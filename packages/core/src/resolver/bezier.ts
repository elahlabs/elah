/**
 * CSS-style cubic-bezier easing (EDX-P6). `[x1, y1, x2, y2]` are the two
 * handles of a curve from (0,0) to (1,1); x is time and y is progress. The
 * x handles are clamped to 0..1 (so time never runs backwards); y is free,
 * which is how an overshoot curve is drawn.
 *
 * Pure and allocation-free on the hot path: Newton-Raphson on x(t) with a
 * bisection fallback, the same scheme browsers use.
 */

export type BezierTuple = readonly [number, number, number, number]

const NEWTON_ITERATIONS = 8
const NEWTON_EPSILON = 1e-6
const BISECT_ITERATIONS = 24

function coord(a1: number, a2: number, t: number): number {
  // B(t) with P0 = 0 and P3 = 1.
  const u = 1 - t
  return 3 * u * u * t * a1 + 3 * u * t * t * a2 + t * t * t
}

function slope(a1: number, a2: number, t: number): number {
  const u = 1 - t
  return 3 * u * u * a1 + 6 * u * t * (a2 - a1) + 3 * t * t * (1 - a2)
}

/** Whether a stored tuple is usable: four finite numbers. */
export function isValidBezier(b: unknown): b is BezierTuple {
  return Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number' && Number.isFinite(n))
}

/** Clamp a tuple's x handles into 0..1 (y stays free). */
export function normalizeBezier(b: BezierTuple): [number, number, number, number] {
  const cx = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
  return [cx(b[0]), b[1], cx(b[2]), b[3]]
}

/** Progress (y) at time `x` in 0..1 along the curve. */
export function cubicBezier(b: BezierTuple, x: number): number {
  if (!(x > 0)) return 0
  if (x >= 1) return 1
  const [x1, y1, x2, y2] = normalizeBezier(b)
  if (x1 === y1 && x2 === y2) return x // linear

  // Solve x(t) = x for t.
  let t = x
  for (let i = 0; i < NEWTON_ITERATIONS; i++) {
    const err = coord(x1, x2, t) - x
    if (Math.abs(err) < NEWTON_EPSILON) return coord(y1, y2, t)
    const d = slope(x1, x2, t)
    if (Math.abs(d) < 1e-7) break
    t -= err / d
  }
  let lo = 0
  let hi = 1
  t = x
  for (let i = 0; i < BISECT_ITERATIONS; i++) {
    const v = coord(x1, x2, t)
    if (Math.abs(v - x) < NEWTON_EPSILON) break
    if (v < x) lo = t
    else hi = t
    t = (lo + hi) / 2
  }
  return coord(y1, y2, t)
}
