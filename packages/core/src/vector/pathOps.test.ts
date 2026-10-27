import { describe, expect, it } from 'vitest'
import {
  IDENTITY,
  applyToPoint,
  arcToCubics,
  determinant,
  ellipsePath,
  invert,
  isConformal,
  isSimilarity,
  multiply,
  parsePathData,
  parsePoints,
  parseTransformList,
  pathBounds,
  pathToD,
  polyPath,
  rectPath,
  rotation,
  rotationOf,
  scaling,
  transformPath,
  translation,
  uniformScale,
} from './pathOps'

describe('matrices and transform lists', () => {
  it('composes translate/rotate/scale left to right, rightmost applying to points first', () => {
    const m = parseTransformList('translate(10 20) rotate(90) scale(2)')
    expect(m).not.toBeNull()
    const [x, y] = applyToPoint(m!, 1, 0)
    expect(x).toBeCloseTo(10, 6)
    expect(y).toBeCloseTo(22, 6)
  })

  it('rotate about an explicit centre fixes that centre', () => {
    const m = parseTransformList('rotate(45 12 12)')
    expect(m).not.toBeNull()
    const [x, y] = applyToPoint(m!, 12, 12)
    expect(x).toBeCloseTo(12, 6)
    expect(y).toBeCloseTo(12, 6)
  })

  it('matrix() is the six components verbatim', () => {
    expect(parseTransformList('matrix(1 2 3 4 5 6)')).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('skewX(45) maps (0,1) to (1,1)', () => {
    const m = parseTransformList('skewX(45)')!
    const [x, y] = applyToPoint(m, 0, 1)
    expect(x).toBeCloseTo(1, 6)
    expect(y).toBeCloseTo(1, 6)
  })

  it('translate(5) defaults ty to 0', () => {
    expect(parseTransformList('translate(5)')).toEqual([1, 0, 0, 1, 5, 0])
  })

  it('scale(2) defaults sy to sx', () => {
    expect(parseTransformList('scale(2)')).toEqual([2, 0, 0, 2, 0, 0])
  })

  it('rejects an unclosed function', () => {
    expect(parseTransformList('translate(10')).toBeNull()
  })

  it('rejects an unknown function name', () => {
    expect(parseTransformList('foo(1)')).toBeNull()
  })

  it('empty or whitespace string is IDENTITY', () => {
    expect(parseTransformList('')).toEqual(IDENTITY)
    expect(parseTransformList('   ')).toEqual(IDENTITY)
  })

  it('invert() undoes multiply()', () => {
    const m: [number, number, number, number, number, number] = [2, 1, -1, 3, 5, 7]
    const inv = invert(m)
    expect(inv).not.toBeNull()
    const roundTrip = multiply(m, inv!)
    for (let i = 0; i < 6; i++) expect(roundTrip[i]).toBeCloseTo(IDENTITY[i], 6)
  })

  it('invert() is null for a singular matrix', () => {
    expect(invert([1, 2, 2, 4, 0, 0])).toBeNull()
  })

  it('isSimilarity/isConformal distinguish uniform scale from anisotropic scale from reflection', () => {
    expect(isSimilarity(rotation(30))).toBe(true)
    expect(isSimilarity(scaling(2, 1))).toBe(false)
    expect(isConformal(scaling(-1, 1))).toBe(true)
    expect(isSimilarity(scaling(-1, 1))).toBe(false)
  })

  it('uniformScale is sqrt(|det|)', () => {
    expect(uniformScale(scaling(2, 8))).toBeCloseTo(4, 6)
  })

  it('determinant and rotationOf read the raw matrix', () => {
    expect(determinant([2, 0, 0, 3, 0, 0])).toBeCloseTo(6, 6)
    expect(rotationOf([0, 1, -1, 0, 0, 0])).toBeCloseTo(Math.PI / 2, 6)
  })

  it('translation()/scaling() build the raw matrices', () => {
    expect(translation(3, 4)).toEqual([1, 0, 0, 1, 3, 4])
    expect(scaling(2)).toEqual([2, 0, 0, 2, 0, 0])
  })
})

describe('path parser', () => {
  it('lowercase relative M/H/V/Z round-trips through pathToD', () => {
    expect(pathToD(parsePathData('m10 10 h5 v5 z'))).toBe('M10 10L15 10L15 15Z')
  })

  it('tokenizes adjacent numbers without separators, dropping a dangling one', () => {
    const segs = parsePathData('M0,0L10-5.5.5 1e1,2')
    expect(segs).toEqual([
      { c: 'M', x: 0, y: 0 },
      { c: 'L', x: 10, y: -5.5 },
      { c: 'L', x: 0.5, y: 10 },
    ])
  })

  it('a path with no initial M returns []', () => {
    expect(parsePathData('L1 1')).toEqual([])
  })

  it('bare numbers after M repeat as L', () => {
    expect(parsePathData('M0 0 10 10')).toEqual([
      { c: 'M', x: 0, y: 0 },
      { c: 'L', x: 10, y: 10 },
    ])
  })

  it('S with no previous curve uses the current point as its first control', () => {
    const segs = parsePathData('M1 1 S 3 3 4 1')
    expect(segs).toHaveLength(2)
    const c = segs[1] as { c: 'C'; x1: number; y1: number }
    expect(c.x1).toBeCloseTo(1, 6)
    expect(c.y1).toBeCloseTo(1, 6)
  })

  it('S after C reflects the previous second control', () => {
    const segs = parsePathData('M0 0 C 0 1 1 1 1 0 S 2 -1 2 0')
    expect(segs).toHaveLength(3)
    const c = segs[2] as { c: 'C'; x1: number; y1: number }
    expect(c.x1).toBeCloseTo(1, 6)
    expect(c.y1).toBeCloseTo(-1, 6)
  })

  it('T after Q reflects the implied quadratic control', () => {
    const segs = parsePathData('M0 0 Q 1 1 2 0 T 4 0')
    expect(segs).toHaveLength(3)
    const c = segs[2] as { c: 'C'; x1: number; y1: number }
    expect(c.x1).toBeCloseTo(2 + (2 / 3) * 1, 6)
    expect(c.y1).toBeCloseTo(0 + (2 / 3) * -1, 6)
  })

  it('Z followed by a non-M command starts a new subpath without an inserted M', () => {
    expect(parsePathData('M0 0 L 10 0 Z L 5 5')).toEqual([
      { c: 'M', x: 0, y: 0 },
      { c: 'L', x: 10, y: 0 },
      { c: 'Z' },
      { c: 'L', x: 5, y: 5 },
    ])
  })

  it('parses a single-letter arc flag run with no separators', () => {
    const segs = parsePathData('M0 0a5 5 0 1010 0')
    // M + the arc's cubics: a chord equal to the diameter is a half circle
    // (180°) regardless of the large-arc flag, which is exactly 2 cubics.
    expect(segs).toHaveLength(3)
    expect(segs[0]).toEqual({ c: 'M', x: 0, y: 0 })
    const last = segs[segs.length - 1] as { c: 'C'; x: number; y: number }
    expect(last.x).toBeCloseTo(10, 6)
    expect(last.y).toBeCloseTo(0, 6)
  })
})

describe('arcs', () => {
  it('a quarter circle is exactly one cubic with the KAPPA handle length', () => {
    const segs = arcToCubics(1, 0, 1, 1, 0, false, true, 0, 1)
    expect(segs).toHaveLength(1)
    const c = segs[0] as { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    expect(c.x1).toBeCloseTo(1, 6)
    expect(c.y1).toBeCloseTo(0.552285, 5)
    expect(c.x2).toBeCloseTo(0.552285, 5)
    expect(c.y2).toBeCloseTo(1, 6)
    expect(c.x).toBeCloseTo(0, 6)
    expect(c.y).toBeCloseTo(1, 6)
  })

  it('a half circle is two cubics ending exactly at the endpoint', () => {
    const segs = arcToCubics(0, 0, 50, 50, 0, false, true, 100, 0)
    expect(segs).toHaveLength(2)
    const c0 = segs[0] as { c: 'C'; x: number; y: number }
    expect(c0.x).toBeCloseTo(50, 6)
    expect(c0.y).toBeCloseTo(-50, 6)
    const last = segs[segs.length - 1] as { c: 'C'; x: number; y: number }
    expect(last.x).toBe(100)
    expect(last.y).toBe(0)
  })

  it('an over-large radius is scaled up to the same result', () => {
    const scaledUp = arcToCubics(0, 0, 10, 10, 0, false, true, 100, 0)
    const reference = arcToCubics(0, 0, 50, 50, 0, false, true, 100, 0)
    expect(scaledUp).toHaveLength(reference.length)
    for (let i = 0; i < scaledUp.length; i++) {
      const a = scaledUp[i] as { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
      const b = reference[i] as { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
      expect(a.x1).toBeCloseTo(b.x1, 9)
      expect(a.y1).toBeCloseTo(b.y1, 9)
      expect(a.x2).toBeCloseTo(b.x2, 9)
      expect(a.y2).toBeCloseTo(b.y2, 9)
      expect(a.x).toBeCloseTo(b.x, 9)
      expect(a.y).toBeCloseTo(b.y, 9)
    }
  })

  it('a rotated ellipse arc ends its first cubic where the geometry says', () => {
    const segs = arcToCubics(0, 0, 20, 10, 90, false, true, 0, 40)
    expect(segs).toHaveLength(2)
    const c0 = segs[0] as { c: 'C'; x: number; y: number }
    expect(c0.x).toBeCloseTo(10, 6)
    expect(c0.y).toBeCloseTo(20, 6)
  })

  it('a zero radius degenerates to a line', () => {
    expect(arcToCubics(0, 0, 0, 5, 0, false, true, 10, 0)).toEqual([{ c: 'L', x: 10, y: 0 }])
  })

  it('coincident endpoints produce nothing', () => {
    expect(arcToCubics(5, 5, 10, 10, 0, false, true, 5, 5)).toEqual([])
  })

  it('every cubic midpoint of a 270° arc lies within 0.03 of the circle', () => {
    const segs = arcToCubics(10, 0, 10, 10, 0, true, true, 0, -10)
    let x0 = 10
    let y0 = 0
    for (const seg of segs) {
      const c = seg as { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
      const t = 0.5
      const u = 1 - t
      const mx = u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x
      const my = u * u * u * y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y
      const r = Math.hypot(mx, my)
      expect(r).toBeGreaterThan(10 - 0.03)
      expect(r).toBeLessThan(10 + 0.03)
      x0 = c.x
      y0 = c.y
    }
    expect(x0).toBeCloseTo(0, 9)
    expect(y0).toBeCloseTo(-10, 9)
  })
})

describe('transform, bounds, primitives', () => {
  it('pathBounds includes cubic extrema', () => {
    expect(pathBounds(parsePathData('M0 0C0 -10 10 -10 10 0'))).toEqual({ x: 0, y: -7.5, width: 10, height: 7.5 })
  })

  it('pathBounds of [] is null', () => {
    expect(pathBounds([])).toBeNull()
  })

  it('transformPath translates every point', () => {
    const moved = transformPath(rectPath(0, 0, 10, 10), translation(5, 5))
    expect(pathBounds(moved)).toEqual({ x: 5, y: 5, width: 10, height: 10 })
  })

  it('pathToD of a square rect', () => {
    expect(pathToD(rectPath(0, 0, 10, 20))).toBe('M0 0L10 0L10 20L0 20Z')
  })

  it('rectPath clamps an oversized radius to half the short side', () => {
    const segs = rectPath(0, 0, 10, 10, 20, 20)
    expect(segs[0]).toEqual({ c: 'M', x: 5, y: 0 })
    expect(pathBounds(segs)).toEqual({ x: 0, y: 0, width: 10, height: 10 })
  })

  it('pathToD of an ellipse starts with the expected control handle', () => {
    expect(pathToD(ellipsePath(0, 0, 1, 1))).toMatch(/^M1 0C1 0\.552 0\.552 1 0 1/)
  })

  it('pathToD of an open and a closed polyline', () => {
    expect(pathToD(polyPath([0, 0, 1, 1], false))).toBe('M0 0L1 1')
    expect(pathToD(polyPath([0, 0, 1, 1, 2, 0], true))).toBe('M0 0L1 1L2 0Z')
  })

  it('polyPath of a single point is []', () => {
    expect(polyPath([0, 0], true)).toEqual([])
  })

  it('parsePoints drops a dangling odd value', () => {
    expect(parsePoints('4 12 10,18 20 6 7')).toEqual([4, 12, 10, 18, 20, 6])
  })

  it('pathToD rounds and normalises -0', () => {
    expect(pathToD([{ c: 'M', x: -0.0001, y: 1.23456 }])).toBe('M0 1.235')
  })

  it('rectPath/ellipsePath reject non-positive sizes', () => {
    expect(rectPath(0, 0, 0, 10)).toEqual([])
    expect(rectPath(0, 0, 10, 0)).toEqual([])
    expect(ellipsePath(0, 0, 0, 5)).toEqual([])
    expect(ellipsePath(0, 0, 5, 0)).toEqual([])
  })
})
