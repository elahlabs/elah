/**
 * MC-1d: the text clip's background-box `shadow` and its `textDecoration`.
 *
 * The context records, in ONE ordered list, every shadow property write, every
 * fillStyle write and every fill / stroke / fillText / fillRect, because both
 * contracts are about ordering: the shadow is set before the box fill and gone
 * before the border and the glyphs; the decoration rectangles come after the
 * glyphs. A recorder that only counted calls would pass with either broken.
 */
import { describe, expect, it } from 'vitest'
import { paintText, textPaintSignature } from '../layers/textPaint'
import type { ActiveTextClip } from '../../../resolver/scene'
import type { TextShadow } from '../../../types'

const STAGE = { width: 1000, height: 500 }
const SHADOW: TextShadow = { color: 'rgba(0,0,0,0.4)', blur: 16, offsetX: 4, offsetY: 8 }

/** `scale`: the output scale the caller has set on the context (the export's setTransform); omitted = a context with no getTransform. */
function recordingCtx(scale?: number) {
  const log: Array<[string, ...unknown[]]> = []
  const rec = (name: string) => (...a: unknown[]) => {
    log.push([name, ...a])
  }
  const state: Record<string, unknown> = {}
  const ctx: Record<string, unknown> = {
    measureText: (t: string) => ({ width: t.length * 10 }),
    save: rec('save'),
    restore: rec('restore'),
    translate: rec('translate'),
    rotate: rec('rotate'),
    scale: rec('scale'),
    beginPath: () => {},
    moveTo: () => {},
    arcTo: () => {},
    closePath: () => {},
    rect: () => {},
    clip: () => {},
    fill: rec('fill'),
    stroke: rec('stroke'),
    fillText: rec('fillText'),
    strokeText: rec('strokeText'),
    fillRect: rec('fillRect'),
  }
  if (scale !== undefined) ctx.getTransform = () => ({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 })
  for (const key of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'lineJoin', 'textAlign', 'textBaseline', 'globalAlpha',
    'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'font',
  ]) {
    Object.defineProperty(ctx, key, {
      get: () => state[key],
      set: (v) => {
        state[key] = v
        if (key.startsWith('shadow') || key === 'fillStyle') log.push([key, v])
      },
    })
  }
  state.globalAlpha = 1
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log }
}

function text(over: Partial<ActiveTextClip> = {}): ActiveTextClip {
  return {
    id: 't', trackId: 'tr', name: 't', type: 'text', content: 'HELLO', sourceFrame: 0, opacity: 1, zIndex: 0,
    fontSize: 28,
    color: '#123456',
    ...over,
  }
}
const names = (log: Array<[string, ...unknown[]]>) => log.map((e) => e[0])

describe('text background-box shadow', () => {
  it('is on for the box fill only, then gone before the border and the glyphs', () => {
    const { ctx, log } = recordingCtx()
    paintText(ctx, text({ backgroundColor: '#fff', borderWidth: 2, borderColor: '#000', shadow: SHADOW }), STAGE)
    const n = names(log)
    const fillAt = n.indexOf('fill')
    expect(n.slice(fillAt - 4, fillAt)).toEqual(['shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY'])
    expect(log.slice(fillAt - 4, fillAt).map((e) => e[1])).toEqual(['rgba(0,0,0,0.4)', 16, 4, 8])
    expect(log.slice(fillAt + 1, fillAt + 5).map((e) => e[1])).toEqual(['transparent', 0, 0, 0])
    // Nothing that follows runs with a shadow set: the only shadow writes are those eight.
    expect(n.filter((x) => x.startsWith('shadow'))).toHaveLength(8)
    expect(n.indexOf('stroke')).toBeGreaterThan(fillAt)
    expect(n.indexOf('fillText')).toBeGreaterThan(n.indexOf('stroke'))
  })

  it('does nothing without a background box', () => {
    const { ctx, log } = recordingCtx()
    paintText(ctx, text({ shadow: SHADOW }), STAGE)
    expect(names(log).some((x) => x.startsWith('shadow'))).toBe(false)
  })

  it('a malformed shadow is no shadow', () => {
    const { ctx, log } = recordingCtx()
    paintText(ctx, text({ backgroundColor: '#fff', shadow: { color: 3 } as unknown as TextShadow }), STAGE)
    expect(names(log).some((x) => x.startsWith('shadow'))).toBe(false)
  })
})

