import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Browser } from 'playwright-core'
import type { Project } from '@elah/core'
import { CliError } from './errors'
import { resolveMediaSource, isRemoteUrl } from './project-io'
import { startHarnessServer, type ProgressPayload } from './server'
import { launchBrowser } from './browser'

export type VideoCodec = 'avc' | 'vp9' | 'vp8'
export const CODECS: readonly VideoCodec[] = ['avc', 'vp9', 'vp8']

export interface RenderSessionArgs {
  browserPath?: string
  headed?: boolean
}

export interface RenderJobOptions {
  videoCodec?: VideoCodec
  outputHeight?: number
  videoBitrate?: number
  audioBitrate?: number
  /** Default 600_000 (10 minutes). */
  timeoutMs?: number
}

export interface RenderCallbacks {
  onProgress?: (p: ProgressPayload) => void
  /** Audio-clip-skipped warnings and in-page errors. */
  onWarning?: (message: string) => void
  /** Verbose [server]/[browser] log lines. */
  onLog?: (line: string) => void
}

export interface RenderSession {
  /** Launch the browser now (idempotent). */
  warmup(): Promise<void>
  browserConnected(): boolean
  render(
    project: Project,
    projectDir: string,
    options?: RenderJobOptions,
    callbacks?: RenderCallbacks
  ): Promise<Buffer>
  close(): Promise<void>
}

const DEFAULT_TIMEOUT_MS = 600_000

export function createRenderSession(args: RenderSessionArgs = {}): RenderSession {
  let browserPromise: Promise<Browser> | undefined
  let lastBrowser: Browser | undefined

  async function ensureBrowser(): Promise<Browser> {
    if (browserPromise) {
      const existing = await browserPromise
      if (existing.isConnected()) return existing
    }
    browserPromise = launchBrowser(args)
    const browser = await browserPromise
    lastBrowser = browser
    return browser
  }

  return {
    async warmup(): Promise<void> {
      await ensureBrowser()
    },

    browserConnected(): boolean {
      return lastBrowser?.isConnected() ?? false
    },

    async render(
      project: Project,
      projectDir: string,
      options: RenderJobOptions = {},
      callbacks: RenderCallbacks = {}
    ): Promise<Buffer> {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const token = randomUUID()
      const { exportProject, media } = prepareMedia(project, projectDir, token)

      const server = await startHarnessServer({
        token,
        media,
        onProgress: (p) => callbacks.onProgress?.(p),
        onAudioIssue: (message, src) =>
          callbacks.onWarning?.(`audio clip skipped (${src ?? 'unknown'}): ${message}`),
        log: (line) => callbacks.onLog?.(`[server] ${line}`),
      })

      const browser = await ensureBrowser()
      const onDisconnect = () =>
        server.fail(new CliError('Browser disconnected before the export finished'))
      browser.on('disconnected', onDisconnect)

      let page: Awaited<ReturnType<Browser['newPage']>> | undefined
      try {
        // Attach the timeout wrapper (and a no-op catch) immediately: the page
        // can POST /error before page.goto() resolves, and an unhandled
        // rejection here would crash the process past the cleanup in `finally`.
        const result = withTimeout(
          server.result,
          timeoutMs,
          `Export timed out after ${timeoutMs / 1000}s — pass a higher timeout to raise the limit`
        )
        result.catch(() => {})

        page = await browser.newPage()
        page.on('crash', () => server.fail(new CliError('Browser tab crashed during export')))
        page.on('console', (msg) => callbacks.onLog?.(`[browser] ${msg.text()}`))
        page.on('pageerror', (err) => callbacks.onWarning?.(`[browser:pageerror] ${err.message}`))

        const renderOptions = {
          videoCodec: options.videoCodec,
          outputHeight: options.outputHeight,
          videoBitrate: options.videoBitrate,
          audioBitrate: options.audioBitrate,
        }
        // Double-stringify → JSON.parse keeps the page side a data-only channel
        // (an object literal would e.g. honour a "__proto__" key).
        await page.addInitScript(
          `globalThis.__ELAH_PROJECT__ = JSON.parse(${JSON.stringify(JSON.stringify(exportProject))});` +
            `globalThis.__ELAH_OPTIONS__ = JSON.parse(${JSON.stringify(JSON.stringify(renderOptions))});`
        )
        await page.goto(server.origin)

        return await result
      } finally {
        browser.off('disconnected', onDisconnect)
        await page?.close().catch(() => {})
        await server.close()
        if (!browser.isConnected()) browserPromise = undefined
      }
    },

    async close(): Promise<void> {
      if (browserPromise) {
        const browser = await browserPromise.catch(() => undefined)
        await browser?.close().catch(() => {})
      }
      browserPromise = undefined
      lastBrowser = undefined
    },
  }
}

/**
 * Clone the project with every media clip src rewritten to a token-guarded
 * local-server route; the map feeds the harness server. Missing local files
 * fail here, before a browser ever launches.
 */
export function prepareMedia(
  project: Project,
  projectDir: string,
  token: string
): { exportProject: Project; media: Map<string, string> } {
  const exportProject = structuredClone(project)
  const media = new Map<string, string>()
  const routeBySource = new Map<string, string>()

  for (const clips of Object.values(exportProject.clips)) {
    for (const clip of clips) {
      if (!clip.src) continue
      if (clip.type !== 'video' && clip.type !== 'audio' && clip.type !== 'image') continue

      const resolved = resolveMediaSource(clip.src, projectDir)
      let route = routeBySource.get(resolved)
      if (!route) {
        if (!isRemoteUrl(resolved) && !existsSync(resolved)) {
          throw new CliError(`Media file not found: ${clip.src} (resolved to ${resolved})`)
        }
        route = `/media/${token}/${routeBySource.size}`
        routeBySource.set(resolved, route)
        media.set(route, resolved)
      }
      clip.src = route
    }
  }
  return { exportProject, media }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const timer = setTimeout(() => rej(new CliError(message)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        res(v)
      },
      (e: Error) => {
        clearTimeout(timer)
        rej(e)
      }
    )
  })
}
