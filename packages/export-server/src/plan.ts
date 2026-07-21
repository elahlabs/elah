/**
 * plan.ts — the Scene-scan pass.
 *
 * `planExport` is the second module (after the ffmpeg-invocation callers) allowed
 * to touch `Project`, and only to call `resolveTimeline(frame, project)` and
 * `getTotalFrames(project.clips)`. Everything it emits is derived from the
 * resulting `Scene` objects — the decoder, compositor, and audio-graph builder
 * never see `Project`/`Clip`, only the `ExportPlan` this module produces.
 *
 * Mirrors ExportWorker.ts's per-clip timestamp precomputation (:277-287) but as
 * a standalone forward scan rather than something interleaved with the frame
 * render loop, since ffmpeg decode (unlike mediabunny's CanvasSink) needs the
 * whole per-clip timestamp list up front to build its `-ss` seek and argv.
 */

import { resolveTimeline, getTotalFrames } from '@elah/core'
import type { Project } from '@elah/core'

import { ExportServerError } from './errors'
import type { AudioClipPlan, ExportPlan, VideoClipPlan, VideoFrameIndex } from './types'

export interface PlanExportOptions {
  /** Maps a Scene `src` to something ffmpeg/mediabunny can open. */
  resolveSource: (src: string) => string
}

/** Video accumulator kept per clip id while the forward scan is in progress. */
interface VideoAccumulator {
  source: string
  firstFrame: number
  lastFrame: number
  /** Built dense as the scan proceeds — see the gap-fill note below. */
  sourceFrames: number[]
}

/** Audio accumulator kept per clip id while the forward scan is in progress. */
interface AudioAccumulator {
  source: string
  firstFrame: number
  lastFrame: number
  /** Captured once, at the clip's first active frame. */
  sourceStartFrame: number
  volume: number
}

/**
 * Scans every export frame's `Scene` exactly once and compresses the result
 * into an `ExportPlan`. This is where frame accuracy is decided: everything
 * downstream (ffmpeg argv, the dup/drop cursor, the audio filter graph) just
 * executes the plan without ever resolving the timeline again.
 */
export function planExport(project: Project, options: PlanExportOptions): ExportPlan {
  const totalFrames = getTotalFrames(project.clips)

  // fps/stage come from the frame-0 Scene regardless of totalFrames (an empty
  // project still has a valid fps/stage — resolveTimeline never depends on
  // there being any clips). Reused as frame 0 of the scan below so it is never
  // resolved twice.
  const scene0 = resolveTimeline(0, project)
  const fps = scene0.fps
  const stage = scene0.stage

  const videos = new Map<string, VideoAccumulator>()
  const audios = new Map<string, AudioAccumulator>()
  const imageSources: Array<{ src: string; source: string }> = []
  const seenImages = new Set<string>()
  const fontFamilies: string[] = []
  const seenFonts = new Set<string>()

  for (let frame = 0; frame < totalFrames; frame++) {
    const scene = frame === 0 ? scene0 : resolveTimeline(frame, project)

    // Every entry in scene.videos, INCLUDING opacity === 0 entries: a
    // transition's outgoing clip is drawn at opacity 0 by the GPU (the export
    // snapshot pass draws it instead), but its pixels must still be decoded —
    // see ExportWorker.ts:331-345.
    for (const v of scene.videos) {
      const acc = videos.get(v.id)
      if (!acc) {
        videos.set(v.id, {
          source: options.resolveSource(v.src),
          firstFrame: frame,
          lastFrame: frame,
          sourceFrames: [v.sourceFrame],
        })
        continue
      }
      // Dense + monotonic contract: if this clip was absent for one or more
      // interior frames (the transition pass in resolveTimeline.ts can re-add
      // a clip outside its own window), fill the hole with the previously
      // recorded value — a flat tail — before appending this frame's value.
      // Keeps `sourceFrames.length === lastFrame - firstFrame + 1` and keeps
      // exactly one decoder `.next()` per open frame in lockstep with the loop.
      const gap = frame - acc.lastFrame - 1
      for (let i = 0; i < gap; i++) {
        acc.sourceFrames.push(acc.sourceFrames[acc.sourceFrames.length - 1])
      }
      acc.sourceFrames.push(v.sourceFrame)
      acc.lastFrame = frame
    }

    for (const a of scene.audios) {
      const acc = audios.get(a.id)
      if (!acc) {
        audios.set(a.id, {
          source: options.resolveSource(a.src),
          firstFrame: frame,
          lastFrame: frame,
          sourceStartFrame: a.sourceFrame,
          volume: a.volume,
        })
        continue
      }
      acc.lastFrame = frame
    }

    for (const img of scene.images) {
      if (seenImages.has(img.src)) continue
      seenImages.add(img.src)
      imageSources.push({ src: img.src, source: options.resolveSource(img.src) })
    }

    for (const txt of scene.texts) {
      if (!txt.fontFamily || seenFonts.has(txt.fontFamily)) continue
      seenFonts.add(txt.fontFamily)
      fontFamilies.push(txt.fontFamily)
    }
  }

  const videoPlans: VideoClipPlan[] = []
  for (const [clipId, acc] of videos) {
    assertNonDecreasing(clipId, acc.sourceFrames)
    videoPlans.push({
      clipId,
      source: acc.source,
      firstFrame: acc.firstFrame,
      lastFrame: acc.lastFrame,
      sourceFrames: Int32Array.from(acc.sourceFrames),
    })
  }

  const audioPlans: AudioClipPlan[] = []
  for (const [clipId, acc] of audios) {
    audioPlans.push({
      clipId,
      source: acc.source,
      startFrame: acc.firstFrame,
      frameCount: acc.lastFrame - acc.firstFrame + 1,
      sourceStartFrame: acc.sourceStartFrame,
      volume: acc.volume,
    })
  }

  return {
    fps,
    stage,
    totalFrames,
    videos: videoPlans,
    audios: audioPlans,
    imageSources,
    fontFamilies,
  }
}

