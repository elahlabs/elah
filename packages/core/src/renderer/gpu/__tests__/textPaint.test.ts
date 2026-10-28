/**
 * EDX-P8: the shared text painter, animators and caption modes, and the
 * word-timing estimate.
 */

import { describe, expect, it } from 'vitest'
import type { ActiveTextClip } from '../../../resolver/scene'
import { animatorLengthFrames, estimateWordTimings } from '../../../elements/captions'
import { animatorOffsets, animatorUnitState, captionWordState, paintText, textPaintSignature } from '../layers/textPaint'

/** A 2D context stub that records the calls the painter makes. */
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

const stage = { width: 1000, height: 500 }
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

describe('paintText', () => {
  it('plain text is one fillText per line, as before', () => {
    const { ctx, calls } = recordingCtx()
    paintText(ctx, text(), stage)
    expect(calls.filter((c) => c.startsWith('fillText'))).toEqual(['fillText:HELLO BIG WORLD'])
    expect(calls.some((c) => c.startsWith('strokeText'))).toBe(false)
  })

  it('an outline strokes under the fill', () => {
    const { ctx, calls } = recordingCtx()
    paintText(ctx, text({ textOutline: { color: '#000', width: 3 } }), stage)
    const glyphs = calls.filter((c) => c.includes('Text:'))
    expect(glyphs).toEqual(['strokeText:HELLO BIG WORLD', 'fillText:HELLO BIG WORLD'])
  })

  it('a word animator draws only the words that have started', () => {
    const { ctx, calls } = recordingCtx()
    paintText(
      ctx,
      text({ textAnimator: { unit: 'word', preset: 'typewriter', staggerFrames: 5, durationFrames: 1 }, localFrame: 5 }),
      stage,
    )
    expect(calls.filter((c) => c.startsWith('fillText'))).toEqual(['fillText:HELLO', 'fillText:BIG'])
  })

  it('reveal captions show the words already spoken', () => {
    const { ctx, calls } = recordingCtx()
    const words = estimateWordTimings('HELLO BIG WORLD', 30)
    paintText(ctx, text({ words, captionMode: 'reveal', localFrame: words[1]!.start }), stage)
    expect(calls.filter((c) => c.startsWith('fillText'))).toEqual(['fillText:HELLO', 'fillText:BIG'])
  })

  it('the signature changes with the frame only while the text animates', () => {
    const still = textPaintSignature(text(), stage)
    expect(textPaintSignature(text(), stage)).toBe(still)
    const a = textPaintSignature(text({ captionMode: 'karaoke', words: [], localFrame: 1 }), stage)
    const b = textPaintSignature(text({ captionMode: 'karaoke', words: [], localFrame: 2 }), stage)
    expect(a).not.toBe(b)
  })
})

describe('unit states', () => {
  const animator = { unit: 'char' as const, preset: 'rise' as const, staggerFrames: 2, durationFrames: 10 }

  it('rise starts low and transparent, then lands', () => {
    expect(animatorUnitState(animator, 3, 6, 40)).toMatchObject({ alpha: 0, dy: 24 })
    expect(animatorUnitState(animator, 3, 16, 40)).toMatchObject({ alpha: 1, dy: 0 })
  })

  it('typewriter is instant per unit', () => {
    const tw = { ...animator, preset: 'typewriter' as const }
    expect(animatorUnitState(tw, 2, 3, 40).alpha).toBe(0)
    expect(animatorUnitState(tw, 2, 4, 40).alpha).toBe(1)
  })

  it('karaoke keeps spoken words highlighted; highlight marks only the current word', () => {
    const word = { text: 'x', start: 10, end: 20 }
    expect(captionWordState('karaoke', word, 5, '#ff0').color).toBeUndefined()
    expect(captionWordState('karaoke', word, 25, '#ff0').color).toBe('#ff0')
    expect(captionWordState('highlight', word, 15, '#ff0').color).toBe('#ff0')
    expect(captionWordState('highlight', word, 25, '#ff0').color).toBeUndefined()
    expect(captionWordState('reveal', word, 5, '#ff0').alpha).toBe(0)
  })
})

