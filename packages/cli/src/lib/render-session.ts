import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Browser } from 'playwright-core'
import type { Clip, Project } from '@elah/core'
import { CliError } from './errors'
import { resolveMediaSource, isRemoteUrl } from './project-io'
import { startHarnessServer, type ProgressPayload } from './server'
import { launchBrowser } from './browser'
import { locateFfmpeg, type FfmpegBinary } from './ffmpeg/locate'
import { pickEncoder, type EncoderChoice, type EncoderDecision } from './ffmpeg/select'
import { createFfmpegEncodeSink, type FfmpegEncodeSink } from './ffmpeg/sink'
import { DEFAULT_AUDIO_BITRATE, DEFAULT_VIDEO_BITRATE } from './ffmpeg/encoder'
import { createSourcePreparer } from './ffmpeg/prepare'
import { resolveOutputFormat, type Container, type OutputFormat, type VideoCodec } from './format'

export { CODECS, type VideoCodec } from './format'

export interface RenderSessionArgs {
  browserPath?: string
  headed?: boolean
  /** Explicit ffmpeg executable (--ffmpeg); otherwise ELAH_FFMPEG, then PATH. */
  ffmpegPath?: string
}

export interface RenderJobOptions {
  /** Default 'mp4'. MP4 takes avc/hevc/av1, WebM takes vp9/vp8/av1 (core's matrix). */
  container?: Container
  /** Default per container: avc for MP4, vp9 for WebM. */
  videoCodec?: VideoCodec
  outputHeight?: number
  videoBitrate?: number
  audioBitrate?: number
  /**
   * Who encodes the MP4. Default 'auto': ffmpeg when it is installed and can
   * write the codec, else Chrome's WebCodecs encoder (with a warning). Chrome
   * composites every frame either way.
   */
  encoder?: EncoderChoice
  /** Default 600_000 (10 minutes). */
  timeoutMs?: number
}

export interface RenderCallbacks {
  onProgress?: (p: ProgressPayload) => void
  /** Audio-clip-skipped warnings, in-page errors, and an 'auto' fallback to Chrome. */
  onWarning?: (message: string) => void
  /** Verbose [server]/[browser] log lines. */
  onLog?: (line: string) => void
  /** Which encoder this render uses, e.g. 'ffmpeg (libx264)' or 'chrome'. Called once, before rendering. */
  onEncoder?: (description: string) => void
  /** Progress the user should see before frames start, e.g. converting a source Chrome cannot decode. */
  onStatus?: (message: string) => void
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
  // Looked up once per session; a failure is remembered so serve mode doesn't
  // re-spawn a missing binary on every request.
  let ffmpegPromise: Promise<FfmpegBinary | Error> | undefined
  const warnedFallbacks = new Set<string>()
  const getFfmpeg = (): Promise<FfmpegBinary | Error> =>
    (ffmpegPromise ??= locateFfmpeg({ ffmpegPath: args.ffmpegPath }).catch((err: Error) => err))
  // Sources Chrome cannot decode, converted once per session (see ffmpeg/prepare.ts).
  const preparer = createSourcePreparer(getFfmpeg)

  async function decideEncoder(
    format: OutputFormat,
    options: RenderJobOptions,
    callbacks: RenderCallbacks
  ): Promise<EncoderDecision> {
    const choice = options.encoder ?? 'auto'
    const decision = pickEncoder(choice, format, choice === 'chrome' ? undefined : await getFfmpeg())
    if (decision.encoder === 'chrome' && decision.fallbackReason && !warnedFallbacks.has(decision.fallbackReason)) {
      warnedFallbacks.add(decision.fallbackReason)
      callbacks.onWarning?.(`encoding with Chrome instead of ffmpeg: ${decision.fallbackReason}`)
    }
    callbacks.onEncoder?.(decision.encoder === 'ffmpeg' ? `ffmpeg (${decision.videoEncoder})` : 'chrome')
    return decision
  }

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
      const format = resolveOutputFormat({ container: options.container, videoCodec: options.videoCodec })
      const token = randomUUID()
      const { exportProject, media, decodeRoutes } = prepareMedia(project, projectDir, token)
      const decision = await decideEncoder(format, options, callbacks)

