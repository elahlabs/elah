import { describe, expect, it } from 'vitest'
import { clipStops, colorAt, linearToPaint, radialToPaint } from './gradient'
import { paintColorAt } from './__tests__/paintSample'
import { IDENTITY, rotation, scaling, type Affine } from './pathOps'
import type { Rgba } from './color'

function expectRgbaClose(actual: Rgba, expected: Rgba, tol = 1): void {
  expect(actual.r).toBeGreaterThanOrEqual(expected.r - tol)
  expect(actual.r).toBeLessThanOrEqual(expected.r + tol)
  expect(actual.g).toBeGreaterThanOrEqual(expected.g - tol)
  expect(actual.g).toBeLessThanOrEqual(expected.g + tol)
  expect(actual.b).toBeGreaterThanOrEqual(expected.b - tol)
  expect(actual.b).toBeLessThanOrEqual(expected.b + tol)
  expect(actual.a).toBeGreaterThanOrEqual(expected.a - 0.01)
  expect(actual.a).toBeLessThanOrEqual(expected.a + 0.01)
}

const grey = (n: number): Rgba => ({ r: n, g: n, b: n, a: 1 })

describe('clipStops', () => {
  it('cuts out-of-range stops at 0 and 1 with interpolated colours', () => {
    const { stops, approximate } = clipStops([
      { offset: -0.5, color: '#000000' },
      { offset: 1.5, color: '#ffffff' },
    ])
    expect(stops).toEqual([
      { offset: 0, color: '#404040' },
      { offset: 1, color: '#bfbfbf' },
    ])
    expect(approximate).toBe(false)
  })

  it('leaves in-range stops unchanged (canvas pads beyond them)', () => {
    const { stops } = clipStops([
      { offset: 0.2, color: 'red' },
      { offset: 0.4, color: 'blue' },
    ])
    expect(stops).toEqual([
      { offset: 0.2, color: 'red' },
      { offset: 0.4, color: 'blue' },
    ])
  })

  it('two stops both above 1 collapse to two stops of the first colour, normalised', () => {
    const { stops } = clipStops([
      { offset: 2, color: '#000' },
      { offset: 3, color: '#fff' },
    ])
    expect(stops).toEqual([
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#000000' },
    ])
  })

  it('a single stop becomes two identical stops at 0 and 1', () => {
    const { stops } = clipStops([{ offset: 0.5, color: '#123456' }])
    expect(stops).toEqual([
      { offset: 0, color: '#123456' },
      { offset: 1, color: '#123456' },
    ])
  })
})

describe('colorAt', () => {
  it('pads before the first and after the last stop', () => {
    const stops = [
      { offset: 0.2, color: '#000000' },
      { offset: 0.8, color: '#ffffff' },
    ]
    expect(colorAt(stops, 0)).toEqual({ color: '#000000', approximate: false })
    expect(colorAt(stops, 1)).toEqual({ color: '#ffffff', approximate: false })
  })

  it('interpolates between neighbours', () => {
    const stops = [
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ]
    expect(colorAt(stops, 0.5)).toEqual({ color: '#808080', approximate: false })
  })
})

