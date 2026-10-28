/**
 * PV-P4b: the canvas `font` shorthand.
 *
 * This file exists to pin ONE string byte for byte in both directions, because
 * both failures are silent. A 2D context whose `font` assignment does not parse
 * IGNORES it and keeps the previous value, so a malformed string does not throw
 * and does not look wrong — it looks like a stale render. And a legacy document
 * whose string changed shape by one token repaints every existing title for no
 * reason, which is invisible in a test that only checks "it produced a string".
 *
 * So: the legacy branch is asserted exactly, the italic and numeric-weight
 * branches are asserted exactly, and `paintText` is checked through a recording
 * context to prove the string actually REACHES the painter.
 */
import { describe, expect, it } from 'vitest'
import { computeTextLayout, cssFont } from '../layers/textLayout'
import { paintText, textPaintSignature } from '../layers/textPaint'
import type { ActiveTextClip } from '../../../resolver/scene'
import type { MeasureContext } from '../layers/textMeasure'

const STAGE = { width: 1000, height: 500 }

function measurer(): MeasureContext {
  return { font: '', measureText: (t: string) => ({ width: t.length * 10 }) as TextMetrics }
}

function fontOf(item: Record<string, unknown>): string {
  return computeTextLayout(measurer(), item as never, STAGE).font
}

/**
 * A 2D context stub that records the calls the painter makes.
 *
 * Copied from `__tests__/textPaint.test.ts` rather than imported: that file is a
 * PARITY suite and PV-P4b's Forbidden list says do not edit it, and importing a
 * helper out of a test file is how one test file starts depending on another's
 * internals. This copy is deliberately inert — it asserts the legacy paint calls
 * are unchanged, not the painter's internals.
 */
