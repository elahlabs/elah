import { describe, it, expect } from 'vitest'
import type { Clip, Keyframe } from '../../types'
import { TimelineEngine } from '../../editor/TimelineEngine'
import { applyOps } from '../../ops/apply'
import type { EditorOp } from '../../ops/types'
import { createTextClip } from '../../elements/text'
import { createShapeClip } from '../../elements/shape'
import { findBezierPreset } from '../../elements/easingPresets'
import { parseMotion, motionPatch, resolveLabels, staggerFrames, staggerSpec, type MotionContext } from './motion'
import { emitScene } from './emit'
import { statScene } from './fixtures'

const FPS = 30
const STAGE = { width: 1080, height: 1920 }
const ctx = (over: Partial<MotionContext> = {}): MotionContext => ({
  fps: FPS,
  sceneDurationFrames: 120,
  clipStartFrameInScene: 0,
  stage: STAGE,
  baseline: { stage: STAGE },
  ...over,
})

const text = (): Clip => createTextClip({ trackId: 't', name: 'big', startFrame: 0, durationFrames: 120, text: { content: '72%' } })
const rect = (): Clip => createShapeClip({ trackId: 't', name: 'ring', startFrame: 0, durationFrames: 120, shape: { shapeKind: 'rect' } })

/** Keys of one channel without ids, which differ between runs. */
function keysOf(clip: Partial<Clip>, channel: string): Array<Omit<Keyframe, 'id'>> {
  const track = clip.keyframes?.channels?.[channel as never] as { keys: Keyframe[] } | undefined
  return (track?.keys ?? []).map(({ id: _id, ...k }) => k)
}

const one = (src: string) => {
  const r = parseMotion(src)
  if (r.errors.length > 0) throw new Error(JSON.stringify(r.errors))
  return r.clauses
}

describe('MOT-8 phase B: rotateX / rotateY channels', () => {
  const image = (): Clip => ({ ...rect(), type: 'image', src: 'x.png' }) as unknown as Clip

  it('are channels on an image clip; degrees become radians', () => {
    const { clauses, errors } = parseMotion('rotateY: 0 → 90deg 0.4s ease-in; rotateX: -20deg → 0 0.4s')
    expect(errors).toEqual([])
    expect(clauses.map((c) => (c.kind === 'channel' ? c.channel : c.kind))).toEqual(['rotateY', 'rotateX'])
    const { patch, violations } = motionPatch(image(), clauses, ctx())
    expect(violations).toEqual([])
    expect(keysOf(patch, 'rotateY').map((k) => +k.value.toFixed(6))).toEqual([0, +(Math.PI / 2).toFixed(6)])
    expect(keysOf(patch, 'rotateX').map((k) => +k.value.toFixed(6))).toEqual([+((-20 * Math.PI) / 180).toFixed(6), 0])
  })

  it('a compound, video and sequence clip take them; text and shape clips are refused with a reason', () => {
    for (const type of ['video', 'compound', 'sequence']) {
      const { violations } = motionPatch({ ...rect(), type } as unknown as Clip, one('rotateY: 0 → 30deg 0.4s'), ctx())
      expect(violations, type).toEqual([])
    }
    for (const clip of [rect(), text()]) {
      const { patch, violations } = motionPatch(clip, one('rotateY: 0 → 30deg 0.4s'), ctx())
      expect(violations).toHaveLength(1)
      expect(violations[0].message).toMatch(/image, video, sequence or compound/)
      expect(keysOf(patch, 'rotateY')).toEqual([])
    }
  })

  it('a unit that is not degrees says degrees', () => {
    const { violations } = motionPatch(image(), one('rotateY: 0 → 90px 0.4s'), ctx())
    expect(violations).toHaveLength(1)
    expect(violations[0].message).toMatch(/degrees/)
  })
})

describe('MOT-8 skew channels', () => {
  it('skewX / skewY are channels; degrees become radians, like rotation', () => {
    const { clauses, errors } = parseMotion('skewX: 0 → 12deg 0.4s ease-in; skewY: 0 → -8deg 0.4s')
    expect(errors).toEqual([])
    expect(clauses.map((c) => (c.kind === 'channel' ? c.channel : c.kind))).toEqual(['skewX', 'skewY'])
    const { patch, violations } = motionPatch(rect(), clauses, ctx())
    expect(violations).toEqual([])
    expect(keysOf(patch, 'skewX').map((k) => +k.value.toFixed(6))).toEqual([0, +((12 * Math.PI) / 180).toFixed(6)])
    expect(keysOf(patch, 'skewY').map((k) => +k.value.toFixed(6))).toEqual([0, +((-8 * Math.PI) / 180).toFixed(6)])
  })

  it('a static skew is a clause that starts and ends on the same value', () => {
    const { patch, violations } = motionPatch(rect(), one('skewX: 12deg → 12deg 0.1s'), ctx())
    expect(violations).toEqual([])
    const values = keysOf(patch, 'skewX').map((k) => k.value)
    expect(values[0]).toBeCloseTo((12 * Math.PI) / 180, 9)
    expect(values[1]).toBeCloseTo((12 * Math.PI) / 180, 9)
  })

  it('a unit that is not degrees is refused with a message that says degrees', () => {
    const { violations } = motionPatch(rect(), one('skewX: 0 → 12px 0.4s'), ctx())
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toMatch(/number of degrees/)
  })
})