describe('text decoration', () => {
  // 28 px text: thickness max(1, 28/14) = 2. The context reports no em-height
  // metrics, so the fallbacks apply: ascent 22.4, descent 5.6 (baseline is 8.4
  // below the middle) and an x-height of 14.
  it('underline is one rect per line, in the glyph colour, after the glyphs', () => {
    const { ctx, log } = recordingCtx()
    const layout = paintText(ctx, text({ content: 'AB\nCDE', textDecoration: 'underline' }), STAGE)
    const rects = log.filter((e) => e[0] === 'fillRect')
    expect(rects).toHaveLength(2)
    expect(layout.lines).toEqual(['AB', 'CDE'])
    const [r0, r1] = rects as Array<[string, number, number, number, number]>
    // centred on anchorX: widths 20 and 30
    expect(r0.slice(3)).toEqual([20, 2])
    expect(r1.slice(3)).toEqual([30, 2])
    expect(r0[1]).toBeCloseTo(layout.anchorX - 10, 6)
    expect(r1[1]).toBeCloseTo(layout.anchorX - 15, 6)
    expect(r0[2]).toBeCloseTo(layout.firstLineY + 8.4 + 2, 6)
    expect(r1[2]).toBeCloseTo(layout.firstLineY + layout.lineAdvance + 8.4 + 2, 6)
    // after the last fillText, and filled with the glyph colour
    const n = names(log)
    expect(n.indexOf('fillRect')).toBeGreaterThan(n.lastIndexOf('fillText'))
    const styleBefore = log.slice(0, n.indexOf('fillRect')).filter((e) => e[0] === 'fillStyle').pop()
    expect(styleBefore![1]).toBe('#123456')
  })

  it('line-through sits half an x-height above the baseline', () => {
    const { ctx, log } = recordingCtx()
    const layout = paintText(ctx, text({ textDecoration: 'line-through' }), STAGE)
    const [r] = log.filter((e) => e[0] === 'fillRect') as Array<[string, number, number, number, number]>
    // baseline = middle + 8.4; centre of the bar = baseline - 14 / 2; top = centre - thickness / 2
    expect(r[2]).toBeCloseTo(layout.firstLineY + 8.4 - 7 - 1, 6)
    expect(r[3]).toBe(50)
  })

  it('thickness scales with the font size and never drops under 1 px', () => {
    const big = recordingCtx()
    paintText(big.ctx, text({ fontSize: 140, textDecoration: 'underline' }), STAGE)
    expect((big.log.find((e) => e[0] === 'fillRect') as unknown[])[4]).toBe(10)
    const small = recordingCtx()
    paintText(small.ctx, text({ fontSize: 7, textDecoration: 'underline' }), STAGE)
    expect((small.log.find((e) => e[0] === 'fillRect') as unknown[])[4]).toBe(1)
  })

  it('draws nothing when absent or unrecognised', () => {
    const none = recordingCtx()
    paintText(none.ctx, text(), STAGE)
    expect(names(none.log)).not.toContain('fillRect')
    const bad = recordingCtx()
    paintText(bad.ctx, text({ textDecoration: 'overline' as never }), STAGE)
    expect(names(bad.log)).not.toContain('fillRect')
  })
})

describe('text signature', () => {
  const sig = (over: Partial<ActiveTextClip> = {}) => textPaintSignature(text(over), STAGE)

  it('shadow fields and decoration each change it; absent leaves it untouched', () => {
    const base = sig()
    expect(sig({ shadow: undefined, textDecoration: undefined })).toBe(base)
    const s0 = sig({ shadow: SHADOW })
    expect(s0).not.toBe(base)
    expect(sig({ shadow: { ...SHADOW, color: '#fff' } })).not.toBe(s0)
    expect(sig({ shadow: { ...SHADOW, blur: 17 } })).not.toBe(s0)
    expect(sig({ shadow: { ...SHADOW, offsetX: 5 } })).not.toBe(s0)
    expect(sig({ shadow: { ...SHADOW, offsetY: 9 } })).not.toBe(s0)
    const u = sig({ textDecoration: 'underline' })
    expect(u).not.toBe(base)
    expect(sig({ textDecoration: 'line-through' })).not.toBe(u)
  })
})

// EXP-2: canvas shadow blur and offset are in DEVICE pixels and ignore the
// transform, so a painter running under the export's output scale must scale
// them itself. The preview paints at an identity transform and keeps its values.
describe('text shadows under an output scale (EXP-2)', () => {
  const writes = (log: Array<[string, ...unknown[]]>) => log.filter((e) => e[0].startsWith('shadow') && e[1] !== 'transparent' && e[1] !== 0).map((e) => [e[0], e[1]])

  it('scales the background-box shadow blur and offset with the output scale', () => {
    const { ctx, log } = recordingCtx(0.5)
    paintText(ctx, text({ backgroundColor: '#fff', shadow: SHADOW }), STAGE)
    expect(writes(log)).toEqual([['shadowColor', 'rgba(0,0,0,0.4)'], ['shadowBlur', 8], ['shadowOffsetX', 2], ['shadowOffsetY', 4]])
  })

  it('scales the glyph shadow too, outline or not', () => {
    for (const textOutline of [undefined, { color: '#000', width: 3 }]) {
      const { ctx, log } = recordingCtx(2)
      paintText(ctx, text({ textShadow: { color: '#000', blur: 10, offsetX: 3, offsetY: 6 }, ...(textOutline ? { textOutline } : {}) }), STAGE)
      expect(writes(log)).toEqual([['shadowColor', '#000'], ['shadowBlur', 20], ['shadowOffsetX', 6], ['shadowOffsetY', 12]])
    }
  })

  it('keeps today’s values at an identity transform and on a context with no getTransform', () => {
    for (const scale of [1, undefined]) {
      const { ctx, log } = recordingCtx(scale)
      paintText(ctx, text({ backgroundColor: '#fff', shadow: SHADOW, textShadow: { color: '#000', blur: 10, offsetX: 3, offsetY: 6 } }), STAGE)
      expect(writes(log)).toEqual([
        ['shadowColor', 'rgba(0,0,0,0.4)'], ['shadowBlur', 16], ['shadowOffsetX', 4], ['shadowOffsetY', 8],
        ['shadowColor', '#000'], ['shadowBlur', 10], ['shadowOffsetX', 3], ['shadowOffsetY', 6],
      ])
    }
  })

  it('rotates the box-shadow offset first, then scales it', () => {
    const { ctx, log } = recordingCtx(0.5)
    paintText(ctx, text({ backgroundColor: '#fff', shadow: { color: '#000', blur: 0, offsetX: 10, offsetY: 0 }, transform: { x: 0.5, y: 0.5, scale: 1, rotation: Math.PI / 2, anchor: { x: 0.5, y: 0.5 } } }), STAGE)
    const x = log.find((e) => e[0] === 'shadowOffsetX')![1] as number
    const y = log.find((e) => e[0] === 'shadowOffsetY')![1] as number
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(5, 6)
  })
})
