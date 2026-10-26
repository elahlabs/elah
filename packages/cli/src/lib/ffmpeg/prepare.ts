import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isRemoteUrl } from '../project-io'
import type { FfmpegBinary } from './locate'
import {
  browserDecodeCheckJs,
  buildTranscodeArgs,
  INTERMEDIATE_PROBES,
  pickIntermediate,
  planConversion,
  probeSource,
  runTranscode,
  type DecodeCheck,
  type Intermediate,
  type SourceProbe,
} from './transcode'

/** The slice of a Playwright page this needs: evaluate a source string, after the page is on the harness origin. */
export interface EvaluatingPage {
  evaluate<T>(expression: string): Promise<T>
}

export interface PrepareCallbacks {
  /** Progress the user should see ("converting …", "converted …"). */
  onStatus?: (message: string) => void
  /** A source that stays undecodable (no ffmpeg, no usable intermediate). */
  onWarning?: (message: string) => void
}

export interface SourcePreparer {
  /**
   * Point every route whose source this browser cannot decode at a converted
   * copy. `media` (route → source) is the harness server's live map and is
   * updated in place; `routes` are the routes video/audio clips read.
   */
  prepare(
    page: EvaluatingPage,
    media: Map<string, string>,
    routes: ReadonlySet<string>,
    callbacks?: PrepareCallbacks
  ): Promise<void>
  /** Delete every converted file. */
  dispose(): Promise<void>
}

/**
 * One per render session. Conversions are cached by source identity (path +
 * size + mtime, or URL) for the session's life, so `elah serve` converts a
 * piece of footage once, not on every request; concurrent renders share the
 * same in-flight conversion.
 */
export function createSourcePreparer(getFfmpeg: () => Promise<FfmpegBinary | Error>): SourcePreparer {
  let workDir: Promise<string> | undefined
  let intermediate: Promise<Intermediate | string> | undefined
  /** source identity → path to serve instead (the source itself when no conversion was possible). */
  const prepared = new Map<string, Promise<string>>()
  let converted = 0

  async function identity(source: string): Promise<string> {
    if (isRemoteUrl(source)) return source
    const s = await stat(source)
    return `${source}|${s.size}|${s.mtimeMs}`
  }

  async function chooseIntermediate(page: EvaluatingPage, ffmpeg: FfmpegBinary): Promise<Intermediate | string> {
    const checks: DecodeCheck[] = []
    for (const container of ['mp4', 'webm'] as const) {
      checks.push({ kind: 'video', config: { codec: INTERMEDIATE_PROBES[container].video, codedWidth: 1920, codedHeight: 1080 } })
      checks.push({ kind: 'audio', config: { codec: INTERMEDIATE_PROBES[container].audio, sampleRate: 48_000, numberOfChannels: 2 } })
    }
    const [mp4Video, mp4Audio, webmVideo, webmAudio] = await page.evaluate<boolean[]>(browserDecodeCheckJs(checks))
    return pickIntermediate({ mp4: !!(mp4Video && mp4Audio), webm: !!(webmVideo && webmAudio) }, ffmpeg)
  }

  async function prepareOne(source: string, page: EvaluatingPage, callbacks: PrepareCallbacks): Promise<string> {
    const probe: SourceProbe = await probeSource(source)
    const checks: DecodeCheck[] = []
    if (probe.video?.config) checks.push({ kind: 'video', config: probe.video.config })
    if (probe.audio?.config) checks.push({ kind: 'audio', config: probe.audio.config })
    const answers = checks.length > 0 ? await page.evaluate<boolean[]>(browserDecodeCheckJs(checks)) : []
    const support = {
      video: probe.video?.config ? answers[0] : false,
      audio: probe.audio?.config ? answers[probe.video?.config ? 1 : 0] : false,
    }

    // Whether to convert doesn't depend on the copy sets; they are filled in
    // below, once the intermediate (and so the container) is known.
    const needed = planConversion(probe, support, { copyVideo: new Set(), copyAudio: new Set() })
    if (!needed) return source

    const ffmpeg = await getFfmpeg()
    if (ffmpeg instanceof Error) {
      callbacks.onWarning?.(
        `${source}: ${needed.reason}, and ffmpeg is not available to convert it (${ffmpeg.message})`
      )
      return source
    }
    intermediate ??= chooseIntermediate(page, ffmpeg)
    const target = await intermediate
    if (typeof target === 'string') {
      callbacks.onWarning?.(`${source}: ${needed.reason}, and it cannot be converted: ${target}`)
      return source
    }

    const plan = planConversion(probe, support, target)!
    workDir ??= mkdtemp(join(tmpdir(), 'elah-convert-'))
    const outPath = join(await workDir, `source-${converted++}.${target.container}`)
    const what = plan.copyVideo && plan.copyAudio
      ? 'remuxing'
      : plan.copyVideo
        ? 'converting the audio'
        : plan.copyAudio
          ? 'converting the video'
          : 'converting'
    callbacks.onStatus?.(`${source}: ${needed.reason}; ${what} to ${target.label} with ffmpeg`)
    const started = Date.now()
    await runTranscode(ffmpeg, buildTranscodeArgs(ffmpeg, source, outPath, plan, target), source)
    callbacks.onStatus?.(`${source}: converted in ${((Date.now() - started) / 1000).toFixed(1)}s`)
    return outPath
  }

  return {
    async prepare(page, media, routes, callbacks = {}): Promise<void> {
      await Promise.all(
        [...routes].map(async (route) => {
          const source = media.get(route)
          if (source === undefined) return
          const key = await identity(source)
          let pending = prepared.get(key)
          if (!pending) {
            pending = prepareOne(source, page, callbacks)
            prepared.set(key, pending)
            // A failed conversion is not cached: the next render retries it.
            pending.catch(() => prepared.delete(key))
          }
          media.set(route, await pending)
        })
      )
    },

    async dispose(): Promise<void> {
      const dir = workDir && (await workDir.catch(() => undefined))
      workDir = undefined
      prepared.clear()
      if (dir) await rm(dir, { recursive: true, force: true })
    },
  }
}
