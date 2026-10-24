/**
 * PV-P4c-1: the one paint helper.
 *
 * The geometry assertions are the reason this file exists and they are asserted
 * as NUMBERS, not as "a gradient was created". A gradient that spans slightly too
 * little still looks like a gradient in a screenshot; it shows as a band of end
 * colour outside the glyphs, which is invisible until someone compares two
 * renders. So the four gradient endpoints are pinned exactly.
 *
 * `Math.cos(Math.PI / 2)` is `6.1e-17`, not `0` — hence `toBeCloseTo` on every
 * 90° and 45° expectation, and never `toBe`.
 */
import { describe, expect, it } from 'vitest'
import { isPaint, paintSignature, toCanvasPaint, type PaintBox } from '../layers/paint'
import type { Paint, PaintStop } from '../../../types'

const BOX: PaintBox = { x: 100, y: 50, width: 200, height: 100 }
const S: PaintStop[] = [
  { offset: 0, color: '#000' },
  { offset: 1, color: '#fff' },
]

/** Records what the helper asked the canvas for. */
function stubCtx() {
  const calls: unknown[][] = []
  const gradient = {
    addColorStop(offset: number, color: string) {
      // The real CanvasGradient THROWS on a colour it cannot parse, and a stop
      // that throws is NOT added. So the check comes BEFORE the record: a stub
      // that recorded the attempt would make the helper's catch branch look like
      // it had done nothing.
      if (color === 'nope') throw new SyntaxError('unparsable colour')
      calls.push(['stop', offset, color])
    },
  }
  const ctx = {
    createLinearGradient(...a: number[]) {
      calls.push(['linear', ...a])
      return gradient
    },
    createRadialGradient(...a: number[]) {
      calls.push(['radial', ...a])
      return gradient
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

describe('toCanvasPaint — solid', () => {
  it('returns the colour and touches the canvas not at all', () => {
    const { ctx, calls } = stubCtx()
    expect(toCanvasPaint(ctx, { type: 'solid', color: '#f00' }, BOX)).toBe('#f00')
    expect(calls).toEqual([])
  })
})

describe('toCanvasPaint — linear geometry', () => {
  it('0 degrees runs left to right through the box centre', () => {
    const { ctx, calls } = stubCtx()
    toCanvasPaint(ctx, { type: 'linear', angle: 0, stops: S }, BOX)
    // half = (|200·1| + |100·0|)/2 = 100, centre (200, 100).
    expect(calls[0]).toEqual(['linear', 100, 100, 300, 100])
    expect(calls.slice(1)).toEqual([
      ['stop', 0, '#000'],
      ['stop', 1, '#fff'],
    ])
  })

  it('90 degrees runs top to bottom', () => {
    const { ctx, calls } = stubCtx()
    toCanvasPaint(ctx, { type: 'linear', angle: 90, stops: S }, BOX)
    // cos(90°) is 6.1e-17, not 0, so the x endpoints are 200 ± 6.1e-15.
    const [, x0, y0, x1, y1] = calls[0] as number[]
    expect(x0).toBeCloseTo(200, 6)
    expect(x1).toBeCloseTo(200, 6)
    expect(y0).toBeCloseTo(50, 6)
    expect(y1).toBeCloseTo(150, 6)
  })

  it('45 and 180 degrees use the same corner-reaching rule', () => {
    const a = stubCtx()
    toCanvasPaint(a.ctx, { type: 'linear', angle: 45, stops: S }, BOX)
    // half = (200 + 100)/2 · √2/2 = 105.83, so the line runs (125,25)→(275,175).
    const [ax0, ay0, ax1, ay1] = (a.calls[0] as number[]).slice(1)
    expect(ax0).toBeCloseTo(125, 6)
    expect(ay0).toBeCloseTo(25, 6)
    expect(ax1).toBeCloseTo(275, 6)
    expect(ay1).toBeCloseTo(175, 6)

    const b = stubCtx()
    toCanvasPaint(b.ctx, { type: 'linear', angle: 180, stops: S }, BOX)
    // 180° is right to left: the endpoints swap, which is why both are asserted.
    const [bx0, by0, bx1, by1] = (b.calls[0] as number[]).slice(1)
    expect(bx0).toBeCloseTo(300, 6)
    expect(by0).toBeCloseTo(100, 6)
    expect(bx1).toBeCloseTo(100, 6)
    expect(by1).toBeCloseTo(100, 6)
  })
})

describe('toCanvasPaint — radial geometry', () => {
  it('centres on the box and scales the radius by half the diagonal', () => {
    const { ctx, calls } = stubCtx()
    toCanvasPaint(ctx, { type: 'radial', cx: 0.5, cy: 0.5, r: 1, stops: S }, BOX)
    // hypot(200, 100)/2 = 111.8034.
    expect(calls[0]!.slice(1, 4)).toEqual([200, 100, 0])
    expect((calls[0] as number[])[4]).toBeCloseTo(200, 6)
    expect((calls[0] as number[])[5]).toBeCloseTo(100, 6)
    // hypot(200, 100)/2 = 111.80339887498948. The ticket writes this as
    // "≈111.8034" and asks for 6 digits, but that is 6 SIGNIFICANT digits: the
    // literal 111.8034 is 1.1e-6 away from the real value, so a 6-DECIMAL-place
    // tolerance (5e-7) cannot hold it. Precision 4 is still three orders tighter
    // than "about 112" and is what the ticket's number actually supports.
    expect((calls[0] as number[])[6]).toBeCloseTo(111.8034, 4)
  })

  it('honours a non-centre centre and a fractional radius', () => {
    const { ctx, calls } = stubCtx()
    toCanvasPaint(ctx, { type: 'radial', cx: 0, cy: 0, r: 0.5, stops: S }, BOX)
    expect(calls[0]!.slice(1, 6)).toEqual([100, 50, 0, 100, 50])
    // hypot(200, 100)/4 = 55.90169943749474 — same significant-digits point.
    expect((calls[0] as number[])[6]).toBeCloseTo(55.9017, 4)
  })
})

describe('toCanvasPaint — stops', () => {
  it('clamps out-of-range offsets and sorts them', () => {
    // addColorStop requires non-decreasing offsets and THROWS otherwise, so an
    // unsorted document would otherwise throw mid-paint.
    const { ctx, calls } = stubCtx()
    toCanvasPaint(
      ctx,
      { type: 'linear', angle: 0, stops: [{ offset: 1.2, color: '#fff' }, { offset: -0.5, color: '#000' }] },
      BOX,
    )
    expect(calls.slice(1)).toEqual([
      ['stop', 0, '#000'],
      ['stop', 1, '#fff'],
    ])
  })

  it('skips an unparsable colour and keeps the rest of the gradient', () => {
    const { ctx, calls } = stubCtx()
    const result = toCanvasPaint(
      ctx,
      { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 0.5, color: 'nope' }, { offset: 1, color: '#fff' }] },
      BOX,
    )
    expect(result).toBeDefined()
    expect(calls.slice(1)).toEqual([
      ['stop', 0, '#000'],
      ['stop', 1, '#fff'],
    ])
  })

  it('does not reorder the caller\'s stops', () => {
    // The Style tab's stop rows are bound to this array by index. Sorting it in
    // place would make a row jump under the pointer mid-drag.
    const stops: PaintStop[] = [{ offset: 1, color: '#fff' }, { offset: 0, color: '#000' }]
    const { ctx } = stubCtx()
    toCanvasPaint(ctx, { type: 'linear', angle: 0, stops }, BOX)
    expect(stops.map((s) => s.offset)).toEqual([1, 0])
  })

  it('one stop is that colour and no gradient; zero stops is transparent', () => {
    const one = stubCtx()
    expect(toCanvasPaint(one.ctx, { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#abc' }] }, BOX)).toBe('#abc')
    expect(one.calls).toEqual([])

    const none = stubCtx()
    expect(toCanvasPaint(none.ctx, { type: 'linear', angle: 0, stops: [] }, BOX)).toBe('rgba(0,0,0,0)')
    expect(none.calls).toEqual([])
  })

  it('a zero-area box returns a colour instead of throwing IndexSizeError', () => {
    // createLinearGradient with coincident points throws in a real canvas.
    const { ctx, calls } = stubCtx()
    expect(toCanvasPaint(ctx, { type: 'linear', angle: 0, stops: S }, { x: 0, y: 0, width: 0, height: 0 })).toBe('#fff')
    expect(calls).toEqual([])

    const radial = stubCtx()
    expect(
      toCanvasPaint(radial.ctx, { type: 'radial', cx: 0.5, cy: 0.5, r: 0, stops: S }, { x: 0, y: 0, width: 0, height: 0 }),
    ).toBe('#fff')
    expect(radial.calls).toEqual([])
  })

  it('a stop that is not an object at all is dropped, not dereferenced', () => {
    const { ctx, calls } = stubCtx()
    const stops = [{ offset: 0, color: '#000' }, null, { offset: 1, color: '#fff' }] as unknown as PaintStop[]
    expect(() => toCanvasPaint(ctx, { type: 'linear', angle: 0, stops }, BOX)).not.toThrow()
    expect(calls.slice(1)).toEqual([
      ['stop', 0, '#000'],
      ['stop', 1, '#fff'],
    ])
  })
})

describe('paintSignature', () => {
  it('is empty for an absent paint, so it can be appended unconditionally', () => {
    expect(paintSignature(undefined)).toBe('')
  })

  it('distinguishes the kinds and the geometry', () => {
    expect(paintSignature({ type: 'solid', color: '#f00' })).toBe('s:#f00')
    expect(paintSignature({ type: 'linear', angle: 90, stops: S })).toBe('l:90:0@#000,1@#fff')
    expect(paintSignature({ type: 'radial', cx: 0.5, cy: 0.5, r: 1, stops: S })).toBe('r:0.5:0.5:1:0@#000,1@#fff')
  })

  it('two angles never share a key, which is what makes a repaint happen', () => {
    const a = paintSignature({ type: 'linear', angle: 0, stops: S })
    const b = paintSignature({ type: 'linear', angle: 90, stops: S })
    expect(a).not.toBe(b)
  })

  it('a solid and a gradient of the same colour never share a key', () => {
    // The key is prefixed by kind precisely so a one-stop gradient and a solid
    // are distinguishable — the gradient is built by a different code path.
    expect(paintSignature({ type: 'solid', color: '#000' })).not.toBe(
      paintSignature({ type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] }),
    )
  })
})

describe('isPaint', () => {
  it('accepts the three well-formed kinds', () => {
    expect(isPaint({ type: 'solid', color: '#fff' })).toBe(true)
    expect(isPaint({ type: 'linear', angle: 0, stops: S })).toBe(true)
    expect(isPaint({ type: 'radial', cx: 0.5, cy: 0.5, r: 1, stops: S })).toBe(true)
  })

  it('refuses a document that is not a Paint', () => {
    // Every one of these can arrive from a hand-edited or AI-authored project,
    // and a painter that trusted it would throw mid-frame — in the export worker
    // that is a failed video, not a warning.
    expect(isPaint(null)).toBe(false)
    expect(isPaint(undefined)).toBe(false)
    expect(isPaint('#fff')).toBe(false)
    expect(isPaint({ type: 'linear' })).toBe(false)
    expect(isPaint({ type: 'linear', angle: 0, stops: 'nope' })).toBe(false)
    expect(isPaint({ type: 'conic', stops: [] })).toBe(false)
    expect(isPaint({ type: 'radial', cx: 0.5, cy: 0.5, stops: [] })).toBe(false)
    expect(isPaint({ type: 'radial', cx: 'a', cy: 0.5, r: 1, stops: [] })).toBe(false)
  })

  it('a solid with no colour is refused, so a painter falls back rather than filling undefined', () => {
    expect(isPaint({ type: 'solid' })).toBe(false)
  })
})

describe('every Paint the registry can express is accepted', () => {
  it('accepts a linear and a radial built by hand', () => {
    const paints: Paint[] = [
      { type: 'solid', color: '#fff' },
      { type: 'linear', angle: 270, stops: S },
      { type: 'radial', cx: 0, cy: 1, r: 2, stops: S },
    ]
    for (const p of paints) expect(isPaint(p)).toBe(true)
  })
})