      let encodeSink: FfmpegEncodeSink | undefined
      if (decision.encoder === 'ffmpeg') {
        encodeSink = await createFfmpegEncodeSink({
          ffmpeg: decision.ffmpeg,
          container: format.container,
          videoEncoder: decision.videoEncoder,
          audioEncoder: decision.audioEncoder,
          fps: project.fps,
          videoBitrate: options.videoBitrate ?? DEFAULT_VIDEO_BITRATE,
          audioBitrate: options.audioBitrate ?? DEFAULT_AUDIO_BITRATE,
        })
      }

      let server: Awaited<ReturnType<typeof startHarnessServer>>
      try {
        server = await startHarnessServer({
          token,
          media,
          encodeSink,
          onProgress: (p) => callbacks.onProgress?.(p),
          onAudioIssue: (message, src) =>
            callbacks.onWarning?.(`audio clip skipped (${src ?? 'unknown'}): ${message}`),
          log: (line) => callbacks.onLog?.(`[server] ${line}`),
        })
      } catch (err) {
        await encodeSink?.dispose()
        throw err
      }
      // A tab crash or disconnect can reject this before anything awaits it
      // (while sources are still being converted); the real handler is below.
      server.result.catch(() => {})

      let browser: Browser
      try {
        browser = await ensureBrowser()
      } catch (err) {
        await server.close()
        await encodeSink?.dispose()
        throw err
      }
      const onDisconnect = () =>
        server.fail(new CliError('Browser disconnected before the export finished'))
      browser.on('disconnected', onDisconnect)

      let page: Awaited<ReturnType<Browser['newPage']>> | undefined
      try {
        page = await browser.newPage()
        page.on('crash', () => server.fail(new CliError('Browser tab crashed during export')))
        page.on('console', (msg) => callbacks.onLog?.(`[browser] ${msg.text()}`))
        page.on('pageerror', (err) => callbacks.onWarning?.(`[browser:pageerror] ${err.message}`))

        // Before the export: ask this browser about every video/audio source
        // and point the ones it cannot decode at ffmpeg-converted copies. The
        // check needs a page on the harness origin (WebCodecs is secure-context only).
        if (decodeRoutes.size > 0) {
          await page.goto(`${server.origin}/blank`)
          await preparer.prepare(page, media, decodeRoutes, {
            onStatus: callbacks.onStatus,
            onWarning: callbacks.onWarning,
          })
        }

        // The timeout covers the export, not the conversions above. Attach it
        // (and a no-op catch) before page.goto(): the page can POST /error
        // before goto resolves, and an unhandled rejection here would crash
        // the process past the cleanup in `finally`.
        const result = withTimeout(
          server.result,
          timeoutMs,
          `Export timed out after ${timeoutMs / 1000}s — pass a higher timeout to raise the limit`
        )
        result.catch(() => {})

        const renderOptions = {
          encoder: decision.encoder,
          container: format.container,
          videoCodec: format.videoCodec,
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
        await encodeSink?.dispose()
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
      await preparer.dispose()
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
): { exportProject: Project; media: Map<string, string>; decodeRoutes: Set<string> } {
  const exportProject = structuredClone(project)
  const media = new Map<string, string>()
  /** Routes read by video/audio clips — the ones whose codecs Chrome must decode. */
  const decodeRoutes = new Set<string>()
  const routeBySource = new Map<string, string>()

  // A compound clip holds a whole nested project whose media needs the same
  // routes; an animated-image sequence clip reads its file from `src` too.
  const visit = (p: Project): void => {
    for (const clips of Object.values(p.clips)) {
      for (const clip of clips) {
        if (clip.type === 'compound' && clip.compound) visit(clip.compound.project)
        if (!clip.src) continue
        if (!MEDIA_CLIP_TYPES.has(clip.type)) continue

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
        if (clip.type === 'video' || clip.type === 'audio') decodeRoutes.add(route)
      }
    }
  }
  visit(exportProject)
  return { exportProject, media, decodeRoutes }
}

/** Clip types whose `src` is a media file the harness must serve. */
const MEDIA_CLIP_TYPES: ReadonlySet<Clip['type']> = new Set([
  'video',
  'audio',
  'image',
  'sequence',
])

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
