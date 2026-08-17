import { describe, expect, it } from 'vitest'
import type { Clip } from '../types'
import {
  applyAnimationEasing,
  evaluateAnimationChannel,
  resolveTextAnimation,
} from './evaluate'
import { normalizeAnimationChannels, normalizeTextAnimation } from './normalize'

function textClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'text-1',
    trackId: 'elements-1',
    type: 'text',
    name: 'Title',
    startFrame: 20,
    durationFrames: 60,
    sourceStartFrame: 0,
    sourceDurationFrames: 60,
    content: 'Hello',
    opacity: 1,
    ...overrides,
  }
}

describe('animation evaluation', () => {
  it('evaluates named easing deterministically', () => {
    expect(applyAnimationEasing(0.5, 'linear')).toBe(0.5)
    expect(applyAnimationEasing(0.5, 'ease-in')).toBe(0.25)
    expect(applyAnimationEasing(0.5, 'ease-out')).toBe(0.75)
    expect(applyAnimationEasing(0.5, 'ease-in-out')).toBe(0.5)
  })

  it('normalizes all stored animation timing to integer frames', () => {
    expect(normalizeTextAnimation({
      in: 'fade',
      durationFrames: 4.6,
      inDurationFrames: 0.2,
    })).toMatchObject({ durationFrames: 5, inDurationFrames: 1 })

    expect(normalizeAnimationChannels([{
      property: 'opacity',
      keyframes: [{ frame: 2.6, value: 0.5 }],
    }])[0].keyframes[0].frame).toBe(3)
  })

  it('interpolates unsorted keyframes and holds endpoint values', () => {
    const channel = {
      property: 'opacity' as const,
      keyframes: [
        { frame: 10, value: 1, easing: 'linear' as const },
        { frame: 0, value: 0 },
      ],
    }

    expect(evaluateAnimationChannel(channel, -5)).toBe(0)
    expect(evaluateAnimationChannel(channel, 5)).toBe(0.5)
    expect(evaluateAnimationChannel(channel, 20)).toBe(1)
  })

  it('resolves custom opacity and transform channels at clip-relative frames', () => {
    const resolved = resolveTextAnimation(textClip({
      animations: [
        { property: 'opacity', keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 1 }] },
        { property: 'transform.x', keyframes: [{ frame: 0, value: 0.2 }, { frame: 10, value: 0.6 }] },
        { property: 'transform.rotation', keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: Math.PI }] },
      ],
    }), 5)

    expect(resolved.opacity).toBe(0.5)
    expect(resolved.transform?.x).toBeCloseTo(0.4)
    expect(resolved.transform?.rotation).toBeCloseTo(Math.PI / 2)
  })

  it('supports fade, slide, pop, typewriter, and pulse presets', () => {
    expect(resolveTextAnimation(textClip({
      textAnimation: { in: 'fade', durationFrames: 10 },
    }), 5).opacity).toBe(0.5)

    const slide = resolveTextAnimation(textClip({
      textAnimation: { in: 'slide', durationFrames: 10, direction: 'left' },
    }), 0)
    expect(slide.opacity).toBe(0)
    expect(slide.transform?.x).toBeCloseTo(0.42)

    const pop = resolveTextAnimation(textClip({
      textAnimation: { in: 'pop', durationFrames: 10 },
    }), 0)
    expect(pop.transform?.scale).toBeCloseTo(0.88)

    expect(resolveTextAnimation(textClip({
      textAnimation: { in: 'typewriter', durationFrames: 10, easing: 'linear' },
    }), 4).content).toBe('He')

    const pulse = resolveTextAnimation(textClip({
      textAnimation: { loop: 'pulse', durationFrames: 20, loopDurationFrames: 20 },
    }), 10)
    expect(pulse.transform?.scale).toBeCloseTo(1.04)
  })

  it('combines entrance and exit phases without using wall-clock time', () => {
    const clip = textClip({
      textAnimation: {
        in: 'fade',
        out: 'fade',
        durationFrames: 10,
        easing: 'linear',
      },
    })

    expect(resolveTextAnimation(clip, 0).opacity).toBe(0)
    expect(resolveTextAnimation(clip, 30).opacity).toBe(1)
    expect(resolveTextAnimation(clip, 59).opacity).toBe(0)
    expect(resolveTextAnimation(clip, 30)).toEqual(resolveTextAnimation(clip, 30))
  })
})
