/**
 * PV-P4c-2: run-aware layout and run painting.
 *
 * The FIRST describe is the one that matters most and the least code: `wrapRuns`
 * is a deliberate re-implementation of `wrapText`'s algorithm, because a candidate
 * with spans is several fonts and `wrapText` measures a candidate as one string.
 * Two algorithms that must agree line-for-line are a standing invitation to drift,
 * so equivalence is asserted over the cases the Gotchas name — a dropped leading
 * space, kept double spaces, an explicit newline, and a single very long word —
 * with and without spans.
 */
import { describe, expect, it } from 'vitest'
import { computeTextLayout, type LinePiece } from '../layers/textLayout'
import { paintText, textPaintSignature } from '../layers/textPaint'
import type { ActiveTextClip } from '../../../resolver/scene'
import type { MeasureContext } from '../layers/textMeasure'
import type { TextSpan } from '../../../types'

const S = [
  { offset: 0, color: '#000000' },
  { offset: 1, color: '#ffffff' },
]
const STAGE = { width: 1000, height: 500 }

/** A measurer that records every font it is handed, and measures 10 px per char. */
function measurer(seen?: string[]): MeasureContext {
  const m = {
    font: '',
    measureText: (t: string) => {
      if (seen) seen.push(m.font)
      // `as TextMetrics` is the house idiom for a width-only stub.
      return { width: t.length * 10 } as TextMetrics
    },
  }
  return m
}

function text(over: Partial<ActiveTextClip> = {}): ActiveTextClip {
  return {
    id: 't',
    trackId: 'tr',
    name: 't',
    type: 'text',
    content: 'HELLO BIG WORLD',
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
    ...over,
  }
}

/** A context that records the font, the fillStyle and the x of every fillText. */
function paintCtx() {
  const calls: string[] = []
  const fonts: string[] = []
  const fills: unknown[] = []
  let font = ''
  let fillStyle: unknown = ''
  // `textAlign` is a real piece of state here, not a literal: `paintPieces` sets it
  // to 'left' and computes each line's own left in JS, because a context that
  // aligned each PIECE would pull a line of mixed weights apart.
  let textAlign = 'left'
  const gradient = { addColorStop: () => {} }
  const ctx = {
    get font() {
      return font
    },
    set font(v: string) {
      font = v
    },
    get fillStyle() {
      return fillStyle
    },
    set fillStyle(v: unknown) {
      fillStyle = v
      fills.push(v)
    },
    fillStyleValue: null,
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    get textAlign() {
      return textAlign
    },
    set textAlign(v: string) {
      textAlign = v
    },
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
    rect: () => {},
    clip: () => {},
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    fillText: (t: string, x: number) => {
      calls.push(`fillText:${t}@${x}`)
      fonts.push(font)
    },
    strokeText: (t: string) => calls.push(`strokeText:${t}`),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, fonts, fills, gradient }
}

describe('wrapRuns must agree with wrapText, line for line', () => {
  const cases: Array<{ content: string; stage: { width: number; height: number } }> = [
    { content: 'HELLO BIG WORLD', stage: { width: 100, height: 500 } },
    { content: ' lead space', stage: { width: 100, height: 500 } },
    { content: 'a  b', stage: { width: 100, height: 500 } },
    { content: 'x\ny z', stage: { width: 100, height: 500 } },
    { content: 'supercalifragilistic word', stage: { width: 200, height: 500 } },
  ]

  for (const { content, stage } of cases) {
    it(`"${content.replace('\n', '\\n')}" at ${stage.width}px wraps identically with and without spans`, () => {
      const plain = computeTextLayout(measurer(), { content } as never, stage)
      // A span on the FIRST character only: enough to take the run path, and it
      // leaves every other run unstyled so the fonts match the plain case.
      const runs = computeTextLayout(measurer(), { content, spans: [{ start: 0, end: 1, color: '#f00' }] } as never, stage)
      expect(runs.lines).toEqual(plain.lines)
      expect(runs.box.width).toBeCloseTo(plain.box.width, 6)
      expect(runs.box.height).toBeCloseTo(plain.box.height, 6)
    })
  }
})

