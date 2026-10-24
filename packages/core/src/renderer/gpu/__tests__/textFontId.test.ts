/**
 * PV-P4a-2: a text clip that names a bundled font by id paints with that face.
 *
 * The contract these tests pin is narrow and load-bearing: `fontId` REPLACES the
 * family only when the registry knows the id, and a clip without one builds the
 * exact font string it built before PV-P4a. Every legacy expectation below is a
 * regression guard, not a restatement — `bold 72px Impact` in particular is the
 * string a pre-P4a document produces, and if the `fontId` branch ever leaked into
 * the `??` chain it would read `bold 72px "elah-…", sans-serif` instead.
 */
import { describe, it, expect } from 'vitest'
import { computeTextLayout } from '../layers/textLayout'
import { textPaintSignature } from '../layers/textPaint'
import type { ActiveTextClip } from '../../../resolver/scene'
import type { MeasureContext } from '../layers/textMeasure'

const STAGE = { width: 1000, height: 500 }

/** A measurer wide enough to wrap nothing, so `font` is the only thing asserted. */
function measurer(): MeasureContext {
  return { font: '', measureText: (t: string) => ({ width: t.length * 10 }) as TextMetrics }
}

/** The font string a clip lays out with — the one line every case below turns on. */
function fontOf(item: Record<string, unknown>): string {
  return computeTextLayout(measurer(), item as never, STAGE).font
}

describe('computeTextLayout — the bundled font id wins the family', () => {
  it('a known id paints the prefixed family with its generic fallback', () => {
    expect(fontOf({ content: 'A', fontId: 'inter' })).toBe('normal 48px "elah-inter", sans-serif')
  })

  it('an unknown id defers to the clip fontFamily instead of overriding it', () => {
    expect(fontOf({ content: 'A', fontId: 'nope', fontFamily: 'Georgia' })).toBe('normal 48px Georgia')
  })

  it('the id wins over a legacy family, and weight and size still apply', () => {
    expect(
      fontOf({ content: 'A', fontId: 'bebas-neue', fontFamily: 'Impact', fontWeight: 'bold', fontSize: 72 }),
    ).toBe('bold 72px "elah-bebas-neue", sans-serif')
  })

  it('a clip with no fontId builds the exact string it built before PV-P4a', () => {
    expect(fontOf({ content: 'A', fontFamily: 'Impact', fontWeight: 'bold', fontSize: 72 })).toBe('bold 72px Impact')
    expect(fontOf({ content: 'A' })).toBe('normal 48px sans-serif')
  })

  it('a display font gets its own generic, not the sans one', () => {
    // Bebas Neue is `display`, whose generic is sans-serif, while Caveat is
    // `handwriting` — so this pins that the GENERIC is read off the category
    // rather than hardcoded. A hardcoded sans-serif would pass the cases above.
    expect(fontOf({ content: 'A', fontId: 'caveat' })).toBe('normal 48px "elah-caveat", cursive')
    expect(fontOf({ content: 'A', fontId: 'roboto-mono' })).toBe('normal 48px "elah-roboto-mono", monospace')
  })
})

describe('textPaintSignature — the id is part of the painted-pixels key', () => {
  const clip = (extra: Partial<ActiveTextClip>): ActiveTextClip =>
    ({ id: 'c1', type: 'text', content: 'A', ...extra }) as ActiveTextClip

  it('two different ids never share a signature', () => {
    expect(textPaintSignature(clip({ fontId: 'inter' }), STAGE)).not.toBe(
      textPaintSignature(clip({ fontId: 'anton' }), STAGE),
    )
  })

  it('the same input is stable', () => {
    expect(textPaintSignature(clip({ fontId: 'inter' }), STAGE)).toBe(
      textPaintSignature(clip({ fontId: 'inter' }), STAGE),
    )
  })

  it('a clip with no id still contributes null, so a legacy signature is unchanged', () => {
    expect(textPaintSignature(clip({}), STAGE)).toBe(textPaintSignature(clip({ fontId: undefined }), STAGE))
  })

  it('changing the id repaints even when the resolved family is the same', () => {
    // The real reason fontId is in the key: an unknown id and no id resolve to
    // the SAME fallback family, so without this element a clip switched to a bad
    // id would keep the pixels of the good one it was painted with.
    expect(textPaintSignature(clip({ fontId: 'nope', fontFamily: 'Georgia' }), STAGE)).not.toBe(
      textPaintSignature(clip({ fontFamily: 'Georgia' }), STAGE),
    )
  })
})
