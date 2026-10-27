/**
 * MC-1d: the converter half of Tier A. box-shadow (one outer shadow), per-corner
 * border-radius, conic-gradient and text-decoration move from "refused" to
 * "mapped onto the new engine fields"; what is still outside the subset (inset,
 * lists, spread, elliptical radii, overline, repeating gradients) keeps its
 * message and substitute.
 */
import { describe, expect, it } from 'vitest'
import type { Clip, Project } from '../../types'
import { cssGradientToPaint } from './cssGradient'
import { emitScene } from './emit'
import { validateScene } from './validate'
import type { MeasuredBox, MeasuredNode, MeasuredScene, MeasuredStyle } from './types'

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

const check = (style: string) => validateScene({ html: `<div id="a" style="${style}">x</div>`, css: '' }).violations

describe('validate: box-shadow', () => {
  it('accepts one outer shadow, colour first or last, with or without blur', () => {
    for (const v of [
      '0 4px 12px rgba(0,0,0,.4)',
      'rgba(0,0,0,.4) 0 4px 12px',
      '2px 3px #000',
      '0 4px 12px 0 #000',
      '0px 8px 24px 0px rgba(15, 23, 42, 0.25)',
      'none',
    ]) {
      expect(check(`box-shadow:${v}`), v).toEqual([])
    }
  })

  it('still refuses inset, lists, spread and unreadable forms, naming one outer shadow', () => {
    for (const v of [
      'inset 0 0 10px #000',
      '0 0 10px #000, 0 4px 8px #fff',
      '0 0 10px 4px #000',
      '0 4px 12px',
      '0.5em 0.5em 1em #000',
    ]) {
      const out = check(`box-shadow:${v}`)
      expect(out, v).toHaveLength(1)
      expect(out[0]!.property).toBe('box-shadow')
      expect(out[0]!.substitute).toContain('one outer shadow')
    }
  })
})

describe('validate: per-corner border-radius', () => {
  it('accepts up to four px values and the four longhands', () => {
    for (const s of [
      'border-radius:12px 12px 0 0',
      'border-radius:4px 8px',
      'border-radius:1px 2px 3px 4px',
      'border-radius:50%',
      'border-top-left-radius:16px',
      'border-bottom-right-radius:0',
    ]) {
      expect(check(s), s).toEqual([])
    }
  })

  it('refuses elliptical, five-value, percent-mixed and non-px longhands', () => {
    expect(check('border-radius:4px / 8px')[0]!.message).toMatch(/elliptical/)
    expect(check('border-radius:1px 2px 3px 4px 5px')[0]!.message).toMatch(/at most four/)
    expect(check('border-radius:10% 4px')[0]!.message).toMatch(/px/)
    expect(check('border-top-left-radius:50%')[0]!.message).toMatch(/px value/)
  })
})