describe('estimateWordTimings', () => {
  it('covers the clip contiguously, longer words longer', () => {
    const w = estimateWordTimings('a extraordinary b', 60)
    expect(w.map((x) => x.text)).toEqual(['a', 'extraordinary', 'b'])
    expect(w[0]!.start).toBe(0)
    expect(w[2]!.end).toBe(60)
    for (let i = 1; i < w.length; i++) expect(w[i]!.start).toBe(w[i - 1]!.end)
    expect(w[1]!.end - w[1]!.start).toBeGreaterThan(w[0]!.end - w[0]!.start)
  })

  it('never produces a negative duration, even with more words than frames', () => {
    const w = estimateWordTimings('one two three four five', 3)
    expect(w).toHaveLength(5)
    for (const x of w) expect(x.end).toBeGreaterThanOrEqual(x.start)
    expect(w.at(-1)!.end).toBe(3)
  })

  it('animator length counts units without spaces', () => {
    expect(animatorLengthFrames('ab c', { unit: 'char', preset: 'fade', staggerFrames: 2, durationFrames: 5 })).toBe(9)
    expect(animatorLengthFrames('ab c', { unit: 'word', preset: 'fade', staggerFrames: 2, durationFrames: 5 })).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// MOT-3: text animator v2 (per-unit tween, unit order)
// ---------------------------------------------------------------------------

describe('MOT-3 legacy presets are untouched', () => {
  const base = { unit: 'char' as const, staggerFrames: 2, durationFrames: 10 }
  const frames = [0, 3, 7, 12, 20, 40]
  const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
  const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2

  it.each(['typewriter', 'fade', 'rise', 'pop'] as const)('%s samples exactly the pre-MOT-3 formula, with no tween channels', (preset) => {
    for (const f of frames) {
      for (const i of [0, 1, 4]) {
        const t = Math.min(1, Math.max(0, (f - i * 2) / 10))
        const want =
          preset === 'typewriter'
            ? { alpha: f >= i * 2 ? 1 : 0, dy: 0, scale: 1 }
            : preset === 'fade'
              ? { alpha: easeOutCubic(t), dy: 0, scale: 1 }
              : preset === 'rise'
                ? { alpha: easeOutCubic(t), dy: (1 - easeOutCubic(t)) * 0.6 * 40, scale: 1 }
                : { alpha: Math.min(1, Math.max(0, t * 3)), dy: 0, scale: 0.5 + 0.5 * easeOutBack(t) }
        expect(animatorUnitState({ ...base, preset }, i, f, 40)).toStrictEqual(want)
      }
    }
  })

  it('the four presets issue no rotate and never touch ctx.filter', () => {
    for (const preset of ['typewriter', 'fade', 'rise', 'pop'] as const) {
      const { ctx, calls } = recordingCtx()
      paintText(ctx, text({ textAnimator: { unit: 'word', preset, staggerFrames: 4, durationFrames: 10 }, localFrame: 7 }), stage)
      expect(calls).not.toContain('rotate')
      expect((ctx as unknown as { filter?: string }).filter).toBeUndefined()
    }
  })

  it('animatorLengthFrames is the legacy sum unless from / staggerEase is set', () => {
    const a = { unit: 'char' as const, preset: 'fade' as const, staggerFrames: 2, durationFrames: 5 }
    expect(animatorLengthFrames('ab c', a)).toBe(9)
    // three chars from the middle: offsets 2, 0, 2 -> last start 2, plus 5
    expect(animatorLengthFrames('ab c', { ...a, from: 'center' })).toBe(7)
  })
})

describe('MOT-3 tween sampling', () => {
  const a = {
    unit: 'word' as const,
    preset: 'fade' as const,
    staggerFrames: 4,
    durationFrames: 10,
    tween: { opacity: [0, 1], dy: [0.5, 0], dx: [-1, 0], scale: [2, 1], rotation: [1, 0], blur: [8, 0] } as Record<string, [number, number]>,
  }

  it('runs from the from values to the to values over durationFrames, linear by default', () => {
    expect(animatorUnitState(a, 0, 0, 40)).toMatchObject({ alpha: 0, dy: 20, dx: -40, scale: 2, rotation: 1, blur: 8 })
    expect(animatorUnitState(a, 0, 5, 40)).toMatchObject({ alpha: 0.5, dy: 10, dx: -20, scale: 1.5, rotation: 0.5, blur: 4 })
    const end = animatorUnitState(a, 0, 10, 40)
    expect(end).toMatchObject({ alpha: 1, dy: 0, scale: 1, rotation: 0, blur: 0 })
    expect(Math.abs(end.dx ?? 0)).toBe(0)
  })

  it('uses `ease`, and a channel left out stays at rest', () => {
    const e = animatorUnitState({ ...a, ease: 'quad-in', tween: { opacity: [0, 1] } }, 0, 5, 40)
    expect(e.alpha).toBeCloseTo(0.25)
    expect(e).toMatchObject({ dy: 0, scale: 1, rotation: 0 })
  })

  it('orders units by `from` and `staggerEase` through staggerOffsets', () => {
    const words = ['A B C D E']
    expect(animatorOffsets({ ...a, from: 'center' }, words)).toEqual([8, 4, 0, 4, 8])
    expect(animatorOffsets({ ...a, from: 'end' }, words)).toEqual([16, 12, 8, 4, 0])
    expect(animatorOffsets(a, words)).toBeUndefined()
    const off = animatorOffsets({ ...a, from: 'end' }, words)
    expect(animatorUnitState(a, 0, 8, 40, off).alpha).toBe(0)
    expect(animatorUnitState(a, 4, 10, 40, off).alpha).toBe(1)
  })

  it('counts units like the painter (spaces are not units)', () => {
    expect(animatorOffsets({ ...a, unit: 'line', from: 'end' }, ['one', 'two three'])).toEqual([4, 0])
    expect(animatorOffsets({ ...a, unit: 'char', from: 'end' }, ['a b'])).toEqual([4, 0])
  })
})

describe('MOT-3 painter parity (preview and export share paintText)', () => {
  function logged(animator: NonNullable<ActiveTextClip['textAnimator']>, localFrame: number) {
    const calls: string[] = []
    const { ctx } = recordingCtx()
    const c = ctx as unknown as Record<string, unknown>
    c.translate = (x: number, y: number) => calls.push(`translate:${x.toFixed(2)},${y.toFixed(2)}`)
    c.rotate = (r: number) => calls.push(`rotate:${r.toFixed(4)}`)
    c.scale = (x: number, y: number) => calls.push(`scale:${x.toFixed(3)},${y.toFixed(3)}`)
    c.save = () => calls.push('save')
    c.restore = () => calls.push('restore')
    c.fillText = (t: string, x: number, y: number) => calls.push(`fillText:${t}@${x.toFixed(2)},${y.toFixed(2)} a=${(c.globalAlpha as number).toFixed(3)}`)
    const filters: string[] = []
    Object.defineProperty(c, 'filter', { set: (v: string) => filters.push(v), get: () => '' })
    paintText(ctx, text({ content: 'ALPHA BETA\nGAMMA DELTA EPS', textAnimator: animator, localFrame }), stage)
    return { calls, filters }
  }
  const mk = (tween: Record<string, [number, number]>, extra: object = {}) => ({
    unit: 'word' as const, preset: 'fade' as const, staggerFrames: 3, durationFrames: 10, tween, ...extra,
  })

  it.each([
    ['opacity', { opacity: [0, 1] as [number, number] }],
    ['dy', { dy: [0.6, 0] as [number, number] }],
    ['dx', { dx: [-0.5, 0] as [number, number] }],
    ['scale', { scale: [0.5, 1] as [number, number] }],
    ['rotation', { rotation: [0.6, 0] as [number, number] }],
    ['blur', { blur: [6, 0] as [number, number] }],
  ])('%s paints identically on two runs and differs from rest', (_name, tw) => {
    const extra = { from: 'center', ease: 'back-out' }
    const one = logged(mk(tw, extra), 6)
    const two = logged(mk(tw, extra), 6)
    expect(two).toEqual(one)
    expect(one).not.toEqual(logged(mk(tw, extra), 60))
  })

  it('rotation turns each unit about its own centre: translate, rotate, translate back', () => {
    const { calls } = logged(mk({ rotation: [1, 1] }), 0)
    const i = calls.indexOf('rotate:1.0000')
    const into = /^translate:(-?[\d.]+),(-?[\d.]+)$/.exec(calls[i - 1] ?? '')
    const back = /^translate:(-?[\d.]+),(-?[\d.]+)$/.exec(calls[i + 1] ?? '')
    expect(into).not.toBeNull()
    expect(back).not.toBeNull()
    expect([Number(back![1]), Number(back![2])]).toEqual([-Number(into![1]), -Number(into![2])])
    // five units over two lines: more than one distinct pivot
    const pivots = new Set(calls.filter((_c, k) => calls[k + 1]?.startsWith('rotate')))
    expect(pivots.size).toBe(5)
  })

  it('blur sets ctx.filter once per unit', () => {
    const { filters } = logged(mk({ blur: [6, 6] }), 0)
    expect(filters).toEqual(Array(5).fill('blur(6px)'))
  })

  it('the signature changes when the tween changes', () => {
    const a = textPaintSignature(text({ textAnimator: mk({ opacity: [0, 1] }), localFrame: 3 }), stage)
    const b = textPaintSignature(text({ textAnimator: mk({ opacity: [0, 0.5] }), localFrame: 3 }), stage)
    expect(a).not.toBe(b)
  })
})

describe('MOT-5 scramble text', () => {
  const scr = (progress: number, localFrame: number, extra: Partial<ActiveTextClip> = {}) =>
    text({
      content: 'HELLO WORLD',
      localFrame,
      scramble: { progress, charset: 'abcdefghij', seed: 5, changeEvery: 2, preserve: 'spaces' },
      ...extra,
    })
  /** Glyph draws as `char@x`, the way the painter placed them. */
  function drawn(item: ActiveTextClip, widthOf: (t: string) => number = (t) => t.length * 10) {
    const rec = recordingCtx()
    const out: string[] = []
    ;(rec.ctx as unknown as { measureText: (t: string) => { width: number } }).measureText = (t: string) => ({ width: widthOf(t) })
    ;(rec.ctx as unknown as { fillText: (t: string, x: number) => void }).fillText = (t: string, x: number) => out.push(`${t}@${x}`)
    const layout = paintText(rec.ctx, item, stage)
    return { out, layout }
  }

  it('progress 1 paints exactly as plain text (one fillText per line)', () => {
    const { out } = drawn(scr(1, 4))
    expect(out.map((s) => s.split('@')[0])).toEqual(['HELLO WORLD'])
  })

  it('progress 0 paints only noise glyphs from the charset, one per real glyph', () => {
    const { out } = drawn(scr(0, 0))
    expect(out).toHaveLength(10)
    for (const d of out) expect('abcdefghij').toContain(d.split('@')[0])
  })

  it('the laid-out box is the real text box at every progress', () => {
    const base = drawn(text({ content: 'HELLO WORLD' })).layout.box
    for (const p of [0, 0.2, 0.5, 0.9, 1]) expect(drawn(scr(p, 3)).layout.box).toEqual(base)
  })

  it('a noise glyph is centred in the real glyph slot and resolved glyphs stay put', () => {
    const w = (t: string) => (t === 'H' ? 20 : t === 'a' ? 10 : t.length * 10)
    const real = drawn(text({ content: 'HELLO', scramble: undefined, textAnimator: { unit: 'char', preset: 'fade', staggerFrames: 0, durationFrames: 1 }, localFrame: 99 }), w).out
    const hX = Number(real[0]!.split('@')[1])
    const { out } = drawn(scr(0, 0, { content: 'HELLO', scramble: { progress: 0, charset: 'a', seed: 0, changeEvery: 2, preserve: 'spaces' } }), w)
    // real H is 20 wide, noise "a" is 10: centred means +5
    expect(out[0]).toBe(`a@${hX + 5}`)
    const half = drawn(scr(0.5, 0, { content: 'HELLO', scramble: { progress: 0.4, charset: 'a', seed: 0, changeEvery: 2, preserve: 'spaces' } }), w).out
    expect(half[0]!.startsWith('H@')).toBe(true)
    expect(half[1]!.startsWith('E@')).toBe(true)
    expect(half[2]!.startsWith('a@')).toBe(true)
  })

  it('same frame paints the same glyphs, in any render order (preview, scrub and export agree)', () => {
    const frames = [0, 5, 10]
    const run = () => frames.map((f) => drawn(scr(0.4, f)).out.join('|'))
    const a = run()
    expect(run()).toEqual(a)
    // frame 10 rendered cold, and after frame 0 in reverse order
    expect(drawn(scr(0.4, 10)).out.join('|')).toBe(a[2])
    expect([10, 5, 0].map((f) => drawn(scr(0.4, f)).out.join('|'))).toEqual([a[2], a[1], a[0]])
    console.log('painted frames 0/5/10:', JSON.stringify(a))
  })

  it('does not change the signature of a clip without scramble, and keys the scrambling ones apart', () => {
    const plain = textPaintSignature(text(), stage)
    expect(textPaintSignature(text({ scramble: undefined }), stage)).toBe(plain)
    expect(textPaintSignature(scr(0.2, 1), stage)).not.toBe(textPaintSignature(scr(0.6, 1), stage))
  })
});
