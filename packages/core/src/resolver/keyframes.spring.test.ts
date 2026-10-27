import { describe, expect, it } from 'vitest'
import { sampleChannel, segmentProgress } from './keyframes'
import { sourceFrameFor } from './sourceTime'
import { evaluateEasing } from './textAnimation'
import { cubicBezier } from './bezier'
import { findSpringPreset } from '../elements/springPresets'
import { springProgress } from './spring'
import type { Clip, Keyframe } from '../types'

const bouncy = findSpringPreset('bouncy')!.spring

/** A minimal key. `spring` is spread last so a test can override the curve. */
const k = (frame: number, value: number, extra: Partial<Keyframe> = {}): Keyframe => ({
  id: `k${frame}`,
  frame,
  value,
  easing: 'linear',
  ...extra,
})

describe('segmentProgress', () => {
  it('prefers the spring over the bezier and the named easing', () => {
    const key = k(30, 1, { spring: bouncy, easingBezier: [0, 0, 1, 1], easing: 'linear' })
    expect(segmentProgress(key, 0.5)).toBe(springProgress(bouncy, 0.5))
  })

  it('falls through to the bezier with no spring', () => {
    const key = k(30, 1, { easingBezier: [0.2, 0.9, 0.1, 1] })
    expect(segmentProgress(key, 0.5)).toBe(cubicBezier([0.2, 0.9, 0.1, 1], 0.5))
    expect(segmentProgress(key, 0.5)).toBeCloseTo(0.9717994, 6)
  })

  it('falls through to the named easing with neither', () => {
    expect(segmentProgress(k(30, 1, { easing: 'quad-out' }), 0.3)).toBe(evaluateEasing('quad-out', 0.3))
  })

  it('ignores an invalid spring instead of producing NaN', () => {
    // Stored springs are unvalidated — readClip spreads raw clip fields. A
    // broken spring must fall through, not poison the channel.
    const key = k(30, 1, { spring: { stiffness: 'x' } as never, easing: 'quad-in' })
    expect(segmentProgress(key, 0.3)).toBe(evaluateEasing('quad-in', 0.3))
  })
})

describe('sampleChannel with a spring', () => {
  const keys = [k(0, 0), k(30, 10, { spring: bouncy })]

  it('lands exactly on both key values', () => {
    expect(sampleChannel(keys, 0)).toBe(0)
    expect(sampleChannel(keys, 30)).toBe(10)
  })

  it('tracks springProgress across the segment', () => {
    expect(sampleChannel(keys, 15)).toBeCloseTo(10 * springProgress(bouncy, 0.5), 10)
  })

  it('overshoots the destination, which is the point', () => {
    let max = -Infinity
    for (let f = 1; f < 30; f++) max = Math.max(max, sampleChannel(keys, f)!)
    expect(max).toBeGreaterThan(10)
  })

  it('wins over a bezier on the same key', () => {
    const withBezier = [k(0, 0), k(30, 10, { spring: bouncy, easingBezier: [0, 0, 1, 1] })]
    for (let f = 0; f <= 30; f++) expect(sampleChannel(withBezier, f)).toBe(sampleChannel(keys, f))
  })

  it('lets hold on the SOURCE key still win over the spring', () => {
    const held = [k(0, 0, { hold: true }), k(30, 10, { spring: bouncy })]
    expect(sampleChannel(held, 29)).toBe(0)
  })

  it('holds the value outside the keys, spring or not', () => {
    expect(sampleChannel(keys, -5)).toBe(0)
    expect(sampleChannel(keys, 99)).toBe(10)
  })

  it('is unchanged for a key with no spring', () => {
    // The regression guard for every existing number in the engine: with no
    // spring on the destination key, segmentProgress is the old expression.
    const plain = [k(0, 0), k(30, 10, { easing: 'quad-out' })]
    for (let f = 0; f <= 30; f++) {
      expect(sampleChannel(plain, f)).toBeCloseTo(10 * evaluateEasing('quad-out', f / 30), 12)
    }
  })
})

describe('a spring on a time key is a springy speed ramp', () => {
  it('warps the source frame through the spring', () => {
    // sampleChannel is shared by the time remap, so a spring here is a
    // non-linear speed ramp. Linear would be 15 at the midpoint; the bouncy
    // spring has already overshot by then, so the source is further along.
    const clip = {
      id: 'c',
      type: 'video',
      startFrame: 0,
      durationFrames: 31,
      sourceStartFrame: 0,
      sourceDurationFrames: 60,
      keyframes: { channels: { time: { source: { kind: 'keyframes' }, keys: [k(0, 0), k(30, 30, { spring: bouncy })] } } },
    } as unknown as Clip
    expect(sourceFrameFor(clip, 15)).toBe(29)
  })

  it('still clamps inside the trim window', () => {
    const clip = {
      id: 'c',
      type: 'video',
      startFrame: 0,
      durationFrames: 31,
      sourceStartFrame: 0,
      sourceDurationFrames: 20,
      keyframes: { channels: { time: { source: { kind: 'keyframes' }, keys: [k(0, 0), k(30, 30, { spring: bouncy })] } } },
    } as unknown as Clip
    expect(sourceFrameFor(clip, 15)).toBeLessThanOrEqual(19)
  })
})
