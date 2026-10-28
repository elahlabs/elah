/**
 * MC-1d: the conic `Paint`.
 *
 * The one thing worth pinning as a NUMBER is the angle conversion. CSS
 * `conic-gradient(from <a>)` starts at 12 o'clock; `createConicGradient` starts
 * at 3 o'clock. A gradient that is a quarter turn off still looks like a
 * gradient in a screenshot, so the start angle handed to the canvas is asserted
 * exactly.
 */
import { describe, expect, it } from 'vitest'
import { isPaint, paintSignature, toCanvasPaint, type PaintBox } from '../layers/paint'
import type { Paint, PaintStop } from '../../../types'

const BOX: PaintBox = { x: 100, y: 50, width: 200, height: 100 }
const S: PaintStop[] = [
  { offset: 0, color: '#f00' },
  { offset: 1, color: '#00f' },
]

function conicCtx() {
  const calls: unknown[][] = []
  const gradient = {
    addColorStop(offset: number, color: string) {
      calls.push(['stop', offset, color])
    },
  }
  const ctx = {
    createConicGradient(...a: number[]) {
      calls.push(['conic', ...a])
      return gradient
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, gradient }
}

const conic = (over: Partial<Extract<Paint, { type: 'conic' }>> = {}): Paint => ({
  type: 'conic',
  angle: 0,
  cx: 0.5,
  cy: 0.5,
  stops: S,
  ...over,
})

describe('toCanvasPaint — conic', () => {
  it('CSS from 0deg (up) becomes canvas -90deg, centred on the box', () => {
    const { ctx, calls, gradient } = conicCtx()
    const out = toCanvasPaint(ctx, conic(), BOX)
    expect(out).toBe(gradient)
    expect(calls[0]).toEqual(['conic', -Math.PI / 2, 200, 100])
    expect(calls.slice(1)).toEqual([
      ['stop', 0, '#f00'],
      ['stop', 1, '#00f'],
    ])
  })

  it('CSS from 90deg (right) is canvas 0, and a non-centre centre maps into the box', () => {
    const { ctx, calls } = conicCtx()
    toCanvasPaint(ctx, conic({ angle: 90, cx: 0.25, cy: 0.75 }), BOX)
    expect(calls[0]).toEqual(['conic', 0, 150, 125])
  })

  it('a context without createConicGradient gets the last stop colour, not a throw', () => {
    expect(toCanvasPaint({} as unknown as CanvasRenderingContext2D, conic(), BOX)).toBe('#00f')
  })

  it('fewer than two stops is a colour, and zero is transparent', () => {
    const one = conicCtx()
    expect(toCanvasPaint(one.ctx, conic({ stops: [{ offset: 0, color: '#abc' }] }), BOX)).toBe('#abc')
    expect(one.calls).toEqual([])
    expect(toCanvasPaint(conicCtx().ctx, conic({ stops: [] }), BOX)).toBe('rgba(0,0,0,0)')
  })
})

describe('isPaint — conic', () => {
  it('accepts a well-formed conic and refuses missing or non-finite fields', () => {
    expect(isPaint(conic())).toBe(true)
    expect(isPaint({ type: 'conic', angle: 0, cx: 0.5, stops: S })).toBe(false)
    expect(isPaint({ type: 'conic', angle: NaN, cx: 0.5, cy: 0.5, stops: S })).toBe(false)
    expect(isPaint({ type: 'conic', angle: 0, cx: 0.5, cy: 0.5, stops: 'x' })).toBe(false)
  })
})

describe('paintSignature — conic', () => {
  it('changes with each of angle, cx, cy and any stop, and is stable otherwise', () => {
    const base = paintSignature(conic())
    expect(base).not.toBe('')
    expect(paintSignature(conic())).toBe(base)
    expect(paintSignature(conic({ angle: 45 }))).not.toBe(base)
    expect(paintSignature(conic({ cx: 0.4 }))).not.toBe(base)
    expect(paintSignature(conic({ cy: 0.4 }))).not.toBe(base)
    expect(paintSignature(conic({ stops: [S[0]!, { offset: 0.9, color: '#00f' }] }))).not.toBe(base)
    expect(paintSignature(conic({ stops: [S[0]!, { offset: 1, color: '#0ff' }] }))).not.toBe(base)
  })

  it('does not collide with a radial paint of the same numbers', () => {
    expect(paintSignature({ type: 'radial', cx: 0.5, cy: 0.5, r: 0, stops: S })).not.toBe(
      paintSignature(conic({ angle: 0 })),
    )
  })
})