describe('the run layout', () => {
  const spans: TextSpan[] = [{ start: 6, end: 9, fontWeight: 700, color: '#f00' }]

  it('measures each run in its own font and splits the line into pieces', () => {
    const seen: string[] = []
    const layout = computeTextLayout(measurer(seen), { content: 'HELLO BIG WORLD', spans } as never, STAGE)
    expect(layout.pieces).toEqual([
      [
        { text: 'HELLO ', font: 'normal 48px sans-serif', width: 60 },
        { text: 'BIG', font: 'normal 700 48px sans-serif', width: 30, color: '#f00' },
        { text: ' WORLD', font: 'normal 48px sans-serif', width: 60 },
      ],
    ])
    // 60 + 30 + 60
    expect(layout.box.width).toBe(150)
    // The base font is left on the context: the painter and the measurer both
    // assume it, and a run's font left behind would silently mismeasure the next
    // clip. The Gotcha calls this out and this asserts it.
    expect(seen[seen.length - 1]).toBe('normal 48px sans-serif')
  })

  it('a clip with no spans has NO pieces key at all', () => {
    // The absence is the signal `paintText` branches on, so it must be a missing
    // key rather than an empty array.
    expect('pieces' in computeTextLayout(measurer(), { content: 'HELLO' } as never, STAGE)).toBe(false)
    expect('pieces' in computeTextLayout(measurer(), { content: 'HELLO', spans: [] } as never, STAGE)).toBe(false)
  })

  it('a span on an empty style range still produces pieces, unstyled', () => {
    // A span that sets nothing normalises away, but a clip that HAS a spans array
    // takes the run path, so its pieces exist and its lines are per-run. The two
    // must agree, or the box would jump when a span is cleared.
    const a = computeTextLayout(measurer(), { content: 'HELLO BIG' } as never, STAGE)
    const b = computeTextLayout(measurer(), { content: 'HELLO BIG', spans: [{ start: 0, end: 5 }] } as never, STAGE)
    expect(b.lines).toEqual(a.lines)
    expect(b.box.width).toBeCloseTo(a.box.width, 6)
  })

  it('leaves the BASE font on the context, even when the last piece is styled', () => {
    // The context is left with the base font as a property, set AFTER the last
    // measurement — the painter and the next clip's layout both assume it. A span
    // in the middle cannot show that — the trailing piece would be unstyled, so
    // the base font is what the last measurement would use anyway. The span has to
    // be at the END, and the check has to read the measurer's `.font` PROPERTY
    // directly rather than `seen` (which only records the font at each
    // `measureText` call and so cannot observe an assignment with no call after
    // it — checked by mutation: deleting the reset in `computeTextLayout` did not
    // change what `seen`'s last entry recorded, so this test was rewritten to look
    // at the property `measureText` never re-reads).
    const m = measurer()
    computeTextLayout(m, { content: 'HELLO BIG WORLD', spans: [{ start: 11, end: 16, fontWeight: 700 }] } as never, STAGE)
    expect(m.font).toBe('normal 48px sans-serif')
  })

  it('a run that only overrides style keeps the clip fontFamily and size', () => {
    const layout = computeTextLayout(
      measurer(),
      { content: 'HELLO', fontId: 'inter', fontSize: 24, spans: [{ start: 0, end: 5, fontStyle: 'italic' }] } as never,
      STAGE,
    )
    const piece = layout.pieces![0]![0]! as LinePiece
    expect(piece.font).toBe('italic normal 24px "elah-inter", sans-serif')
  })
})