describe('linearToPaint', () => {
  const S = [
    { offset: 0, color: '#000000' },
    { offset: 1, color: '#ffffff' },
  ]

  it('identity: samples along the box match the mix at that fraction', () => {
    const result = linearToPaint([0, 0], [200, 0], S, IDENTITY, { x: 50, y: 0, width: 100, height: 10 })
    expect(result.kind).toBe('paint')
    if (result.kind !== 'paint') return
    const box = { x: 50, y: 0, width: 100, height: 10 }
    expectRgbaClose(paintColorAt(result.paint, box, 50, 5), grey(64))
    expectRgbaClose(paintColorAt(result.paint, box, 100, 5), grey(128))
    expectRgbaClose(paintColorAt(result.paint, box, 150, 5), grey(191))
  })

  it('a 90-degree rotation reproduces the same samples turned to a vertical box', () => {
    const g: Affine = rotation(90)
    const result = linearToPaint([0, 0], [200, 0], S, g, { x: 0, y: 50, width: 10, height: 100 })
    expect(result.kind).toBe('paint')
    if (result.kind !== 'paint') return
    const box = { x: 0, y: 50, width: 10, height: 100 }
    expectRgbaClose(paintColorAt(result.paint, box, 5, 50), grey(64))
    expectRgbaClose(paintColorAt(result.paint, box, 5, 100), grey(128))
    expectRgbaClose(paintColorAt(result.paint, box, 5, 150), grey(191))
  })

  it('a skew maps t(q) = (qx - 0.5*qy)/10 exactly', () => {
    const g: Affine = [1, 0, 0.5, 1, 0, 0]
    const result = linearToPaint([0, 0], [10, 0], S, g, { x: 0, y: 0, width: 20, height: 20 })
    expect(result.kind).toBe('paint')
    if (result.kind !== 'paint') return
    const box = { x: 0, y: 0, width: 20, height: 20 }
    const points: Array<[number, number]> = [
      [5, 4],
      [10, 10],
      [15, 2],
    ]
    for (const [qx, qy] of points) {
      const t = Math.min(1, Math.max(0, (qx - 0.5 * qy) / 10))
      const expected = grey(Math.round(255 * t))
      expectRgbaClose(paintColorAt(result.paint, box, qx, qy), expected, 2)
    }
  })

  it('p1 == p2 collapses to the last stop colour', () => {
    const result = linearToPaint([10, 10], [10, 10], S, IDENTITY, { x: 0, y: 0, width: 10, height: 10 })
    expect(result).toEqual({ kind: 'solid', color: '#ffffff', approximations: [] })
  })

  it('a singular matrix falls back to the last stop with an approximation', () => {
    const singular: Affine = [0, 0, 0, 0, 0, 0]
    const result = linearToPaint([0, 0], [10, 0], S, singular, { x: 0, y: 0, width: 10, height: 10 })
    expect(result).toEqual({ kind: 'solid', color: '#ffffff', approximations: ['gradient-singular'] })
  })
})

describe('radialToPaint', () => {
  const S = [
    { offset: 0, color: '#000000' },
    { offset: 1, color: '#ffffff' },
  ]

  it('identity: centre and radius as fractions of the box', () => {
    const result = radialToPaint([60, 60], 50, undefined, S, IDENTITY, { x: 10, y: 10, width: 100, height: 100 })
    expect(result.kind).toBe('paint')
    if (result.kind !== 'paint') return
    expect(result.paint.type).toBe('radial')
    if (result.paint.type !== 'radial') return
    expect(result.paint.cx).toBeCloseTo(0.5, 6)
    expect(result.paint.cy).toBeCloseTo(0.5, 6)
    expect(result.paint.r).toBeCloseTo(0.7071, 4)
    expect(result.approximations).toEqual([])
  })

  it('a non-conformal matrix reports an elliptical approximation', () => {
    const g = scaling(2, 1)
    const result = radialToPaint([60, 60], 50, undefined, S, g, { x: 10, y: 10, width: 100, height: 100 })
    expect(result.approximations).toContain('radial-gradient-elliptical')
  })

  it('a focal point away from the centre reports a focal approximation', () => {
    const result = radialToPaint([60, 60], 50, [45, 45], S, IDENTITY, { x: 10, y: 10, width: 100, height: 100 })
    expect(result.approximations).toContain('radial-gradient-focal')
  })

  it('a zero or negative radius collapses to the last stop colour', () => {
    const result = radialToPaint([0, 0], 0, undefined, S, IDENTITY, { x: 0, y: 0, width: 10, height: 10 })
    expect(result).toEqual({ kind: 'solid', color: '#ffffff', approximations: [] })
  })
})
