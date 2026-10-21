import { describe, expect, it } from 'vitest'
import type { Keyframe } from '../types'
import { samplePathChannel } from './keyframes'
import { morphCubics, parsePathToCubics, reconcileCubics, sameStructure, serializeCubics, splitCubicAt, type CubicSubpath } from './pathMorph'

function sq(s: number): import('./pathMorph').CubicSubpath[] {
  return parsePathToCubics(`M0 0 L${s} 0 L${s} ${s} L 0 ${s} Z`)!
}

describe('parsePathToCubics + serializeCubics', () => {
  it('turns a line into one cubic segment', () => {
    expect(serializeCubics(parsePathToCubics('M0 0 L10 0')!)).toBe('M 0 0 C 3.333 0 6.667 0 10 0')
  })

  it('closes a relative triangle-ish path into one closed subpath', () => {
    const [p] = parsePathToCubics('m0 0 l10 0 l0 10 z')!
    expect(p!.closed).toBe(true)
    expect(p!.segs).toHaveLength(12)
    // first segment ends at (10, 0), second at (10, 10)
    expect([p!.segs[4], p!.segs[5]]).toEqual([10, 0])
    expect([p!.segs[10], p!.segs[11]]).toEqual([10, 10])
  })

  it('treats H/V as equivalent to L', () => {
    expect(parsePathToCubics('M0 0 H10 V10')).toEqual(parsePathToCubics('M0 0 L10 0 L10 10'))
  })

  it('converts a quadratic to the exact cubic', () => {
    const [p] = parsePathToCubics('M0 0 Q5 10 10 0')!
    const [c1x, c1y, c2x, c2y, ex, ey] = p!.segs
    expect(c1x).toBeCloseTo(10 / 3, 9)
    expect(c1y).toBeCloseTo(20 / 3, 9)
    expect(c2x).toBeCloseTo(20 / 3, 9)
    expect(c2y).toBeCloseTo(20 / 3, 9)
    expect(ex).toBe(10)
    expect(ey).toBe(0)
  })

  it('reflects the previous cubic control point for S', () => {
    const [p] = parsePathToCubics('M0 0 C0 5 5 5 5 0 S10 -5 10 0')!
    // second segment's c1 is (5, -5)
    expect([p!.segs[6], p!.segs[7]]).toEqual([5, -5])
  })

  it('starts a new subpath at the close point when a command follows Z with no M', () => {
    const subpaths = parsePathToCubics('M0 0 L1 1 Z L2 2')!
    expect(subpaths).toHaveLength(2)
    expect([subpaths[1]!.x, subpaths[1]!.y]).toEqual([0, 0])
  })

  it('refuses malformed and empty input', () => {
    expect(parsePathToCubics('')).toBeNull()
    expect(parsePathToCubics('10 0')).toBeNull()
    expect(parsePathToCubics('M0')).toBeNull()
    expect(parsePathToCubics('M0 0 X1')).toBeNull()
  })
})

/** Evaluate segment `s` (6 numbers) of a subpath at t, from its start point. */
function cubicAt(from: [number, number], s: number[], t: number): [number, number] {
  const u = 1 - t
  const f = (a: number, b: number, c: number, d: number) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
  return [f(from[0], s[0]!, s[2]!, s[4]!), f(from[1], s[1]!, s[3]!, s[5]!)]
}

