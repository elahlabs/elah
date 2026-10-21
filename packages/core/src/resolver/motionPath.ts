/**
 * Motion along a path (MOT-1) — pure, deterministic, DOM-free.
 *
 * A clip with `motionPath` and a keyed `motion.progress` travels an SVG path.
 * This file only measures the path and answers "where is progress p"; the
 * resolver (resolveTimeline.ts) calls `applyMotionPath` after keyframe sampling
 * and hands every renderer a plain `Transform`, so the GPU preview, the 2D
 * export path and the CSS overlay agree by construction.
 *
 * Progress is ARC-LENGTH parameterised: 0.5 is the point half the path's length
 * along, whatever the control points do. The channel value is not clamped (an
 * ease such as `back-out` overshoots 1), only the lookup is, after the ease ran.
 * Only the first subpath is used; a path with more reports that to
 * `motionPathIssue`.
 */

import type { Clip, Transform } from '../types'
import { parsePathToCubics } from './pathMorph'

/** Samples per cubic when measuring length. Position and tangent are then exact within a sample. */
const SAMPLES_PER_SEGMENT = 24
/** Distinct `d` strings kept measured. A project rarely has more than a handful. */
const CACHE_LIMIT = 64

interface Interval {
  /** Cubic: x0 y0 c1x c1y c2x c2y x3 y3. */
  seg: number[]
  t0: number
  t1: number
  /** Cumulative length at the interval's start and end. */
  from: number
  to: number
}

export interface PathTable {
  /** Total arc length in the path's own units. */
  length: number
  start: { x: number; y: number }
  /** True when the path had more than one subpath (only the first is used). */
  extraSubpaths: boolean
  intervals: ReadonlyArray<Interval>
}

export interface PathSample {
  x: number
  y: number
  /** Tangent direction in radians, `Transform.rotation` convention (y down, positive = clockwise). */
  angle: number
}

const cache = new Map<string, PathTable | null>()

function cubicAt(s: ReadonlyArray<number>, t: number): [number, number] {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [a * s[0]! + b * s[2]! + c * s[4]! + d * s[6]!, a * s[1]! + b * s[3]! + c * s[5]! + d * s[7]!]
}

function cubicTangent(s: ReadonlyArray<number>, t: number): [number, number] {
  const u = 1 - t
  const a = 3 * u * u
  const b = 6 * u * t
  const c = 3 * t * t
  return [
    a * (s[2]! - s[0]!) + b * (s[4]! - s[2]!) + c * (s[6]! - s[4]!),
    a * (s[3]! - s[1]!) + b * (s[5]! - s[3]!) + c * (s[7]! - s[5]!),
  ]
}

/** Measure `d`. `null` when it is not a usable path (unparseable, or no length and no start). Cached by `d`. */
export function buildPathTable(d: string): PathTable | null {
  if (typeof d !== 'string') return null
  if (cache.has(d)) return cache.get(d) ?? null
  const table = measure(d)
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(d, table)
  return table
}

function measure(d: string): PathTable | null {
  const subs = parsePathToCubics(d)
  if (!subs || subs.length === 0) return null
  const sub = subs[0]!
  if (![sub.x, sub.y].every(Number.isFinite) || !sub.segs.every(Number.isFinite)) return null
  const segs: number[][] = []
  let px = sub.x
  let py = sub.y
  for (let i = 0; i + 5 < sub.segs.length; i += 6) {
    const s = sub.segs
    segs.push([px, py, s[i]!, s[i + 1]!, s[i + 2]!, s[i + 3]!, s[i + 4]!, s[i + 5]!])
    px = s[i + 4]!
    py = s[i + 5]!
  }
  // `Z` draws the closing edge but stores none.
  if (sub.closed && Math.hypot(px - sub.x, py - sub.y) > 1e-9) {
    segs.push([px, py, px, py, sub.x, sub.y, sub.x, sub.y])
  }
  const intervals: Interval[] = []
  let length = 0
  for (const seg of segs) {
    let [lx, ly] = cubicAt(seg, 0)
    for (let k = 1; k <= SAMPLES_PER_SEGMENT; k++) {
      const t1 = k / SAMPLES_PER_SEGMENT
      const [x, y] = cubicAt(seg, t1)
      const len = Math.hypot(x - lx, y - ly)
      if (len > 0) {
        intervals.push({ seg, t0: (k - 1) / SAMPLES_PER_SEGMENT, t1, from: length, to: length + len })
        length += len
      }
      lx = x
      ly = y
    }
  }
  if (length <= 0) {
    // A lone `M x y` (or all-degenerate segments): the clip rests on the start point.
    return { length: 0, start: { x: sub.x, y: sub.y }, extraSubpaths: subs.length > 1, intervals }
  }
  return { length, start: { x: sub.x, y: sub.y }, extraSubpaths: subs.length > 1, intervals }
}