describe('paintPieces', () => {
  const STAGE = { width: 1000, height: 500 }
  const spans: TextSpan[] = [{ start: 6, end: 9, fontWeight: 700, color: '#f00' }]

  it('draws each piece at its own x, in its own font, with the run colour', () => {
    const { ctx, calls, fonts, fills } = paintCtx()
    paintText(ctx, text({ spans }), STAGE)
    // box.x = 500 - 150/2 = 425, and the pieces advance by their own widths.
    expect(calls.filter((c) => c.startsWith('fillText:'))).toEqual([
      'fillText:HELLO @425',
      'fillText:BIG@485',
      'fillText: WORLD@515',
    ])
    expect(fonts.slice(-3)).toEqual([
      'normal 48px sans-serif',
      'normal 700 48px sans-serif',
      'normal 48px sans-serif',
    ])
    // The run colour applies to BIG only; the others take the clip's colour.
    const bigAt = fills.lastIndexOf('#f00')
    expect(bigAt).toBeGreaterThan(-1)
    expect(fills.filter((f) => f === '#f00')).toHaveLength(1)
  })

  it('left, centre and right alignment all place the pieces identically for one line', () => {
    // A one-line block is the width of its own content, so the three anchors
    // coincide — which is exactly what makes this a useful check that the
    // per-piece advance is not being re-anchored per piece.
    const xs = (textAlign: 'left' | 'center' | 'right') => {
      const { ctx, calls } = paintCtx()
      paintText(ctx, text({ spans, textAlign }), STAGE)
      return calls.filter((c) => c.startsWith('fillText:'))
    }
    expect(xs('left')).toEqual(xs('center'))
    expect(xs('center')).toEqual(xs('right'))
  })

  it('a two-line block anchors each line independently', () => {
    const stage = { width: 200, height: 500 }
    const twoLine: TextSpan[] = [{ start: 0, end: 5, color: '#f00' }]
    const run = (textAlign: 'left' | 'right') => {
      const { ctx, calls } = paintCtx()
      paintText(ctx, text({ content: 'HELLO BIG WORLD FOO', spans: twoLine, textAlign }), stage)
      return calls.filter((c) => c.startsWith('fillText:'))
    }
    // max width 180, so 'HELLO BIG WORLD' (150) then 'FOO' (30). The block is as
    // wide as its widest line, 150, centred on 100: box.x = 25.
    //
    // TWO pieces on the first line, not three: the span ends at 5, which is exactly
    // the end of 'HELLO', so there is no run boundary inside the rest of the line.
    expect(run('left')).toEqual(['fillText:HELLO@25', 'fillText: BIG WORLD@75', 'fillText:FOO@25'])
    // Right-aligned: the second line's own right edge is box.x + 150, so its
    // single piece starts at 175 - 30 = 145.
    expect(run('right')).toEqual(['fillText:HELLO@25', 'fillText: BIG WORLD@75', 'fillText:FOO@145'])
  })

  it('an uncoloured piece takes the clip gradient, a coloured one keeps its colour', () => {
    const { ctx, fills, gradient } = paintCtx()
    paintText(ctx, text({ spans, textFill: { type: 'linear', angle: 0, stops: S } }), STAGE)
    expect(fills.filter((f) => f === gradient).length).toBeGreaterThan(0)
    expect(fills.filter((f) => f === '#f00')).toHaveLength(1)
  })

  it('an outline is stroked under each piece', () => {
    const { ctx, calls } = paintCtx()
    paintText(ctx, text({ spans, textOutline: { color: '#000', width: 3 } }), STAGE)
    // `drawGlyphs` emits the stroke and then the fill back to back, so the pairing
    // is positional. Comparing with `lastIndexOf('fillText:')` would be wrong —
    // that searches for that LITERAL, not the prefix, and returns -1.
    const strokes = calls.filter((c) => c.startsWith('strokeText:'))
    expect(strokes).toHaveLength(3)
    for (let i = 0; i < calls.length; i++) {
      if (!calls[i]!.startsWith('strokeText:')) continue
      expect(calls[i + 1]).toMatch(/^fillText:/)
    }
  })

  it('restores the base font afterwards, even when the LAST piece is styled', () => {
    // The Gotcha: `ctx.font` is left at the last piece's font otherwise. The first
    // version of this test used a span in the middle, where the last piece happened
    // to be unstyled — so the restore was a no-op and removing it passed. A span at
    // the END is what makes the claim observable.
    const { ctx } = paintCtx()
    paintText(ctx, text({ spans: [{ start: 11, end: 16, fontWeight: 700 }] }), STAGE)
    expect(ctx.font).toBe('normal 48px sans-serif')
  })

  it('a clip with no spans makes exactly the calls it made before', () => {
    const { ctx, calls, fills } = paintCtx()
    paintText(ctx, text(), STAGE)
    expect(calls.filter((c) => c.startsWith('fillText:'))).toEqual(['fillText:HELLO BIG WORLD@500'])
    expect(fills).toEqual(['#ffffff'])
  })
})

describe('spans are ignored while an animator runs, and that is deliberate', () => {
  it('an animated clip with spans paints exactly what the same clip without spans paints', () => {
    const animator = { unit: 'word' as const, preset: 'typewriter' as const, staggerFrames: 5, durationFrames: 1 }
    const run = (spans?: TextSpan[]) => {
      const { ctx, calls } = paintCtx()
      paintText(ctx, text({ spans, textAnimator: animator, localFrame: 5 }), STAGE)
      return calls.filter((c) => c.startsWith('fillText:'))
    }
    // `paintUnits` positions units itself and is on the Forbidden list, so spans
    // do not reach it. Recording the equality here is what makes the limitation a
    // decision rather than an accident.
    expect(run([{ start: 0, end: 5, fontWeight: 900 }])).toEqual(run(undefined))
  })
})

describe('textPaintSignature', () => {
  it('separates a clip with spans from one without', () => {
    const STAGE = { width: 1000, height: 500 }
    const a = textPaintSignature(text(), STAGE)
    const b = textPaintSignature(text({ spans: [{ start: 0, end: 5, color: '#f00' }] }), STAGE)
    const c = textPaintSignature(text({ spans: [{ start: 0, end: 6, color: '#f00' }] }), STAGE)
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('an empty spans array is normalised away by the resolver, so the difference is unreachable', () => {
    // The spec is `item.spans ?? null`, so `[]` and absent serialise differently.
    // That is harmless and unreachable: `resolveTimeline` gates the spread on
    // `.length`, so a scene object never carries an empty array — a clip whose
    // spans were all cleared resolves with no key at all. Pinned so the reason is
    // written down rather than rediscovered.
    const a = textPaintSignature(text({ spans: [] }), STAGE)
    const b = textPaintSignature(text(), STAGE)
    expect(a).not.toBe(b)
    expect(JSON.parse(a).at(-1)).toEqual([])
    expect(JSON.parse(b).at(-1)).toBeNull()
  })
})
