/**
 * Timeline frame → source frame (EDX-P6). The one mapping preview, export
 * and transitions share, so a speed ramp or a reverse shows the same frame
 * everywhere.
 *
 * Two modes:
 *   - Constant speed (every clip without `time` keys): unchanged from before,
 *     `floor(local × speed) + sourceStartFrame`.
 *   - Time remap (a VIDEO clip with keys on the `time` channel): the channel's
 *     value IS the source frame, sampled like any other channel — so a hold
 *     key is a freeze, descending values are reverse, and an eased pair is a
 *     speed ramp. Clamped to the clip's source window.
 */

import type { Clip, Keyframe } from '../types'
import { normalizeKeys, sampleChannel } from './keyframes'

/** The clip's `time` keys when it is a remapped VIDEO clip, else null. */
export function timeRemapKeys(clip: Clip): Keyframe[] | null {
  // A compound maps timeline frames to its nested timeline exactly as a video
  // clip maps them to its media, so it takes a time remap too (PV-P1).
  if (clip.type !== 'video' && clip.type !== 'compound') return null
  const keys = clip.keyframes?.channels?.time?.keys
  if (!keys || keys.length === 0) return null
  const sorted = normalizeKeys(keys)
  return sorted.length ? sorted : null
}

export function hasTimeRemap(clip: Clip): boolean {
  return timeRemapKeys(clip) !== null
}

/**
 * Source frames from `sourceStartFrame` to the end of the media, at 1x.
 *
 * Legacy (no `assetFrames`): the trim window's own length, which is the only
 * thing an older document knows. With `assetFrames`, the real end of the media,
 * so a split half can be trimmed back out past the frames it happened to hold
 * at split time. `sourceStartFrame` is only read when the field is present, so
 * the legacy result is byte-identical.
 */
export function sourceFramesAvailable(
  clip: Pick<Clip, 'assetFrames' | 'sourceDurationFrames' | 'sourceStartFrame'>,
  sourceStartFrame: number = clip.sourceStartFrame,
): number {
  return clip.assetFrames !== undefined ? Math.max(0, clip.assetFrames - sourceStartFrame) : clip.sourceDurationFrames
}

/** The last absolute source frame a clip may show. Legacy: the window's own end. */
export function lastSourceFrame(clip: Pick<Clip, 'assetFrames' | 'sourceDurationFrames'>): number {
  return Math.max(0, (clip.assetFrames ?? clip.sourceDurationFrames) - 1)
}

/** The last source frame a remap may show. */
export function sourceWindowEnd(clip: Clip): number {
  return clip.assetFrames !== undefined
    ? lastSourceFrame(clip)
    : Math.max(0, clip.sourceStartFrame + Math.max(1, clip.sourceDurationFrames) - 1)
}

/**
 * Source frame for timeline `frame`.
 *
 * Constant speed uses `Math.floor`, not `Math.round`: floor is monotonic in
 * `frame` for any speed, and — combined with TimelineEngine.setClipSpeed's
 * invariant `durationFrames * speed <= sourceDurationFrames` — guarantees the
 * last timeline frame of the clip never maps past the end of its trim window.
 * `Math.round` can overshoot by one frame at that boundary.
 *
 * A remap floors with a tiny epsilon so a bezier that lands a hair under an
 * integer still shows that frame.
 */
export function sourceFrameFor(clip: Clip, frame: number): number {
  const localFrame = frame - clip.startFrame
  const keys = timeRemapKeys(clip)
  if (keys) {
    const v = sampleChannel(keys, localFrame) ?? clip.sourceStartFrame
    const f = Math.floor(v + 1e-6)
    return Math.min(sourceWindowEnd(clip), Math.max(0, f))
  }
  const speed = clip.speed ?? 1
  return Math.floor(localFrame * speed) + clip.sourceStartFrame
}

/**
 * Source frames for every local frame of the clip, in order — what the export
 * decoder needs up front. `null` for a clip without a remap (the exporter
 * keeps its exact historical timestamps for those).
 */
export function remappedSourceFrames(clip: Clip): number[] | null {
  if (!hasTimeRemap(clip)) return null
  return Array.from({ length: clip.durationFrames }, (_, i) => sourceFrameFor(clip, clip.startFrame + i))
}

/**
 * Instantaneous speed (source frames per timeline frame) at a local frame,
 * for the Speed tab's graph: the slope of the remap, or `clip.speed`.
 */
export function speedAt(clip: Clip, localFrame: number): number {
  const keys = timeRemapKeys(clip)
  if (!keys) return clip.speed ?? 1
  const a = sampleChannel(keys, localFrame - 0.5) ?? 0
  const b = sampleChannel(keys, localFrame + 0.5) ?? 0
  return b - a
}
