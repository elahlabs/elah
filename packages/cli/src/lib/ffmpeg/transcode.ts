import { spawn } from 'node:child_process'
import { CliError } from '../errors'
import { isRemoteUrl } from '../project-io'
import { attachStderrTail } from './spawn'
import type { FfmpegBinary } from './locate'

/**
 * Converting media Chrome cannot decode into media it can, before the export.
 *
 * Core decodes video through WebCodecs (mediabunny demux → VideoDecoder) and
 * audio through Web Audio's `decodeAudioData` on the whole file. A source
 * fails when mediabunny cannot demux its container (AVI, WMV, FLV), when this
 * Chrome has no decoder for its codec (ProRes everywhere, HEVC on most Linux
 * and on Chromium, AC-3/DTS audio), or when `decodeAudioData` cannot read its
 * container even though the codec is fine (MPEG-TS).
 *
 * The decision is made per source from two facts: what mediabunny reads in
 * Node (`probeSource`) and what this browser says about the exact decoder
 * config (`browserDecodeCheck`, run in the harness page). Only what fails is
 * re-encoded; a stream that decodes and fits the intermediate container is
 * copied, so a container-only problem is a fast remux.
 */

/** Containers `decodeAudioData` reads in Chrome (by mediabunny format name). Measured: MPEG-TS is not one. */
const AUDIO_CONTAINERS = new Set([
  'MP4',
  'QuickTime File Format',
  'Matroska',
  'WebM',
  'Ogg',
  'MP3',
  'WAVE',
  'FLAC',
  'ADTS',
])

/** A decoder config with its `description` made JSON-safe for `page.evaluate`. */
export interface PortableDecoderConfig {
  codec: string
  codedWidth?: number
  codedHeight?: number
  sampleRate?: number
  numberOfChannels?: number
  /** Base64 of the codec's `description` (avcC/hvcC/…), when it has one. */
  description?: string
}

export interface SourceProbe {
  /** mediabunny's format name; null when mediabunny cannot read the container at all. */
  container: string | null
  video?: {
    codec: string | null
    config: PortableDecoderConfig | null
    /** Presentation time of the first frame, in seconds; often not 0 in MPEG-TS. */
    firstTimestamp?: number
  }
  audio?: { codec: string | null; config: PortableDecoderConfig | null }
}

/** What the browser answered for a probe's decoder configs; undefined = no such track. */
export interface DecodeSupport {
  video?: boolean
  audio?: boolean
}

/** The intermediate format conversions are written in, chosen once per browser. */
export interface Intermediate {
  container: 'mp4' | 'webm'
  videoEncoder: string
  videoArgs: readonly string[]
  audioEncoder: string
  audioArgs: readonly string[]
  /** Codecs that may be stream-copied into this container instead of re-encoded. */
  copyVideo: ReadonlySet<string>
  copyAudio: ReadonlySet<string>
  label: string
}

