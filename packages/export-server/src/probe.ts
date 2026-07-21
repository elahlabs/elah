/**
 * All mediabunny usage in this package lives here: probing, presentation-
 * timestamp index construction, and post-export output validation. mediabunny
 * is a pure-JS demuxer/index reader in this module — it never decodes or
 * encodes a single sample. Decode is ffmpeg's job (decoder.ts); encode is
 * ffmpeg's job too (encoder.ts).
 *
 * `probeMedia` is a direct port of packages/cli/src/lib/probe.ts:15, adapted
 * to throw ExportServerError instead of CliError. Everything else here exists
 * to build `buildVideoFrameIndex`'s presentation-timestamp index, which is
 * what lets ffmpeg decode frame-accurately: see decoder.ts / plan.ts for how
 * targets are computed against it (ExportWorker.ts:277-287 is the browser
 * exporter's equivalent — it feeds mediabunny's own CanvasSink the same
 * per-frame source timestamps we compute here for ffmpeg).
 */

import { ExportServerError } from './errors'

import type { Input, InputVideoTrack } from 'mediabunny'
import type { MediaInfo, VideoSourceInfo, VideoFrameIndex, OutputValidation } from './types'

/** True for http(s) sources, which mediabunny reads via ranged UrlSource requests. */
function isRemoteUrl(source: string): boolean {
  return /^https?:\/\//.test(source)
}

/** Opens an `Input` over a local path or remote URL. Caller owns `.dispose()`. */
async function openInput(source: string): Promise<Input> {
  const mb = await import('mediabunny')
  return new mb.Input({
    formats: mb.ALL_FORMATS,
    source: isRemoteUrl(source) ? new mb.UrlSource(source) : new mb.FilePathSource(source),
  })
}

/**
 * The duration + dimension + frame-rate facts every other function in this
 * module needs about a video track. Factored out because `probeVideoSource`
 * and `buildVideoFrameIndex` both need it (the index embeds a `VideoSourceInfo`).
 */
async function readVideoSourceInfo(track: InputVideoTrack): Promise<VideoSourceInfo> {
  const [durationSec, displayWidth, displayHeight, codedWidth, codedHeight, stats] = await Promise.all([
    track.computeDuration(),
    track.getDisplayWidth(),
    track.getDisplayHeight(),
    track.getCodedWidth(),
    track.getCodedHeight(),
    track.computePacketStats(),
  ])
  return {
    durationSec,
    displayWidth,
    displayHeight,
    codedWidth,
    codedHeight,
    averageFrameRate: stats.averagePacketRate,
  }
}

/**
 * Synthesizes a constant-frame-rate presentation-timestamp index when the
 * container yields no usable packet timestamps (rare; some live/fragmented
 * inputs). `exact: false` tells callers (exportProject) to push a warning
 * rather than silently trusting fabricated timestamps.
 *
 * When rate or duration can't be established either, an empty index is the
 * honest answer: every target timestamp maps to -1 (nothing decoded) rather
 * than a guessed frame count.
 */
function synthesizeCfrIndex(info: VideoSourceInfo): Float64Array {
  const rate = info.averageFrameRate
  if (!(rate > 0) || !(info.durationSec > 0)) return new Float64Array(0)
  const frameCount = Math.max(1, Math.round(info.durationSec * rate))
  const timestamps = new Float64Array(frameCount)
  for (let i = 0; i < frameCount; i++) timestamps[i] = i / rate
  return timestamps
}

/** Port of packages/cli/src/lib/probe.ts:15 — duration + coded dimensions. */
export async function probeMedia(source: string): Promise<MediaInfo> {
  let input: Input | undefined
  try {
    input = await openInput(source)
    const durationSec = await input.computeDuration()
    const video = await input.getPrimaryVideoTrack()
    return {
      durationSec,
      width: video ? await video.getCodedWidth() : undefined,
      height: video ? await video.getCodedHeight() : undefined,
    }
  } catch (err) {
    throw new ExportServerError('PROBE_FAILED', `Cannot probe media '${source}': ${(err as Error).message}`)
  } finally {
    input?.dispose?.()
  }
}

/** Duration + display (post-rotation, PAR-corrected) dimensions + average frame rate. */
export async function probeVideoSource(source: string): Promise<VideoSourceInfo> {
  let input: Input | undefined
  try {
    input = await openInput(source)
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('source has no video track')
    return await readVideoSourceInfo(track)
  } catch (err) {
    throw new ExportServerError(
      'PROBE_FAILED',
      `Cannot probe video source '${source}': ${(err as Error).message}`,
    )
  } finally {
    input?.dispose?.()
  }
}

/**
 * Full presentation-timestamp index of the source's primary video track,
 * ascending. Built from metadata-only packets — no sample data is read and
 * nothing is decoded.
 *
 * `packets()` yields in *decode* order; the cursor walk in decoder.ts needs
 * *presentation* order, so the collected timestamps are sorted before return.
 * This is the one line that makes B-frame sources (decode order !=
 * presentation order) safe to drive with a monotonic cursor.
 */
export async function buildVideoFrameIndex(source: string): Promise<VideoFrameIndex> {
  let input: Input | undefined
  try {
    input = await openInput(source)
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('source has no video track')

    const info = await readVideoSourceInfo(track)

    const mb = await import('mediabunny')
    const sink = new mb.EncodedPacketSink(track)
    const ts: number[] = []
    for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
      ts.push(packet.timestamp)
    }

    if (ts.length === 0) {
      return { ...info, timestamps: synthesizeCfrIndex(info), exact: false }
    }

    ts.sort((a, b) => a - b)
    return { ...info, timestamps: Float64Array.from(ts), exact: true }
  } catch (err) {
    throw new ExportServerError(
      'PROBE_FAILED',
      `Cannot build frame index for '${source}': ${(err as Error).message}`,
    )
  } finally {
    input?.dispose?.()
  }
}

/**
 * Re-opens the finished MP4 and reports what actually landed in it. Never
 * throws on a content mismatch (missing audio, short frame count, etc.) —
 * those are policy decisions for exportProject, which fails the export only
 * when there is no video track at all. This function only throws if the file
 * itself can't be opened/read.
 */
export async function validateOutputFile(path: string): Promise<OutputValidation> {
  let input: Input | undefined
  try {
    input = await openInput(path)
    const [durationSec, videoTrack, audioTrack] = await Promise.all([
      input.computeDuration(),
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ])

    if (!videoTrack) {
      return { durationSec, frameCount: null, width: 0, height: 0, hasAudioTrack: !!audioTrack }
    }

    const [width, height, stats] = await Promise.all([
      videoTrack.getDisplayWidth(),
      videoTrack.getDisplayHeight(),
      videoTrack.computePacketStats(),
    ])

    return {
      durationSec,
      frameCount: stats.packetCount,
      width,
      height,
      hasAudioTrack: !!audioTrack,
    }
  } catch (err) {
    throw new ExportServerError('PROBE_FAILED', `Cannot validate output '${path}': ${(err as Error).message}`)
  } finally {
    input?.dispose?.()
  }
}