describe('AGN-P28: arcs become cubics', () => {
  it('the recorded circle-as-arc parses and stays within 0.5 of a true circle of radius 50', () => {
    const sub = parsePathToCubics('M50 0 A50 50 0 1 1 49.9 0')!
    expect(sub).toHaveLength(1)
    expect(sub[0]!.segs.length / 6).toBeGreaterThanOrEqual(2)
    // The chord is 0.1 long, so the centre sits 50 above or below its midpoint: (49.95, 50) or (49.95, -50).
    const n = sub[0]!.segs.length / 6
    const samples: Array<[number, number]> = []
    let from: [number, number] = [sub[0]!.x, sub[0]!.y]
    for (let i = 0; i < n; i++) {
      const s = sub[0]!.segs.slice(i * 6, i * 6 + 6)
      for (const t of [0.25, 0.5, 0.75]) samples.push(cubicAt(from, s, t))
      from = [s[4]!, s[5]!]
    }
    expect(samples.length).toBeGreaterThanOrEqual(8)
    const worst = (cy: number) => Math.max(...samples.map(([x, y]) => Math.abs(Math.hypot(x - 49.95, y - cy) - 50)))
    const best = Math.min(worst(50), worst(-50))
    expect(best).toBeLessThan(0.5)
    // A large arc starting and ending at the top runs through the bottom of the circle.
    expect(Math.max(...samples.map(([, y]) => y))).toBeGreaterThan(95)
  })

  it('a zero radius is one straight cubic, as SVG says', () => {
    const sub = parsePathToCubics('M0 0 A0 50 0 0 1 50 0')!
    expect(serializeCubics(sub)).toBe('M 0 0 C 16.667 0 33.333 0 50 0')
  })

  it('an arc whose endpoints coincide adds nothing and leaves the point where it was', () => {
    const sub = parsePathToCubics('M10 10 A5 5 0 0 1 10 10 L20 10')!
    expect(sub[0]!.segs).toHaveLength(6)
    expect(sub[0]!.segs.slice(4)).toEqual([20, 10])
    expect(parsePathToCubics('M10 10 A5 5 0 0 1 10 10')![0]!.segs).toEqual([])
  })

  it('relative a offsets the end point only, never the radii or rotation', () => {
    const rel = parsePathToCubics('M10 20 a30 30 0 0 1 60 0')!
    const abs = parsePathToCubics('M10 20 A30 30 0 0 1 70 20')!
    expect(serializeCubics(rel)).toBe(serializeCubics(abs))
  })

  it('a flag that is neither 0 nor 1 is refused, as is an arc short of its seven numbers', () => {
    expect(parsePathToCubics('M0 0 A5 5 0 2 1 10 0')).toBeNull()
    expect(parsePathToCubics('M0 0 A5 5 0 1 3 10 0')).toBeNull()
    // The legal unseparated flag form cannot be tokenized here, so it is refused rather than misread.
    expect(parsePathToCubics('M50 0 A50 50 0 11 49.9 0')).toBeNull()
    expect(parsePathToCubics('M0 0 A5 5 0 0 1 10')).toBeNull()
  })

  it('an arc key morphs with a cubic key (reconcile + sample)', () => {
    const a = parsePathToCubics('M50 0 A50 50 0 1 1 49.9 0')!
    const b = parsePathToCubics('M0 0 L100 0 L100 100 L0 100 Z')!
    expect(reconcileCubics(a, b).ok).toBe(true)
  })
})

describe('sameStructure', () => {
  it('matches two closed squares and rejects a square against a triangle', () => {
    const squareA = sq(4)
    const squareB = sq(10)
    const triangle = parsePathToCubics('M0 0 L4 0 L0 4 Z')!
    expect(sameStructure(squareA, squareB)).toBe(true)
    expect(sameStructure(squareA, triangle)).toBe(false)
  })
})

describe('morphCubics', () => {
  it('interpolates every number linearly', () => {
    const morphed = morphCubics(sq(0), sq(10), 0.5)
    expect(serializeCubics(morphed)).toBe(serializeCubics(sq(5)))
  })
})

// ---- AGN-P27: the reconciler -------------------------------------------------

const TRIANGLE = 'M 50 6 L 94 50 L 6 50 Z'
// A four-cubic circle of radius 44 about (50, 50).
const CIRCLE = 'M 94 50 C 94 74.3 74.3 94 50 94 C 25.7 94 6 74.3 6 50 C 6 25.7 25.7 6 50 6 C 74.3 6 94 25.7 94 50 Z'

