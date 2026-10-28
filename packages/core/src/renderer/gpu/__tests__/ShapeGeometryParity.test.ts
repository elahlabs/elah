/**
 * ShapeGeometryParity — the shape box agrees with every path that draws it.
 *
 * Three independent code paths decide where a shape is: the painter (2D ops in
 * stage pixels), the preview overlay (a CSS-transformed DOM box), and the
 * export worker (the same painter, in a worker). They agree only because all
 * three derive from `resolveShapeRect`. This file pins the rect itself, and
 * checks its rotated corners against the SAME reference formula
 * `GeometryParity` uses for media — because that formula is what
 * `ExportWorker.drawMedia`'s `translate/rotate` and the overlay's CSS
 * `rotate()` both realise.
 *
 * Rotation has to be checked on a NON-square stage at the CORNERS: a rotation
 * applied in normalized space rather than pixel space is invisible at the
 * centre and on a square stage, which is exactly how the media bug of the same
 * shape survived for a while.
 */

import { describe, it, expect } from 'vitest'
import { resolveShapeRect } from '../layers/shapePaint'
import type { DrawRect } from '../layers/drawRect'
import type { Transform } from '../../../types'

const LANDSCAPE = { width: 1920, height: 1080 }
const PORTRAIT = { width: 1080, height: 1920 }

function transform(overrides: Partial<Transform> = {}): Transform {
  return { x: 0.5, y: 0.5, scale: 0.5, rotation: 0, anchor: { x: 0.5, y: 0.5 }, ...overrides }
}

/** Where the 2D canvas puts a box corner — the shared reference (GeometryParity). */
function canvasCorner(rect: DrawRect, u: number, v: number): { x: number; y: number } {
  const c = Math.cos(rect.rotation)
  const s = Math.sin(rect.rotation)
  const lx = (u - 0.5) * rect.width
  const ly = (v - 0.5) * rect.height
  return {
    x: rect.x + rect.width / 2 + (lx * c - ly * s),
    y: rect.y + rect.height / 2 + (lx * s + ly * c),
  }
}

/**
 * The overlay's screen box, extracted as pure math: the same contain-fit
 * viewport mapping `ShapeOverlay` applies to turn stage pixels into CSS pixels.
 */
function screenBox(
  rect: DrawRect,
  fit: { left: number; top: number; scale: number },
): { left: number; top: number; width: number; height: number } {
  return {
    left: fit.left + rect.x * fit.scale,
    top: fit.top + rect.y * fit.scale,
    width: rect.width * fit.scale,
    height: rect.height * fit.scale,
  }
}

describe('resolveShapeRect — the box', () => {
  it('a transform-less shape is half the short side, centred', () => {
    expect(resolveShapeRect(undefined, LANDSCAPE)).toEqual({
      x: 690, y: 270, width: 540, height: 540, rotation: 0,
    })
  })

  it('the base side follows the SHORT side on either orientation', () => {
    expect(resolveShapeRect(undefined, PORTRAIT).width).toBe(540)
    expect(resolveShapeRect(undefined, PORTRAIT).height).toBe(540)
  })

  it('scaleX / scaleY stretch the square box per axis', () => {
    const rect = resolveShapeRect(transform({ scaleX: 2, scaleY: 0.5 }), LANDSCAPE)
    expect(rect.width).toBe(1080)
    expect(rect.height).toBe(270)
    // Still centred: the anchor is the default 0.5.
    expect(rect.x + rect.width / 2).toBeCloseTo(960, 9)
    expect(rect.y + rect.height / 2).toBeCloseTo(540, 9)
  })

  it('the anchor moves the box, not the point (x, y) names', () => {
    const topLeft = resolveShapeRect(transform({ anchor: { x: 0, y: 0 } }), LANDSCAPE)
    expect(topLeft.x).toBe(960)
    expect(topLeft.y).toBe(540)

    const bottomRight = resolveShapeRect(transform({ anchor: { x: 1, y: 1 } }), LANDSCAPE)
    expect(bottomRight.x).toBe(960 - 540)
    expect(bottomRight.y).toBe(540 - 540)
  })

  it('anchor 0.5 reduces to the pre-v2 centred expression', () => {
    for (const scale of [0.1, 0.5, 1, 3]) {
      for (const [scaleX, scaleY] of [[1, 1], [2, 0.5], [0.3, 4]]) {
        const rect = resolveShapeRect(transform({ scale, scaleX, scaleY }), PORTRAIT)
        const shortSide = Math.min(PORTRAIT.width, PORTRAIT.height)
        const baseHalf = scale * shortSide * 0.5
        const halfW = baseHalf * scaleX
        const halfH = baseHalf * scaleY
        // The literal pre-v2 arithmetic.
        expect(rect.x).toBe(0.5 * PORTRAIT.width - halfW)
        expect(rect.y).toBe(0.5 * PORTRAIT.height - halfH)
        expect(rect.width).toBe(halfW * 2)
        expect(rect.height).toBe(halfH * 2)
      }
    }
  })

  it('carries rotation through untouched', () => {
    expect(resolveShapeRect(transform({ rotation: Math.PI / 3 }), LANDSCAPE).rotation)
      .toBeCloseTo(Math.PI / 3, 12)
  })
})