describe('parseMotion', () => {
  it('reads the plan 4.3 example, one clause per form', () => {
    const { clauses, errors } = parseMotion(`in: pop-overshoot 0.4s @0.2;
      x: 0.30 → 0.50 0.6s overshoot @1.0;
      rotation: 0 → 12deg 0.5s spring:bouncy @1.0;
      color: #fff → #ffd166 0.3s @2.0;
      fx.glow.intensity: 0 → 1 0.4s @2.2;
      out: blur-out 0.3s @-0.3`)
    expect(errors).toEqual([])
    expect(clauses).toEqual([
      { kind: 'preset', end: 'in', preset: 'pop-overshoot', dur: 0.4, at: 0.2 },
      { kind: 'channel', channel: 'x', from: '0.30', to: '0.50', dur: 0.6, ease: 'overshoot', at: 1 },
      { kind: 'channel', channel: 'rotation', from: '0', to: '12deg', dur: 0.5, ease: 'spring:bouncy', at: 1 },
      { kind: 'channel', channel: 'color', from: '#fff', to: '#ffd166', dur: 0.3, ease: 'ease-out', at: 2 },
      { kind: 'channel', channel: 'fx.glow.intensity', from: '0', to: '1', dur: 0.4, ease: 'ease-out', at: 2.2 },
      { kind: 'preset', end: 'out', preset: 'blur-out', dur: 0.3, at: -0.3 },
    ])
  })

  it('accepts -> for the arrow, ms durations, ".", a hold, a stagger and a cubic-bezier', () => {
    const { clauses, errors } = parseMotion('opacity: .->1 400ms; y: hold 0.5s @1; scale: 1 → 2 1s cubic-bezier(0.1, 0.2, 0.3, 1) @0.5; stagger: children 100ms')
    expect(errors).toEqual([])
    expect(clauses[0]).toMatchObject({ kind: 'channel', channel: 'opacity', from: '.', to: '1', dur: 0.4, ease: 'ease-out' })
    expect(clauses[1]).toEqual({ kind: 'hold', channel: 'y', dur: 0.5, at: 1 })
    expect(clauses[2]).toMatchObject({ ease: 'cubic-bezier(0.1, 0.2, 0.3, 1)', at: 0.5 })
    expect(clauses[3]).toEqual({ kind: 'stagger', ms: 100 })
    expect(staggerFrames(clauses, 30)).toBe(3)
    expect(staggerFrames(one('stagger: children 4f'), 30)).toBe(4)
  })

  it('accepts an ease on a preset, as the plan 4.5 stat scene writes it', () => {
    expect(one('in: slide-in-up 0.4s overshoot @0.4')[0]).toMatchObject({ preset: 'slide-in-up', ease: 'overshoot', dur: 0.4, at: 0.4 })
  })

  it('names the nearest valid channel, preset and ease', () => {
    expect(parseMotion('opacty: 0 → 1 1s').errors[0].substitute).toBe('opacity')
    expect(parseMotion('rotaton: 0 → 1 1s').errors[0].substitute).toBe('rotation')
    expect(parseMotion('in: pop-ovrshoot 0.4s').errors[0].substitute).toBe('pop-overshoot')
    expect(parseMotion('out: fade-ot 0.3s').errors[0].substitute).toBe('fade-out')
    expect(parseMotion('x: 0 → 1 1s overshot').errors[0].substitute).toBe('overshoot')
    expect(parseMotion('x: 0 → 1 1s spring:bounce').errors[0].substitute).toBe('spring:bouncy')
  })

  it('names the right direction for a preset used on the wrong end', () => {
    const e = parseMotion('in: fade-out 0.3s').errors[0]
    expect(e.message).toMatch(/exit preset/)
    expect(e.substitute).toBe('out: fade-out')
  })

  it('reports malformed clauses without throwing', () => {
    for (const bad of ['nonsense', 'x: 0 1 1s', 'x: 0 → 1', 'x: 0 → 1 -1s', 'x: 0 → 1 1s @1.2.3', 'stagger: kids 3f', 'y: hold', 'in:']) {
      expect(parseMotion(bad).errors.length, bad).toBe(1)
    }
  })

  it('treats an empty string and stray semicolons as nothing', () => {
    expect(parseMotion('  ; ;').clauses).toEqual([])
  })
})

describe('motionPatch: channel clauses are exactly what setKeyframes writes', () => {
  it('x with the overshoot bezier equals a real setKeyframes op, key for key', () => {
    const engine = new TimelineEngine({ fps: FPS, stage: STAGE })
    const track = engine.addTrack('elements').id
    const added = engine.addClip({ trackId: track, type: 'text', name: 'big', text: { content: '72%' }, startFrame: 0, durationFrames: 120 } as never)
    const before = engine.getProject().clips[track].find((c) => c.id === added.id) as Clip
    const op = { op: 'setKeyframes', clip: added.id, channel: 'x', keys: [{ at: 1, value: 0.3 }, { at: 1.6, value: 0.5, curve: 'overshoot' }] } as unknown as EditorOp
    applyOps(engine, [op], { description: 'reference' })
    const reference = engine.getProject().clips[track].find((c) => c.id === added.id) as Clip

    const { patch, violations } = motionPatch(before, one('x: 0.30 → 0.50 0.6s overshoot @1.0'), ctx())
    expect(violations).toEqual([])
    expect(keysOf(patch, 'x')).toEqual(keysOf(reference, 'x'))
    expect(keysOf(patch, 'x')[1].easingBezier).toEqual(findBezierPreset('overshoot')?.bezier)
    expect(keysOf(patch, 'x').map((k) => k.frame)).toEqual([30, 48])
    expect(keysOf(patch, 'x').map((k) => k.value)).toEqual([0.3, 0.5])
  })

  it('"@-0.3" starts 0.3 s before the scene end: the key pair ends on the last visible frame', () => {
    const { patch } = motionPatch(text(), one('opacity: 1 → 0 0.3s linear @-0.3'), ctx())
    expect(keysOf(patch, 'opacity').map((k) => k.frame)).toEqual([119 - 9, 119])
  })

  it('an @time without a start defaults to frame 0 and the default ease is ease-out', () => {
    const { patch } = motionPatch(text(), one('opacity: 0 → 1 0.5s'), ctx())
    const keys = keysOf(patch, 'opacity')
    expect(keys.map((k) => k.frame)).toEqual([0, 15])
    expect(keys[1].easingBezier).toEqual(findBezierPreset('ease-out')?.bezier)
  })

  it('px becomes a stage fraction on x and y, degrees become radians on rotation', () => {
    const { patch } = motionPatch(text(), one('x: 108px → 540px 1s; y: 0 → 960px 1s; rotation: 0 → 90deg 1s'), ctx())
    expect(keysOf(patch, 'x').map((k) => k.value)).toEqual([0.1, 0.5])
    expect(keysOf(patch, 'y').map((k) => k.value)).toEqual([0, 0.5])
    const rot = keysOf(patch, 'rotation').map((k) => k.value)
    expect(rot[0]).toBe(0)
    expect(rot[1]).toBeCloseTo(Math.PI / 2, 10)
  })

  it('"." reads the static value', () => {
    const clip = { ...text(), opacity: 0.6 }
    const { patch } = motionPatch(clip, one('opacity: . → 0 1s'), ctx())
    expect(keysOf(patch, 'opacity')[0].value).toBe(0.6)
  })

  it('colours become vec keys; a spring ease is stored as a spring', () => {
    const { patch } = motionPatch(text(), one('color: #ffffff → #ffd166 0.3s @1; rotation: 0 → 12deg 0.5s spring:bouncy @1'), ctx())
    const colour = (patch.keyframes?.channels?.color as { keys: Array<{ vec?: number[] }> }).keys
    expect(colour[0].vec).toEqual([1, 1, 1, 1])
    expect(colour[1].vec?.[0]).toBe(1)
    expect(colour[1].vec?.[2]).toBeCloseTo(0x66 / 255, 6)
    expect(keysOf(patch, 'rotation')[1].spring).toMatchObject({ stiffness: 180, damping: 12 })
  })

  it('a hold clause writes a hold key that steps to a closing key, keeping the arriving ease', () => {
    const { patch } = motionPatch(text(), one('x: 0.2 → 0.8 1s @0; x: hold 0.5s @1'), ctx())
    const keys = keysOf(patch, 'x')
    expect(keys.map((k) => [k.frame, k.value, k.hold === true])).toEqual([
      [0, 0.2, false],
      [30, 0.8, true],
      [45, 0.8, false],
    ])
    expect(keys[1].easingBezier).toEqual(findBezierPreset('ease-out')?.bezier)
  })

  it('skips an unreadable clause with a violation and keeps the others', () => {
    const { patch, violations } = motionPatch(text(), one('color: 0 → 1 1s; opacity: 0 → 1 1s'), ctx())
    expect(violations).toHaveLength(1)
    expect(violations[0].message).toMatch(/cannot read "0" as a colour/)
    expect(keysOf(patch, 'opacity')).toHaveLength(2)
    expect(patch.keyframes?.channels?.color).toBeUndefined()
  })

  it('reports an unreadable value instead of writing NaN', () => {
    const { patch, violations } = motionPatch(text(), one('x: left → 0.5 1s'), ctx())
    expect(violations[0].message).toMatch(/cannot read "left"/)
    expect(patch).toEqual({})
  })
})

