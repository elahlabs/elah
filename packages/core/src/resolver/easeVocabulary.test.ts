import { describe, expect, it } from 'vitest'
import type { Clip, Keyframe } from '../types'
import { createTextClip } from '../elements/text'
import { setKeysEasingAtFrame, setKeysStepsAtFrame, setKeyframe } from '../elements/keyframes'
import { approxBezierFor } from '../elements/easingPresets'
import { parseMotion, motionPatch, type MotionContext } from '../vector/html/motion'
import { evaluateEasing, TEXT_ANIMATION_EASINGS } from './textAnimation'
import { isValidSteps, sampleChannel, splitKeyframes } from './keyframes'

const NAMES = TEXT_ANIMATION_EASINGS
const key = (frame: number, value: number, extra: Partial<Keyframe> = {}): Keyframe => ({
  id: `k${frame}`,
  frame,
  value,
  easing: 'linear',
  ...extra,
})

describe('ease vocabulary', () => {
  it('has every family and variant', () => {
    for (const fam of ['sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ', 'back', 'elastic', 'bounce']) {
      for (const dir of ['in', 'out', 'in-out']) expect(NAMES).toContain(`${fam}-${dir}`)
    }
  })

  it.each(NAMES.map((n) => [n]))('%s starts at 0 and ends at 1', (name) => {
    expect(evaluateEasing(name, 0)).toBeCloseTo(0, 9)
    expect(evaluateEasing(name, 1)).toBeCloseTo(1, 9)
  })

  it('every -in is the time-reverse complement of its -out, and -in-out is symmetric', () => {
    const ts = [0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.95]
    for (const name of NAMES) {
      if (name.endsWith('-in') && !name.endsWith('-in-out')) {
        const out = name.replace(/-in$/, '-out') as typeof name
        for (const t of ts) expect(evaluateEasing(name, t)).toBeCloseTo(1 - evaluateEasing(out, 1 - t), 9)
      }
      if (name.endsWith('-in-out')) {
        for (const t of ts) expect(evaluateEasing(name, t)).toBeCloseTo(1 - evaluateEasing(name, 1 - t), 9)
        expect(evaluateEasing(name, 0.5)).toBeCloseTo(0.5, 9)
      }
    }
  })

  it('sampleChannel equals evaluateEasing for every name', () => {
    for (const name of NAMES) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const v = sampleChannel([key(0, 0), key(100, 1, { easing: name })], t * 100)
        expect(v).toBeCloseTo(evaluateEasing(name, t), 9)
      }
    }
  })
})