const INTERMEDIATES: readonly Intermediate[] = [
  {
    container: 'mp4',
    // High-quality, fast: a scratch file the export decodes once, not a deliverable.
    videoEncoder: 'libx264',
    videoArgs: ['-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p'],
    audioEncoder: 'aac',
    audioArgs: ['-b:a', '256000'],
    copyVideo: new Set(['avc', 'hevc', 'av1', 'vp9']),
    copyAudio: new Set(['aac', 'mp3']),
    label: 'H.264/AAC MP4',
  },
  {
    container: 'webm',
    videoEncoder: 'libvpx-vp9',
    videoArgs: ['-crf', '18', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-pix_fmt', 'yuv420p'],
    audioEncoder: 'libopus',
    audioArgs: ['-b:a', '192000', '-ar', '48000'],
    copyVideo: new Set(['vp8', 'vp9', 'av1']),
    copyAudio: new Set(['opus', 'vorbis']),
    label: 'VP9/Opus WebM',
  },
]

/** Configs the browser is asked about to choose an intermediate: H.264 High + AAC, then VP9 + Opus. */
export const INTERMEDIATE_PROBES: Readonly<Record<'mp4' | 'webm', { video: string; audio: string }>> = {
  mp4: { video: 'avc1.640028', audio: 'mp4a.40.2' },
  webm: { video: 'vp09.00.10.08', audio: 'opus' },
}

/**
 * Pick the intermediate: the first one this browser decodes and this ffmpeg
 * can write. Branded Chrome gets H.264 MP4; Playwright's Chromium (no H.264)
 * gets VP9 WebM. Returns why not when neither works.
 */
export function pickIntermediate(
  browser: Readonly<Record<'mp4' | 'webm', boolean>>,
  ffmpeg: FfmpegBinary
): Intermediate | string {
  for (const candidate of INTERMEDIATES) {
    if (!browser[candidate.container]) continue
    if (!ffmpeg.encoders.has(candidate.videoEncoder) || !ffmpeg.encoders.has(candidate.audioEncoder)) continue
    return candidate
  }
  return (
    `no intermediate this browser decodes and ffmpeg at '${ffmpeg.path}' can write ` +
    `(needs libx264 + aac for MP4, or libvpx-vp9 + libopus for WebM)`
  )
}

export interface ConversionPlan {
  /** Why Chrome cannot use the source as it is, for the user. */
  reason: string
  copyVideo: boolean
  copyAudio: boolean
  /**
   * The source's first video timestamp, when known. The conversion shifts
   * every stream by it so the first frame lands at exactly 0: core's export
   * reads source time as the container's absolute timestamps, and ffmpeg's
   * default rebase (earliest stream to 0) left an MPEG-TS whose audio starts
   * 21 ms early one frame late.
   */
  videoStart?: number
}

/** null when Chrome can decode the source as it is; otherwise what to convert. Pure. */
export function planConversion(
  probe: SourceProbe,
  support: DecodeSupport,
  intermediate: Pick<Intermediate, 'copyVideo' | 'copyAudio'>
): ConversionPlan | null {
  if (probe.container === null) {
    return { reason: 'its container cannot be read in the browser', copyVideo: false, copyAudio: false }
  }
  const problems: string[] = []
  const video = probe.video
  const videoOk = !video || (video.codec !== null && support.video === true)
  if (!videoOk) problems.push(`${video?.codec ?? 'unknown'} video`)

  const audio = probe.audio
  const audioCodecOk = !audio || (audio.codec !== null && support.audio === true)
  const audioContainerOk = !audio || AUDIO_CONTAINERS.has(probe.container)
  if (!audioCodecOk) problems.push(`${audio?.codec ?? 'unknown'} audio`)
  else if (!audioContainerOk) problems.push(`audio in ${probe.container}`)

  if (problems.length === 0) return null
  return {
    reason: `Chrome cannot decode ${problems.join(' or ')}`,
    copyVideo: !!video && videoOk && video.codec !== null && intermediate.copyVideo.has(video.codec),
    copyAudio: !!audio && audioCodecOk && audio.codec !== null && intermediate.copyAudio.has(audio.codec),
    ...(video?.firstTimestamp !== undefined ? { videoStart: video.firstTimestamp } : {}),
  }
}

/**
 * ffmpeg argv for one conversion. Frame timing is passed through untouched
 * (`-fps_mode passthrough`, or `-vsync` before 5.1), so every source frame
 * keeps its timestamp and the clip's frame math still lands on the same
 * frames. With a known `videoStart`, timestamps are kept as they are
 * (`-copyts`) and shifted by exactly that, negative audio included, so the
 * first frame is at 0 and audio stays in sync. Only the primary video and
 * audio streams are kept.
 */
export function buildTranscodeArgs(
  ffmpeg: FfmpegBinary,
  source: string,
  outPath: string,
  plan: ConversionPlan,
  intermediate: Intermediate
): string[] {
  const passthrough =
    ffmpeg.version === null || ffmpeg.version[0] > 5 || (ffmpeg.version[0] === 5 && ffmpeg.version[1] >= 1)
      ? ['-fps_mode', 'passthrough']
      : ['-vsync', 'passthrough']
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    ...(plan.videoStart !== undefined ? ['-copyts'] : []),
    '-i',
    source,
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
    '-sn',
    '-dn',
    ...(plan.copyVideo ? ['-c:v', 'copy'] : ['-c:v', intermediate.videoEncoder, ...intermediate.videoArgs]),
    ...passthrough,
    ...(plan.copyAudio ? ['-c:a', 'copy'] : ['-c:a', intermediate.audioEncoder, ...intermediate.audioArgs]),
    ...(plan.videoStart !== undefined
      ? ['-output_ts_offset', String(-plan.videoStart), '-avoid_negative_ts', 'disabled']
      : []),
    ...(intermediate.container === 'mp4' ? ['-movflags', '+faststart'] : []),
    '-f',
    intermediate.container,
    outPath,
  ]
}