describe('motionPatch: presets', () => {
  it('"in: fade-in 0.3s @0.6" equals applyMotionPreset shifted to frame 18, with a 9 frame ramp', () => {
    const { patch, violations } = motionPatch(text(), one('in: fade-in 0.3s @0.6'), ctx())
    expect(violations).toEqual([])
    expect(keysOf(patch, 'opacity').map((k) => [k.frame, k.value])).toEqual([[18, 0], [27, 1]])
  })

  it('"in: pop-in 0.3s" with no @ starts at frame 0 on scale and opacity', () => {
    const { patch } = motionPatch(rect(), one('in: pop-in 0.3s'), ctx())
    expect(keysOf(patch, 'scale').map((k) => k.frame)).toEqual([0, 9])
    expect(keysOf(patch, 'opacity').map((k) => k.frame)).toEqual([0, 9])
  })

  it('an exit with @-0.3 ends on the last visible frame (the `last = duration - 1` rule)', () => {
    const { patch } = motionPatch(text(), one('out: fade-out 0.3s @-0.3'), ctx())
    expect(keysOf(patch, 'opacity').map((k) => [k.frame, k.value])).toEqual([[110, 1], [119, 0]])
  })

  it('an exit that should end before the scene does lands where it was asked', () => {
    const { patch } = motionPatch(text(), one('out: fade-out 0.3s @2'), ctx())
    // starts at frame 60, 9 frames long
    expect(keysOf(patch, 'opacity').map((k) => k.frame)).toEqual([60, 69])
  })

  it('a bezier ease on a preset replaces the arriving key, not the others (plan 4.5 big number)', () => {
    const { patch, violations } = motionPatch(text(), one('in: slide-in-up 0.4s overshoot @0.4'), ctx())
    expect(violations).toEqual([])
    const y = keysOf(patch, 'y')
    expect(y.map((k) => k.frame)).toEqual([12, 24])
    expect(y[0].easingBezier).toBeUndefined()
    expect(y[1].easingBezier).toEqual(findBezierPreset('overshoot')?.bezier)
    expect(y[1].easing).toBe('linear')
  })

  it('a named ease goes straight through the preset', () => {
    const { patch } = motionPatch(text(), one('in: slide-in-up 0.4s expo-out'), ctx())
    expect(keysOf(patch, 'y')[1].easing).toBe('expo-out')
  })

  it('a preset the clip cannot perform is a violation, not a throw', () => {
    const { patch, violations } = motionPatch(text(), one('in: underline-draw 0.5s'), ctx())
    expect(violations[0].message).toMatch(/does not apply/)
    expect(patch).toEqual({})
  })
})

describe('motionPatch: stagger', () => {
  it('pushes start-anchored clauses later by the clip\'s offset and leaves end-anchored ones alone', () => {
    const plain = motionPatch(text(), one('in: fade-in 0.3s @0.6; out: fade-out 0.3s @-0.3'), ctx())
    const shifted = motionPatch(text(), one('in: fade-in 0.3s @0.6; out: fade-out 0.3s @-0.3'), ctx({ shiftFrames: 4 }))
    expect(keysOf(plain.patch, 'opacity').map((k) => k.frame)).toEqual([18, 27, 110, 119])
    expect(keysOf(shifted.patch, 'opacity').map((k) => k.frame)).toEqual([22, 31, 110, 119])
  })

  it('shifts channel clauses the same way', () => {
    const { patch } = motionPatch(text(), one('x: 0 → 1 1s @0.5'), ctx({ shiftFrames: 8 }))
    expect(keysOf(patch, 'x').map((k) => k.frame)).toEqual([23, 53])
  })
})

