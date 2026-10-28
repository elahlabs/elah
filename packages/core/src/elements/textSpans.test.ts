/**
 * PV-P4c-2: styled runs of a text clip's content.
 *
 * The awkward cases are the point. Overlapping spans, an offset past the end of
 * the text, a collapsed range, and the four different things typing can do at a
 * span's boundary are all silent — a span that quietly stops covering its text
 * looks exactly like a span that was never applied.
 */
import { describe, expect, it } from 'vitest'
import {
  applySpanStyle,
  contentPatch,
  isBoldWeight,
  normalizeSpans,
  remapSpans,
  spanRangeEvery,
  textRuns,
} from './textSpans'
import type { TextSpan } from '../types'

const C = 'Hello big world'

describe('isBoldWeight', () => {
  it('is the keyword, or a number at or above the threshold', () => {
    expect(isBoldWeight('bold')).toBe(true)
    expect(isBoldWeight(600)).toBe(true)
    expect(isBoldWeight(900)).toBe(true)
    expect(isBoldWeight(500)).toBe(false)
    expect(isBoldWeight('normal')).toBe(false)
    expect(isBoldWeight(undefined)).toBe(false)
  })
})

describe('applySpanStyle', () => {
  it('sets a field over a range', () => {
    expect(applySpanStyle(C, [], 6, 9, { fontWeight: 700 })).toEqual([{ start: 6, end: 9, fontWeight: 700 }])
  })

  it('layers a colour over an existing weight, then removes the weight', () => {
    const bold = applySpanStyle(C, [], 6, 9, { fontWeight: 700 })
    // The colour is wider than the weight, so the runs split: this is the case
    // that shows the model is per-field and not per-span.
    expect(applySpanStyle(C, bold, 0, 9, { color: '#f00' })).toEqual([
      { start: 0, end: 6, color: '#f00' },
      { start: 6, end: 9, fontWeight: 700, color: '#f00' },
    ])
    // Removing the weight leaves one run, because the styles now match.
    expect(applySpanStyle(C, applySpanStyle(C, bold, 0, 9, { color: '#f00' }), 6, 9, { fontWeight: null })).toEqual([
      { start: 0, end: 9, color: '#f00' },
    ])
  })

  it('clamps a range past the end of the content', () => {
    expect(applySpanStyle(C, [], 10, 99, { fontStyle: 'italic' })).toEqual([
      { start: 10, end: 15, fontStyle: 'italic' },
    ])
  })

  it('a collapsed range changes nothing', () => {
    expect(applySpanStyle(C, [], 4, 4, { color: '#f00' })).toEqual([])
  })

  it('leaves a field not named in the patch alone', () => {
    const p = applySpanStyle(C, [], 0, 5, { fontWeight: 700, color: '#f00' })
    expect(applySpanStyle(C, p, 0, 5, { fontStyle: 'italic' })).toEqual([
      { start: 0, end: 5, fontWeight: 700, fontStyle: 'italic', color: '#f00' },
    ])
  })

  it('does not mutate the spans it was given', () => {
    const before: TextSpan[] = [{ start: 6, end: 9, fontWeight: 700 }]
    const snapshot = JSON.stringify(before)
    applySpanStyle(C, before, 0, 5, { color: '#f00' })
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('textRuns', () => {
  it('covers the whole content, unstyled head and tail included', () => {
    // A caller measuring a line needs to know where the styled parts are;
    // returning only the styled runs would make every consumer re-derive the gaps.
    expect(textRuns(C, [{ start: 6, end: 9, color: '#f00' }])).toEqual([
      { start: 0, end: 6, style: {} },
      { start: 6, end: 9, style: { color: '#f00' } },
      { start: 9, end: 15, style: {} },
    ])
  })

  it('is empty for empty content', () => {
    expect(textRuns('', [])).toEqual([])
  })

  it('merges adjacent units that end up with the same style', () => {
    // Two adjacent spans with the same value are ONE run: without merging, every
    // line would be split into more pieces than there are styles.
    expect(textRuns('abcd', [{ start: 0, end: 2, color: 'x' }, { start: 2, end: 4, color: 'x' }])).toEqual([
      { start: 0, end: 4, style: { color: 'x' } },
    ])
  })

  it('lets a later span win field by field, not wholesale', () => {
    expect(textRuns(C, [{ start: 0, end: 5, fontWeight: 700, color: 'a' }, { start: 3, end: 8, color: 'b' }])).toEqual([
      { start: 0, end: 3, style: { fontWeight: 700, color: 'a' } },
      { start: 3, end: 5, style: { fontWeight: 700, color: 'b' } },
      { start: 5, end: 8, style: { color: 'b' } },
      { start: 8, end: 15, style: {} },
    ])
  })
})

describe('normalizeSpans', () => {
  it('is the styled runs only, with the later span winning the overlap', () => {
    expect(normalizeSpans(C, [{ start: 0, end: 5, color: 'a' }, { start: 3, end: 8, color: 'b' }])).toEqual([
      { start: 0, end: 3, color: 'a' },
      { start: 3, end: 8, color: 'b' },
    ])
  })

  it('drops a span with no style at all', () => {
    expect(normalizeSpans(C, [{ start: 0, end: 5 }])).toEqual([])
  })

  it('is empty for no spans', () => {
    expect(normalizeSpans(C, undefined)).toEqual([])
    expect(normalizeSpans(C, [])).toEqual([])
  })

  it('clamps a span authored against LONGER text, without indexing past the end', () => {
    // The `unitStyles` clamp, reached through `textRuns` — `applySpanStyle` has its
    // own clamp, so only this path exercises that one. Unclamped, `to` would run
    // past `units.length` and `units[i]!` would be undefined.
    expect(textRuns(C, [{ start: 0, end: 999, color: 'x' }])).toEqual([
      { start: 0, end: 15, style: { color: 'x' } },
    ])
    expect(normalizeSpans(C, [{ start: 999, end: 1000, color: 'x' }])).toEqual([])
    // A negative start clamps to 0 rather than wrapping.
    expect(normalizeSpans(C, [{ start: -5, end: 4, color: 'x' }])).toEqual([{ start: 0, end: 4, color: 'x' }])
  })

  it('tolerates a span with non-finite offsets by DROPPING it', () => {
    // A hand-edited or AI-authored document can hold anything. The spec filters on
    // "finite offsets", so an infinite end is not clamped to the content length —
    // the whole span is skipped. Dropping is the safer of the two: a span with a
    // NaN bound would otherwise cover text the author never asked to style.
    expect(normalizeSpans(C, [{ start: Number.NaN, end: 5, color: 'x' }])).toEqual([])
    expect(normalizeSpans(C, [{ start: 0, end: Number.POSITIVE_INFINITY, color: 'x' }])).toEqual([])
  })
})

describe('spanRangeEvery', () => {
  const bold: TextSpan[] = [{ start: 6, end: 9, fontWeight: 700 }]
  const isBold = (s: { fontWeight?: unknown }) => isBoldWeight(s.fontWeight as never)

  it('is true only when every unit in the range qualifies', () => {
    expect(spanRangeEvery(C, bold, 6, 9, isBold)).toBe(true)
    // One unit short at the front, and the unstyled unit fails the test.
    expect(spanRangeEvery(C, bold, 5, 9, isBold)).toBe(false)
    expect(spanRangeEvery(C, bold, 6, 10, isBold)).toBe(false)
  })

  it('is false for a collapsed range, not vacuously true', () => {
    // The toolbar asks "is the whole selection bold?"; true for a collapsed caret
    // would report the clip's state and then apply a patch to nothing.
    expect(spanRangeEvery(C, bold, 6, 6, isBold)).toBe(false)
    expect(spanRangeEvery(C, bold, 4, 4, isBold)).toBe(false)
  })
})

describe('remapSpans — the four typing boundaries', () => {
  const bold: TextSpan[] = [{ start: 6, end: 9, fontWeight: 700 }]

  it('typing INSIDE the span extends it', () => {
    expect(remapSpans(C, 'Hello bXig world', bold)).toEqual([{ start: 6, end: 10, fontWeight: 700 }])
  })

  it('typing at the span END extends it', () => {
    expect(remapSpans(C, 'Hello bigX world', bold)).toEqual([{ start: 6, end: 10, fontWeight: 700 }])
  })

  it('typing at the span START does not', () => {
    // The new character belongs to what came before, not to the run the caret is
    // about to leave.
    expect(remapSpans(C, 'Hello Xbig world', bold)).toEqual([{ start: 7, end: 10, fontWeight: 700 }])
  })

  it('replacing the whole styled word keeps the style', () => {
    expect(remapSpans(C, 'Hello huge world', bold)).toEqual([{ start: 6, end: 10, fontWeight: 700 }])
  })

  it('deleting the styled word drops the span', () => {
    expect(remapSpans(C, 'Hello  world', bold)).toEqual([])
  })

  it('deleting the FIRST character shifts the span down', () => {
    expect(remapSpans(C, 'ello big world', bold)).toEqual([{ start: 5, end: 8, fontWeight: 700 }])
  })

  it('extends BOTH spans when typing at each end', () => {
    const spans: TextSpan[] = [
      { start: 0, end: 5, fontWeight: 700 },
      { start: 10, end: 15, fontStyle: 'italic' },
    ]
    expect(remapSpans(C, 'Hello, big world', spans)).toEqual([
      { start: 0, end: 6, fontWeight: 700 },
      { start: 11, end: 16, fontStyle: 'italic' },
    ])
  })

  it('is empty for no spans, and does not mutate them', () => {
    expect(remapSpans(C, 'Hello bXig world', undefined)).toEqual([])
    expect(remapSpans(C, 'Hello bXig world', [])).toEqual([])
    const before: TextSpan[] = [{ start: 6, end: 9, fontWeight: 700 }]
    const snapshot = JSON.stringify(before)
    remapSpans(C, 'Hello bXig world', before)
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('contentPatch', () => {
  it('writes content alone for a clip that never had spans', () => {
    // `toStrictEqual`, not `toEqual`: an extra `spans: undefined` would write an
    // empty array into every keystroke of every title and mark the document dirty
    // for no reason.
    expect(contentPatch({ content: C }, 'x')).toStrictEqual({ content: 'x' })
    expect(contentPatch({ content: C, spans: [] }, 'x')).toStrictEqual({ content: 'x' })
  })

  it('remaps the spans alongside the content', () => {
    const clip = { content: C, spans: [{ start: 6, end: 9, fontWeight: 700 }] }
    expect(contentPatch(clip, 'Hello bXig world')).toEqual({
      content: 'Hello bXig world',
      spans: [{ start: 6, end: 10, fontWeight: 700 }],
    })
  })

  it('clears the styling but keeps the key when the styled text is deleted', () => {
    const patch = contentPatch({ content: C, spans: [{ start: 6, end: 9, fontWeight: 700 }] }, 'Hello  world')
    expect('spans' in patch).toBe(true)
    expect(patch.spans).toBeUndefined()
  })

  it('drops a span that described content which did not exist', () => {
    // A span over an EMPTY old content is a degenerate document: `p` is 0 and
    // `oldEnd` is 0, so `mapStart(0)` takes the `o >= oldEnd` arm and shifts the
    // whole range past the end of the new text, where it clamps away. The span is
    // dropped rather than guessed at — the design's `mapStart` ordering produces
    // exactly this, and inventing a mapping for it would be a rule with no spec.
    expect(contentPatch({ content: undefined, spans: [{ start: 0, end: 1, color: 'x' }] }, 'ab')).toEqual({
      content: 'ab',
      spans: undefined,
    })
  })
})

describe('offsets are UTF-16 units, like textarea.selectionStart', () => {
  it('an emoji is two units and a span may split it', () => {
    // The per-unit model tolerates this rather than pretending it cannot happen:
    // the second half of the surrogate pair simply carries the style.
    const content = 'a😀b'
    expect(content.length).toBe(4)
    expect(applySpanStyle(content, [], 1, 3, { color: '#f00' })).toEqual([{ start: 1, end: 3, color: '#f00' }])
  })
})
