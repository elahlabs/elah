/**
 * PV-P4c-1: a text clip's glyph fill reaches the painter.
 *
 * The context here records `fillStyle` ASSIGNMENTS, which `textPaint.test.ts`'s
 * `recordingCtx` does not — and that is the whole point. A gradient is invisible
 * to a recorder that only counts `fillText` calls: the legacy path and the
 * gradient path issue the same `fillText`, and the only difference is which value
 * `fillStyle` held when it happened. A test that watched call counts would pass
 * with the feature completely broken.
 *
 * `recordingCtx` is COPIED from `__tests__/textPaint.test.ts`, not imported: that
 * file is a parity suite on this ticket's Forbidden list, and importing a helper
 * out of a test file is how one test file starts depending on another's internals.
 */
import { describe, expect, it } from 'vitest'
import { estimateWordTimings } from '../../../elements/captions'
import { paintText, textPaintSignature } from '../layers/textPaint'
import type { ActiveTextClip } from '../../../resolver/scene'
import type { Paint, PaintStop } from '../../../types'

const STAGE = { width: 1000, height: 500 }
const S: PaintStop[] = [
  { offset: 0, color: '#000' },
  { offset: 1, color: '#fff' },
]

/** A 2D context stub that records calls AND every fillStyle assignment. */
function recordingCtx() {
  const calls: string[] = []
  const fills: unknown[] = []
  const gradients: unknown[][] = []
  let fillStyle: unknown = ''
  const gradient = { addColorStop: () => {} }
  const ctx = {
    get fillStyle() {
      return fillStyle
    },
    set fillStyle(v: unknown) {
      // The assignment is the event under test, so it is recorded in order with
      // nothing else.
      fillStyle = v
      fills.push(v)
    },
    fillStyle_: null,
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
    rect: () => {},
    clip: () => {},
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    fillText: (t: string) => calls.push(`fillText:${t}`),
    strokeText: (t: string) => calls.push(`strokeText:${t}`),
    createLinearGradient: (...a: number[]) => {
      gradients.push(['linear', ...a])
      return gradient
    },
    createRadialGradient: (...a: number[]) => {
      gradients.push(['radial', ...a])
      return gradient
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, fills, gradients, gradient }
}

function text(over: Partial<ActiveTextClip> = {}): ActiveTextClip {
  return {
    id: 't',
    trackId: 'tr',
    name: 't',
    type: 'text',
    content: 'HELLO',
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
    ...over,
  }
}

describe('a linear glyph fill', () => {
  it('spans the glyph box and becomes the fillStyle the glyphs paint with', () => {
    const { ctx, calls, fills, gradients, gradient } = recordingCtx()
    paintText(ctx, text({ textFill: { type: 'linear', angle: 0, stops: S } }), STAGE)

    // 'HELLO' is 5 chars x 10 = 50 wide on a 1000px stage, centred: box
    // x 475..525, y centred on 250 with one 48px line. half = 50/2 = 25, so the
    // gradient line runs (475,250) -> (525,250).
    expect(gradients[0]!.slice(0, 5)).toEqual(['linear', 475, 250, 525, 250])
    // The value in force for the single fillText IS the gradient object.
    expect(fills).toContain(gradient)
    expect(calls.filter((c) => c === 'fillText:HELLO')).toHaveLength(1)
    expect(fills[fills.length - 1]).toBe(gradient)
  })

  it('padding does not move the gradient, because it spans the GLYPH box', () => {
    // Padding is the margin between glyphs and the background box. A gradient
    // over the padded box starts and ends inside that margin and reads washed
    // out at both ends, so `glyphBox` insets it — the four arguments are
    // therefore IDENTICAL with and without padding.
    const bare = recordingCtx()
    paintText(bare.ctx, text({ textFill: { type: 'linear', angle: 0, stops: S } }), STAGE)
    const padded = recordingCtx()
    paintText(padded.ctx, text({ textFill: { type: 'linear', angle: 0, stops: S }, padding: 10 }), STAGE)
    expect(padded.gradients[0]).toEqual(bare.gradients[0])
  })
})

describe('a solid textFill', () => {
  it('paints the colour and creates no gradient at all', () => {
    const { ctx, fills, gradients } = recordingCtx()
    paintText(ctx, text({ textFill: { type: 'solid', color: '#0f0' } }), STAGE)
    expect(gradients).toEqual([])
    expect(fills).toEqual(['#0f0'])
  })
})

describe('a clip with no textFill is untouched', () => {
  it('issues exactly one fillStyle assignment, the legacy colour, and no gradient', () => {
    // This is the Forbidden clause made measurable: "changing any call a clip
    // without textFill makes". One assignment, the same string, no gradient
    // object created.
    const { ctx, calls, fills, gradients } = recordingCtx()
    paintText(ctx, text(), STAGE)
    expect(fills).toEqual(['#ffffff'])
    expect(gradients).toEqual([])
    expect(calls.filter((c) => c.startsWith('fillText:'))).toEqual(['fillText:HELLO'])
  })

  it('a malformed textFill falls back to the colour instead of throwing', () => {
    // A document is data. An AI-authored or hand-edited `textFill` must not take
    // the whole frame down — in the export worker that is a failed video.
    for (const bad of [null, '#fff', { type: 'conic' }, { type: 'linear' }, { type: 'radial', cx: 0.5 }]) {
      const { ctx, fills, gradients } = recordingCtx()
      expect(() => paintText(ctx, text({ textFill: bad as Paint | undefined }), STAGE)).not.toThrow()
      expect(fills).toEqual(['#ffffff'])
      expect(gradients).toEqual([])
    }
  })
})

describe('the fill reaches every glyph path', () => {
  it('an outline is stroked in its own colour and the gradient fills the glyphs', () => {
    const { ctx, calls, fills, gradients, gradient } = recordingCtx()
    paintText(ctx, text({ textOutline: { color: '#000', width: 3 }, textFill: { type: 'linear', angle: 0, stops: S } }), STAGE)
    expect(gradients).toHaveLength(1)
    // strokeText first, then fillText — the outline is under the fill.
    expect(calls.indexOf('strokeText:HELLO')).toBeLessThan(calls.lastIndexOf('fillText:HELLO'))
    expect(fills[fills.length - 1]).toBe(gradient)
  })

  it('a tracked line still gets the gradient, not the solid colour', () => {
    // `paintTrackedLines` reads the fill too. It is the path PV-P3a added and the
    // one a first pass through this wiring would forget, because it is reached
    // only by a clip with BOTH letterSpacing and a box.
    //
    // The clip needs an OUTLINE as well: with none, `plain` is true and the
    // tracked line goes straight to `ctx.fillText`, which picks up the fillStyle
    // `paintText` already set. Only the outlined variant reaches `drawGlyphs`,
    // which is the call the threading actually changes. The first version of this
    // test had no outline and passed with the gradient removed.
    const box = { letterSpacing: 4, width: 900, overflow: 'wrap' } as const
    const bare = recordingCtx()
    paintText(bare.ctx, text({ textFill: { type: 'linear', angle: 0, stops: S }, textBox: box }), STAGE)
    expect(bare.gradients).toHaveLength(1)
    expect(bare.fills[bare.fills.length - 1]).toBe(bare.gradient)

    const outlined = recordingCtx()
    paintText(
      outlined.ctx,
      text({ textFill: { type: 'linear', angle: 0, stops: S }, textBox: box, textOutline: { color: '#000', width: 2 } }),
      STAGE,
    )
    expect(outlined.gradients).toHaveLength(1)
    // The tracked+outlined path goes through drawGlyphs, so this is the assertion
    // that the threading reaches it.
    expect(outlined.fills[outlined.fills.length - 1]).toBe(outlined.gradient)
  })
})

describe('karaoke: a caption highlight still wins', () => {
  it('sung words paint the highlight and unsung words the gradient', () => {
    const words = estimateWordTimings('HELLO BIG WORLD', 30)
    const second = words[1]!
    const { ctx, calls, fills, gradient } = recordingCtx()
    paintText(
      ctx,
      text({
        content: 'HELLO BIG WORLD',
        words,
        captionMode: 'karaoke',
        captionHighlight: '#ff0',
        localFrame: second.start,
        textFill: { type: 'linear', angle: 0, stops: S },
      }),
      STAGE,
    )
    // The highlight IS the karaoke's job: a gradient overriding it would make the
    // sung word indistinguishable from the unsung ones. The sequence is what
    // matters, not a count — `paintText` assigns `fillStyle = fill` once up front
    // and then `drawGlyphs` assigns per token, so the gradient legitimately
    // appears both times (the opening assignment and the unsung word).
    const fillTexts = calls.filter((c) => c.startsWith('fillText:'))
    expect(fillTexts).toHaveLength(3)
    // Runs collapsed, so the opening assignment and the first sung word read as
    // one run and the unsung word as the next.
    const runs: unknown[] = []
    for (const f of fills) if (runs[runs.length - 1] !== f) runs.push(f)
    expect(runs).toEqual([gradient, '#ff0', gradient])
  })
})

describe('textPaintSignature', () => {
  it('separates no fill, linear 0 and linear 90', () => {
    const none = textPaintSignature(text(), STAGE)
    const a = textPaintSignature(text({ textFill: { type: 'linear', angle: 0, stops: S } }), STAGE)
    const b = textPaintSignature(text({ textFill: { type: 'linear', angle: 90, stops: S } }), STAGE)
    expect(new Set([none, a, b]).size).toBe(3)
  })

  it('is stable for the same paint, so the layer does not repaint every frame', () => {
    // A gradient is an OBJECT: a key built by stringifying it naively could vary
    // with key order and repaint forever.
    const p: Paint = { type: 'linear', angle: 0, stops: S }
    const q: Paint = { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] }
    expect(textPaintSignature(text({ textFill: p }), STAGE)).toBe(textPaintSignature(text({ textFill: q }), STAGE))
  })

  it('a clip with no fill still contributes null, so its signature is unchanged', () => {
    expect(textPaintSignature(text(), STAGE)).toBe(
      textPaintSignature(text({ textFill: undefined }), STAGE),
    )
  })
})
