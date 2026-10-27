/**
 * The geometry box of an SVG path (PV-P2b).
 *
 * A freehand drawing has no natural width and height the way a video or a text
 * box does: its size IS its path. So before a v2 freehand clip can be placed
 * like an image, something has to know how big the path is - and the only place
 * that can know is the `d` string itself, since no DOM is available here and the
 * export worker needs the same answer.
 *
 * Curves are sampled at the same 16 steps `estimatePathLength` uses, on the same
 * shared walk (`walkPath`), so the two agree by construction rather than by
 * luck. Arcs go through the SVG endpoint-to-centre conversion (F.6.5, F.6.6)
 * rather than the chord the length function settles for, because a box is the
 * one place an approximation is visible: a chord bound clips the drawing.
 *
 * Pure, DOM-free, never throws. The stroke width is NOT included - a caller that
 * wants the inked box adds half the stroke itself.
 */

import { walkPath, type PathVisitor } from './pathLength'

export interface PathBox {
  x: number
  y: number
  width: number
  height: number
}

/** Matches the curve flattening in pathLength, so the two agree. */
const CURVE_STEPS = 16

/**
 * Geometry bounds of an SVG path, or `null` when nothing parses.
 *
 * `'M5 5'` is a box of zero size at (5,5) - a moveto is a point, and a point is
 * a box. Only input that yields no point at all gives `null`.
 */
export function pathBounds(d: string): PathBox | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let seen = false

  const include = (x: number, y: number) => {
    seen = true
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const visitor: PathVisitor = {
    move: (x, y) => include(x, y),
    // The start of a line is already in the box: it is either a moveto or the
    // end of the previous segment.
    line: (_x0, _y0, x1, y1) => include(x1, y1),
    cubic: (x0, y0, x1, y1, x2, y2, x3, y3) => {
      for (let s = 1; s <= CURVE_STEPS; s++) {
        const t = s / CURVE_STEPS
        const u = 1 - t
        include(
          u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        )
      }
    },
    arc: (x0, y0, rx, ry, rotationDeg, largeArc, sweep, x1, y1) => {
      // A zero radius degenerates to a straight line, per SVG.
      if (rx === 0 || ry === 0) {
        include(x1, y1)
        return
      }
      for (const [x, y] of sampleArc(x0, y0, rx, ry, rotationDeg, largeArc, sweep, x1, y1)) {
        include(x, y)
      }
    },
  }

  walkPath(d, visitor)

  if (!seen) return null
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * CURVE_STEPS points along an elliptical arc, from SVG 1.1 F.6.5 (endpoint to
 * centre) and F.6.6 (centre to point). Written out rather than pulled from a
 * library because there is no dependency to pull from and because the flags
 * have to mean what SVG says they mean.
 */
function sampleArc(
  x0: number,
  y0: number,
  rx: number,
  ry: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x1: number,
  y1: number,
): Array<[number, number]> {
  const phi = (rotationDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  const dx2 = (x0 - x1) / 2
  const dy2 = (y0 - y1) / 2
  const x1p = cosPhi * dx2 + sinPhi * dy2
  const y1p = -sinPhi * dx2 + cosPhi * dy2

  // Radii are never negative, and they grow if the endpoints are further apart
  // than they can be.
  let rX = Math.abs(rx)
  let rY = Math.abs(ry)
  const lambda = (x1p * x1p) / (rX * rX) + (y1p * y1p) / (rY * rY)
  if (lambda > 1) {
    const k = Math.sqrt(lambda)
    rX *= k
    rY *= k
  }

  const rx2 = rX * rX
  const ry2 = rY * rY
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p
  const coef = den === 0 ? 0 : (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))

  const cxp = (coef * rX * y1p) / rY
  const cyp = (-coef * rY * x1p) / rX
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2

  const ux = (x1p - cxp) / rX
  const uy = (y1p - cyp) / rY
  const vx = (-x1p - cxp) / rX
  const vy = (-y1p - cyp) / rY

  const theta1 = angleBetween(1, 0, ux, uy)
  let delta = angleBetween(ux, uy, vx, vy)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  if (sweep && delta < 0) delta += 2 * Math.PI

  const out: Array<[number, number]> = []
  for (let s = 1; s <= CURVE_STEPS; s++) {
    const theta = theta1 + (delta * s) / CURVE_STEPS
    const cosT = Math.cos(theta)
    const sinT = Math.sin(theta)
    out.push([
      cx + rX * cosPhi * cosT - rY * sinPhi * sinT,
      cy + rX * sinPhi * cosT + rY * cosPhi * sinT,
    ])
  }
  return out
}

/** The signed angle between two vectors, in (−π, π]. */
function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  const dot = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))
  const sign = ux * vy - uy * vx < 0 ? -1 : 1
  return sign * Math.acos(Math.min(1, Math.max(-1, dot)))
}
