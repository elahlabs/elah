import { describe, expect, it } from 'vitest'
import { STAGGER_DEFAULT_SEED, staggerOffsets } from './stagger'
import { evaluateEasing } from '../resolver/textAnimation'

describe('staggerOffsets', () => {
  it('defaults to i * each, byte-identical to the old linear stagger', () => {
    for (const each of [0, 1, 3, 4, 7]) {
      for (const count of [0, 1, 2, 5, 12]) {
        expect(staggerOffsets(count, { each })).toEqual(Array.from({ length: count }, (_, i) => i * each))
      }
    }
    expect(staggerOffsets(4, { each: 5, from: 'start' })).toEqual([0, 5, 10, 15])
  })

  it('end is the mirror of start', () => {
    expect(staggerOffsets(5, { each: 3, from: 'end' })).toEqual([12, 9, 6, 3, 0])
  })

  it('center of 5 is [2,1,0,1,2] * each, and an even count is symmetric', () => {
    expect(staggerOffsets(5, { each: 4, from: 'center' })).toEqual([8, 4, 0, 4, 8])
    const even = staggerOffsets(4, { each: 4, from: 'center' })
    expect(even[0]).toBe(even[3])
    expect(even[1]).toBe(even[2])
    expect(even[0]).toBeGreaterThan(even[1]!)
  })

  it('edges starts at both ends and meets in the middle', () => {
    expect(staggerOffsets(5, { each: 2, from: 'edges' })).toEqual([0, 2, 4, 2, 0])
  })

  it('a numeric origin is a distance from that index', () => {
    expect(staggerOffsets(5, { each: 2, from: 1 })).toEqual([2, 0, 2, 4, 6])
    expect(staggerOffsets(3, { each: 2, from: 99 })).toEqual([4, 2, 0])
  })

  it('random is deterministic, seedable and a permutation of the linear offsets', () => {
    const a = staggerOffsets(8, { each: 3, from: 'random' })
    expect(staggerOffsets(8, { each: 3, from: 'random' })).toEqual(a)
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 8 }, (_, i) => i * 3))
    expect(a).not.toEqual(Array.from({ length: 8 }, (_, i) => i * 3))
    expect(staggerOffsets(8, { each: 3, from: 'random', seed: STAGGER_DEFAULT_SEED })).toEqual(a)
    expect(staggerOffsets(8, { each: 3, from: 'random', seed: 7 })).not.toEqual(a)
  })

  it('an ease spreads the offsets: quad-out front-loads, endpoints stay put', () => {
    const lin = staggerOffsets(6, { each: 10 })
    const out = staggerOffsets(6, { each: 10, ease: 'quad-out' })
    expect(out[0]).toBe(0)
    expect(out[5]).toBe(lin[5])
    expect(out[1]).toBeGreaterThan(lin[1]!)
    expect(out).toEqual(lin.map((_, i) => Math.round(evaluateEasing('quad-out', i / 5) * 50)))
    const inn = staggerOffsets(6, { each: 10, ease: 'quad-in' })
    expect(inn[1]).toBeLessThan(lin[1]!)
  })

  it('an ease that dips below zero clamps to 0', () => {
    for (const v of staggerOffsets(6, { each: 10, ease: 'back-in' })) expect(v).toBeGreaterThanOrEqual(0)
  })

  it('a 3x3 grid from the centre radiates by Euclidean distance', () => {
    const o = staggerOffsets(9, { each: 10, from: 'center', grid: { cols: 3 } })
    expect(o[4]).toBe(0)
    for (const edge of [1, 3, 5, 7]) expect(o[edge]).toBe(10)
    for (const corner of [0, 2, 6, 8]) expect(o[corner]).toBe(Math.round(Math.SQRT2 * 10))
  })

  it('a grid from start measures from the top-left cell; edges from the outer ring', () => {
    const s = staggerOffsets(6, { each: 10, grid: { cols: 3 } })
    expect(s[0]).toBe(0)
    expect(s[1]).toBe(10)
    expect(s[3]).toBe(10)
    expect(Math.max(...s)).toBe(s[5])
    const e = staggerOffsets(9, { each: 10, from: 'edges', grid: { cols: 3 } })
    expect(e[4]).toBe(10)
    expect(e[0]).toBe(0)
  })

  it('stays finite and integral on odd input', () => {
    expect(staggerOffsets(3, { each: NaN })).toEqual([0, 0, 0])
    expect(staggerOffsets(1, { each: 5, from: 'center' })).toEqual([0])
    expect(staggerOffsets(-2, { each: 5 })).toEqual([])
    for (const v of staggerOffsets(7, { each: 2.5, from: 'center', ease: 'sine-in-out' })) expect(Number.isInteger(v)).toBe(true)
  })
})