describe('plan 4.5 end to end', () => {
  const clips = () => {
    const { clip, report } = emitScene(statScene(), { fps: FPS })
    const top = Object.values((clip.compound as { project: { clips: Record<string, Clip[]> } }).project.clips).flat()
    const ring = top.find((c) => c.name === 'ring') as Clip
    const column = top.find((c) => c.type === 'compound') as Clip
    const inner = Object.values((column.compound as { project: { clips: Record<string, Clip[]> } }).project.clips).flat()
    return { ring, big: inner.find((c) => c.name === 'big') as Clip, label: inner.find((c) => c.name === 'label') as Clip, report }
  }

  it('draws the ring on and pops it in', () => {
    const { ring, report } = clips()
    expect(report.violations).toBeUndefined()
    expect(keysOf(ring, 'draw').map((k) => [k.frame, k.value])).toEqual([[9, 0], [45, 0.72]])
    expect(keysOf(ring, 'draw')[1].easing).toBe('expo-out')
    expect(keysOf(ring, 'scale').map((k) => k.frame)).toEqual([0, 9])
  })

  it('slides "72%" in with the overshoot bezier', () => {
    const { big } = clips()
    const y = keysOf(big, 'y')
    expect(y.map((k) => k.frame)).toEqual([12, 24])
    expect(y[1].easingBezier).toEqual(findBezierPreset('overshoot')?.bezier)
  })

  it('fades the label in 4 frames later than a plain fade, and out 0.3 s before the end', () => {
    const { label } = clips()
    expect(keysOf(label, 'opacity').map((k) => k.frame)).toEqual([22, 31, 110, 119])
  })
})

describe('MC-2d: Tier B channel names', () => {
  it('parses font-size, letter-spacing, stroke-width, anchor-x and anchor-y to the engine channels', () => {
    const { clauses, errors } = parseMotion('font-size: 40px → 96px 0.5s; letter-spacing: -2px → 12px 1s; stroke-width: 0 → 8px 0.4s; anchor-x: 0 → 100% 0.3s; anchor-y: hold 0.2s')
    expect(errors).toEqual([])
    expect(clauses.map((c) => (c as { channel: string }).channel)).toEqual(['text.fontSize', 'text.letterSpacing', 'stroke.width', 'anchor.x', 'anchor.y'])
  })

  it('does not accept the engine names or an unknown spelling, and suggests the CSS one', () => {
    const { errors } = parseMotion('text.fontSize: 1 → 2 1s; fontsize: 1 → 2 1s')
    expect(errors).toHaveLength(2)
    expect(errors[1]!.substitute).toBeDefined()
  })

  it('writes the same keys setKeyframes writes: px values stay px', () => {
    const c = text()
    const p = motionPatch(c, one('font-size: 40px → 96 0.5s linear @1; letter-spacing: -2px → 12px 1s linear @1'), ctx()).patch
    expect(keysOf(p, 'text.fontSize')).toMatchObject([{ frame: 30, value: 40 }, { frame: 45, value: 96 }])
    expect(keysOf(p, 'text.letterSpacing')).toMatchObject([{ frame: 30, value: -2 }, { frame: 60, value: 12 }])
  })

  it('stroke-width on a shape, and anchor as a fraction or a percentage', () => {
    const p = motionPatch(rect(), one('stroke-width: 0 → 8px 0.5s linear; anchor-x: 0 → 100% 1s linear; anchor-y: 0.25 → 0.75 1s linear'), ctx()).patch
    expect(keysOf(p, 'stroke.width')).toMatchObject([{ frame: 0, value: 0 }, { frame: 15, value: 8 }])
    expect(keysOf(p, 'anchor.x')).toMatchObject([{ frame: 0, value: 0 }, { frame: 30, value: 1 }])
    expect(keysOf(p, 'anchor.y')).toMatchObject([{ frame: 0, value: 0.25 }, { frame: 30, value: 0.75 }])
  })

  it('"." reads the static value and a hold keeps it', () => {
    const c = { ...text(), fontSize: 64 }
    const p = motionPatch(c, one('font-size: . → 100px 0.5s linear'), ctx()).patch
    expect(keysOf(p, 'text.fontSize')[0]!.value).toBe(64)
    const h = motionPatch(c, one('font-size: hold 0.5s @1'), ctx()).patch
    expect(keysOf(h, 'text.fontSize').map((k) => k.value)).toEqual([64, 64])
  })

  it('refuses units a channel cannot take, and a clip type that cannot take the channel', () => {
    const bad = motionPatch(text(), one('font-size: 10% → 20% 1s; anchor-x: 0 → 20px 1s'), ctx())
    expect(bad.violations).toHaveLength(2)
    expect(bad.patch.keyframes).toBeUndefined()
    const wrongType = motionPatch(rect(), one('font-size: 10px → 20px 1s'), ctx())
    expect(wrongType.violations).toHaveLength(1)
    expect(wrongType.violations[0]!.message).toMatch(/cannot take a text.fontSize key/)
    expect(wrongType.patch.keyframes).toBeUndefined()
  })
})

describe('rich stagger (MOT-2)', () => {
  it('parses from, ease and grid after the unit', () => {
    const { clauses, errors } = parseMotion('stagger: children 3f from center ease power2.out grid 4')
    expect(errors).toEqual([])
    expect(clauses[0]).toEqual({ kind: 'stagger', frames: 3, from: 'center', ease: 'quad-out', grid: 4 })
    expect(parseMotion('stagger: children 100ms from 2').clauses[0]).toEqual({ kind: 'stagger', ms: 100, from: 2 })
  })

  it('a plain stagger is unchanged and yields i * each', () => {
    const c = parseMotion('stagger: children 4f').clauses
    expect(c[0]).toEqual({ kind: 'stagger', frames: 4 })
    expect(staggerSpec(c, 30, 4)).toEqual([0, 4, 8, 12])
    expect(staggerSpec(parseMotion('opacity: 0 → 1 1s').clauses, 30, 4)).toBeNull()
  })

  it('from center gives the symmetric offsets', () => {
    expect(staggerSpec(parseMotion('stagger: children 3f from center').clauses, 30, 5)).toEqual([6, 3, 0, 3, 6])
  })

  it('an unknown origin, ease, option or grid is a violation, with a substitute where there is one', () => {
    const origin = parseMotion('stagger: children 3f from centre')
    expect(origin.clauses).toEqual([])
    expect(origin.errors[0]).toMatchObject({ element: 'data-motion', substitute: 'center' })
    expect(parseMotion('stagger: children 3f from rndom').errors[0]!.substitute).toBe('random')
    expect(parseMotion('stagger: children 3f ease wobble').errors).toHaveLength(1)
    expect(parseMotion('stagger: children 3f grid 0').errors).toHaveLength(1)
    expect(parseMotion('stagger: children 3f grid').errors).toHaveLength(1)
    expect(parseMotion('stagger: children 3f spin 2').errors[0]!.message).toMatch(/unknown stagger option/)
  })
})

