/**
 * Gradient math shared by every vector importer (SVG now — PV-P6b-3; Lottie
 * later — PV-P6c-1): turn a gradient described in its own coordinate space
 * (a line or a circle, stops, and the matrix mapping that space onto a box)
 * into the engine's `Paint` — exact for a linear gradient under any affine
 * map, exact for a radial gradient whenever the map keeps circles circular,
 * approximate (and reported) otherwise.
 *
 * DOM-free, dependency-free, like the rest of `vector/`.
 */
import type { Paint, PaintStop } from '../types'
import { type Affine, invert, applyToPoint, uniformScale, isConformal } from './pathOps'
import type { Box } from './place'
import { parseCssColor, formatCssColor, mixRgba } from './color'
import { linearGradientPoints } from '../renderer/gpu/layers/paint'

/** One input stop: offset may be any real number (SVG allows out-of-range and unsorted); colour any CSS colour. */
export interface GradientStopIn {
  offset: number
  color: string
}

export type GradientResult =
  | { kind: 'paint'; paint: Paint; approximations: string[] }
  | { kind: 'solid'; color: string; approximations: string[] }

/**
 * Colour of a stop list at `t` (pad outside the first/last offset, like
 * canvas `addColorStop`/SVG `spreadMethod="pad"`). Boundary colours are
 * normalised through `parseCssColor`/`formatCssColor` (so `#000` reads back
 * as `#000000`, matching an interpolated stop); an unparseable neighbour
 * falls back to the nearer stop's literal string and sets `approximate`.
 */
export function colorAt(stops: readonly GradientStopIn[], t: number): { color: string; approximate: boolean } {
  if (stops.length === 0) return { color: 'transparent', approximate: false }
  const sorted = [...stops].sort((a, b) => a.offset - b.offset)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!

  const boundary = (raw: string): { color: string; approximate: boolean } => {
    const c = parseCssColor(raw)
    return c ? { color: formatCssColor(c), approximate: false } : { color: raw, approximate: true }
  }

  if (t <= first.offset) return boundary(first.color)
  if (t >= last.offset) return boundary(last.color)

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    if (t >= a.offset && t <= b.offset) {
      const u = a.offset === b.offset ? 1 : (t - a.offset) / (b.offset - a.offset)
      const ca = parseCssColor(a.color)
      const cb = parseCssColor(b.color)
      if (!ca || !cb) {
        const nearer = u < 0.5 ? a.color : b.color
        return { color: nearer, approximate: true }
      }
      return { color: formatCssColor(mixRgba(ca, cb, u)), approximate: false }
    }
  }
  return boundary(last.color)
}

/**
 * Remap arbitrary stops into 0..1 for `addColorStop` (which throws outside
 * that range): cut at 0 and 1 with interpolated colours, keep the inside
 * stops as-is (canvas already pads beyond the first/last of what remains).
 * A single stop becomes two identical stops at 0 and 1. `approximate` is
 * true when a boundary cut hit an unparseable colour.
 */
export function clipStops(stops: readonly GradientStopIn[]): { stops: PaintStop[]; approximate: boolean } {
  if (stops.length === 0) return { stops: [{ offset: 0, color: 'transparent' }, { offset: 1, color: 'transparent' }], approximate: false }
  const sorted = [...stops].sort((a, b) => a.offset - b.offset)
  if (sorted.length === 1) {
    return { stops: [{ offset: 0, color: sorted[0]!.color }, { offset: 1, color: sorted[0]!.color }], approximate: false }
  }

  const inside = sorted.filter((s) => s.offset >= 0 && s.offset <= 1)
  if (inside.length === 0) {
    const c0 = colorAt(sorted, 0)
    const c1 = colorAt(sorted, 1)
    return { stops: [{ offset: 0, color: c0.color }, { offset: 1, color: c1.color }], approximate: c0.approximate || c1.approximate }
  }

  let approximate = false
  const result: PaintStop[] = []
  if (sorted.some((s) => s.offset < 0)) {
    const c0 = colorAt(sorted, 0)
    if (c0.approximate) approximate = true
    result.push({ offset: 0, color: c0.color })
  }
  for (const s of inside) result.push({ offset: s.offset, color: s.color })
  if (sorted.some((s) => s.offset > 1)) {
    const c1 = colorAt(sorted, 1)
    if (c1.approximate) approximate = true
    result.push({ offset: 1, color: c1.color })
  }
  return { stops: result, approximate }
}

