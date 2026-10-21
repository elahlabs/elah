/**
 * Test-only: the colour a `Paint` puts at (x, y) in `box`, using P4c's own
 * geometry (`linearGradientPoints`) so a test never re-derives the gradient
 * line by hand and drifts from what the painter actually does.
 */
import type { Paint } from '../../types'
import type { Box } from '../place'
import { linearGradientPoints } from '../../renderer/gpu/layers/paint'
import { colorAt } from '../gradient'
import { parseCssColor, type Rgba } from '../color'

export function paintColorAt(paint: Paint, box: Box, x: number, y: number): Rgba {
  if (paint.type === 'solid') {
    return parseCssColor(paint.color) ?? { r: 0, g: 0, b: 0, a: 0 }
  }

  let t: number
  if (paint.type === 'linear') {
    const { x0, y0, x1, y1 } = linearGradientPoints(paint.angle, box)
    const dx = x1 - x0
    const dy = y1 - y0
    const len2 = dx * dx + dy * dy
    t = len2 === 0 ? 0 : ((x - x0) * dx + (y - y0) * dy) / len2
  } else if (paint.type === 'conic') {
    // CSS `from <angle>`: 0 = up, clockwise. t is the turn fraction.
    const cx = box.x + paint.cx * box.width
    const cy = box.y + paint.cy * box.height
    const turns = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90 - paint.angle
    t = (((turns % 360) + 360) % 360) / 360
  } else {
    const cx = box.x + paint.cx * box.width
    const cy = box.y + paint.cy * box.height
    const radius = paint.r * 0.5 * Math.hypot(box.width, box.height)
    t = radius === 0 ? 0 : Math.hypot(x - cx, y - cy) / radius
  }

  const { color } = colorAt(paint.stops, t)
  return parseCssColor(color) ?? { r: 0, g: 0, b: 0, a: 0 }
}
