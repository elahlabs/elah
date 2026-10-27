import type { Clip, Transform } from '../types'
import { pathBounds } from '../renderer/gpu/layers/pathBounds'
import { createClip, type FreehandClipMetadata } from './base'

export interface CreateFreehandClipOptions {
  trackId: string
  name?: string
  startFrame: number
  durationFrames: number
  freehand?: FreehandClipMetadata
  volume?: number
  opacity?: number
}

export function createFreehandClip(options: CreateFreehandClipOptions): Clip {
  return createClip({
    ...options,
    type: 'freehand',
    name: options.name ?? 'Drawing',
  })
}

// ---------------------------------------------------------------------------
// Authoring (PV-P2c)
//
// Everything here is pure and DOM-free: it turns sampled pointer positions into
// the two fields a completed drawing commits. The overlay owns the sampling and
// the gesture; this owns the geometry.
// ---------------------------------------------------------------------------

/** One sampled point, in stage px. */
export interface StagePoint {
  x: number
  y: number
}

/** Below this distance (stage px) a sample is dropped: `pointermove` is noisy. */
export const FREEHAND_MIN_SAMPLE_PX = 2
/** Path coordinates are rounded to this many decimals: `pathData` is stored in the document. */
export const FREEHAND_PATH_PRECISION = 1
/** Hard cap on samples in one stroke, so a long drag cannot produce a huge document. */
export const FREEHAND_MAX_POINTS = 2000

function round(value: number): number {
  const f = 10 ** FREEHAND_PATH_PRECISION
  return Math.round(value * f) / f
}

/**
 * Drop samples closer than {@link FREEHAND_MIN_SAMPLE_PX} to the last KEPT one,
 * keeping the first unconditionally and stopping at {@link FREEHAND_MAX_POINTS}.
 *
 * Comparing against the last kept sample rather than the previous raw one is what
 * stops a slow drag from accumulating a cloud of near-identical points: jitter
 * around one spot collapses to a single sample instead of a dense zigzag.
 */
function keepSparse(points: ReadonlyArray<StagePoint>): StagePoint[] {
  const kept: StagePoint[] = []
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    const last = kept[kept.length - 1]
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < FREEHAND_MIN_SAMPLE_PX) continue
    kept.push(p)
    if (kept.length >= FREEHAND_MAX_POINTS) break
  }
  return kept
}

/** `M x y L x y L ...`, optionally shifted by `(dx, dy)` before rounding. */
function emit(points: ReadonlyArray<StagePoint>, dx = 0, dy = 0): string {
  const parts: string[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const x = round(p.x - dx)
    const y = round(p.y - dy)
    parts.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)
  }
  return parts.join(' ')
}

/**
 * A polyline `d` string from sampled points, rounded and de-duplicated by
 * {@link FREEHAND_MIN_SAMPLE_PX}.
 *
 * `''` for fewer than two surviving samples. A one-point path strokes nothing but
 * is not an empty document field, and an empty `pathData` is exactly what the
 * timeline already inserts for a freehand clip — so a tap that never moves must
 * produce `''`, not `M x y`.
 */
export function pointsToPathData(points: ReadonlyArray<StagePoint>): string {
  const kept = keepSparse(points)
  return kept.length < 2 ? '' : emit(kept)
}

export interface FreehandDraft {
  /** Content-space path: the drawn shape re-based so its bounds start at (0, 0). */
  pathData: string
  /**
   * The transform that puts that box where the user drew, under the v2 model.
   */
  transform: Transform
}

/**
 * The clip fields a completed drag commits, or `null` when there is nothing to draw.
 *
 * The drawing is stored as CONTENT, not as a picture of the stage: `pathData` is
 * re-based so its own bounds start at (0, 0), and `transform` carries where that
 * box sits. A path authored in stage coordinates could never be re-placed,
 * re-used or nested without baking it first, which is the problem v2 exists to
 * remove.
 *
 * The placement rule is `freehandRestTransform`'s, verbatim, applied to the
 * DRAWN box. Re-basing and then calling `freehandRestTransform` on the re-based
 * box would report the box's own centre — (0,0) — and drop every drawing at the
 * stage centre instead of where it was drawn.
 */
export function freehandFromDrag(
  points: ReadonlyArray<StagePoint>,
  stage: { width: number; height: number },
): FreehandDraft | null {
  const drawn = keepSparse(points)
  if (drawn.length < 2) return null

  // Measure the drawn shape in stage px, from the same rounded geometry that will
  // be stored, so the box and the content agree.
  const bounds = pathBounds(emit(drawn))
  if (!bounds) return null

  return {
    pathData: emit(drawn, bounds.x, bounds.y),
    transform: {
      x: (bounds.x + bounds.width / 2) / stage.width,
      y: (bounds.y + bounds.height / 2) / stage.height,
      scale: 1,
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
    },
  }
}