/** Run one conversion to completion; reject with ffmpeg's argv and stderr tail. */
export function runTranscode(ffmpeg: FfmpegBinary, args: readonly string[], source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg.path, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const stderrTail = attachStderrTail(proc)
    proc.once('error', (err) => reject(new CliError(`Cannot run ffmpeg to convert ${source}: ${err.message}`)))
    proc.once('close', (code) => {
      if (code === 0) return resolve()
      reject(
        new CliError(
          `ffmpeg could not convert ${source} for Chrome (exit ${code})\n` +
            `argv: ffmpeg ${args.join(' ')}\nstderr:\n${stderrTail() || '(empty)'}`
        )
      )
    })
  })
}

/** Read a source's container, primary tracks and decoder configs with mediabunny in Node. */
export async function probeSource(source: string): Promise<SourceProbe> {
  const mb = await import('mediabunny')
  const input = new mb.Input({
    formats: mb.ALL_FORMATS,
    source: isRemoteUrl(source) ? new mb.UrlSource(source) : new mb.FilePathSource(source),
  })
  try {
    let container: string
    try {
      container = (await input.getFormat()).name
    } catch {
      return { container: null }
    }
    const probe: SourceProbe = { container }
    const video = await input.getPrimaryVideoTrack()
    if (video) {
      probe.video = {
        codec: video.codec,
        config: portable(await video.getDecoderConfig().catch(() => null)),
        firstTimestamp: await video.getFirstTimestamp().catch(() => undefined),
      }
    }
    const audio = await input.getPrimaryAudioTrack()
    if (audio) probe.audio = { codec: audio.codec, config: portable(await audio.getDecoderConfig().catch(() => null)) }
    return probe
  } finally {
    input.dispose?.()
  }
}

/** The fields of a WebCodecs decoder config this module reads (no DOM types in Node). */
interface DecoderConfigLike {
  codec: string
  codedWidth?: number
  codedHeight?: number
  sampleRate?: number
  numberOfChannels?: number
  description?: ArrayBuffer | ArrayBufferView
}

export function portable(config: DecoderConfigLike | null): PortableDecoderConfig | null {
  if (!config) return null
  const out: PortableDecoderConfig = { codec: config.codec }
  for (const key of ['codedWidth', 'codedHeight', 'sampleRate', 'numberOfChannels'] as const) {
    if (config[key] !== undefined) out[key] = config[key]
  }
  const { description } = config
  if (description) {
    const bytes = ArrayBuffer.isView(description)
      ? Buffer.from(description.buffer, description.byteOffset, description.byteLength)
      : Buffer.from(description)
    out.description = bytes.toString('base64')
  }
  return out
}

export interface DecodeCheck {
  kind: 'video' | 'audio'
  config: PortableDecoderConfig
}

/**
 * The page-side check, as source text (like harness.ts) so no bundler or test
 * transform can rewrite it before Playwright ships it to the browser. Asks
 * this browser's WebCodecs about each config; a missing API or a thrown check
 * counts as unsupported.
 */
export function browserDecodeCheckJs(checks: readonly DecodeCheck[]): string {
  return `(async (checks) => Promise.all(checks.map(async ({ kind, config }) => {
  const api = kind === 'video' ? globalThis.VideoDecoder : globalThis.AudioDecoder
  if (!api) return false
  const { description, ...rest } = config
  const full = description
    ? { ...rest, description: Uint8Array.from(atob(description), (c) => c.charCodeAt(0)) }
    : rest
  try {
    return (await api.isConfigSupported(full)).supported === true
  } catch {
    return false
  }
})))(${JSON.stringify(checks)})`
}
