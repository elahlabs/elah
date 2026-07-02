import type { Clip } from '../types'

/**
 * Snap a frame to the nearest snap point within the given pixel threshold.
 * Returns the original frame unchanged if no snap point is close enough.
 *
 * @param frame        - The frame to snap
 * @param snapPoints   - Candidate snap positions in frames
 * @param threshold    - Max distance in frames to trigger snap
 */
export function snapFrame(frame: number, snapPoints: number[], threshold: number): number {
  let nearest = frame
  let minDist = threshold

  for (const point of snapPoints) {
    const dist = Math.abs(frame - point)
    if (dist < minDist) {
      minDist = dist
      nearest = point
    }
  }

  return nearest
}

/**
 * Build a list of snap points from all clips on all tracks.
 * Includes both the start and end frame of every clip.
 *
 * @param clips     - All clips keyed by trackId
 * @param excludeId - Skip this clip (the one currently being dragged)
 */
export function buildSnapPoints(clips: Record<string, Clip[]>, excludeId?: string): number[] {
  const points = new Set<number>()

  for (const trackClips of Object.values(clips)) {
    for (const clip of trackClips) {
      if (clip.id === excludeId) continue
      points.add(clip.startFrame)
      points.add(clip.startFrame + clip.durationFrames)
    }
  }

  // Always snap to the timeline origin
  points.add(0)

  return [...points].sort((a, b) => a - b)
}

/** Default: overlap up to 30% of the underlying clip settles behind; above that settles after. */
export const DEFAULT_OVERLAP_TOLERANCE = 0.4

const MAX_OVERLAP_RESOLVE_ITERATIONS = 48

function clipEndFrame(c: Clip): number {
  return c.startFrame + c.durationFrames
}

/** Positive when intervals overlap by at least one frame. */
function overlapFrames(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const lo = Math.max(aStart, bStart)
  const hi = Math.min(aEnd, bEnd)
  const n = hi - lo
  return n > 0 ? n : 0
}

function clipsOverlappingMoving(
  start: number,
  durationFrames: number,
  movingId: string,
  trackClips: Clip[],
): Clip[] {
  const mEnd = start + durationFrames
  return trackClips.filter((c) => {
    if (c.id === movingId) return false
    return overlapFrames(start, mEnd, c.startFrame, clipEndFrame(c)) > 0
  })
}

/**
 * On drop only: iteratively settle the moving clip so it does not overlap any other
 * clip on the track. Each step uses the same 30% rule against the clip that currently
 * has the **largest overlap ratio** (overlap length / that clip’s duration). If a step
 * would not move the playhead (e.g. clamped behind at 0), we shove past the **rightmost**
 * end among clips still overlapping — that clears stacked / multi-clip collisions.
 *
 * - Overlap ratio ≤ `overlapTolerance` → align **behind** that clip (abutting its start).
 * - Overlap ratio > `overlapTolerance` → align **after** that clip (abutting its end).
 */
export function resolveOverlapEdgeSnap(
  nextStart: number,
  movingClip: Clip,
  trackClips: Clip[],
  overlapTolerance = DEFAULT_OVERLAP_TOLERANCE,
): number {
  const D = movingClip.durationFrames
  let start = nextStart

  for (let iter = 0; iter < MAX_OVERLAP_RESOLVE_ITERATIONS; iter++) {
    const overlapping = clipsOverlappingMoving(start, D, movingClip.id, trackClips)
    if (overlapping.length === 0) return start

    let dominant: Clip | null = null
    let maxRatio = -1

    const mEnd = start + D
    for (const c of overlapping) {
      const ov = overlapFrames(start, mEnd, c.startFrame, clipEndFrame(c))
      const ratio = ov / Math.max(1, c.durationFrames)
      if (ratio > maxRatio) {
        maxRatio = ratio
        dominant = c
      }
    }

    if (!dominant) return start

    const targetStart = dominant.startFrame
    const targetEnd = clipEndFrame(dominant)
    let candidate = maxRatio > overlapTolerance ? targetEnd : Math.max(0, targetStart - D)

    if (candidate === start) {
      candidate = Math.max(...overlapping.map((c) => clipEndFrame(c)))
    }

    start = candidate
  }

  // Hard cap: clear any remaining overlap by sitting after the latest blocking end.
  const finalOverlapping = clipsOverlappingMoving(start, D, movingClip.id, trackClips)
  if (finalOverlapping.length === 0) return start
  return Math.max(start, ...finalOverlapping.map((c) => clipEndFrame(c)))
}