describe('validate: conic-gradient and text-decoration', () => {
  it('accepts a readable conic gradient and refuses an unreadable or repeating one', () => {
    expect(check('background:conic-gradient(from 45deg at 30% 40%, red, blue)')).toEqual([])
    expect(check('background-image:conic-gradient(red 0deg, blue 180deg, red 360deg)')).toEqual([])
    expect(check('background:conic-gradient(from nope, red, blue)')[0]!.message).toMatch(/unreadable conic/)
    expect(check('background:repeating-conic-gradient(red, blue 20deg)')[0]!.message).toMatch(/repeating/)
  })

  it('accepts underline, line-through and none, refuses the rest', () => {
    for (const v of ['underline', 'line-through', 'none']) {
      expect(check(`text-decoration:${v}`)).toEqual([])
      expect(check(`text-decoration-line:${v}`)).toEqual([])
    }
    expect(check('text-decoration:overline')[0]!.substitute).toBe('underline or line-through')
    expect(check('text-decoration:underline wavy red')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// cssGradient
// ---------------------------------------------------------------------------

describe('cssGradientToPaint: conic', () => {
  it('keeps the CSS from-angle and centre, and reads stops as turn fractions', () => {
    const r = cssGradientToPaint('conic-gradient(from 90deg at 25% 75%, #ff0000, #0000ff)')
    expect(r.ok && r.paint).toEqual({
      type: 'conic',
      angle: 90,
      cx: 0.25,
      cy: 0.75,
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    })
  })

  it('defaults to from 0 at the centre, and accepts deg / turn / percent stop positions', () => {
    const r = cssGradientToPaint('conic-gradient(red 0deg, blue 0.5turn, green 75%, red 360deg)')
    if (!r.ok || r.paint.type !== 'conic') throw new Error('expected conic')
    expect([r.paint.angle, r.paint.cx, r.paint.cy]).toEqual([0, 0.5, 0.5])
    expect(r.paint.stops.map((s) => s.offset)).toEqual([0, 0.5, 0.75, 1])
  })

  it('spreads unpositioned stops evenly like the other gradients', () => {
    const r = cssGradientToPaint('conic-gradient(red, lime, blue)')
    if (!r.ok || r.paint.type !== 'conic') throw new Error('expected conic')
    expect(r.paint.stops.map((s) => s.offset)).toEqual([0, 0.5, 1])
  })

  it('returns a reason for px stops, a bad angle or a bad position', () => {
    for (const bad of [
      'conic-gradient(red 10px, blue)',
      'conic-gradient(from sideways, red, blue)',
      'conic-gradient(from 10deg at somewhere, red, blue)',
      'conic-gradient(from 10deg at 1% 2% 3%, red, blue)',
    ]) {
      expect(cssGradientToPaint(bad).ok, bad).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------

const box = (x: number, y: number, width: number, height: number): MeasuredBox => ({ x, y, width, height })

function node(tag: string, b: MeasuredBox, style: MeasuredStyle, extra: Partial<MeasuredNode> = {}): MeasuredNode {
  return { tag, box: b, style, children: [], ...extra }
}

function scene(...children: MeasuredNode[]): MeasuredScene {
  return {
    name: 's',
    at: 0,
    duration: 2,
    stage: { width: 1000, height: 1000 },
    root: node('section', box(0, 0, 1000, 1000), {}, { children }),
  }
}

function layers(clip: Clip): Clip[] {
  const project = clip.compound?.project as Project
  return [...project.tracks].sort((a, b) => a.order - b.order).flatMap((t) => project.clips[t.id] ?? [])
}

const emit = (s: MeasuredScene) => emitScene(s, { fps: 30 })
const SHADOW_CSS = 'rgba(0, 0, 0, 0.5) 0px 8px 24px 0px'

describe('emit: rect shape', () => {
  const card = (style: MeasuredStyle) => node('div', box(100, 100, 200, 100), { backgroundColor: '#ffffff', ...style }, { id: 'card' })

  it('per-corner radii become cornerRadii as fractions of the short side', () => {
    const { clip } = emit(scene(card({ borderRadii: [10, 20, 30, 40], borderRadius: 40 })))
    const [rect] = layers(clip)
    expect(rect!.type).toBe('shape')
    expect(rect!.cornerRadii).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(rect!.cornerRadius).toBeUndefined()
  })

  it('four equal radii stay a plain cornerRadius', () => {
    const { clip } = emit(scene(card({ borderRadii: [20, 20, 20, 20], borderRadius: 20 })))
    const [rect] = layers(clip)
    expect(rect!.cornerRadius).toBe(0.2)
    expect(rect!.cornerRadii).toBeUndefined()
  })

  it('a radius larger than half the short side is capped at 0.5 per corner', () => {
    const { clip } = emit(scene(card({ borderRadii: [500, 0, 0, 0] })))
    expect(layers(clip)[0]!.cornerRadii).toEqual([0.5, 0, 0, 0])
  })

  it('box-shadow becomes shadow: x, y, blur and colour, spread dropped', () => {
    const { clip } = emit(scene(card({ boxShadow: SHADOW_CSS })))
    expect(layers(clip)[0]!.shadow).toEqual({ color: 'rgba(0, 0, 0, 0.5)', offsetX: 0, offsetY: 8, blur: 24 })
  })

  it('a clip with none of the new styles gains none of the new fields', () => {
    const { clip } = emit(scene(card({ borderRadius: 12, boxShadow: 'none' })))
    const [rect] = layers(clip)
    expect('shadow' in rect!).toBe(false)
    expect('cornerRadii' in rect!).toBe(false)
  })

  it('reports a spread, an inset shadow and extra layers instead of guessing', () => {
    const spread = emit(scene(card({ boxShadow: 'rgba(0, 0, 0, 0.5) 0px 8px 24px 6px' })))
    expect(spread.report.skipped).toContainEqual({ feature: 'box-shadow-spread', count: 1 })
    const inset = emit(scene(card({ boxShadow: 'inset 0 0 8px #000' })))
    expect(inset.report.skipped).toContainEqual({ feature: 'box-shadow-inset', count: 1 })
    expect('shadow' in layers(inset.clip)[0]!).toBe(false)
    const list = emit(scene(card({ boxShadow: '0 4px 8px #000, 0 8px 16px #111' })))
    expect(list.report.skipped).toContainEqual({ feature: 'box-shadow-layers', count: 1 })
  })

  it('a conic background becomes a conic fill paint', () => {
    const { clip, report } = emit(
      scene(card({ backgroundColor: undefined, backgroundImage: 'conic-gradient(from 30deg at 40% 60%, #ff0000, #0000ff)' })),
    )
    expect(layers(clip)[0]!.shapeFillPaint).toMatchObject({ type: 'conic', angle: 30, cx: 0.4, cy: 0.6 })
    expect(report.skipped).toEqual([])
  })

  it('a shadow with nothing painted to cast it is reported', () => {
    const { report } = emit(scene(node('div', box(0, 0, 100, 100), { boxShadow: SHADOW_CSS }, { id: 'ghost' })))
    expect(report.skipped).toContainEqual({ feature: 'box-shadow-without-fill', count: 1 })
  })

  it('overflow:hidden with per-corner radii masks with those corners', () => {
    const parent = node('div', box(100, 100, 200, 100), { backgroundColor: '#fff', overflowHidden: true, borderRadii: [10, 0, 0, 0], borderRadius: 10 }, {
      id: 'frame',
      children: [node('div', box(110, 110, 50, 50), { backgroundColor: '#f00' }, { id: 'dot' })],
    })
    const { clip } = emit(scene(parent))
    const frame = layers(clip)[0]!
    expect(frame.type).toBe('compound')
    expect(frame.mask).toMatchObject({ kind: 'path' })
    // top-left corner rounded (an arc ends at x = 10 on the top edge), the others square
    expect((frame.mask as { path: string }).path).toBe(
      'M 10 0 H 200 A 0 0 0 0 1 200 0 V 100 A 0 0 0 0 1 200 100 H 0 A 0 0 0 0 1 0 100 V 10 A 10 10 0 0 1 10 0 Z',
    )
  })
})

describe('emit: text', () => {
  const lineOf = (text: string, b: MeasuredBox) => ({ lines: [{ text, box: b }] })
  const pill = (style: MeasuredStyle) => {
    const b = box(100, 100, 220, 60)
    return node('p', b, { color: '#111111', fontFamily: 'inter', fontSize: 28, fontWeight: 400, lineHeight: 36, ...style }, { id: 'tag', text: lineOf('NEW', b) })
  }

  it('text-decoration becomes textDecoration', () => {
    expect(layers(emit(scene(pill({ textDecoration: 'underline' }))).clip)[0]!.textDecoration).toBe('underline')
    expect(layers(emit(scene(pill({ textDecoration: 'line-through' }))).clip)[0]!.textDecoration).toBe('line-through')
    const none = layers(emit(scene(pill({ textDecoration: 'none' }))).clip)[0]!
    expect('textDecoration' in none).toBe(false)
  })

  it('underline wins over line-through when both are set, and overline is reported', () => {
    const both = emit(scene(pill({ textDecoration: 'underline line-through overline' })))
    expect(layers(both.clip)[0]!.textDecoration).toBe('underline')
    expect(both.report.skipped).toContainEqual({ feature: 'text-decoration:both', count: 1 })
    expect(both.report.skipped).toContainEqual({ feature: 'text-decoration:overline', count: 1 })
  })

  it("a text pill's box-shadow rides on the text clip's background box", () => {
    const { clip } = emit(scene(pill({ backgroundColor: '#ffd166', padding: 12, borderRadius: 30, boxShadow: SHADOW_CSS })))
    const [text] = layers(clip)
    expect(layers(clip)).toHaveLength(1)
    expect(text!.type).toBe('text')
    expect(text!.backgroundColor).toBe('#ffd166')
    expect(text!.shadow).toEqual({ color: 'rgba(0, 0, 0, 0.5)', offsetX: 0, offsetY: 8, blur: 24 })
  })

  it('a text pill with per-corner radii becomes a rect with cornerRadii behind a plain text clip', () => {
    const { clip } = emit(scene(pill({ backgroundColor: '#ffd166', padding: 12, borderRadii: [30, 30, 0, 0], borderRadius: 30, boxShadow: SHADOW_CSS })))
    const group = layers(clip)[0]!
    expect(group.type).toBe('compound')
    const [rect, text] = layers(group)
    expect(rect!.type).toBe('shape')
    expect(rect!.cornerRadii).toEqual([0.5, 0.5, 0, 0])
    expect(rect!.shadow).toBeDefined()
    expect(text!.type).toBe('text')
    expect(text!.backgroundColor).toBeUndefined()
    expect(text!.shadow).toBeUndefined()
  })
})