function recordingCtx() {
  const calls: string[] = []
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    measureText: (t: string) => ({ width: t.length * 10 }),
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    scale: () => calls.push('scale'),
    beginPath: () => {},
    moveTo: () => {},
    arcTo: () => {},
    closePath: () => {},
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    fillText: (t: string) => calls.push(`fillText:${t}`),
    strokeText: (t: string) => calls.push(`strokeText:${t}`),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

function text(over: Partial<ActiveTextClip> = {}): ActiveTextClip {
  return {
    id: 't',
    trackId: 'tr',
    name: 't',
    type: 'text',
    content: 'HI',
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
    ...over,
  }
}

describe('the font string — the legacy branch is byte-identical', () => {
  it('a bare clip builds the pre-P4b string', () => {
    expect(fontOf({ content: 'A' })).toBe('normal 48px sans-serif')
  })

  it('a keyword weight with a system family, at scale 1 and at scale 2', () => {
    expect(fontOf({ content: 'A', fontWeight: 'bold', fontFamily: 'Impact', fontSize: 72 })).toBe('bold 72px Impact')
    // transform.scale multiplies the glyph size, so the STRING must follow it —
    // measuring at 72 and painting at 144 is the classic text-scaling blur.
    expect(
      fontOf({
        content: 'A',
        fontWeight: 'bold',
        fontFamily: 'Impact',
        fontSize: 72,
        transform: { x: 0.5, y: 0.5, scale: 2, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      }),
    ).toBe('bold 144px Impact')
  })

  it('a bundled font with no style and a keyword weight is unchanged from PV-P4a-2', () => {
    expect(fontOf({ content: 'A', fontId: 'inter' })).toBe('normal 48px "elah-inter", sans-serif')
  })
})

describe('the font string — the new branches', () => {
  it('a numeric weight emits a leading `normal` style, because the slot is needed', () => {
    // `700 48px sans-serif` would be INVALID: a bare number there is read as a
    // size, not a weight. The style slot is what makes the weight legible.
    expect(fontOf({ content: 'A', fontWeight: 700 })).toBe('normal 700 48px sans-serif')
  })

  it('italic alone, and italic over a keyword weight', () => {
    expect(fontOf({ content: 'A', fontStyle: 'italic' })).toBe('italic normal 48px sans-serif')
    expect(fontOf({ content: 'A', fontStyle: 'italic', fontWeight: 'bold' })).toBe('italic bold 48px sans-serif')
  })

  it('italic over a bundled family with a numeric weight', () => {
    expect(fontOf({ content: 'A', fontId: 'inter', fontWeight: 900, fontStyle: 'italic' })).toBe(
      'italic 900 48px "elah-inter", sans-serif',
    )
  })

  it('an explicit fontStyle of `normal` still takes the new branch', () => {
    // Not a no-op: `fontStyle: 'normal'` is a STORED value, so it is emitted, and
    // the string gains a token. That is correct — the clip asked for it — but it
    // means `fontStyle: 'normal'` is not the same document as no fontStyle, and
    // the picker stores ABSENCE when the toggle is off rather than 'normal'.
    expect(fontOf({ content: 'A', fontStyle: 'normal' })).toBe('normal normal 48px sans-serif')
  })
})

describe('cssFont', () => {
  it('is the whole contract, callable on its own', () => {
    expect(cssFont({ fontWeight: 'normal', fontFamily: 'Georgia' }, 30)).toBe('normal 30px Georgia')
    expect(cssFont({ fontWeight: 800, fontFamily: 'Georgia' }, 30)).toBe('normal 800 30px Georgia')
    expect(cssFont({ fontWeight: 'bold', fontStyle: 'italic', fontFamily: 'Georgia' }, 30)).toBe(
      'italic bold 30px Georgia',
    )
  })
})

describe('paintText — the string reaches the painter', () => {
  it('an italic clip sets the italic font string and still issues one fillText', () => {
    const { ctx, calls } = recordingCtx()
    paintText(ctx, text({ fontStyle: 'italic' }), STAGE)
    // The painter sets ctx.font as a SIDE EFFECT, which is how the export path
    // ends up painting with the same metrics the layout measured.
    expect(ctx.font).toBe('italic normal 48px sans-serif')
    expect(calls.filter((c) => c.startsWith('fillText:'))).toEqual(['fillText:HI'])
  })

  it('a legacy clip still sets the byte-identical string', () => {
    const { ctx } = recordingCtx()
    paintText(ctx, text({ fontWeight: 'bold', fontFamily: 'Impact' }), STAGE)
    expect(ctx.font).toBe('bold 48px Impact')
  })
})

describe('the shrink loop measures with the same string it paints (PV-P4b)', () => {
  /**
   * The Gotcha that made this test necessary: after PV-P3a the font string is
   * built in a SECOND place, inside the `overflow: 'shrink'` search, and a
   * candidate measured with a different string than it is finally painted with
   * is a box that fits on paper and overflows on screen. Nothing else in this
   * file can see that: a mutation putting the old template literal back into
   * `shrinkFontSize` left every other case here green.
   *
   * So this records the strings the measurer is actually handed and requires
   * every one of them to carry the italic style.
   */
  it('hands the shrink search only italic font strings', () => {
    const seen: string[] = []
    const m: MeasureContext = {
      font: '',
      // Every assignment is a measurement the layout then trusted.
      measureText: (t: string) => {
        seen.push(m.font)
        return { width: t.length * 10 } as TextMetrics
      },
    }
    // A narrow box with a line limit forces the binary search to run.
    const layout = computeTextLayout(m, {
      content: 'a considerably longer line of words than will ever fit',
      fontStyle: 'italic',
      fontWeight: 700,
      textBox: { overflow: 'shrink', width: 200, maxLines: 2, minFontSize: 8 },
    } as never, STAGE)

    // The search must actually have run, or every assertion below is vacuous.
    expect(new Set(seen).size).toBeGreaterThan(1)
    for (const font of new Set(seen)) expect(font.startsWith('italic ')).toBe(true)
    // And the size it settled on is the one it measured with.
    expect(layout.font).toBe(`italic 700 ${layout.style.fontSize}px sans-serif`)
  })

  it('a legacy clip shrinks with the byte-identical string', () => {
    const seen: string[] = []
    const m: MeasureContext = {
      font: '',
      measureText: (t: string) => {
        seen.push(m.font)
        return { width: t.length * 10 } as TextMetrics
      },
    }
    computeTextLayout(m, {
      content: 'a considerably longer line of words than will ever fit',
      fontWeight: 'bold',
      textBox: { overflow: 'shrink', width: 200, maxLines: 2, minFontSize: 8 },
    } as never, STAGE)
    expect(new Set(seen).size).toBeGreaterThan(1)
    for (const font of new Set(seen)) expect(font.startsWith('bold ')).toBe(true)
    for (const font of new Set(seen)) expect(font).not.toContain('italic')
  })
})

describe('textPaintSignature', () => {
  it('differs between italic and absent', () => {
    const a = textPaintSignature(text({ fontStyle: 'italic' }), STAGE)
    const b = textPaintSignature(text({}), STAGE)
    expect(a).not.toBe(b)
  })

  it('a legacy clip contributes null, so its signature is unchanged', () => {
    expect(textPaintSignature(text({}), STAGE)).toBe(textPaintSignature(text({ fontStyle: undefined }), STAGE))
  })
})
