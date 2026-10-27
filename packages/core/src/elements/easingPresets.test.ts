import { describe, it, expect } from 'vitest'
import { TEXT_ANIMATION_EASINGS, evaluateEasing } from '../resolver/textAnimation'
import { BEZIER_PRESETS, reverseBezier, reverseEase } from './easingPresets'

describe('reverseEase', () => {
  it('swaps in and out for every named family, and keeps in-out and linear', () => {
    for (const name of TEXT_ANIMATION_EASINGS as ReadonlyArray<string>) {
      const r = reverseEase(name)
      if (name === 'linear' || name.endsWith('-in-out')) expect(r).toBe(name)
      else expect(r).toBe(name.endsWith('-in') ? name.replace(/-in$/, '-out') : name.replace(/-out$/, '-in'))
      expect((TEXT_ANIMATION_EASINGS as ReadonlyArray<string>).includes(r)).toBe(true)
      expect(reverseEase(r)).toBe(name)
    }
  })

  it('the reverse is the time-mirror: rev(t) = 1 - e(1 - t) for the plain families', () => {
    for (const name of ['sine-out', 'quad-out', 'cubic-out', 'quart-out', 'quint-out', 'expo-out', 'circ-out', 'back-out', 'elastic-out', 'bounce-out']) {
      const rev = reverseEase(name) as never
      for (const t of [0.1, 0.35, 0.5, 0.8]) {
        expect(evaluateEasing(rev, t)).toBeCloseTo(1 - evaluateEasing(name as never, 1 - t), 9)
      }
    }
  })

  it('maps a cubic-bezier to its mirror and back', () => {
    expect(reverseEase('cubic-bezier(0.1,0.2,0.3,0.4)')).toBe('cubic-bezier(0.7,0.6,0.9,0.8)')
    const there = reverseEase('cubic-bezier(0.34,1.56,0.64,1)')
    expect(reverseEase(there)).toBe('cubic-bezier(0.34,1.56,0.64,1)')
    expect(reverseBezier(reverseBezier([0.25, 0.1, 0.25, 1]))).toEqual([0.25, 0.1, 0.25, 1])
  })

  it('swaps the ease-in and ease-out presets and leaves springs and steps alone', () => {
    expect(reverseEase('ease-in')).toBe('ease-out')
    expect(reverseEase('ease-out')).toBe('ease-in')
    expect(reverseEase('ease-in-out')).toBe('ease-in-out')
    for (const p of BEZIER_PRESETS) expect(typeof reverseEase(p.id)).toBe('string')
    expect(reverseEase('spring:bouncy')).toBe('spring:bouncy')
    expect(reverseEase('steps:4')).toBe('steps:4')
  })
})