describe('timeline positions (MOT-6)', () => {
  const frames = (clip: Partial<Clip>, ch: string) => keysOf(clip, ch).map((k) => k.frame)

  it('parses @<, @>, offsets, labels and the label head', () => {
    const c = parseMotion('x: 0 → 1 0.5s @0.2; y: 0 → 1 0.3s @<; opacity: 0 → 1 0.3s @>0.2; scale: 0 → 1 0.3s @>-0.1; label: intro @0.4; rotation: 0 → 90deg 0.3s @intro+0.3; draw: 0 → 1 0.3s @intro-0.1; cornerRadius: 0 → 4 0.3s @intro')
    expect(c.errors).toEqual([])
    expect(c.clauses.map((x) => ('ref' in x ? x.ref : 'at' in x ? x.at : null))).toEqual([
      0.2,
      { kind: 'prev', edge: 'start', offset: 0 },
      { kind: 'prev', edge: 'end', offset: 0.2 },
      { kind: 'prev', edge: 'end', offset: -0.1 },
      0.4,
      { kind: 'label', name: 'intro', offset: 0.3 },
      { kind: 'label', name: 'intro', offset: -0.1 },
      { kind: 'label', name: 'intro', offset: 0 },
    ])
    expect(c.clauses[4]).toEqual({ kind: 'label', name: 'intro', at: 0.4 })
  })

  it('keeps absolute and from-end positions exactly as they were (no ref, same frames)', () => {
    const c = one('in: fade-in 0.3s @0.6; out: fade-out 0.3s @-0.3')
    expect(c[0]).toEqual({ kind: 'preset', end: 'in', preset: 'fade-in', dur: 0.3, at: 0.6 })
    expect(c[1]).toEqual({ kind: 'preset', end: 'out', preset: 'fade-out', dur: 0.3, at: -0.3 })
    const { patch } = motionPatch(text(), c, ctx())
    expect(frames(patch, 'opacity')).toEqual([18, 27, 110, 119])
    expect(frames(motionPatch(text(), one('x: 0 → 1 1s @0.5'), ctx({ shiftFrames: 8 })).patch, 'x')).toEqual([23, 53])
  })

  it('refuses a malformed position or label', () => {
    expect(parseMotion('x: 0 → 1 1s @>abc').errors).toHaveLength(1)
    expect(parseMotion('x: 0 → 1 1s @3x').errors).toHaveLength(1)
    expect(parseMotion('label: 1bad @1').errors).toHaveLength(1)
    expect(parseMotion('label: a b').errors).toHaveLength(1)
  })

  it('@> starts as the previous clause ends, @< as it starts, offsets add seconds', () => {
    const run = (src: string) => motionPatch(text(), one(src), ctx())
    expect(frames(run('x: 0 → 1 0.5s @0.2; y: 0 → 1 0.3s @>0.1').patch, 'y')).toEqual([24, 33])
    expect(frames(run('x: 0 → 1 0.5s @0.2; y: 0 → 1 0.3s @<0.2').patch, 'y')).toEqual([12, 21])
    expect(frames(run('x: 0 → 1 0.5s @0.2; y: 0 → 1 0.3s @>-0.1').patch, 'y')).toEqual([18, 27])
    // At the first clause both mean 0 (the clip's own stagger shift still applies).
    expect(frames(run('x: 0 → 1 0.5s @>').patch, 'x')).toEqual([0, 15])
    expect(frames(motionPatch(text(), one('x: 0 → 1 0.5s @<'), ctx({ shiftFrames: 4 })).patch, 'x')).toEqual([4, 19])
  })

  it('"previous" skips stagger and label clauses', () => {
    const { patch } = motionPatch(text(), one('x: 0 → 1 0.5s @0.2; stagger: children 4f; label: m @3; y: 0 → 1 0.3s @>'), ctx())
    expect(frames(patch, 'y')).toEqual([21, 30])
  })

  it('a preset without dur ends after its default ramp', () => {
    // 120-frame clip: a quarter, capped at 30 frames, so a 30-frame ramp.
    const { patch } = motionPatch(text(), one('in: fade-in; x: 0 → 1 0.3s @>'), ctx())
    expect(frames(patch, 'x')).toEqual([30, 39])
  })

  it('@> after a 0.5 s clause equals the explicit absolute position, key for key', () => {
    const rel = motionPatch(text(), one('x: 0 → 1 0.5s @0.2; y: 0 → 1 0.3s ease-out @>; opacity: 0 → 1 0.2s @>0.1'), ctx())
    const abs = motionPatch(text(), one('x: 0 → 1 0.5s @0.2; y: 0 → 1 0.3s ease-out @0.7; opacity: 0 → 1 0.2s @1.1'), ctx())
    expect(rel.violations).toEqual([])
    for (const ch of ['x', 'y', 'opacity']) expect(keysOf(rel.patch, ch)).toEqual(keysOf(abs.patch, ch))
  })

  it('a label places a clause, forward references included, and is scene time (never staggered)', () => {
    const nodes = [
      { element: 'a', clauses: one('x: 0 → 1 0.3s @late'), shiftFrames: 0 },
      { element: 'b', clauses: one('label: late @1'), shiftFrames: 6 },
    ]
    const { labels, violations } = resolveLabels(nodes, { fps: FPS, sceneDurationFrames: 120 })
    expect(violations).toEqual([])
    expect(labels.get('late')).toBe(1)
    expect(frames(motionPatch(text(), nodes[0].clauses, ctx({ labels, shiftFrames: 4 })).patch, 'x')).toEqual([30, 39])
    expect(frames(motionPatch(text(), one('x: 0 → 1 0.3s @late+0.5'), ctx({ labels })).patch, 'x')).toEqual([45, 54])
  })

  it('a label may follow the previous clause of its element', () => {
    const nodes = [{ element: 'a', clauses: one('x: 0 → 1 0.5s @0.2; label: done @>'), shiftFrames: 0 }]
    const { labels } = resolveLabels(nodes, { fps: FPS, sceneDurationFrames: 120 })
    expect(labels.get('done')).toBeCloseTo(0.7, 10)
  })

  it('an unknown label is a violation with the nearest declared name; the clause is skipped', () => {
    const labels = new Map([['intro', 1], ['outro', 3]])
    const r = motionPatch(text(), one('x: 0 → 1 0.3s @intor+0.1; y: 0 → 1 0.3s @>'), ctx({ labels }))
    expect(r.violations[0]).toMatchObject({ element: 'data-motion', substitute: 'intro' })
    expect(r.violations[0].message).toMatch(/unknown label "intor"/)
    expect(r.patch.keyframes?.channels?.x).toBeUndefined()
    expect(r.violations).toHaveLength(2) // the follower has nothing to be relative to, and says so
  })

  it('a duplicate label keeps the first and reports', () => {
    const { labels, violations } = resolveLabels(
      [{ element: 'a', clauses: one('label: t @1'), shiftFrames: 0 }, { element: 'b', clauses: one('label: t @2'), shiftFrames: 0 }],
      { fps: FPS, sceneDurationFrames: 120 },
    )
    expect(labels.get('t')).toBe(1)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ element: 'b' })
    expect(violations[0].message).toMatch(/declared twice/)
  })

  it('a cycle is reported and its labels fall back to 0', () => {
    const { labels, violations } = resolveLabels(
      [{ element: 'a', clauses: one('label: a @b+0.1'), shiftFrames: 0 }, { element: 'b', clauses: one('label: b @a'), shiftFrames: 0 }],
      { fps: FPS, sceneDurationFrames: 120 },
    )
    expect(violations.length).toBeGreaterThanOrEqual(1)
    expect(violations[0].message).toMatch(/cannot be placed/)
    expect([labels.get('a'), labels.get('b')]).toEqual([0, 0])
  })

  it('a label before 0 is clamped to 0 and reported', () => {
    const labels = new Map([['intro', 0.2]])
    const r = motionPatch(text(), one('x: 0 → 1 0.3s @intro-0.5'), ctx({ labels }))
    expect(frames(r.patch, 'x')).toEqual([0, 9])
    expect(r.violations[0].message).toMatch(/clamped to 0/)
  })
})