describe('steps', () => {
  it('advances in n equal jumps, jump-end', () => {
    const keys = [key(0, 0), key(100, 1, { steps: 4 })]
    expect(sampleChannel(keys, 0)).toBe(0)
    expect(sampleChannel(keys, 24)).toBe(0)
    expect(sampleChannel(keys, 25)).toBe(0.25)
    expect(sampleChannel(keys, 74)).toBe(0.5)
    expect(sampleChannel(keys, 99)).toBe(0.75)
    expect(sampleChannel(keys, 100)).toBe(1)
  })

  it('beats easing, loses to a bezier', () => {
    expect(sampleChannel([key(0, 0), key(100, 1, { steps: 2, easing: 'quad-in' })], 40)).toBe(0)
    const withBezier = sampleChannel([key(0, 0), key(100, 1, { steps: 2, easingBezier: [0, 0, 1, 1] })], 40)
    expect(withBezier).toBeCloseTo(0.4, 3)
  })

  it('ignores an invalid count', () => {
    for (const bad of [0, 65, 2.5, NaN]) {
      expect(isValidSteps(bad)).toBe(false)
      expect(sampleChannel([key(0, 0), key(100, 1, { steps: bad })], 50)).toBeCloseTo(0.5, 9)
    }
  })

  it('survives a mid-segment split', () => {
    const split = splitKeyframes({ channels: { x: { source: { kind: 'keyframes' }, keys: [key(0, 0), key(100, 1, { steps: 4 })] } } } as never, 40)
    const keys = (split.left?.channels.x as { keys: Keyframe[] }).keys
    expect(keys.find((k) => k.frame === 40)?.steps).toBe(4)
  })

  it('setKeysStepsAtFrame writes and clears; setKeysEasingAtFrame drops it', () => {
    const base = createTextClip({ trackId: 't', name: 'a', startFrame: 0, durationFrames: 100, text: { content: 'x' } })
    const ctx = { stage: { width: 1080, height: 1920 } }
    let clip: Clip = base
    clip = { ...clip, ...setKeyframe(clip, 'opacity', 0, ctx, 0) }
    clip = { ...clip, ...setKeyframe(clip, 'opacity', 50, ctx, 1) }
    const steps = (c: Clip) => (c.keyframes?.channels?.opacity as { keys: Keyframe[] }).keys.find((k) => k.frame === 50)?.steps
    clip = { ...clip, ...setKeysStepsAtFrame(clip, 50, 5) }
    expect(steps(clip)).toBe(5)
    expect(setKeysStepsAtFrame(clip, 50, 99)).toEqual({})
    const eased = { ...clip, ...setKeysEasingAtFrame(clip, 50, 'quart-in-out') }
    expect(steps(eased)).toBeUndefined()
    clip = { ...clip, ...setKeysStepsAtFrame(clip, 50, null) }
    expect(steps(clip)).toBeUndefined()
  })
})

describe('approxBezierFor', () => {
  it('returns an in/out family approximation', () => {
    expect(approxBezierFor('quart-in-out')).toEqual([0.76, 0, 0.24, 1])
    expect(approxBezierFor('elastic-in')).toEqual([0.25, 0.1, 0.25, 1])
  })
})

describe('data-motion aliases and steps', () => {
  const ctx: MotionContext = {
    fps: 30,
    sceneDurationFrames: 120,
    clipStartFrameInScene: 0,
    stage: { width: 1080, height: 1920 },
    baseline: { stage: { width: 1080, height: 1920 } },
  }
  const clip = () => createTextClip({ trackId: 't', name: 'big', startFrame: 0, durationFrames: 120, text: { content: '72%' } })
  const arriving = (src: string): Keyframe => {
    const r = parseMotion(src)
    expect(r.errors).toEqual([])
    const { patch } = motionPatch(clip(), r.clauses, ctx)
    const keys = (patch.keyframes?.channels?.opacity as { keys: Keyframe[] }).keys
    return keys[keys.length - 1]
  }

  it('maps GSAP aliases to stored names', () => {
    expect(arriving('opacity: 0 → 1 1s power2.out').easing).toBe('quad-out')
    expect(arriving('opacity: 0 → 1 1s power4.inOut').easing).toBe('quart-in-out')
    expect(arriving('opacity: 0 → 1 1s sine.out').easing).toBe('sine-out')
    expect(arriving('opacity: 0 → 1 1s quint-in').easing).toBe('quint-in')
  })

  it('writes steps(n) on the arriving key', () => {
    expect(arriving('opacity: 0 → 1 1s steps(4)').steps).toBe(4)
  })

  it('writes steps(n) through a preset ease', () => {
    const r = parseMotion('in: fade-in 0.5s steps(3)')
    expect(r.errors).toEqual([])
    const { patch } = motionPatch(clip(), r.clauses, ctx)
    const keys = (patch.keyframes?.channels?.opacity as { keys: Keyframe[] }).keys
    expect(keys.some((k) => k.steps === 3)).toBe(true)
  })

  it('rejects steps out of range and unknown aliases', () => {
    expect(parseMotion('opacity: 0 → 1 1s steps(0)').errors.length).toBe(1)
    expect(parseMotion('opacity: 0 → 1 1s steps(99)').errors.length).toBe(1)
    expect(parseMotion('opacity: 0 → 1 1s power9.out').errors.length).toBe(1)
  })
})