/**
 * Position and tangent at `progress` (clamped to 0..1 here, after any ease).
 * A non-finite progress reads as 0.
 */
export function samplePathPosition(table: PathTable, progress: number): PathSample {
  const { intervals } = table
  if (table.length <= 0 || intervals.length === 0) return { x: table.start.x, y: table.start.y, angle: 0 }
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
  const s = p * table.length
  let lo = 0
  let hi = intervals.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (intervals[mid]!.to < s) lo = mid + 1
    else hi = mid
  }
  const iv = intervals[lo]!
  const f = iv.to > iv.from ? Math.min(1, Math.max(0, (s - iv.from) / (iv.to - iv.from))) : 0
  const t = iv.t0 + f * (iv.t1 - iv.t0)
  const [x, y] = cubicAt(iv.seg, t)
  let [tx, ty] = cubicTangent(iv.seg, t)
  if (Math.hypot(tx, ty) < 1e-9) {
    // A cusp or a collapsed control point: fall back to the interval's chord.
    const [ax, ay] = cubicAt(iv.seg, iv.t0)
    const [bx, by] = cubicAt(iv.seg, iv.t1)
    tx = bx - ax
    ty = by - ay
  }
  return { x, y, angle: Math.atan2(ty, tx) }
}

/** A readable reason `motionPath` cannot be used, or `undefined` when it can. For validators and the inspector. */
export function motionPathIssue(d: string): string | undefined {
  const table = buildPathTable(d)
  if (!table) return 'the path is not valid SVG path data'
  if (table.extraSubpaths) return 'the path has more than one subpath; only the first is followed'
  return undefined
}

/**
 * The resolver's step: replace `x`/`y` with the path position at `progress`
 * and, with `orient`, add the tangent angle (plus `offsetRotation` degrees) to
 * `rotation`. `transform` is the keyed transform (or the clip's own); `base`
 * supplies the fields it lacks. The authored x/y are ignored while a path is
 * set (`space: 'clip'` is the exception: the path is an offset from them).
 * Returns `transform` untouched when the path is unusable.
 */
export function applyMotionPath(
  motionPath: NonNullable<Clip['motionPath']>,
  transform: Transform | undefined,
  base: Transform,
  progress: number | undefined,
  stage: { width: number; height: number },
): Transform | undefined {
  if (!motionPath || typeof motionPath.d !== 'string') return transform
  const table = buildPathTable(motionPath.d)
  if (!table || !(stage.width > 0) || !(stage.height > 0)) return transform
  const p = progress !== undefined && Number.isFinite(progress) ? progress : 0
  const at = samplePathPosition(table, p)
  const t = transform ?? base
  let x: number
  let y: number
  if (motionPath.space === 'clip') {
    // Relative to the path start, added to the authored (keyed) position.
    x = t.x + (at.x - table.start.x) / stage.width
    y = t.y + (at.y - table.start.y) / stage.height
  } else {
    x = at.x / stage.width
    y = at.y / stage.height
  }
  const offset = typeof motionPath.offsetRotation === 'number' && Number.isFinite(motionPath.offsetRotation) ? motionPath.offsetRotation : 0
  const rotation = motionPath.orient ? t.rotation + at.angle + (offset * Math.PI) / 180 : t.rotation
  return { ...t, x, y, rotation }
}
