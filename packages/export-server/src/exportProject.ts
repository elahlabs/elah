/**
 * exportProject — the frame loop that ties every leaf module together.
 *
 * Mirrors packages/core/src/export/ExportWorker.ts:303-361 (resolve -> decode
 * -> composite -> encode, fully serial) but is split into two passes rather
 * than one, because ffmpeg's decode primitive is a forward-only pipe, not
 * mediabunny's random-access `canvasesAtTimestamps()` generator:
 *
 *   pass 1 (planExport, plan.ts)      — scan every frame's Scene once, up
 *                                        front, to learn each clip's whole
 *                                        source-frame timeline. ffmpeg's `-ss`
 *                                        seek and argv need this before a
 *                                        single process can be spawned.
 *   pass 2 (this file's frame loop)   — resolve the Scene AGAIN, per frame,
 *                                        for the actual composite (plan.ts's
 *                                        output is deliberately too
 *                                        compressed to composite from — it
 *                                        keeps only what the decoder cursor
 *                                        needs). Every clip decoder is opened
 *                                        lazily on its first active frame and
 *                                        closed on its last, so process count
 *                                        tracks simultaneously-active clips
 *                                        (i.e. transition overlaps), not the
 *                                        project's total clip count.
 *
 * This module never reads `Project` for anything except handing it, opaque,
 * to `resolveTimeline`/`planExport` — every decode/composite/encode decision
 * downstream of those two calls is made from a `Scene` or a `plan.ts` type.
 */

import { rm, stat } from 'node:fs/promises'

import { resolveTimeline } from '@elah/core'
import type { Project } from '@elah/core'
import { loadImage } from '@napi-rs/canvas'
import type { Image } from '@napi-rs/canvas'

import { ExportServerError } from './errors'
import { planExport, mapSourceFramesToIndices } from './plan'
import { buildVideoFrameIndex, validateOutputFile } from './probe'
import { locateFfmpeg } from './ffmpeg/locate'
import { ClipDecoder } from './ffmpeg/decoder'
import { FrameEncoder } from './ffmpeg/encoder'
import { buildAudioMix } from './ffmpeg/audio'
import { FrameCompositor } from './render/frame'
import { createFontRegistry } from './render/fonts'
import { resolveSource } from './util/sources'

import type {
  DecodedFrame,
  ExportProjectOptions,
  ExportResult,
  OutputValidation,
  VideoFrameIndex,
} from './types'

/** Runtime, per-video-clip state the frame loop drives — the compiled form of a `VideoClipPlan`. */
interface VideoRuntime {
  clipId: string
  source: string
  firstFrame: number
  lastFrame: number
  /** One entry per export frame in `[firstFrame, lastFrame]` — mapSourceFramesToIndices's output. */
  sourceIndices: Int32Array
  decodeWidth: number
  decodeHeight: number
  displayWidth: number
  displayHeight: number
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ExportServerError('ABORTED', 'Export aborted by caller signal.')
  }
}

/**
 * Nearest even integer, biasing up on a tie — H.264 4:2:0 chroma subsampling
 * requires both encoder output dimensions to be even; odd dims make ffmpeg
 * refuse `yuv420p` outright.
 */
function roundToEven(n: number): number {
  const r = Math.max(2, Math.round(n))
  return r % 2 === 0 ? r : r + 1
}

/**
 * The pixel size ffmpeg is asked to decode a source AT — the true display
 * size, unless `decodeMaxHeight` caps it, in which case both dimensions scale
 * down together so the source's aspect ratio is preserved. This is purely a
 * decode-bandwidth knob: `FrameCompositor` always places the resulting frame
 * with its TRUE display size (see render/frame.ts's `drawMedia`), so capping
 * this never moves anything on stage, it only trades sharpness for speed.
 *
 * Unlike the encoder's output dimensions, these do not need to be even: the
 * buffer is an intermediate RGBA scratch surface, never hallucinatorally
 * touched by yuv420p subsampling.
 */
