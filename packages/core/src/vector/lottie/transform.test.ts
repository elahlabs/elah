import { describe, expect, it } from 'vitest'
import { applyToPoint } from '../pathOps'
import { animatedProps, hasSkew, positionAt, transformMatrix, transformOpacity } from './transform'
import type { LottieTransform } from './types'

describe('transformMatrix', () => {
  it('applies T(p) · R(r) · S(s/100) · T(-a) in order', () => {
    const tr: LottieTransform = { a: { a: 0, k: [10, 10] }, p: { a: 0, k: [50, 50] }, s: { a: 0, k: [200, 100] }, r: { a: 0, k: 90 } }
    const m = transformMatrix(tr, 0)
    const [x1, y1] = applyToPoint(m, 10, 10)
    expect(x1).toBeCloseTo(50, 6)
    expect(y1).toBeCloseTo(50, 6)
    const [x2, y2] = applyToPoint(m, 11, 10)
    expect(x2).toBeCloseTo(50, 6)
    expect(y2).toBeCloseTo(52, 6)
  })

  it('reads a split position', () => {
    const tr: LottieTransform = { p: { s: true, x: { a: 0, k: 5 }, y: { a: 0, k: 7 } } }
    expect(positionAt(tr, 0)).toEqual([5, 7])
    const m = transformMatrix(tr, 0)
    const [x, y] = applyToPoint(m, 0, 0)
    expect(x).toBeCloseTo(5, 6)
    expect(y).toBeCloseTo(7, 6)
  })

  it('falls back to rz when r is absent', () => {
    const tr: LottieTransform = { rz: { a: 0, k: 90 }, p: { a: 0, k: [0, 0] } }
    const m = transformMatrix(tr, 0)
    const [x, y] = applyToPoint(m, 1, 0)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(1, 6)
  })
})

describe('transformOpacity', () => {
  it('defaults to 1, reads o/100', () => {
    expect(transformOpacity(undefined, 0)).toBe(1)
    expect(transformOpacity({ o: { a: 0, k: 50 } }, 0)).toBeCloseTo(0.5, 6)
  })
})

describe('hasSkew', () => {
  it('false for a static zero skew, true for a non-zero one', () => {
    expect(hasSkew({ sk: { a: 0, k: 0 } })).toBe(false)
    expect(hasSkew({ sk: { a: 0, k: 10 } })).toBe(true)
  })

  it('true whenever sk is animated, regardless of value', () => {
    expect(hasSkew({ sk: { a: 1, k: [{ t: 0, s: [0] }, { t: 10, s: [0] }] } })).toBe(true)
  })
})

describe('animatedProps', () => {
  it('lists only the animated transform props, in a p/r/... order', () => {
    const tr: LottieTransform = {
      p: { a: 1, k: [{ t: 0, s: [0, 0] }, { t: 10, s: [10, 10] }] },
      r: { a: 1, k: [{ t: 0, s: [0] }, { t: 10, s: [90] }] },
      s: { a: 0, k: [100, 100] },
    }
    expect(animatedProps(tr)).toEqual(['p', 'r'])
  })

  it('is empty for undefined or fully static transforms', () => {
    expect(animatedProps(undefined)).toEqual([])
    expect(animatedProps({ p: { a: 0, k: [0, 0] } })).toEqual([])
  })
})
