import { describe, expect, it } from 'vitest'
import { cubicBezier } from '../../resolver/bezier'
import { isAnimated, keyTimes, sampleProp, samplePath, segmentEase } from './props'

describe('sampleProp', () => {
  it('static scalar and vector props', () => {
    expect(sampleProp({ a: 0, k: 5 }, 0, [0])).toEqual([5])
    expect(sampleProp({ a: 0, k: [1, 2] }, 0, [0, 0])).toEqual([1, 2])
    expect(sampleProp(undefined, 3, [7])).toEqual([7])
  })

  it('linear keys interpolate and clamp at the ends', () => {
    const p = {
      a: 1,
      k: [
        { t: 0, s: [0], o: { x: [0], y: [0] }, i: { x: [1], y: [1] } },
        { t: 10, s: [10] },
      ],
    }
    expect(sampleProp(p, 5, [0])[0]).toBeCloseTo(5, 6)
    expect(sampleProp(p, -3, [0])).toEqual([0])
    expect(sampleProp(p, 20, [0])).toEqual([10])
  })

  it('eased keys use the resolver cubicBezier', () => {
    const p = {
      a: 1,
      k: [
        { t: 0, s: [0], o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } },
        { t: 10, s: [10] },
      ],
    }
    const expected = 10 * cubicBezier([0.33, 0, 0.67, 1], 0.25)
    expect(sampleProp(p, 2.5, [0])[0]).toBeCloseTo(expected, 6)
  })

  it('a hold key freezes the value until the next key', () => {
    const p = {
      a: 1,
      k: [
        { t: 0, s: [0], h: 1 },
        { t: 10, s: [10] },
      ],
    }
    expect(sampleProp(p, 9.9, [0])).toEqual([0])
  })

  it('the pre-5.5 e (end value) format', () => {
    const p = {
      a: 1,
      k: [{ t: 0, s: [0], e: [10] }, { t: 10 }],
    }
    expect(sampleProp(p, 5, [0])[0]).toBeCloseTo(5, 6)
    expect(sampleProp(p, 20, [0])).toEqual([10])
  })

  it('per-dimension bezier handles ease each dimension independently', () => {
    const p = {
      a: 1,
      k: [
        { t: 0, s: [0, 0], o: { x: [0, 0.5], y: [0, 0] }, i: { x: [1, 0.5], y: [1, 1] } },
        { t: 10, s: [10, 10] },
      ],
    }
    const v = sampleProp(p, 5, [0, 0])
    expect(v[0]).toBeCloseTo(5, 6)
    expect(v[1]).toBeCloseTo(10 * cubicBezier([0.5, 0, 0.5, 1], 0.5), 6)
  })

  it('spatial position curves are sampled by arc length (symmetric case)', () => {
    const p = {
      a: 1,
      k: [
        { t: 0, s: [0, 0], to: [0, -50], ti: [0, -50], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
        { t: 10, s: [100, 0] },
      ],
    }
    const v = sampleProp(p, 5, [0, 0])
    expect(v[0]).toBeCloseTo(50, 1)
    expect(v[1]).toBeCloseTo(-37.5, 1)
  })
})

describe('segmentEase', () => {
  it('reports the eased bezier tuple for a normal segment', () => {
    const p = {
      a: 1,
      k: [
        { t: 0, s: [0], o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } },
        { t: 10, s: [10] },
      ],
    }
    expect(segmentEase(p, 1, 0)).toEqual({ bezier: [0.33, 0, 0.67, 1], hold: false })
  })

  it('reports hold for a segment starting at a hold key', () => {
    const p = {
      a: 1,
      k: [
        { t: 0, s: [0], h: 1 },
        { t: 10, s: [10] },
      ],
    }
    expect(segmentEase(p, 1, 0).hold).toBe(true)
  })

  it('returns hold:false with no bezier when i is out of range', () => {
    expect(segmentEase({ a: 0, k: 5 }, 0, 0)).toEqual({ hold: false })
  })
})

describe('samplePath', () => {
  it('morphs vertex-wise between two equal-count paths at the midpoint', () => {
    const p = {
      a: 1,
      k: [
        { t: 0, s: [{ i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], v: [[0, 0], [10, 0], [10, 10]], c: true }] },
        { t: 10, s: [{ i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], v: [[10, 10], [20, 10], [20, 20]], c: true }] },
      ],
    }
    const mid = samplePath(p, 5)
    expect(mid?.v).toEqual([[5, 5], [15, 5], [15, 15]])
  })

  it('holds the first path when vertex counts differ', () => {
    const p = {
      a: 1,
      k: [
        { t: 0, s: [{ i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]], v: [[0, 0], [10, 0]], c: false }] },
        { t: 10, s: [{ i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], v: [[10, 10], [20, 10], [20, 20]], c: true }] },
      ],
    }
    const at5 = samplePath(p, 5)
    expect(at5?.v).toEqual([[0, 0], [10, 0]])
  })
})

describe('keyTimes / isAnimated', () => {
  it('keyTimes returns the sorted key times, [] when static', () => {
    const p = { a: 1, k: [{ t: 10, s: [1] }, { t: 0, s: [0] }] }
    expect(keyTimes(p)).toEqual([0, 10])
    expect(keyTimes({ a: 0, k: [1, 2] })).toEqual([])
  })

  it('isAnimated is false for a static vector prop', () => {
    expect(isAnimated({ a: 0, k: [1, 2] })).toBe(false)
  })
})
