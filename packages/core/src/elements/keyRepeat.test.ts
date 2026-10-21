import { describe, it, expect } from 'vitest'
import type { Clip, Keyframe, TextAnimationEasing } from '../types'
import { createTextClip } from './text'
import { sampleChannel } from '../resolver/keyframes'
import { repeatKeysPatch } from './keyRepeat'

const key = (frame: number, value: number, easing: TextAnimationEasing = 'linear', more: Partial<Keyframe> = {}): Keyframe => ({
  id: `k${frame}`,
  frame,
  value,
  easing,
  ...more,
})

function clipWith(keys: Keyframe[], durationFrames = 120): Clip {
  const clip = createTextClip({ trackId: 't', name: 'c', startFrame: 0, durationFrames, text: { content: 'x' } })
  return { ...clip, keyframes: { channels: { scale: { source: { kind: 'keyframes' }, keys } } } }
}

const keysOf = (clip: Clip, patch: Partial<Clip>): Keyframe[] => (patch.keyframes ?? clip.keyframes)!.channels.scale!.keys

describe('repeatKeysPatch', () => {
  it('repeat 0 writes nothing', () => {
    const clip = clipWith([key(0, 1), key(18, 1.08, 'quad-out')])
    const r = repeatKeysPatch(clip, 'scale', { from: 0, to: 18, count: 0 })
    expect(r.patch).toEqual({})
    expect(r.added).toBe(0)
  })

  it('a plain repeat copies the span with a one-frame snap and holds the key before each restart', () => {
    const clip = clipWith([key(0, 1), key(18, 1.08, 'quad-out')])
    const r = repeatKeysPatch(clip, 'scale', { from: 0, to: 18, count: 2 })
    const keys = keysOf(clip, r.patch)
    expect(keys.map((k) => [k.frame, k.value, k.hold === true])).toEqual([
      [0, 1, false],
      [18, 1.08, true],
      [19, 1, false],
      [37, 1.08, true],
      [38, 1, false],
      [56, 1.08, false],
    ])
    expect(keys[3]!.easing).toBe('quad-out')
    expect(r.cycles).toBe(2)
    expect(new Set(keys.map((k) => k.id)).size).toBe(keys.length)
    expect(sampleChannel(keys, 18)).toBe(1.08)
    expect(sampleChannel(keys, 19)).toBe(1)
  })

  it('a yoyo with an even count returns to the start and mirrors an ease-out exactly', () => {
    const clip = clipWith([key(0, 1), key(30, 2, 'cubic-out')])
    const r = repeatKeysPatch(clip, 'scale', { from: 0, to: 30, count: 2, yoyo: true })
    const keys = keysOf(clip, r.patch)
    expect(keys.map((k) => [k.frame, k.value])).toEqual([
      [0, 1],
      [30, 2],
      [60, 1],
      [90, 2],
    ])
    expect(keys[2]!.easing).toBe('cubic-in')
    expect(sampleChannel(keys, 60)).toBe(1)
    for (const d of [1, 4, 8, 13, 19, 25, 29]) {
      expect(sampleChannel(keys, 30 + d)!).toBeCloseTo(sampleChannel(keys, 30 - d)!, 9)
    }
  })

  it('a yoyo with a gap rests on the turning value', () => {
    const clip = clipWith([key(0, 0), key(10, 1)])
    const r = repeatKeysPatch(clip, 'scale', { from: 0, to: 10, count: 1, yoyo: true, gapFrames: 5 })
    const keys = keysOf(clip, r.patch)
    expect(keys.map((k) => [k.frame, k.value])).toEqual([
      [0, 0],
      [10, 1],
      [15, 1],
      [25, 0],
    ])
    expect(sampleChannel(keys, 12)).toBe(1)
  })

  it('reverses a custom bezier and keeps a spring', () => {
    const clip = clipWith([key(0, 0), key(10, 1, 'linear', { easingBezier: [0.1, 0.2, 0.3, 0.4] }), key(20, 0, 'linear', { spring: { stiffness: 100, damping: 10 } })])
    const r = repeatKeysPatch(clip, 'scale', { from: 0, to: 20, count: 1, yoyo: true })
    const keys = keysOf(clip, r.patch)
    // Reversed order: value 0 (frame 20+20), then the mirror of the spring segment, then of the bezier one.
    const back = keys.filter((k) => k.frame > 20)
    expect(back.map((k) => [k.frame, k.value])).toEqual([
      [30, 1],
      [40, 0],
    ])
    expect(back[0]!.spring).toEqual({ stiffness: 100, damping: 10 })
    expect(back[1]!.easingBezier).toEqual([0.7, 0.6, 0.9, 0.8])
  })

  it('cuts at the clip end, keeping whole keys', () => {
    const clip = clipWith([key(0, 1), key(18, 2)], 50)
    const r = repeatKeysPatch(clip, 'scale', { from: 0, to: 18, count: 10 })
    const keys = keysOf(clip, r.patch)
    expect(Math.max(...keys.map((k) => k.frame))).toBeLessThanOrEqual(49)
    expect(r.cut).toBe(true)
    expect(r.cycles).toBe(1)
  })

  it('forever fills a 2 s clip at 30 fps without a cut', () => {
    const clip = clipWith([key(0, 1), key(15, 2)], 60)
    const r = repeatKeysPatch(clip, 'scale', { from: 0, to: 15, count: Infinity, yoyo: true })
    const keys = keysOf(clip, r.patch)
    expect(keys.map((k) => k.frame)).toEqual([0, 15, 30, 45])
    expect(r.cut).toBe(false)
    expect(r.cycles).toBe(2)
  })

  it('stops before the key cap', () => {
    const clip = clipWith([key(0, 1), key(1, 2)], 600)
    const r = repeatKeysPatch(clip, 'scale', { from: 0, to: 1, count: 50, maxKeys: 10 })
    expect(r.added).toBeLessThanOrEqual(10)
    expect(r.capped).toBe(true)
  })

  it('copies colour keys with their vec', () => {
    const base = createTextClip({ trackId: 't', name: 'c', startFrame: 0, durationFrames: 60, text: { content: 'x' } })
    const clip: Clip = {
      ...base,
      keyframes: {
        channels: {
          color: {
            source: { kind: 'keyframes' },
            keys: [
              { id: 'a', frame: 0, value: 0, vec: [1, 0, 0, 1], easing: 'linear' },
              { id: 'b', frame: 10, value: 0, vec: [0, 0, 1, 1], easing: 'linear' },
            ],
          },
        },
      },
    }
    const r = repeatKeysPatch(clip, 'color', { from: 0, to: 10, count: 1, yoyo: true })
    const keys = r.patch.keyframes!.channels.color!.keys
    expect(keys.map((k) => k.vec)).toEqual([[1, 0, 0, 1], [0, 0, 1, 1], [1, 0, 0, 1]])
  })
})