function bbox(ps: ReadonlyArray<CubicSubpath>): { minX: number; minY: number; maxX: number; maxY: number } {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const p of ps) {
    const pts = [p.x, p.y, ...p.segs]
    for (let i = 0; i < pts.length; i += 2) {
      b.minX = Math.min(b.minX, pts[i]!)
      b.maxX = Math.max(b.maxX, pts[i]!)
      b.minY = Math.min(b.minY, pts[i + 1]!)
      b.maxY = Math.max(b.maxY, pts[i + 1]!)
    }
  }
  return b
}

/** Shoelace area of a subpath's anchor polygon (start + each segment end). */
function anchorArea(p: CubicSubpath): number {
  const pts: Array<[number, number]> = [[p.x, p.y]]
  for (let i = 0; i < p.segs.length; i += 6) pts.push([p.segs[i + 4]!, p.segs[i + 5]!])
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!
    const [x2, y2] = pts[(i + 1) % pts.length]!
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

function bezier(s: ReadonlyArray<number>, t: number): [number, number] {
  const u = 1 - t
  const f = (a: number, b: number, c: number, d: number) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
  return [f(s[0]!, s[2]!, s[4]!, s[6]!), f(s[1]!, s[3]!, s[5]!, s[7]!)]
}

describe('splitCubicAt', () => {
  const seg = [3, 4, 10, -2, 20, 15, 31, 9]
  it('draws the identical curve in both halves', () => {
    const [h1, h2] = splitCubicAt(seg, 0.5)
    for (const t of [0, 0.125, 0.25, 0.375, 0.5]) {
      const [ox, oy] = bezier(seg, t)
      const [hx, hy] = bezier(h1, t * 2)
      expect(Math.abs(ox - hx)).toBeLessThan(1e-9)
      expect(Math.abs(oy - hy)).toBeLessThan(1e-9)
    }
    for (const t of [0.5, 0.625, 0.75, 0.875, 1]) {
      const [ox, oy] = bezier(seg, t)
      const [hx, hy] = bezier(h2, (t - 0.5) * 2)
      expect(Math.abs(ox - hx)).toBeLessThan(1e-9)
      expect(Math.abs(oy - hy)).toBeLessThan(1e-9)
    }
  })
})

describe('reconcileCubics', () => {
  it('the live failure: a 2-segment triangle and a 4-cubic circle reconcile and morph', () => {
    const tri = parsePathToCubics(TRIANGLE)!
    const circ = parsePathToCubics(CIRCLE)!
    expect(sameStructure(tri, circ)).toBe(false)
    const r = reconcileCubics(tri, circ)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.a[0]!.segs.length / 6).toBe(4)
    expect(r.b[0]!.segs.length / 6).toBe(4)
    expect(sameStructure(r.a, r.b)).toBe(true)
    // The raised triangle still draws the triangle: its anchors are on the original edges' extent.
    const mid = parsePathToCubics(serializeCubics(morphCubics(r.a, r.b, 0.5)))!
    expect(mid).not.toBeNull()
    const bt = bbox(tri)
    const bc = bbox(circ)
    const bm = bbox(mid)
    const eps = 0.01
    expect(bm.minX).toBeGreaterThanOrEqual(Math.min(bt.minX, bc.minX) - eps)
    expect(bm.maxX).toBeLessThanOrEqual(Math.max(bt.maxX, bc.maxX) + eps)
    expect(bm.minY).toBeGreaterThanOrEqual(Math.min(bt.minY, bc.minY) - eps)
    expect(bm.maxY).toBeLessThanOrEqual(Math.max(bt.maxY, bc.maxY) + eps)
    // ...and on each edge it lies between the two (bbox of control-point hulls).
    for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) {
      const lo = Math.min(bt[k], bc[k]) - eps
      const hi = Math.max(bt[k], bc[k]) + eps
      expect(bm[k]).toBeGreaterThanOrEqual(lo)
      expect(bm[k]).toBeLessThanOrEqual(hi)
    }
  })

  it('returns the inputs untouched when the structure matches and every subpath is open', () => {
    const a = parsePathToCubics('M0 0 L10 0 L10 10')!
    const b = parsePathToCubics('M0 0 L20 0 L20 20')!
    const r = reconcileCubics(a, b)
    expect(r.ok && r.a[0]).toBe(a[0])
    expect(r.ok && r.b[0]).toBe(b[0])
  })

  it('tie-break: a same-structure pair already in its best correspondence keeps rotation 0, forward', () => {
    const a = parsePathToCubics('M0 0 L100 0 L100 100 L0 100 Z')!
    const b = parsePathToCubics('M10 10 L200 10 L200 200 L10 200 Z')!
    const r = reconcileCubics(a, b)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // The only change from the authored b is the explicit closing edge: same start, same anchor order.
    const explicit = parsePathToCubics('M10 10 L200 10 L200 200 L10 200 L10 10 Z')!
    expect(r.b).toEqual(explicit)
    expect(r.a).toEqual(parsePathToCubics('M0 0 L100 0 L100 100 L0 100 L0 0 Z')!)
    // And its mid-span geometry is the plain linear morph of the authored paths (anchor by anchor).
    const mid = morphCubics(r.a, r.b, 0.5)[0]!
    expect([mid.x, mid.y]).toEqual([5, 5])
    expect(mid.segs.slice(4, 6)).toEqual([150, 5])
    expect(mid.segs.slice(10, 12)).toEqual([150, 150])
  })

  it('tie-break: when every candidate costs the same, the first (rotation 0, forward) wins', () => {
    // A point-ring against a square: every rotation and winding has identical cost.
    const a = parsePathToCubics('M50 50 L50 50 L50 50 L50 50 Z')!
    const b = parsePathToCubics('M0 0 L100 0 L100 100 L0 100 Z')!
    const r = reconcileCubics(a, b)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.b).toEqual(parsePathToCubics('M0 0 L100 0 L100 100 L0 100 L0 0 Z')!)
  })

  it('same-structure square against itself started at the opposite corner does not collapse', () => {
    const a = parsePathToCubics('M0 0 L100 0 L100 100 L0 100 Z')!
    const b = parsePathToCubics('M100 100 L0 100 L0 0 L100 0 Z')!
    expect(sameStructure(a, b)).toBe(true)
    const r = reconcileCubics(a, b)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const mid = morphCubics(r.a, r.b, 0.5)
    expect(anchorArea(mid[0]!) / anchorArea(a[0]!)).toBeGreaterThan(0.95)
    // Before AGN-P27's fast-path fix this pair morphed (plain lerp) to a single point.
    expect(anchorArea(morphCubics(a, b, 0.5)[0]!)).toBe(0)
  })

  it('same-structure square against its reversed ring does not turn inside out', () => {
    const a = parsePathToCubics('M0 0 L100 0 L100 100 L0 100 Z')!
    const b = parsePathToCubics('M0 0 L0 100 L100 100 L100 0 Z')!
    expect(sameStructure(a, b)).toBe(true)
    const r = reconcileCubics(a, b)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(anchorArea(morphCubics(r.a, r.b, 0.5)[0]!) / anchorArea(a[0]!)).toBeGreaterThan(0.95)
    expect(anchorArea(morphCubics(a, b, 0.5)[0]!)).toBeLessThan(1)
  })

  it('the explicit closing edge is visually neutral', () => {
    const src = 'M10 10 C 40 0 70 0 90 10 L 80 60 L 20 60 Z'
    const orig = parsePathToCubics(src)!
    const self = reconcileCubics(orig, orig)
    expect(self.ok).toBe(true)
    if (!self.ok) return
    const closing = self.a[0]!.segs.slice(-6)
    // The appended edge is a straight cubic from the last end back to the start: controls at the thirds, ends at the start.
    const [lx, ly] = [orig[0]!.segs.at(-2)!, orig[0]!.segs.at(-1)!]
    expect(closing[4]).toBe(orig[0]!.x)
    expect(closing[5]).toBe(orig[0]!.y)
    expect(closing[0]).toBeCloseTo(lx + (orig[0]!.x - lx) / 3, 9)
    expect(closing[1]).toBeCloseTo(ly + (orig[0]!.y - ly) / 3, 9)
    expect(closing[2]).toBeCloseTo(lx + (2 * (orig[0]!.x - lx)) / 3, 9)
    expect(closing[3]).toBeCloseTo(ly + (2 * (orig[0]!.y - ly)) / 3, 9)
    // Everything before the closing edge is byte-identical to the authored path.
    expect(self.a[0]!.segs.slice(0, -6)).toEqual(orig[0]!.segs)
    // The no-op morph at any t re-parses to the original shape plus that straight edge.
    for (const t of [0, 0.25, 0.5, 1]) {
      const re = parsePathToCubics(serializeCubics(morphCubics(self.a, self.b, t)))![0]!
      expect(re.segs.length).toBe(orig[0]!.segs.length + 6)
      expect(re.closed).toBe(true)
      for (let i = 0; i < orig[0]!.segs.length; i++) expect(Math.abs(re.segs[i]! - orig[0]!.segs[i]!)).toBeLessThan(1e-3)
    }
  })

  it('a ring whose closing edge is already explicit (start equals end) gains nothing', () => {
    const a = parsePathToCubics('M0 0 L100 0 L100 100 L0 100 L0 0 Z')!
    const r = reconcileCubics(a, a)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.a).toEqual(a)
    expect(r.b).toEqual(a)
    for (const t of [0, 0.5, 1]) expect(serializeCubics(morphCubics(r.a, r.b, t))).toBe(serializeCubics(a))
  })

  it('chooses a rotation: a square against itself rotated two segments does not collapse', () => {
    const a = parsePathToCubics('M0 0 L100 0 L100 100 L0 100 Z')!
    // Written with its closing edge out, so the structure differs (4 vs 3 segments) and the reconciler runs.
    const b = parsePathToCubics('M100 100 L0 100 L0 0 L100 0 L100 100 Z')!
    const r = reconcileCubics(a, b)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const mid = morphCubics(r.a, r.b, 0.5)
    const bm = bbox(mid)
    const bs = bbox(a)
    expect(Math.abs((bm.maxX - bm.minX) / (bs.maxX - bs.minX) - 1)).toBeLessThan(0.05)
    expect(Math.abs((bm.maxY - bm.minY) / (bs.maxY - bs.minY) - 1)).toBeLessThan(0.05)
    expect(anchorArea(mid[0]!) / anchorArea(a[0]!)).toBeGreaterThan(0.95)
  })

  it('chooses a winding: a square against its reversed ring does not turn inside out', () => {
    const a = parsePathToCubics('M0 0 L100 0 L100 100 L0 100 Z')!
    const b = parsePathToCubics('M0 0 L0 100 L100 100 L100 0 L0 0 Z')!
    const r = reconcileCubics(a, b)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const mid = morphCubics(r.a, r.b, 0.5)
    // A bounding box cannot see inside-out (the diagonal collapse keeps the full box); the anchor polygon's area does.
    expect(anchorArea(mid[0]!) / anchorArea(a[0]!)).toBeGreaterThan(0.95)
  })

  it('pairs a surplus subpath with a point at its centroid', () => {
    const a = parsePathToCubics('M0 0 L100 0 L100 100 L0 100 Z')!
    const b = parsePathToCubics('M0 0 L100 0 L100 100 L0 100 Z M200 200 L300 200 L300 300 L200 300 Z')!
    const r = reconcileCubics(a, b)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.a).toHaveLength(2)
    expect(sameStructure(r.a, r.b)).toBe(true)
    const t0 = bbox([morphCubics(r.a, r.b, 0)[1]!])
    expect(t0.maxX - t0.minX).toBe(0)
    expect(t0.maxY - t0.minY).toBe(0)
    expect(t0.minX).toBeCloseTo(250, 9)
    expect(t0.minY).toBeCloseTo(250, 9)
    expect(morphCubics(r.a, r.b, 1)[1]).toEqual(r.b[1])
    // and the other way round: the surplus collapses into its centroid
    const back = reconcileCubics(b, a)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    const end = bbox([morphCubics(back.a, back.b, 1)[1]!])
    expect(end.maxX - end.minX).toBe(0)
  })

  it('refuses closed against open with a real gap, naming it', () => {
    const closed = parsePathToCubics('M0 0 L100 0 L100 100 L0 100 Z')!
    const open = parsePathToCubics('M0 0 L100 0 L100 100')!
    const r = reconcileCubics(closed, open)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/open/)
    expect(r.reason).toMatch(/closed/)
  })

  it('reconciles closed against open whose ends coincide', () => {
    const closed = parsePathToCubics('M0 0 L100 0 L100 100 L0 100 Z')!
    const open = parsePathToCubics('M0 0 L100 0 L100 100 L0 100 L0 0')!
    const r = reconcileCubics(closed, open)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(sameStructure(r.a, r.b)).toBe(true)
    expect(r.a[0]!.closed).toBe(true)
  })

  it('refuses a pair that would need more than 512 segments', () => {
    const big = `M0 0 ${Array.from({ length: 300 }, (_, i) => `L${i + 1} ${i % 7}`).join(' ')} Z`
    const other = `M0 0 ${Array.from({ length: 5 }, (_, i) => `L${i + 1} 9`).join(' ')} Z M5 5 ${Array.from({ length: 300 }, (_, i) => `L${i} 3`).join(' ')} Z`
    const r = reconcileCubics(parsePathToCubics(big)!, parsePathToCubics(other)!)
    expect(r.ok).toBe(false)
  })

  it('is deterministic and never mutates its inputs', () => {
    const a = parsePathToCubics(TRIANGLE)!
    const b = parsePathToCubics(CIRCLE + ' M1 1 L5 5 L1 9 Z')!
    const copyA = structuredClone(a)
    const copyB = structuredClone(b)
    const r1 = reconcileCubics(a, b)
    const r2 = reconcileCubics(a, b)
    expect(r1).toEqual(r2)
    expect(a).toEqual(copyA)
    expect(b).toEqual(copyB)
  })
})