describe('repeat and yoyo (MOT-7)', () => {
  const sc = (src: string, over: Partial<MotionContext> = {}) => motionPatch(text(), one(src), ctx(over))
  const frames = (clip: Partial<Clip>, ch: string) => keysOf(clip, ch).map((k) => k.frame)

  it('parses the tokens in any order before @', () => {
    const { clauses, errors } = parseMotion('scale: 1 → 1.08 0.6s ease-in-out repeat 4 yoyo @1.0; opacity: 0 → 1 0.5s yoyo repeat-delay 0.2s repeat forever')
    expect(errors).toEqual([])
    expect(clauses[0]).toMatchObject({ channel: 'scale', ease: 'ease-in-out', repeat: 4, yoyo: true, at: 1 })
    expect(clauses[1]).toMatchObject({ channel: 'opacity', ease: 'ease-out', repeat: 'forever', yoyo: true, repeatDelay: 0.2 })
  })

  it('rejects negative, fractional, over-cap, hold and preset repeats, and a yoyo with no count', () => {
    for (const src of ['scale: 1 → 2 1s repeat -1', 'scale: 1 → 2 1s repeat 1.5', 'scale: 1 → 2 1s repeat 65', 'scale: 1 → 2 1s yoyo', 'y: hold 0.5s repeat 2', 'in: fade-in 0.4s repeat 2']) {
      const r = parseMotion(src)
      expect(r.errors, src).toHaveLength(1)
      expect(r.clauses, src).toEqual([])
    }
    expect(parseMotion('scale: 1 → 2 1s repeat 65').errors[0].message).toMatch(/at most 64/)
  })

  it('repeat 0 equals no repeat', () => {
    const a = sc('scale: 1 → 1.08 0.6s linear @1')
    const b = sc('scale: 1 → 1.08 0.6s linear repeat 0 @1')
    expect(keysOf(b.patch, 'scale')).toEqual(keysOf(a.patch, 'scale'))
  })

  it('repeat 3 yoyo writes 4 plays as plain keys that rest on the start value', () => {
    const r = sc('scale: 1 → 1.08 0.6s ease-out repeat 3 yoyo @1')
    expect(r.violations).toEqual([])
    const ks = keysOf(r.patch, 'scale')
    expect(ks.map((k) => k.frame)).toEqual([30, 48, 66, 84, 102])
    expect(ks.map((k) => k.value)).toEqual([1, 1.08, 1, 1.08, 1])
    expect(ks.every((k) => k.hold === undefined)).toBe(true)
  })

  it('forever on a 2 s clip fills to the clip end and is not a violation', () => {
    const clip = createTextClip({ trackId: 't', name: 'big', startFrame: 0, durationFrames: 60, text: { content: '72%' } })
    const r = motionPatch(clip, one('scale: 1 → 1.2 0.5s linear repeat forever yoyo'), ctx({ sceneDurationFrames: 60 }))
    expect(r.violations).toEqual([])
    const ks = keysOf(r.patch, 'scale')
    expect(Math.max(...ks.map((k) => k.frame))).toBeLessThanOrEqual(59)
    expect(ks.length).toBeGreaterThan(3)
  })

  it('reports a repeat cut at the clip end', () => {
    const r = sc('scale: 1 → 2 1s linear repeat 10 @2')
    expect(r.violations.map((v) => v.message).join()).toMatch(/repeat cut at the clip end after \d+ cycles/)
  })

  it('repeats a colour channel with vec keys', () => {
    const r = sc('color: #ff0000 → #0000ff 0.5s linear repeat 1 yoyo')
    const track = r.patch.keyframes!.channels.color!.keys
    expect(track.map((k) => k.frame)).toEqual([0, 15, 30])
    expect(track[2]!.vec).toEqual(track[0]!.vec)
  })

  it('a following @> waits for the whole repeat', () => {
    const r = sc('scale: 1 → 2 0.5s linear repeat 2 yoyo; opacity: 0 → 1 0.2s @>')
    expect(frames(r.patch, 'opacity')).toEqual([45, 51])
  })
})

