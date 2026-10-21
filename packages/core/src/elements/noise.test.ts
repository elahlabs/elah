import { describe, expect, it } from 'vitest'
import { noise1, shakeSamples } from './noise'

describe('noise1', () => {
  it('is deterministic: pinned values for seed 1', () => {
    const values = [0, 0.5, 1, 2.25, 7.9].map((t) => noise1(1, t))
    expect(values).toEqual([0, 0.5, 1, 2.25, 7.9].map((t) => noise1(1, t)))
    // Pinned so a change to the hash is caught: shake keys already stored in
    // documents were generated from it.
    expect(values.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([
      0.007491, -0.04623, -0.099951, -0.723398, -0.554494,
    ])
  })

  it('stays inside [-1, 1] and differs across seeds', () => {
    let differs = false
    for (let i = 0; i < 500; i++) {
      const t = i * 0.37
      const v = noise1(42, t)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
      if (Math.abs(v - noise1(43, t)) > 1e-9) differs = true
    }
    expect(differs).toBe(true)
  })

  it('is continuous: small steps make small changes', () => {
    for (let i = 0; i < 200; i++) {
      const t = i * 0.05
      expect(Math.abs(noise1(9, t + 0.001) - noise1(9, t))).toBeLessThan(0.01)
    }
  })

  it('treats a non-finite position as 0', () => {
    expect(noise1(5, Number.NaN)).toBe(noise1(5, 0))
  })
})

describe('shakeSamples', () => {
  it('returns one sample per frame within the amplitude', () => {
    const s = shakeSamples(7, 30, { frequency: 0.3, amplitude: 0.02 })
    expect(s).toHaveLength(30)
    for (const v of s) expect(Math.abs(v)).toBeLessThanOrEqual(0.02)
  })

  it('handles zero and junk frame counts', () => {
    expect(shakeSamples(1, 0, { frequency: 1, amplitude: 1 })).toEqual([])
    expect(shakeSamples(1, Number.NaN, { frequency: 1, amplitude: 1 })).toEqual([])
  })
})
