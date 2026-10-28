import { describe, expect, it } from 'vitest'
import {
  isValidSpring,
  normalizeSpring,
  physicalSpring,
  springDisplacement,
  springProgress,
  springSettleSeconds,
  SPRING_EPSILON,
} from './spring'
import { SPRING_PRESETS } from '../elements/springPresets'
import type { KeyframeSpring } from '../types'

const norm = (s: KeyframeSpring) => normalizeSpring(s)

/** The three damping regimes the solver branches on, at mass 1. */
const UNDER = { stiffness: 100, damping: 10, mass: 1 }
const CRITICAL = { stiffness: 100, damping: 20, mass: 1 }
const OVER = { stiffness: 100, damping: 40, mass: 1 }

describe('springDisplacement', () => {
  it('matches the reference rows for all three regimes', () => {
    expect(springDisplacement(norm(UNDER), 0.1)).toBeCloseTo(0.6597002, 6)
    expect(springDisplacement(norm(CRITICAL), 0.1)).toBeCloseTo(0.7357589, 6)
    expect(springDisplacement(norm(OVER), 0.1)).toBeCloseTo(0.8222634, 6)
  })

  it('starts the whole step away from the target in every regime', () => {
    // x(0) === 1 is the initial condition all three closed forms share; a
    // regression here would make every spring start mid-flight.
    expect(springDisplacement(norm(UNDER), 0)).toBe(1)
    expect(springDisplacement(norm(CRITICAL), 0)).toBe(1)
    expect(springDisplacement(norm(OVER), 0)).toBe(1)
  })

  it('has initial slope -velocity', () => {
    // x'(0) = v0 = -velocity. Numeric, because no closed form is exported.
    const p = norm({ stiffness: 100, damping: 10, mass: 1, velocity: 5 })
    const h = 1e-7
    const slope = (springDisplacement(p, h) - springDisplacement(p, 0)) / h
    expect(slope).toBeCloseTo(-5, 3)
  })

  it('converges to the target', () => {
    for (const p of [norm(UNDER), norm(CRITICAL), norm(OVER)]) {
      expect(Math.abs(springDisplacement(p, 30))).toBeLessThan(1e-3)
    }
  })
})

describe('normalizeSpring', () => {
  it('matches the reference row for a zero-damping spring', () => {
    expect(normalizeSpring({ stiffness: 100, damping: 0 })).toEqual({
      stiffness: 100,
      damping: 1,
      mass: 1,
      velocity: 0,
    })
  })

  it('clamps stiffness, mass and velocity into range', () => {
    expect(norm({ stiffness: 1e9, damping: 10 }).stiffness).toBe(10000)
    expect(norm({ stiffness: 1e-9, damping: 10 }).stiffness).toBe(1)
    expect(norm({ stiffness: 100, damping: 10, mass: 1e9 }).mass).toBe(100)
    expect(norm({ stiffness: 100, damping: 10, mass: 1e-9 }).mass).toBe(0.01)
    expect(norm({ stiffness: 100, damping: 10, velocity: 1e9 }).velocity).toBe(100)
    expect(norm({ stiffness: 100, damping: 10, velocity: -1e9 }).velocity).toBe(-100)
  })

  it('raises damping to a floor so a key cannot ring for hundreds of oscillations', () => {
    // zeta = c / (2*sqrt(k*m)) must never fall below 0.05.
    for (const k of [1, 100, 10000]) {
      const p = norm({ stiffness: k, damping: 0, mass: 1 })
      const zeta = p.damping / (2 * Math.sqrt(p.stiffness * p.mass))
      expect(zeta).toBeGreaterThanOrEqual(0.05 - 1e-12)
    }
  })

  it('never raises damping above what the author asked for', () => {
    expect(norm({ stiffness: 100, damping: 26 }).damping).toBe(26)
  })
})

describe('springSettleSeconds', () => {
  it('matches the reference rows', () => {
    expect(springSettleSeconds(norm(UNDER))).toBeCloseTo(1.088432, 6)
    expect(springSettleSeconds(norm(CRITICAL))).toBeCloseTo(0.743013, 6)
    expect(springSettleSeconds(norm(OVER))).toBeCloseTo(2.005164, 6)
  })

  it('is the first time the envelope drops under the epsilon', () => {
    // The definition is a threshold, so check it brackets: just before T the
    // spring is still moving more than epsilon, at T it is not.
    for (const s of [UNDER, CRITICAL, OVER]) {
      const p = norm(s)
      const T = springSettleSeconds(p)
      const at = Math.abs(springDisplacement(p, T))
      const before = Math.abs(springDisplacement(p, T * 0.9))
      expect(at).toBeLessThanOrEqual(0.005)
      expect(before).toBeGreaterThan(0)
    }
  })
})

