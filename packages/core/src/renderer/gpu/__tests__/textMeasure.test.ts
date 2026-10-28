import { describe, expect, it } from 'vitest'
import { createCanvasMeasurer, measureContextFor, trackedWidth, type MeasureContext } from '../layers/textMeasure'

/**
 * The shared text measurer (PV-P2a).
 *
 * The interesting behaviour is not the arithmetic, it is the two edges: tracking
 * never adds a gap after the last character (a trailing space of tracking is a
 * bug every layout engine has shipped at least once), and a context with no
 * bounding box reports zero rather than a number it made up - which is what
 * makes this usable from a jsdom test, where `actualBoundingBoxAscent` does not
 * exist at all.
 */

describe('trackedWidth', () => {
  it('adds one gap per gap between characters', () => {
    expect(trackedWidth(100, 'HELLO', 5)).toBe(120)
  })

  it('is the plain width with no tracking', () => {
    expect(trackedWidth(100, 'HELLO', 0)).toBe(100)
  })

  it('does not track a single character', () => {
    expect(trackedWidth(10, 'H', 5)).toBe(10)
  })

  it('counts code points, not UTF-16 units', () => {
    // One emoji, one gap - not two, which is what `.length` would give.
    expect(trackedWidth(20, 'a😀', 4)).toBe(24)
  })
})

describe('createCanvasMeasurer', () => {
  function context(extra: Partial<TextMetrics> = {}): MeasureContext & { font: string } {
    return {
      font: '',
      measureText: (text: string) =>
        ({ width: text.length * 10, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 3, ...extra }) as TextMetrics,
    } as MeasureContext & { font: string }
  }

  it('sets the font and reports width, ascent and descent', () => {
    const ctx = context()
    const m = createCanvasMeasurer(ctx)
    expect(m.measure('bold 40px serif', 'HI', 2)).toEqual({ width: 22, ascent: 7, descent: 3 })
    // The context has to know which metrics it was asked for.
    expect(ctx.font).toBe('bold 40px serif')
  })

  it('reports zero for a context with no bounding box', () => {
    const ctx = { font: '', measureText: (t: string) => ({ width: t.length * 10 }) as TextMetrics }
    expect(createCanvasMeasurer(ctx).measure('12px serif', 'AB')).toEqual({ width: 20, ascent: 0, descent: 0 })
  })
})

describe('measureContextFor', () => {
  it('hands layout a context that carries the font through', () => {
    const seen: string[] = []
    const ctx = measureContextFor({
      measure: (font, text) => {
        seen.push(font)
        return { width: text.length * 10, ascent: 0, descent: 0 }
      },
    })
    ctx.font = 'f'
    expect(ctx.measureText('ABC').width).toBe(30)
    expect(seen).toEqual(['f'])
    // Reading it back gives the font that was set, which is what layout relies
    // on when it paints with the metrics it measured.
    expect(ctx.font).toBe('f')
  })
})
