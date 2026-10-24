import { describe, expect, it } from 'vitest'
import {
  normalizeKeys,
  remapKeyframes,
  sampleChannel,
  sampleKeyframes,
  splitKeyframes,
  hasKeyframes,
  typeDefaultTransform,
} from './keyframes'
import { DEFAULT_SHAPE_TRANSFORM, DEFAULT_TEXT_TRANSFORM } from './textAnimation'
import type { ClipKeyframes, Keyframe, Transform } from '../types'

const BASE: Transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }

function key(frame: number, value: number, extra: Partial<Keyframe> = {}): Keyframe {
  return { id: `k${frame}`, frame, value, easing: 'linear', ...extra }
}

function kf(channels: ClipKeyframes['channels']): ClipKeyframes {
  return { channels }
}

describe('normalizeKeys — unvalidated input battery', () => {
  it('drops non-finite frames and values, floors frames, sorts ascending', () => {
    const out = normalizeKeys([
      key(10, 1),
      key(NaN, 2),
      key(5, Infinity),
      key(2.9, 3),
      key(-Infinity, 4),
      key(0, 0),
    ])
    expect(out.map((k) => [k.frame, k.value])).toEqual([
      [0, 0],
      [2, 3],
      [10, 1],
    ])
  })

  it('collapses duplicate frames to the LAST key in source order', () => {
    const out = normalizeKeys([key(4, 1, { id: 'old' }), key(4, 9, { id: 'new' })])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('new')
    expect(out[0].value).toBe(9)
  })

  it('tolerates garbage entries and non-arrays', () => {
    expect(normalizeKeys(undefined)).toEqual([])
    expect(normalizeKeys([null as unknown as Keyframe, 'x' as unknown as Keyframe])).toEqual([])
  })

  it('never mutates its input', () => {
    const input = [key(3, 1), key(1, 2)]
    const snapshot = JSON.stringify(input)
    normalizeKeys(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('sampleChannel', () => {
  it('returns undefined for no keys', () => {
    expect(sampleChannel([], 5)).toBeUndefined()
  })

  it('a single key is a constant everywhere', () => {
    expect(sampleChannel([key(10, 0.7)], -100)).toBe(0.7)
    expect(sampleChannel([key(10, 0.7)], 10)).toBe(0.7)
    expect(sampleChannel([key(10, 0.7)], 1e6)).toBe(0.7)
  })

  it('holds the first value before the first key and the last after the last — never extrapolates', () => {
    const keys = [key(10, 1), key(20, 3)]
    expect(sampleChannel(keys, 0)).toBe(1)
    expect(sampleChannel(keys, -50)).toBe(1)
    expect(sampleChannel(keys, 20)).toBe(3)
    expect(sampleChannel(keys, 999)).toBe(3)
  })

  it('interpolates linearly by default', () => {
    expect(sampleChannel([key(0, 0), key(10, 1)], 5)).toBeCloseTo(0.5)
    expect(sampleChannel([key(0, 2), key(10, 4)], 2.5)).toBeCloseTo(2.5)
  })

  it('uses the DESTINATION key’s easing for the segment leading into it', () => {
    // quad-in at t=0.5 is 0.25
    const keys = [key(0, 0), key(10, 1, { easing: 'quad-in' })]
    expect(sampleChannel(keys, 5)).toBeCloseTo(0.25)
    // The first key's own easing is irrelevant.
    const keys2 = [key(0, 0, { easing: 'quad-in' }), key(10, 1)]
    expect(sampleChannel(keys2, 5)).toBeCloseTo(0.5)
  })

  it('an unknown easing name reads as linear instead of throwing', () => {
    const keys = [key(0, 0), key(10, 1, { easing: 'nope' as Keyframe['easing'] })]
    expect(sampleChannel(keys, 5)).toBeCloseTo(0.5)
  })

  it('a hold key steps: its value persists until the next key', () => {
    const keys = [key(0, 0, { hold: true }), key(10, 1)]
    expect(sampleChannel(keys, 9)).toBe(0)
    expect(sampleChannel(keys, 10)).toBe(1)
  })

  it('reads unsorted / duplicate input the same as clean input', () => {
    const clean = [key(0, 0), key(10, 1)]
    const dirty = [key(10, 1), key(0, 99), key(0, 0)]
    for (const f of [0, 3, 7, 10]) {
      expect(sampleChannel(dirty, f)).toBe(sampleChannel(clean, f))
    }
  })
})

describe('sampleKeyframes', () => {
  it('returns an empty sample for undefined / empty keyframes', () => {
    expect(sampleKeyframes(undefined, 0, BASE)).toEqual({})
    expect(sampleKeyframes(kf({}), 0, BASE)).toEqual({})
    expect(sampleKeyframes(kf({ scale: { source: { kind: 'keyframes' }, keys: [] } }), 0, BASE)).toEqual({})
  })

  it('carries NO transform when only non-transform channels are keyed', () => {
    const s = sampleKeyframes(kf({ opacity: { source: { kind: 'keyframes' }, keys: [key(0, 0.4)] } }), 0, BASE)
    expect(s.transform).toBeUndefined()
    expect(s.opacity).toBe(0.4)
  })

  it('overrides only the keyed transform channels and never mutates base', () => {
    const base: Transform = { ...BASE, anchor: { x: 0.5, y: 0.5 } }
    const s = sampleKeyframes(
      kf({
        x: { source: { kind: 'keyframes' }, keys: [key(0, 0.1), key(10, 0.9)] },
        rotation: { source: { kind: 'keyframes' }, keys: [key(0, 1)] },
      }),
      5,
      base,
    )
    expect(s.transform).toEqual({ ...BASE, x: 0.5, rotation: 1 })
    expect(s.transform).not.toBe(base)
    expect(s.transform!.anchor).not.toBe(base.anchor)
    expect(base).toEqual(BASE)
  })

  it('floors scale channels above zero so the clip stays selectable', () => {
    const s = sampleKeyframes(kf({ scale: { source: { kind: 'keyframes' }, keys: [key(0, 0)] } }), 0, BASE)
    expect(s.transform!.scale).toBeGreaterThan(0)
  })

  it('clamps opacity, volume and cornerRadius to their ranges', () => {
    const s = sampleKeyframes(
      kf({
        opacity: { source: { kind: 'keyframes' }, keys: [key(0, 2)] },
        volume: { source: { kind: 'keyframes' }, keys: [key(0, -1)] },
        cornerRadius: { source: { kind: 'keyframes' }, keys: [key(0, 9)] },
      }),
      0,
      BASE,
    )
    expect(s.opacity).toBe(1)
    expect(s.volume).toBe(0)
    expect(s.cornerRadius).toBe(0.5)
  })

  it('an unknown source kind still samples the keys (forward compatibility)', () => {
    const track = { source: { kind: 'track' }, keys: [key(0, 0.25)] } as unknown as ClipKeyframes['channels']['x']
    const s = sampleKeyframes(kf({ x: track }), 0, BASE)
    expect(s.transform!.x).toBe(0.25)
  })

  it('tolerates a corrupt channels object', () => {
    expect(sampleKeyframes({ channels: 'nope' } as unknown as ClipKeyframes, 0, BASE)).toEqual({})
    expect(sampleKeyframes({ channels: { x: 'bad' } } as unknown as ClipKeyframes, 0, BASE)).toEqual({})
  })
})

describe('hasKeyframes', () => {
  it('is false for undefined, empty, and channels with only unusable keys', () => {
    expect(hasKeyframes(undefined)).toBe(false)
    expect(hasKeyframes(kf({}))).toBe(false)
    expect(hasKeyframes(kf({ x: { source: { kind: 'keyframes' }, keys: [key(NaN, 1)] } }))).toBe(false)
  })
  it('is true with one usable key', () => {
    expect(hasKeyframes(kf({ y: { source: { kind: 'keyframes' }, keys: [key(3, 1)] } }))).toBe(true)
  })
})

describe('typeDefaultTransform', () => {
  it('matches the renderer defaults for text and shape', () => {
    expect(typeDefaultTransform('text')).toBe(DEFAULT_TEXT_TRANSFORM)
    expect(typeDefaultTransform('shape')).toBe(DEFAULT_SHAPE_TRANSFORM)
  })
  it('is the identity for media (the renderer’s unknown-content-size path)', () => {
    expect(typeDefaultTransform('video')).toEqual(BASE)
    expect(typeDefaultTransform('image')).toEqual(BASE)
  })
})

describe('remapKeyframes', () => {
  const src = kf({ x: { source: { kind: 'keyframes' }, keys: [key(0, 0), key(10, 1), key(20, 2)] } })

  it('passes undefined through and returns the same object for a no-op', () => {
    expect(remapKeyframes(undefined, { shift: 5 })).toBeUndefined()
    expect(remapKeyframes(src, {})).toBe(src)
    expect(remapKeyframes(src, { shift: 0, scale: 1 })).toBe(src)
  })

  it('shifts every frame and keeps keys that land outside 0..duration', () => {
    const out = remapKeyframes(src, { shift: -15 })!
    expect(out.channels.x!.keys.map((k) => k.frame)).toEqual([-15, -5, 5])
    // Values ride along untouched.
    expect(out.channels.x!.keys.map((k) => k.value)).toEqual([0, 1, 2])
  })

  it('scales frames, rounds to integers, and collapses collisions to the later key', () => {
    const out = remapKeyframes(src, { scale: 0.05 })! // 0,10,20 → 0,0.5→1,1
    expect(out.channels.x!.keys.map((k) => [k.frame, k.value])).toEqual([
      [0, 0],
      [1, 2],
    ])
  })

  it('ignores a non-positive or non-finite scale', () => {
    expect(remapKeyframes(src, { scale: 0 })).toBe(src)
    expect(remapKeyframes(src, { scale: NaN })).toBe(src)
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(src)
    remapKeyframes(src, { shift: 3, scale: 2 })
    expect(JSON.stringify(src)).toBe(before)
  })
})

describe('splitKeyframes', () => {
  const src = kf({ scale: { source: { kind: 'keyframes' }, keys: [key(0, 1), key(30, 2)] } })

  it('passes undefined through', () => {
    expect(splitKeyframes(undefined, 10)).toEqual({ left: undefined, right: undefined })
  })

  it('inserts a boundary key on both halves carrying the curve’s value at the cut', () => {
    const { left, right } = splitKeyframes(src, 12)
    const l = left!.channels.scale!.keys
    const r = right!.channels.scale!.keys
    expect(l.map((k) => k.frame)).toEqual([0, 12])
    expect(l[1].value).toBeCloseTo(1.4)
    expect(r.map((k) => k.frame)).toEqual([0, 18])
    expect(r[0].value).toBeCloseTo(1.4)
    expect(r[1].value).toBe(2)
  })

  it('is a visual no-op: sampling the halves reproduces the original curve', () => {
    const { left, right } = splitKeyframes(src, 12)
    for (let f = 0; f < 30; f++) {
      const expected = sampleChannel(src.channels.scale!.keys, f)!
      const actual =
        f < 12
          ? sampleChannel(left!.channels.scale!.keys, f)!
          : sampleChannel(right!.channels.scale!.keys, f - 12)!
      expect(actual).toBeCloseTo(expected, 10)
    }
  })

  it('a key exactly on the cut goes to both halves', () => {
    const exact = kf({ x: { source: { kind: 'keyframes' }, keys: [key(0, 0), key(12, 0.5, { id: 'mid' }), key(30, 1)] } })
    const { left, right } = splitKeyframes(exact, 12)
    expect(left!.channels.x!.keys.map((k) => k.id)).toEqual(['k0', 'mid'])
    expect(right!.channels.x!.keys.map((k) => [k.id, k.frame])).toEqual([
      ['mid', 0],
      ['k30', 18],
    ])
  })

  it('the left boundary key uses the incoming segment’s easing so the ease into the cut survives', () => {
    const eased = kf({ x: { source: { kind: 'keyframes' }, keys: [key(0, 0), key(30, 1, { easing: 'quad-in' })] } })
    const { left } = splitKeyframes(eased, 12)
    expect(left!.channels.x!.keys[1].easing).toBe('quad-in')
  })

  it('a hold segment stays held on both sides of the cut', () => {
    const held = kf({ x: { source: { kind: 'keyframes' }, keys: [key(0, 0, { hold: true }), key(30, 1)] } })
    const { left, right } = splitKeyframes(held, 12)
    expect(left!.channels.x!.keys[1].value).toBe(0)
    expect(right!.channels.x!.keys[0].hold).toBe(true)
    expect(sampleChannel(right!.channels.x!.keys, 10)).toBe(0)
    expect(sampleChannel(right!.channels.x!.keys, 18)).toBe(1)
  })
})
