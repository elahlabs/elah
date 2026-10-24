import { describe, expect, it } from 'vitest'
import { cubicBezier, isValidBezier, normalizeBezier } from './bezier'
import { sampleChannel } from './keyframes'
import { BEZIER_PRESETS, matchBezierPreset } from '../elements/easingPresets'
import {
  moveKeyframe,
  setKeyframe,
  setKeysBezierAtFrame,
  setKeysEasingAtFrame,
  setKeysHoldAtFrame,
} from '../elements/keyframes'
import type { Clip, Keyframe } from '../types'

describe('cubicBezier', () => {
  it('pins the ends', () => {
    for (const p of BEZIER_PRESETS) {
      expect(cubicBezier(p.bezier, 0)).toBe(0)
      expect(cubicBezier(p.bezier, 1)).toBe(1)
    }
  })

  it('is exact for the linear curve', () => {
    for (const x of [0.1, 0.33, 0.5, 0.9]) expect(cubicBezier([0.25, 0.25, 0.75, 0.75], x)).toBeCloseTo(x, 6)
  })

  it('matches CSS ease-in-out at the midpoint and is symmetric', () => {
    expect(cubicBezier([0.42, 0, 0.58, 1], 0.5)).toBeCloseTo(0.5, 5)
    const a = cubicBezier([0.42, 0, 0.58, 1], 0.2)
    const b = cubicBezier([0.42, 0, 0.58, 1], 0.8)
    expect(a + b).toBeCloseTo(1, 5)
  })

  it('agrees with a brute-force solve for every preset', () => {
    const at = (a1: number, a2: number, t: number) => 3 * (1 - t) ** 2 * t * a1 + 3 * (1 - t) * t * t * a2 + t ** 3
    for (const { bezier: b } of BEZIER_PRESETS) {
      for (const x of [0.05, 0.25, 0.5, 0.75, 0.95]) {
        // Dense scan for t with x(t) ≈ x (x(t) is monotonic for clamped handles).
        let best = 0
        for (let i = 0; i <= 20000; i++) {
          const t = i / 20000
          if (Math.abs(at(b[0], b[2], t) - x) < Math.abs(at(b[0], b[2], best) - x)) best = t
        }
        expect(cubicBezier(b, x)).toBeCloseTo(at(b[1], b[3], best), 3)
      }
    }
  })

  it('overshoots when y handles leave 0..1', () => {
    const peak = Math.max(...Array.from({ length: 99 }, (_, i) => cubicBezier([0.34, 1.56, 0.64, 1], (i + 1) / 100)))
    expect(peak).toBeGreaterThan(1)
  })

  it('clamps x handles, validates tuples', () => {
    expect(normalizeBezier([-1, 0, 2, 1])).toEqual([0, 0, 1, 1])
    expect(isValidBezier([0, 0, 1, 1])).toBe(true)
    expect(isValidBezier([0, 0, 1])).toBe(false)
    expect(isValidBezier([0, NaN, 1, 1])).toBe(false)
    expect(isValidBezier(undefined)).toBe(false)
  })

  it('matches a preset by value', () => {
    expect(matchBezierPreset([0.42, 0, 0.58, 1])?.id).toBe('ease-in-out')
    expect(matchBezierPreset([0.1, 0.2, 0.3, 0.4])).toBeUndefined()
  })
})

describe('sampleChannel with easingBezier', () => {
  const k = (frame: number, value: number, extra: Partial<Keyframe> = {}): Keyframe => ({
    id: `k${frame}`,
    frame,
    value,
    easing: 'linear',
    ...extra,
  })

  it('a bezier wins over the named easing', () => {
    const keys = [k(0, 0), k(10, 100, { easingBezier: [0.42, 0, 1, 1] })]
    const v = sampleChannel(keys, 5)!
    expect(v).toBeCloseTo(100 * cubicBezier([0.42, 0, 1, 1], 0.5), 6)
    expect(v).toBeLessThan(50)
  })

  it('an invalid bezier falls back to the named easing', () => {
    const keys = [k(0, 0), k(10, 100, { easingBezier: [0, NaN, 1, 1] as never })]
    expect(sampleChannel(keys, 5)).toBeCloseTo(50, 6)
  })

  it('hold still steps', () => {
    const keys = [k(0, 0, { hold: true }), k(10, 100, { easingBezier: [0.42, 0, 1, 1] })]
    expect(sampleChannel(keys, 9)).toBe(0)
  })
})

