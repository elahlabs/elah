import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Project } from '@elah/core'
import { CliError, usageError } from '../lib/errors'
import { readProject, resolveMediaSource } from '../lib/project-io'
import { startHarnessServer } from '../lib/server'
import { launchBrowser } from '../lib/browser'

export interface ExportArgs {
  project: string
  out: string
  codec?: string
  height?: string
  videoBitrate?: string
  audioBitrate?: string
  browser?: string
  headed: boolean
  timeoutSec?: string
  verbose: boolean
}

const CODECS = ['avc', 'vp9', 'vp8'] as const

export async function runExport(args: ExportArgs): Promise<void> {
  const { project, dir } = readProject(args.project)

  if (args.codec !== undefined && !(CODECS as readonly string[]).includes(args.codec)) {
    throw usageError(`--codec must be one of: ${CODECS.join(', ')}`)
  }
  const height = args.height !== undefined ? parsePositiveInt(args.height, '--height') : undefined
  const videoBitrate =
    args.videoBitrate !== undefined ? parsePositiveInt(args.videoBitrate, '--video-bitrate') : undefined
  const audioBitrate =
    args.audioBitrate !== undefined ? parsePositiveInt(args.audioBitrate, '--audio-bitrate') : undefined
  const timeoutMs =
    (args.timeoutSec !== undefined ? parsePositiveInt(args.timeoutSec, '--timeout') : 600) * 1000

  const { exportProject, media } = prepareMedia(project, dir)

  const stderr = (line: string) => process.stderr.write(line)
  const server = await startHarnessServer({
    media,
    onProgress: ({ frame, totalFrames }) => stderr(`\rexporting frame ${frame}/${totalFrames}`),
    onAudioIssue: (message, src) => stderr(`\nwarning: audio clip skipped (${src ?? 'unknown'}): ${message}\n`),
    log: (line) => args.verbose && stderr(`[server] ${line}\n`),
  })

  const browser = await launchBrowser({ browserPath: args.browser, headed: args.headed })
  try {
    const page = await browser.newPage()
    page.on('console', (msg) => {
      if (args.verbose) stderr(`[browser] ${msg.text()}\n`)
    })
    page.on('pageerror', (err) => stderr(`[browser:pageerror] ${err.message}\n`))

    const options = {
      videoCodec: args.codec,
      outputHeight: height,
      videoBitrate,
      audioBitrate,
    }
    await page.addInitScript(
      `globalThis.__ELAH_PROJECT__ = ${JSON.stringify(exportProject)};` +
        `globalThis.__ELAH_OPTIONS__ = ${JSON.stringify(options)};`
    )
    await page.goto(server.origin)

    const buffer = await withTimeout(
      server.result,
      timeoutMs,
      `Export timed out after ${timeoutMs / 1000}s — pass --timeout to raise the limit`
    )
    writeFileSync(resolve(args.out), buffer)
    stderr(`\nwrote ${args.out} (${buffer.length} bytes)\n`)
  } finally {
    await browser.close()
    await server.close()
  }
}

/**
 * Clone the project with every media clip src rewritten to a local-server
 * route; the map feeds the harness server. Missing local files fail here,
 * before a browser ever launches.
 */
function prepareMedia(
  project: Project,
  projectDir: string
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
        if (!/^https?:\/\//.test(resolved) && !existsSync(resolved)) {
          throw new CliError(`Media file not found: ${clip.src} (resolved to ${resolved})`)
        }
        route = `/media/${routeBySource.size}`
        routeBySource.set(resolved, route)
        media.set(route, resolved)
      }
      clip.src = route
    }
  }
  return { exportProject, media }
}

function parsePositiveInt(value: string, flag: string): number {
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw usageError(`${flag} expects a positive integer`)
  }
  return Number(value)
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