function computeDecodeDims(
  displayWidth: number,
  displayHeight: number,
  maxHeight: number | undefined,
): { width: number; height: number } {
  if (!maxHeight || displayHeight <= maxHeight) {
    return { width: Math.max(1, Math.round(displayWidth)), height: Math.max(1, Math.round(displayHeight)) }
  }
  const scale = maxHeight / displayHeight
  return { width: Math.max(1, Math.round(displayWidth * scale)), height: Math.max(1, Math.round(maxHeight)) }
}

/** Deletes a possibly-partial output file, tolerating it never having been created. */
async function removePartialOutput(outPath: string): Promise<void> {
  await rm(outPath, { force: true })
}

/**
 * Renders a `Project` to an MP4 with system ffmpeg — no browser, no
 * WebCodecs. Resolves the same `Scene`s the editor's preview and the browser
 * exporter resolve, so output matches the editor; see this file's header for
 * why the Scene is resolved twice (once compressed for planning, once in
 * full for compositing).
 */
export async function exportProject(project: Project, options: ExportProjectOptions): Promise<ExportResult> {
  const startedAt = performance.now()
  const warnings: string[] = []
  const signal = options.signal
  const projectDir = options.projectDir ?? process.cwd()
  const resolveSrc = options.resolveSource ?? ((src: string) => resolveSource(src, projectDir))

  checkAborted(signal)
  options.onProgress?.({ phase: 'planning', frame: 0, totalFrames: 0 })
  const plan = planExport(project, { resolveSource: resolveSrc })

  if (plan.totalFrames <= 0) {
    throw new ExportServerError(
      'EMPTY_PROJECT',
      'Project has no clips on its timeline (getTotalFrames returned 0) — nothing to export.',
    )
  }

  checkAborted(signal)

  const audioSampleRate = options.audioSampleRate ?? 48_000
  const audioChannels = options.audioChannels ?? 2
  const audioMix = buildAudioMix(plan.audios, {
    fps: plan.fps,
    totalFrames: plan.totalFrames,
    sampleRate: audioSampleRate,
    channels: audioChannels,
    masterVolume: options.masterVolume,
  })

  const videoEncoderName = options.videoEncoder ?? 'libx264'
  const audioEncoderName = options.audioEncoder ?? 'aac'
  const requireEncoders = audioMix ? [videoEncoderName, audioEncoderName] : [videoEncoderName]

  const ffmpeg = await locateFfmpeg({ ffmpegPath: options.ffmpegPath, requireEncoders })

  checkAborted(signal)
  options.onProgress?.({ phase: 'probing', frame: 0, totalFrames: plan.totalFrames })

  // One PTS index per unique source, not per clip: two clips trimmed from the
  // same file describe the same presentation timeline, and probing is a
  // metadata-only index read but still one file open per call — no reason to
  // pay it twice.
  const frameIndexBySource = new Map<string, VideoFrameIndex>()
  for (const video of plan.videos) {
    if (frameIndexBySource.has(video.source)) continue
    checkAborted(signal)
    const index = await buildVideoFrameIndex(video.source)
    if (!index.exact) {
      warnings.push(
        `Source '${video.source}' had no usable packet timestamps; its presentation-timestamp ` +
          'index was synthesized from the average frame rate, so frame accuracy for this source is approximate.',
      )
    }
    frameIndexBySource.set(video.source, index)
  }

  checkAborted(signal)

  // Keyed by the RAW Scene src — the same string `FrameCompositor` looks
  // images up by (`ActiveImageClip.src`, never a resolved path) — so a
  // relative/`file://` src that `resolveSource` rewrites still resolves to
  // its loaded image at render time. `entry.source` (the resolved, openable
  // path/URL) is used only for the one-time `loadImage` call.
  const imagesBySource = new Map<string, Image>()
  for (const entry of plan.imageSources) {
    checkAborted(signal)
    try {
      imagesBySource.set(entry.src, await loadImage(entry.source))
    } catch (err) {
      warnings.push(`Failed to load image '${entry.source}': ${(err as Error).message} — it will be skipped.`)
    }
  }

  const fontRegistry = createFontRegistry({ fonts: options.fonts, fallbackFamily: options.fallbackFontFamily })

  // Output dims: width follows the stage aspect ratio from the (possibly
  // overridden) output height. Both are rounded to even — see roundToEven.
  const requestedHeight = options.outputHeight ?? plan.stage.height
  const stageAspect = plan.stage.width / plan.stage.height
  const outputHeight = roundToEven(requestedHeight)
  const outputWidth = roundToEven(outputHeight * stageAspect)

  const decodeMaxHeight = options.decodeMaxHeight
  const videoRuntimes: VideoRuntime[] = plan.videos.map(video => {
    const index = frameIndexBySource.get(video.source)
    if (!index) {
      // Cannot happen — every plan.videos[].source was probed above — but a
      // thrown, named error beats an unchecked `!` if this invariant ever slips.
      throw new ExportServerError('PLAN_INVALID', `No frame index built for source '${video.source}'`)
    }
    const sourceIndices = mapSourceFramesToIndices(video.sourceFrames, plan.fps, index.timestamps)
    const { width: decodeWidth, height: decodeHeight } = computeDecodeDims(
      index.displayWidth,
      index.displayHeight,
      decodeMaxHeight,
    )
    return {
      clipId: video.clipId,
      source: video.source,
      firstFrame: video.firstFrame,
      lastFrame: video.lastFrame,
      sourceIndices,
      decodeWidth,
      decodeHeight,
      displayWidth: index.displayWidth,
      displayHeight: index.displayHeight,
    }
  })

  checkAborted(signal)

  const compositor = new FrameCompositor({ width: outputWidth, height: outputHeight, fonts: fontRegistry })
  const openDecoders = new Map<string, ClipDecoder>()
  const warnedShortClips = new Set<string>()

  const encoder = FrameEncoder.start({
    ffmpeg,
    outPath: options.outPath,
    width: outputWidth,
    height: outputHeight,
    fps: plan.fps,
    videoEncoder: videoEncoderName,
    videoBitrate: options.videoBitrate ?? 8_000_000,
    audio: audioMix
      ? { spec: audioMix, encoder: audioEncoderName, bitrate: options.audioBitrate ?? 128_000 }
      : null,
    extraOutputArgs: options.extraOutputArgs,
    signal,
  })

  try {
    options.onProgress?.({ phase: 'encoding', frame: 0, totalFrames: plan.totalFrames })

    for (let frame = 0; frame < plan.totalFrames; frame++) {
      checkAborted(signal)

      // Open any clip decoder whose first active export frame is this one.
      // Lazy, not up front: process count then tracks simultaneously-active
      // clips (a transition's outgoing + incoming pair) rather than the
      // project's total clip count.
      for (const runtime of videoRuntimes) {
        if (runtime.firstFrame === frame && !openDecoders.has(runtime.clipId)) {
          const index = frameIndexBySource.get(runtime.source)
          if (!index) continue
          openDecoders.set(
            runtime.clipId,
            ClipDecoder.open({
              ffmpeg,
              source: runtime.source,
              index,
              sourceIndices: runtime.sourceIndices,
              decodeWidth: runtime.decodeWidth,
              decodeHeight: runtime.decodeHeight,
              displayWidth: runtime.displayWidth,
              displayHeight: runtime.displayHeight,
              signal,
            }),
          )
        }
      }

      const scene = resolveTimeline(frame, project)

      // Advance every currently-open clip decoder exactly one step, mirroring
      // ExportWorker.ts:322-327's per-frame `decoder.gen.next()` advance.
      const videoFrames = new Map<string, DecodedFrame | null>()
      for (const runtime of videoRuntimes) {
        if (frame < runtime.firstFrame || frame > runtime.lastFrame) continue
        const decoder = openDecoders.get(runtime.clipId)
        if (!decoder) continue
        const decoded = await decoder.next()
        videoFrames.set(runtime.clipId, decoded)

        // A null result is only a problem when a real frame was expected —
        // `sourceIndices[step] === -1` (target before the source's first
        // timestamp) is the same "nothing to draw" case ExportWorker gets
        // from mediabunny's CanvasSink returning null, not a warning-worthy one.
        const wantedReal = runtime.sourceIndices[frame - runtime.firstFrame] >= 0
        if (decoded === null && wantedReal && !warnedShortClips.has(runtime.clipId)) {
          warnedShortClips.add(runtime.clipId)
          warnings.push(
            `Clip '${runtime.clipId}': source '${runtime.source}' ran out of frames before the ` +
              "clip's plan expected — the source is shorter than the clip claims. Remaining frames " +
              'render nothing for this clip.',
          )
        }
      }

      const pixels = compositor.render(scene, { video: videoFrames, images: imagesBySource })
      await encoder.writeFrame(pixels)

      // Close any clip decoder whose last active export frame was this one —
      // symmetric with the lazy open above.
      for (const runtime of videoRuntimes) {
        if (runtime.lastFrame === frame) {
          const decoder = openDecoders.get(runtime.clipId)
          if (decoder) {
            await decoder.close()
            openDecoders.delete(runtime.clipId)
          }
        }
      }

      options.onProgress?.({ phase: 'encoding', frame: frame + 1, totalFrames: plan.totalFrames })
    }

    checkAborted(signal)

    // Defensive: every runtime's window should already have closed its
    // decoder above. Closing anything left open keeps a bug in the
    // open/close bookkeeping from leaking a process rather than corrupting output.
    await Promise.all(Array.from(openDecoders.values()).map(decoder => decoder.close()))
    openDecoders.clear()

    options.onProgress?.({ phase: 'finalizing', frame: plan.totalFrames, totalFrames: plan.totalFrames })
    await encoder.finish()
  } catch (err) {
    encoder.abort()
    await Promise.all(Array.from(openDecoders.values()).map(decoder => decoder.close()))
    await removePartialOutput(options.outPath)
    throw err
  } finally {
    compositor.dispose()
  }

  for (const family of fontRegistry.missing) {
    warnings.push(`Font family '${family}' could not be resolved to an installed font; a fallback was substituted.`)
  }

  let validation: OutputValidation | undefined
  if (options.validateOutput ?? true) {
    options.onProgress?.({ phase: 'validating', frame: plan.totalFrames, totalFrames: plan.totalFrames })
    validation = await validateOutputFile(options.outPath)

    // Only a missing video track is treated as a hard failure — everything
    // else (duration/frame-count/dimension drift) is expected slop from
    // container muxing and audio padding, so it becomes a warning instead of
    // failing an otherwise-successful export (probe.ts's own contract).
    if (validation.frameCount === null || validation.width === 0 || validation.height === 0) {
      throw new ExportServerError(
        'OUTPUT_INVALID',
        `Exported file '${options.outPath}' has no readable video track after muxing.`,
      )
    }

    const expectedDurationSec = plan.totalFrames / plan.fps
    const durationToleranceSec = 1 / plan.fps + 0.05
    if (Math.abs(validation.durationSec - expectedDurationSec) > durationToleranceSec) {
      warnings.push(
        `Output duration ${validation.durationSec.toFixed(3)}s differs from the expected ` +
          `${expectedDurationSec.toFixed(3)}s by more than one frame.`,
      )
    }
    if (validation.frameCount !== null && Math.abs(validation.frameCount - plan.totalFrames) > 1) {
      warnings.push(
        `Output frame count ${validation.frameCount} differs from the expected ${plan.totalFrames}.`,
      )
    }
    if (validation.width !== outputWidth || validation.height !== outputHeight) {
      warnings.push(
        `Output dimensions ${validation.width}x${validation.height} differ from the requested ` +
          `${outputWidth}x${outputHeight}.`,
      )
    }
  }

  const { size } = await stat(options.outPath)

  return {
    outPath: options.outPath,
    sizeBytes: size,
    totalFrames: plan.totalFrames,
    fps: plan.fps,
    width: outputWidth,
    height: outputHeight,
    durationSec: plan.totalFrames / plan.fps,
    hasAudio: audioMix !== null,
    validation,
    warnings,
    ffmpeg: {
      path: ffmpeg.path,
      versionLine: ffmpeg.versionLine,
      videoEncoder: videoEncoderName,
      audioEncoder: audioMix ? audioEncoderName : undefined,
    },
    elapsedMs: performance.now() - startedAt,
  }
}