describe('samplePathChannel morphs a reconciled pair', () => {
  const key = (frame: number, path: string): Keyframe => ({ id: 'p-'+frame, frame, value: 0, path, easing: 'linear' })
  const keys = [key(0, TRIANGLE), key(60, CIRCLE)]
  it('is neither key mid-span, parses, and is byte-exact on the keys', () => {
    const mid = samplePathChannel(keys, 30)!
    expect(mid).not.toBe(TRIANGLE)
    expect(mid).not.toBe(CIRCLE)
    expect(parsePathToCubics(mid)).not.toBeNull()
    expect(samplePathChannel(keys, 0)).toBe(TRIANGLE)
    expect(samplePathChannel(keys, 60)).toBe(CIRCLE)
  })
  it('same-structure square to the same square from the opposite corner morphs through a square, not a point', () => {
    const ks = [key(0, 'M0 0 L100 0 L100 100 L0 100 Z'), key(60, 'M100 100 L0 100 L0 0 L100 0 Z')]
    const mid = parsePathToCubics(samplePathChannel(ks, 30)!)!
    expect(anchorArea(mid[0]!)).toBeGreaterThan(9500)
    expect(samplePathChannel(ks, 0)).toBe('M0 0 L100 0 L100 100 L0 100 Z')
    expect(samplePathChannel(ks, 60)).toBe('M100 100 L0 100 L0 0 L100 0 Z')
  })
  it('still holds a genuinely irreconcilable pair', () => {
    const open = 'M0 0 L100 0 L100 100'
    const ks = [key(0, 'M0 0 L100 0 L100 100 L0 100 Z'), key(60, open)]
    expect(samplePathChannel(ks, 30)).toBe('M0 0 L100 0 L100 100 L0 100 Z')
  })
})