describe('MOT-1: path and progress', () => {
  const D = 'M 100 900 C 300 200 700 200 900 900'
  const sh = (src: string, clip: Clip = rect()) => motionPatch(clip, one(src), ctx())
  const frames = (clip: Partial<Clip>, ch: string) => keysOf(clip, ch).map((k) => k.frame)

  it('parses path: (d) orient offset and the progress channel', () => {
    expect(one(`path: (${D}) orient offset 90deg`)).toEqual([{ kind: 'path', d: D, orient: true, offset: 90 }])
    expect(one(`path: (${D})`)).toEqual([{ kind: 'path', d: D }])
    const [c] = one('progress: 0 → 1 1.2s ease-in-out @0.2')
    expect(c).toMatchObject({ kind: 'channel', channel: 'motion.progress', from: '0', to: '1', dur: 1.2, at: 0.2 })
  })

  it('rejects a missing, invalid or element-referencing path with a readable error', () => {
    expect(parseMotion('path: orient').errors[0]!.message).toMatch(/path needs \(d\)/)
    expect(parseMotion('path: ()').errors[0]!.message).toMatch(/path needs \(d\)/)
    expect(parseMotion('path: (hello world)').errors[0]!.message).toMatch(/not valid SVG path data/)
    expect(parseMotion('path: #curve').errors[0]!.message).toMatch(/cannot point at an element/)
    expect(parseMotion(`path: (${D}) offset 90deg`).errors[0]!.message).toMatch(/needs "orient"/)
    expect(parseMotion(`path: (${D}) spin`).errors[0]!.message).toMatch(/unknown path option/)
  })

  it('lowers to Clip.motionPath plus two native progress keys', () => {
    const r = sh(`path: (${D}) orient; progress: 0 → 1 1s ease-in-out @0.2`)
    expect(r.violations).toEqual([])
    expect(r.patch.motionPath).toEqual({ d: D, orient: true })
    expect(keysOf(r.patch, 'motion.progress').map((k) => [k.frame, k.value])).toEqual([
      [6, 0],
      [36, 1],
    ])
  })

  it('a path with a second subpath still applies but reports it', () => {
    const r = sh('path: (M 0 0 L 100 0 M 5 5 L 9 9)')
    expect(r.patch.motionPath?.d).toBe('M 0 0 L 100 0 M 5 5 L 9 9')
    expect(r.violations.map((v) => v.message).join()).toMatch(/more than one subpath/)
  })

  it('a path clause does not break @< placement of the clauses around it', () => {
    const r = sh(`opacity: 0 → 1 0.5s; path: (${D}); progress: 0 → 1 1s @>`)
    expect(frames(r.patch, 'motion.progress')).toEqual([15, 45])
  })

  it('emits end to end: the element clip carries the path and keys', () => {
    const scene = { ...statScene(), root: { ...statScene().root, children: [{ ...statScene().root.children[0]!, motion: `path: (${D}) orient; progress: 0 → 1 1s` }] } }
    const r = emitScene(scene as never, { fps: FPS } as never)
    const all = JSON.stringify(r)
    expect(all).toContain('"motionPath"')
    expect(all).toContain('"motion.progress"')
  })
})

describe('MOT-3: split / each write one textAnimator', () => {
  const src = 'split: word 2f from center ease quad-out; each: opacity: 0 → 1 0.4s expo-out; each: y: 0.6 → 0 0.5s expo-out; each: rotation: -20 → 0 0.5s expo-out'

  it('parses split and each clauses', () => {
    const r = parseMotion(src)
    expect(r.errors).toEqual([])
    expect(r.clauses[0]).toEqual({ kind: 'split', unit: 'word', frames: 2, from: 'center', ease: 'quad-out' })
    expect(r.clauses[1]).toMatchObject({ kind: 'each', channel: 'opacity', from: 0, to: 1, dur: 0.4, ease: 'expo-out' })
    expect(r.clauses[2]).toMatchObject({ kind: 'each', channel: 'dy', from: 0.6, to: 0 })
    expect((r.clauses[3] as { from: number }).from).toBeCloseTo((-20 * Math.PI) / 180)
  })

  it('writes the animator, not channel keys, with the fade fallback preset', () => {
    const { patch, violations } = motionPatch(text(), one(src), ctx())
    expect(violations).toEqual([])
    expect(patch.keyframes).toBeUndefined()
    expect(patch.textAnimator).toMatchObject({
      unit: 'word',
      preset: 'fade',
      staggerFrames: 2,
      durationFrames: 15,
      from: 'center',
      staggerEase: 'quad-out',
      ease: 'expo-out',
      tween: { opacity: [0, 1], dy: [0.6, 0] },
    })
  })

  it('leaves a plain preset-free default (from start) off the animator and ordinary clauses still key the clip', () => {
    const { patch } = motionPatch(text(), one('split: char 1f; each: scale: 0.5 → 1 0.3s; in: fade-in 0.3s'), ctx())
    expect(patch.textAnimator?.from).toBeUndefined()
    expect(patch.textAnimator?.staggerEase).toBeUndefined()
    expect(patch.textAnimator?.unit).toBe('char')
    expect(keysOf(patch, 'opacity').length).toBe(2)
  })

  it('reports split on a non-text node and a split with no each', () => {
    const bad = motionPatch(rect(), one('split: word 2f; each: opacity: 0 → 1 0.4s'), ctx())
    expect(bad.patch.textAnimator).toBeUndefined()
    expect(bad.violations[0]?.message).toMatch(/text element/)
    const lone = motionPatch(text(), one('split: word 2f'), ctx())
    expect(lone.patch.textAnimator).toBeUndefined()
    expect(lone.violations[0]?.message).toMatch(/each:/)
  })

  it('rejects malformed clauses with a suggestion', () => {
    expect(parseMotion('each: bogus: 0 → 1 0.4s').errors[0]?.message).toMatch(/unknown each channel/)
    expect(parseMotion('each: opacity: 0 → 1').errors[0]?.message).toMatch(/each is/)
    expect(parseMotion('split: sentence 2f').errors[0]?.message).toMatch(/split is/)
    expect(parseMotion('split: word 2f from middle').errors[0]?.message).toMatch(/unknown split origin/)
    expect(parseMotion('each: opacity: 0 → 1 0.4s wobble').errors[0]?.message).toMatch(/unknown each ease/)
  })

  it('warns when the each clauses disagree on ease', () => {
    const { violations, patch } = motionPatch(text(), one('split: word 2f; each: opacity: 0 → 1 0.4s quad-out; each: y: 1 → 0 0.4s linear'), ctx())
    expect(patch.textAnimator).toBeDefined()
    expect(violations[0]?.message).toMatch(/one ease/)
  })

  it('emits a textAnimator on a converted text element and a violation on a box', () => {
    const scene = statScene()
    scene.root.children[1].children[0].motion = 'split: char 1f from end; each: opacity: 0 → 1 0.2s'
    const { clip, report } = emitScene(scene, { fps: FPS })
    const project = clip.compound?.project as { tracks: Array<{ id: string; order: number }>; clips: Record<string, Clip[]> }
    const all = project.tracks.flatMap((t) => project.clips[t.id] ?? [])
    expect(report.violations ?? []).toEqual([])
    expect(JSON.stringify(all)).toContain('"textAnimator"')
  })
})