/**
 * Guards the decoder's monotonic cursor: it is only ever safe to hold or
 * advance, never to seek backwards. `sourceFrames` is non-decreasing by
 * construction — the resolver's transition clamps (resolveTimeline.ts:288-298,
 * `Math.min(..., sourceDurationFrames - 1)` / `Math.max(0, ...)`) only ever
 * flatten the ramp, and the gap-fill above only ever repeats the previous
 * value. If this ever fails it means the resolver produced a decreasing
 * `sourceFrame` for a clip, which would otherwise silently corrupt export by
 * seeking a per-clip ffmpeg process backwards.
 */
function assertNonDecreasing(clipId: string, sourceFrames: number[]): void {
  for (let i = 1; i < sourceFrames.length; i++) {
    if (sourceFrames[i] < sourceFrames[i - 1]) {
      throw new ExportServerError(
        'PLAN_INVALID',
        `clip "${clipId}": sourceFrames must be non-decreasing, got ${sourceFrames[i - 1]} -> ${sourceFrames[i]} at frame offset ${i}`,
      )
    }
  }
}

/**
 * The frame-accuracy kernel. Maps each export frame's `sourceFrame` (project-fps
 * units) to a source presentation-frame index, using the same rule mediabunny's
 * CanvasSink uses: the last frame whose PTS is <= the target timestamp.
 * Returns -1 for targets that fall before the source's first timestamp
 * (CanvasSink returns null there; the compositor draws nothing).
 *
 * `timestamps` is the presentation-timestamp index built in probe.ts (see
 * {@link VideoFrameIndex}) — ascending seconds, one per source video frame.
 *
 * Implemented as a monotonic cursor rather than a per-frame binary search:
 * `sourceFrames` is non-decreasing (planExport asserts it), so the targets
 * derived from it are non-decreasing too, and the whole mapping is O(N + M)
 * instead of O(N log M).
 */
export function mapSourceFramesToIndices(
  sourceFrames: Int32Array,
  fps: number,
  timestamps: Float64Array,
): Int32Array {
  const out = new Int32Array(sourceFrames.length)
  if (timestamps.length === 0) return out.fill(-1)

  let k = 0
  for (let j = 0; j < sourceFrames.length; j++) {
    // Verbatim from ExportWorker.ts:280-282: the +0.5 midpoint matches the
    // preview's Math.round(PTS / usPerFrame) convention, and dividing by the
    // PROJECT fps (never the source fps) is what makes `sourceFrame` — a
    // project-frame quantity — land on the right source frame.
    const target = (sourceFrames[j] + 0.5) / fps
    while (k + 1 < timestamps.length && timestamps[k + 1] <= target) k++
    out[j] = target < timestamps[0] ? -1 : k
  }
  return out
}
