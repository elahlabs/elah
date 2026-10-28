import { describe, expect, it } from 'vitest'
import { findSpringPreset, matchSpringPreset, SPRING_PRESETS } from './springPresets'
import { normalizeSpring, springProgress } from '../resolver/spring'
import type { KeyframeSpring } from '../types'

/** Damping ratio — the only parameter that differs between the presets. */
function zetaOf(s: KeyframeSpring): number {
  const p = normalizeSpring(s)
  return p.damping / (2 * Math.sqrt(p.stiffness * p.mass))
}

describe('SPRING_PRESETS', () => {
  it('keeps the documented ids, in order', () => {
    expect(SPRING_PRESETS.map((p) => p.id)).toEqual(['gentle', 'snappy', 'bouncy', 'stiff', 'wobbly'])
  })

  it('is a valid spring for every preset', () => {
    for (const p of SPRING_PRESETS) {
      expect(normalizeSpring(p.spring)).toBeTruthy()
      expect(p.spring.stiffness).toBeGreaterThan(0)
      expect(p.spring.damping).toBeGreaterThan(0)
    }
  })

  it('is spread across the damping ratio so the five look different', () => {
    // Two presets with the same zeta are the same curve; this is the property
    // that makes five presets worth shipping instead of two.
    const zetas = SPRING_PRESETS.map((p) => Math.round(zetaOf(p.spring) * 1000))
    expect(new Set(zetas).size).toBe(SPRING_PRESETS.length)
  })

  it('finds a preset by id', () => {
    expect(findSpringPreset('bouncy')?.spring.damping).toBe(12)
    expect(findSpringPreset('nope')).toBeUndefined()
  })
})

describe('matchSpringPreset', () => {
  it('matches a preset by value', () => {
    expect(matchSpringPreset({ stiffness: 180, damping: 12 })?.id).toBe('bouncy')
    expect(matchSpringPreset({ stiffness: 100, damping: 26, mass: 1 })?.id).toBe('gentle')
  })

  it('returns undefined for a spring the author nudged', () => {
    expect(matchSpringPreset({ stiffness: 180, damping: 12.5 })).toBeUndefined()
    expect(matchSpringPreset(undefined)).toBeUndefined()
  })
})

describe('springProgress at the preset values', () => {
  it('matches the reference midpoint for every preset', () => {
    expect(springProgress(findSpringPreset('gentle')!.spring, 0.5)).toBeCloseTo(0.9224226, 6)
    expect(springProgress(findSpringPreset('snappy')!.spring, 0.5)).toBeCloseTo(1.0473384, 6)
    expect(springProgress(findSpringPreset('bouncy')!.spring, 0.5)).toBeCloseTo(0.9811825, 6)
    expect(springProgress(findSpringPreset('stiff')!.spring, 0.5)).toBeCloseTo(0.8876700, 6)
    expect(springProgress(findSpringPreset('wobbly')!.spring, 0.5)).toBeCloseTo(0.9719139, 6)
  })
})

/**
 * The Risks-table measurement, "spring normalisation on short segments": the
 * normalisation stretches a spring onto the segment, so the question is
 * whether a 3-frame segment still looks like the preset or degenerates. This is
 * a measurement AND a gate — the assertions below are the decision rule from
 * the ticket, and the printed lines go into Result verbatim.
 */
describe('normalisation probe: 3-frame vs 60-frame', () => {
  it('records the span-3 and span-60 shape of every preset and holds the rule', () => {
    const SPAN60 = 60
    const y = (s: KeyframeSpring, f: number, span: number) => springProgress(s, f / span)

    for (const p of SPRING_PRESETS) {
      const s = p.spring
      const span3 = [0, 1, 2, 3].map((f) => y(s, f, 3))
      const f15 = y(s, 15, SPAN60)
      const f30 = y(s, 30, SPAN60)
      const f45 = y(s, 45, SPAN60)

      // A crossing is a sign change of (y - 1) large enough to see. Counting
      // every sign change would count numerical noise around the settle line.
      const frames: number[] = []
      for (let f = 0; f < SPAN60; f++) {
        const a = y(s, f, SPAN60) - 1
        const b = y(s, f + 1, SPAN60) - 1
        if (a * b < 0 && Math.max(Math.abs(a), Math.abs(b)) > 0.01) frames.push(f)
      }
      const crossings60 = frames.length
      const minGap = frames.length < 2 ? Infinity : frames.slice(1).reduce((m, f, i) => Math.min(m, f - frames[i]!), Infinity)

      console.log(
        'SPRING_PROBE',
        p.id,
        JSON.stringify({ zeta: Number(zetaOf(s).toFixed(3)), span3, f15, f30, f45, crossings60, minGap }),
      )

      // Every sample finite — a NaN here would silently blank the whole channel.
      for (const v of [...span3, f15, f30, f45]) expect(Number.isFinite(v)).toBe(true)
      // Exact arrival at the end of both spans: the sampler's whole contract.
      expect(span3[3]).toBe(1)
      expect(y(s, SPAN60, SPAN60)).toBe(1)
      // The rule: no ringing a viewer would read as noise, and no two
      // crossings closer than 3 frames (which reads as a vibration).
      expect(crossings60).toBeLessThanOrEqual(6)
      if (crossings60 >= 2) expect(minGap).toBeGreaterThanOrEqual(3)
    }
  })
})