describe('MOT-5: scramble clause', () => {
  const src = 'scramble: 0 → 1 0.9s linear @0.2 chars=upper seed=7'

  it('parses the channel alias and the chars / seed tokens before or after @', () => {
    for (const s of [src, 'scramble: 0 → 1 0.9s linear chars=upper seed=7 @0.2']) {
      const r = parseMotion(s)
      expect(r.errors, s).toEqual([])
      expect(r.clauses[0]).toMatchObject({ kind: 'channel', channel: 'text.scramble', from: '0', to: '1', dur: 0.9, ease: 'linear', at: 0.2, scramble: { chars: 'upper', seed: 7 } })
    }
  })

  it('keys text.scramble and also sets textScramble', () => {
    const { patch, violations } = motionPatch(text(), one(src), ctx())
    expect(violations).toEqual([])
    expect(patch.textScramble).toEqual({ charset: 'upper', seed: 7 })
    const ks = keysOf(patch, 'text.scramble')
    expect(ks).toHaveLength(2)
    expect(ks[0]!.value).toBe(0)
    expect(ks[1]!.value).toBe(1)
    expect(ks[1]!.frame - ks[0]!.frame).toBe(27)
  })

  it('a literal charset passes through; no chars= defaults to upper', () => {
    expect(motionPatch(text(), one('scramble: 0 → 1 0.5s chars=ABC123'), ctx()).patch.textScramble).toEqual({ charset: 'ABC123' })
    expect(motionPatch(text(), one('scramble: 0 → 1 0.5s'), ctx()).patch.textScramble).toEqual({ charset: 'upper' })
  })

  it('refuses a charset over 64 characters, an unknown preset and a bad seed', () => {
    expect(parseMotion(`scramble: 0 → 1 0.5s chars=${'x'.repeat(65)}`).errors[0]!.message).toMatch(/at most 64/)
    const e = parseMotion('scramble: 0 → 1 0.5s chars=uper').errors[0]!
    expect(e.message).toMatch(/unknown charset preset/)
    expect(e.substitute).toBe('chars=upper')
    expect(parseMotion('scramble: 0 → 1 0.5s seed=abc').errors).toHaveLength(1)
    expect(parseMotion('x: 0 → 1 0.5s chars=upper').errors[0]!.message).toMatch(/scramble/)
  })

  it('is a violation on a shape, and writes nothing', () => {
    const { patch, violations } = motionPatch(rect(), one(src), ctx())
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toMatch(/text element/)
    expect(patch).toEqual({})
  })
});

// MOT-9: every refusal the new clauses can give names the form it wanted (one line) and, where a nearest name exists, the substitute.
describe('MOT-1..8 error messages (table)', () => {
  const cases: Array<[input: string, message: string, substitute?: string]> = [
    ['path: #x', 'path cannot point at an element yet; write the path data: "path: (M 100 900 C 300 200 700 200 900 900) orient"'],
    ['path: M 0 0', 'path needs (d): "path: (M 100 900 C 300 200 700 200 900 900) [orient] [offset <n>deg]" with d in stage px'],
    ['path: (M 0 0 L 9 9) spin', 'unknown path option "spin"', 'orient'],
    ['path: (M 0 0 L 9 9) offset 90deg', '"offset" turns the clip along the path, so it needs "orient"'],
    ['split: sentence 2f', 'split is "split: char|word|line <n>f|<n>ms [from start|end|center|edges|random] [ease <name>]"', 'split: word 2f'],
    ['split: word 2f from middle', 'unknown split origin "middle"', 'center'],
    ['each: z: 0 → 1 0.5s', 'unknown each channel "z"', 'x'],
    ['each: y: 0 → 1', 'each is "each: <opacity|x|y|scale|rotation|blur>: <from> → <to> <dur> [<ease>]", e.g. "each: y: 0.6 → 0 0.5s back-out"'],
    ['stagger: children 3f from middle', 'unknown stagger origin "middle"', 'center'],
    ['stagger: children 3f grid 0', 'grid is a column count from 1 to 64'],
    ['y: 0 → 1 0.4s @!', 'the "@" time must be seconds (@1.2, @-0.3), relative to the previous clause (@<, @>0.2) or a label (@intro+0.3)'],
    ['label: 1bad', 'a label is "label: <name> [@<at>]"; a name starts with a letter and has letters, digits and "_"'],
    ['y: 0 → 1 0.4s repeat 99', 'repeat is at most 64; use "repeat forever" to fill the clip'],
    ['y: 0 → 1 0.4s yoyo', '"yoyo" needs a repeat count: add "repeat 3" or "repeat forever"'],
    ['y: 0 → 1 0.4s repeat 2 repeat-delay x', 'repeat-delay is a duration like 0.2s'],
    ['in: fade-in 0.3s repeat 2', 'repeat does not apply to a preset; repeat a "<channel>: <from> → <to>" clause'],
    ['opacity: hold 0.4s repeat 2', '"repeat" does not apply to a hold; repeat a "<from> → <to>" clause'],
    ['scramble: 0 → 1 0.5s chars=uper', 'unknown charset preset "uper"', 'chars=upper'],
    ['opacity: 0 → 1 0.4s chars=upper', '"chars=" belongs to a "scramble:" clause'],
    ['opacity: 0 → 1 0.4s quad-ot', 'unknown ease "quad-ot"', 'quad-out'],
    ['opacity: 0 → 1 0.4s steps(0)', 'steps(n) takes a whole number of jumps from 1 to 64', 'steps(4)'],
    ['skwX: 0 → 12deg 0.4s', 'unknown channel "skwX"', 'skewX'],
    ['progres: 0 → 1 1s', 'unknown channel "progres"', 'progress'],
  ]
  for (const [input, message, substitute] of cases) {
    it(`${input} -> ${message.slice(0, 48)}`, () => {
      const { errors, clauses } = parseMotion(input)
      expect(clauses).toEqual([])
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe(message)
      expect(errors[0].substitute).toBe(substitute)
      expect(errors[0].message.includes('\n')).toBe(false)
    })
  }
})