/**
 * Linear gradient from `p1` to `p2` in gradient space; `g` maps gradient
 * space to `box`'s space. Exact under ANY affine `g`: the colour at a point
 * depends only on its projection `t` onto the gradient axis, and because `g`
 * is affine, `t` composed with `g` is itself an affine function of the point
 * in box space — so the whole gradient can be re-expressed as a `Paint`
 * (some angle through `box`) whose own `t` matches at every point.
 */
export function linearToPaint(
  p1: readonly [number, number],
  p2: readonly [number, number],
  stops: readonly GradientStopIn[],
  g: Affine,
  box: Box,
): GradientResult {
  const lastColor = stops[stops.length - 1]?.color ?? 'transparent'

  const gi = invert(g)
  if (gi === null) return { kind: 'solid', color: lastColor, approximations: ['gradient-singular'] }

  const [p1x, p1y] = p1
  const [p2x, p2y] = p2
  const Dx = p2x - p1x
  const Dy = p2y - p1y
  const L2 = Dx * Dx + Dy * Dy
  if (L2 === 0) return { kind: 'solid', color: lastColor, approximations: [] }

  const [a, b, c, d, e, f] = gi
  const alpha = (a * Dx + b * Dy) / L2
  const beta = (c * Dx + d * Dy) / L2
  const gamma = ((e - p1x) * Dx + (f - p1y) * Dy) / L2

  let theta = (Math.atan2(beta, alpha) * 180) / Math.PI
  theta = ((theta % 360) + 360) % 360

  const { x0, y0, x1, y1 } = linearGradientPoints(theta, box)
  const t0 = alpha * x0 + beta * y0 + gamma
  const t1 = alpha * x1 + beta * y1 + gamma

  if (Math.abs(t1 - t0) < 1e-12) {
    const mid = colorAt(stops, t0)
    return { kind: 'solid', color: mid.color, approximations: mid.approximate ? ['gradient-color'] : [] }
  }

  const remapped = stops.map((s) => ({ offset: (s.offset - t0) / (t1 - t0), color: s.color }))
  const { stops: clipped, approximate } = clipStops(remapped)
  return { kind: 'paint', paint: { type: 'linear', angle: theta, stops: clipped }, approximations: approximate ? ['gradient-color'] : [] }
}

/**
 * Radial gradient (centre `c`, radius `r`, optional focal point) in gradient
 * space, mapped by `g` onto `box`. Exact when `g` keeps circles circular
 * (`isConformal`); otherwise approximated as a circle of equal area and
 * reported. A focal point away from the centre has no `Paint` equivalent and
 * is dropped, reported.
 */
export function radialToPaint(
  c: readonly [number, number],
  r: number,
  focal: readonly [number, number] | undefined,
  stops: readonly GradientStopIn[],
  g: Affine,
  box: Box,
): GradientResult {
  const lastColor = stops[stops.length - 1]?.color ?? 'transparent'
  const approximations: string[] = []

  const [Cx, Cy] = applyToPoint(g, c[0], c[1])
  const R = r * uniformScale(g)

  if (!isConformal(g)) approximations.push('radial-gradient-elliptical')
  if (focal !== undefined) {
    const dist = Math.hypot(focal[0] - c[0], focal[1] - c[1])
    if (dist > 1e-6 * Math.max(r, 1)) approximations.push('radial-gradient-focal')
  }

  if (!(R > 0)) return { kind: 'solid', color: lastColor, approximations }

  const cx = box.width === 0 ? 0.5 : (Cx - box.x) / box.width
  const cy = box.height === 0 ? 0.5 : (Cy - box.y) / box.height
  const half = Math.hypot(box.width, box.height) / 2
  const rr = half === 0 ? 0 : R / half

  const { stops: clipped, approximate } = clipStops(stops)
  if (approximate) approximations.push('gradient-color')

  return { kind: 'paint', paint: { type: 'radial', cx, cy, r: rr, stops: clipped }, approximations }
}