describe('resolveShapeRect — rotation agrees with the media reference', () => {
  /**
   * A quarter turn must not change the box's size. On a 9:16 stage, a rotation
   * applied in normalized space would come out 1.78× on one axis.
   */
  it('a quarter turn on a 9:16 stage keeps a square box square', () => {
    const rect = resolveShapeRect(transform({ rotation: Math.PI / 2 }), PORTRAIT)
    const tl = canvasCorner(rect, 0, 0)
    const tr = canvasCorner(rect, 1, 0)
    const bl = canvasCorner(rect, 0, 1)

    expect(Math.hypot(tr.x - tl.x, tr.y - tl.y)).toBeCloseTo(540, 9)
    expect(Math.hypot(bl.x - tl.x, bl.y - tl.y)).toBeCloseTo(540, 9)
  })

  it('a stretched box keeps both edge lengths through a rotation', () => {
    const rect = resolveShapeRect(
      transform({ scaleX: 2, scaleY: 0.5, rotation: Math.PI / 6 }),
      PORTRAIT,
    )
    const tl = canvasCorner(rect, 0, 0)
    const tr = canvasCorner(rect, 1, 0)
    const bl = canvasCorner(rect, 0, 1)

    expect(Math.hypot(tr.x - tl.x, tr.y - tl.y)).toBeCloseTo(rect.width, 9)
    expect(Math.hypot(bl.x - tl.x, bl.y - tl.y)).toBeCloseTo(rect.height, 9)
  })

  it('the pivot is the box centre even with an off-centre anchor', () => {
    const rect = resolveShapeRect(
      transform({ anchor: { x: 0, y: 0 }, rotation: Math.PI }),
      LANDSCAPE,
    )
    const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    // A half turn maps each corner onto the diagonally opposite one.
    const tl = canvasCorner(rect, 0, 0)
    expect(tl.x).toBeCloseTo(centre.x + rect.width / 2, 9)
    expect(tl.y).toBeCloseTo(centre.y + rect.height / 2, 9)
  })

  it('positive rotation is clockwise on screen', () => {
    const rect = resolveShapeRect(transform({ rotation: Math.PI / 2 }), LANDSCAPE)
    const tl = canvasCorner(rect, 0, 0)
    const tr = canvasCorner(rect, 1, 0)
    // The width edge, which pointed +x, now points +y (down the screen).
    expect(tr.x - tl.x).toBeCloseTo(0, 9)
    expect(tr.y - tl.y).toBeCloseTo(540, 9)
  })
})

describe('resolveShapeRect — the overlay box tracks the painted box', () => {
  const fit = { left: 40, top: 12, scale: 0.25 }

  it('maps the stage rect into screen space without changing its aspect', () => {
    const rect = resolveShapeRect(transform({ scaleX: 2 }), LANDSCAPE)
    const box = screenBox(rect, fit)
    expect(box.width / box.height).toBeCloseTo(rect.width / rect.height, 12)
    expect(box.left).toBeCloseTo(fit.left + rect.x * fit.scale, 12)
    expect(box.top).toBeCloseTo(fit.top + rect.y * fit.scale, 12)
  })

  it('the screen box centre is the rotation pivot, so CSS rotate() agrees', () => {
    const rect = resolveShapeRect(transform({ rotation: 0.8, anchor: { x: 0.2, y: 0.9 } }), PORTRAIT)
    const box = screenBox(rect, fit)
    const cssPivot = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    const stagePivot = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    expect(cssPivot.x).toBeCloseTo(fit.left + stagePivot.x * fit.scale, 12)
    expect(cssPivot.y).toBeCloseTo(fit.top + stagePivot.y * fit.scale, 12)
  })
})