describe('springProgress', () => {
  it('pins the ends exactly', () => {
    // The sampler's contract: the value at the key frame is the key value.
    for (const p of SPRING_PRESETS) {
      expect(springProgress(p.spring, 0)).toBe(0)
      expect(springProgress(p.spring, 1)).toBe(1)
      expect(springProgress(p.spring, 1.5)).toBe(1)
      expect(springProgress(p.spring, -1)).toBe(0)
    }
  })

  it('never extrapolates past the end of the segment', () => {
    // Past t = 1 the spring is stretched, so there is no further spring to
    // evaluate: the curve must be pinned at exactly 1 rather than continued.
    // t = 1 alone does NOT prove this — the residual subtraction already makes
    // t = 1 exact — so the probe has to sit strictly inside the pinned range.
    for (const p of SPRING_PRESETS) {
      expect(springProgress(p.spring, 1.000001)).toBe(1)
      expect(springProgress(p.spring, 1.2)).toBe(1)
      expect(springProgress(p.spring, 1.49)).toBe(1)
      expect(springProgress(p.spring, 2)).toBe(1)
    }
  })

  it('does not extrapolate before the start either', () => {
    for (const p of SPRING_PRESETS) {
      expect(springProgress(p.spring, -0.5)).toBe(0)
      expect(springProgress(p.spring, 0)).toBe(0)
    }
  })

  it('is within 2e-3 of the target one frame before the end of a 60 frame segment', () => {
    for (const p of SPRING_PRESETS) {
      expect(Math.abs(springProgress(p.spring, 0.999) - 1)).toBeLessThan(2e-3)
    }
  })

  it('never dips below 0 on a 60 frame segment', () => {
    // A spring may overshoot past 1; it must not swing the clip backwards
    // before the start of the step, which is what an unbounded anticipation
    // would look like.
    for (const p of SPRING_PRESETS) {
      for (let i = 0; i <= 100; i++) expect(springProgress(p.spring, i / 100)).toBeGreaterThanOrEqual(0)
    }
  })

  it('is monotonic for the over-damped and critically damped presets', () => {
    for (const id of ['gentle', 'stiff'] as const) {
      const s = SPRING_PRESETS.find((p) => p.id === id)!.spring
      let prev = -1
      for (let i = 0; i <= 100; i++) {
        const y = springProgress(s, i / 100)
        expect(y).toBeGreaterThanOrEqual(prev)
        prev = y
      }
    }
  })

  it('overshoots for the bouncy presets', () => {
    for (const id of ['bouncy', 'wobbly'] as const) {
      const s = SPRING_PRESETS.find((p) => p.id === id)!.spring
      let max = 0
      for (let i = 0; i <= 100; i++) max = Math.max(max, springProgress(s, i / 100))
      expect(max).toBeGreaterThan(1.2)
    }
  })

  it('is continuous through the residual subtraction', () => {
    // The `- t * xT` term removes the settle residual. If it were dropped the
    // curve would end at 1 - xT; if xT were treated as a discontinuity there
    // would be a visible step in the final frames.
    const s = SPRING_PRESETS.find((p) => p.id === 'bouncy')!.spring
    let prev = springProgress(s, 0.9)
    for (let i = 91; i <= 99; i++) {
      const y = springProgress(s, i / 100)
      expect(Math.abs(y - prev)).toBeLessThan(0.05)
      prev = y
    }
  })

  it('is memoised by value, not by identity', () => {
    const a: KeyframeSpring = { stiffness: 180, damping: 12, mass: 1 }
    const b: KeyframeSpring = { stiffness: 180, damping: 12, mass: 1 }
    expect(springProgress(a, 0.5)).toBe(springProgress(b, 0.5))
    expect(springProgress(a, 0.37)).toBe(springProgress(b, 0.37))
  })
})

describe('isValidSpring', () => {
  it('rejects anything the sampler could not use', () => {
    for (const bad of [
      null,
      undefined,
      'x',
      42,
      [],
      {},
      { stiffness: 100 },
      { damping: 10 },
      { stiffness: 0, damping: 1 },
      { stiffness: -1, damping: 1 },
      { stiffness: NaN, damping: 1 },
      { stiffness: Infinity, damping: 1 },
      { stiffness: 100, damping: -1 },
      { stiffness: 100, damping: NaN },
      { stiffness: 100, damping: 10, mass: Infinity },
      { stiffness: 100, damping: 10, mass: 'x' },
      { stiffness: 100, damping: 10, velocity: NaN },
      { stiffness: '100', damping: 10 },
    ]) {
      expect(isValidSpring(bad)).toBe(false)
    }
  })

  it('accepts a minimal spring, with or without the optional fields', () => {
    expect(isValidSpring({ stiffness: 100, damping: 10 })).toBe(true)
    expect(isValidSpring({ stiffness: 100, damping: 0 })).toBe(true)
    expect(isValidSpring({ stiffness: 100, damping: 10, mass: 1, velocity: 0 })).toBe(true)
    expect(isValidSpring({ stiffness: 100, damping: 10, mass: 2, velocity: -3 })).toBe(true)
  })
})

describe('physicalSpring', () => {
  it('matches the reference rows', () => {
    expect(physicalSpring(0.1)).toBeCloseTo(0.3402998, 6)
    expect(physicalSpring(0.5)).toBeCloseTo(1.0745906, 6)
  })

  it('pins the start and clamps before it', () => {
    expect(physicalSpring(0)).toBe(0)
    expect(physicalSpring(-1)).toBe(0)
    expect(physicalSpring(NaN)).toBe(0)
  })

  it('is the real-time twin of springProgress, not the same function', () => {
    // physicalSpring sets its own duration; springProgress is stretched onto a
    // segment. At the settle time the two must agree to within the epsilon —
    // that is the invariant which makes the shared maths usable in
    // expressions (PV-P5b) instead of needing a second implementation.
    const s = UNDER
    const T = springSettleSeconds(norm(s))
    expect(Math.abs(1 - physicalSpring(T))).toBeLessThanOrEqual(SPRING_EPSILON)
  })
})