describe('bezier / hold / move writers', () => {
  const ctx = { stage: { width: 1920, height: 1080 } }
  function base(): Clip {
    return {
      id: 'c1',
      trackId: 't1',
      type: 'shape',
      name: 'S',
      startFrame: 0,
      durationFrames: 60,
      sourceStartFrame: 0,
      sourceDurationFrames: 60,
      shapeKind: 'rect',
    }
  }
  function withKeys(): Clip {
    let c = base()
    c = { ...c, ...setKeyframe(c, 'opacity', 0, ctx, 0) }
    c = { ...c, ...setKeyframe(c, 'opacity', 30, ctx, 1) }
    c = { ...c, ...setKeyframe(c, 'x', 30, ctx, 0.8) }
    return c
  }

  it('setKeyframe stores a normalised bezier', () => {
    const c = base()
    const p = setKeyframe(c, 'opacity', 5, ctx, 1, { easingBezier: [-0.5, 0, 1.5, 1] })
    expect(p.keyframes!.channels.opacity!.keys[0]!.easingBezier).toEqual([0, 0, 1, 1])
  })

  it('setKeysBezierAtFrame writes every channel at the frame, or one', () => {
    const c = withKeys()
    const all = { ...c, ...setKeysBezierAtFrame(c, 30, [0.2, 0.9, 0.1, 1]) }
    expect(all.keyframes!.channels.opacity!.keys[1]!.easingBezier).toEqual([0.2, 0.9, 0.1, 1])
    expect(all.keyframes!.channels.x!.keys[0]!.easingBezier).toEqual([0.2, 0.9, 0.1, 1])
    const one = { ...c, ...setKeysBezierAtFrame(c, 30, [0.2, 0.9, 0.1, 1], 'x') }
    expect(one.keyframes!.channels.opacity!.keys[1]!.easingBezier).toBeUndefined()
    const cleared = { ...all, ...setKeysBezierAtFrame(all, 30, null) }
    expect(cleared.keyframes!.channels.x!.keys[0]!.easingBezier).toBeUndefined()
  })

  it('a named easing clears the bezier', () => {
    const c = withKeys()
    const b = { ...c, ...setKeysBezierAtFrame(c, 30, [0.2, 0.9, 0.1, 1]) }
    const e = { ...b, ...setKeysEasingAtFrame(b, 30, 'quad-out') }
    const key = e.keyframes!.channels.opacity!.keys[1]!
    expect(key.easing).toBe('quad-out')
    expect(key.easingBezier).toBeUndefined()
  })

  it('setKeysHoldAtFrame toggles hold', () => {
    const c = withKeys()
    const on = { ...c, ...setKeysHoldAtFrame(c, 0, true) }
    expect(on.keyframes!.channels.opacity!.keys[0]!.hold).toBe(true)
    const off = { ...on, ...setKeysHoldAtFrame(on, 0, false) }
    expect(off.keyframes!.channels.opacity!.keys[0]!.hold).toBeUndefined()
    expect(setKeysHoldAtFrame(c, 7, true)).toEqual({})
  })

  it('moveKeyframe moves one key in frame and value, replacing a key it lands on', () => {
    const c = withKeys()
    const id = c.keyframes!.channels.opacity!.keys[0]!.id
    const m = { ...c, ...moveKeyframe(c, 'opacity', id, 12, 0.4) }
    expect(m.keyframes!.channels.opacity!.keys.map((k) => [k.frame, k.value])).toEqual([
      [12, 0.4],
      [30, 1],
    ])
    const onto = { ...c, ...moveKeyframe(c, 'opacity', id, 30, 0.2) }
    expect(onto.keyframes!.channels.opacity!.keys).toHaveLength(1)
    expect(moveKeyframe(c, 'opacity', 'nope', 3, 1)).toEqual({})
  })
})
