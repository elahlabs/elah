import { describe, expect, it } from 'vitest'
import { estimatePathLength, walkPath, type PathVisitor } from '../layers/pathLength'
import { legacyEstimatePathLength } from './helpers/legacyPathLength'

/**
 * The SVG path walker (PV-P2b).
 *
 * `estimatePathLength` feeds a shape's draw-on animation, so its numbers are
 * load-bearing in a way nobody can see: a drawing that finishes a frame early or
 * late looks like a slightly different animation, not a bug. The walker was
 * split out of the length function so `pathBounds` could share the same parse -
 * and a shared parse that parses differently is worse than two parsers, so the
 * first test here compares the whole thing against a verbatim copy of the
 * function as it was before the split, with `toBe`.
 */

/** Every listed shape, plus the cases that used to be quietly mishandled. */
const PATHS = [
  'M0 0 L100 0 L100 100 Z',
  'm10 20 h100 v50 z',
  'M100 0 C100 55.23 55.23 100 0 100',
  'M0 0 Q50 100 100 0',
  'M0 0 S50 100 100 0',
  'M0 0 T100 0',
  'M0 50 A50 50 0 0 1 100 50',
  'M0 0 L10 0 M50 50 L60 50',
  'M 1e1 2E1 L -5.5 .5',
  // An unknown command used to return early with the total so far.
  'M0 0 L10 10 X20 20',
  'garbage',
  '',
]

describe('estimatePathLength (parity with the pre-split function)', () => {
  for (const d of PATHS) {
    it(`is bit-identical for ${JSON.stringify(d)}`, () => {
      expect(estimatePathLength(d)).toBe(legacyEstimatePathLength(d))
    })
  }
})

describe('walkPath', () => {
  interface Call {
    kind: string
    args: number[]
  }

  function record(): { calls: Call[]; visitor: PathVisitor } {
    const calls: Call[] = []
    return {
      calls,
      visitor: {
        move: (x, y) => calls.push({ kind: 'move', args: [x, y] }),
        line: (x0, y0, x1, y1) => calls.push({ kind: 'line', args: [x0, y0, x1, y1] }),
        cubic: (x0, y0, x1, y1, x2, y2, x3, y3) =>
          calls.push({ kind: 'cubic', args: [x0, y0, x1, y1, x2, y2, x3, y3] }),
        arc: (x0, y0, rx, ry, rot, large, sweep, x1, y1) =>
          calls.push({ kind: 'arc', args: [x0, y0, rx, ry, rot, large ? 1 : 0, sweep ? 1 : 0, x1, y1] }),
      },
    }
  }

  it('reports every segment in order, with absolute coordinates', () => {
    const { calls, visitor } = record()
    walkPath('M10 20 l5 0 Q20 30 40 20 A5 5 0 1 0 50 20 z', visitor)

    expect(calls[0]).toEqual({ kind: 'move', args: [10, 20] })
    expect(calls[1]).toEqual({ kind: 'line', args: [10, 20, 15, 20] })
    // The quadratic arrives as the cubic it is equivalent to, which is what the
    // length function already walked.
    const quad = calls[2]!
    expect(quad.kind).toBe('cubic')
    expect(quad.args.slice(0, 2)).toEqual([15, 20])
    expect(quad.args.slice(6)).toEqual([40, 20])
    expect(calls[3]).toEqual({ kind: 'arc', args: [40, 20, 5, 5, 0, 1, 0, 50, 20] })
    // Z closes back to the subpath start, not to the last point.
    expect(calls[4]).toEqual({ kind: 'line', args: [50, 20, 10, 20] })
    expect(calls).toHaveLength(5)
  })

  it('never throws on input the length function did not survive either', () => {
    for (const d of [...PATHS, 'M0 0 A', 'M0', 'M0 0 C1 2 3', 'L5 5', 'M0 0 Z Z Z']) {
      const { visitor } = record()
      expect(() => walkPath(d, visitor)).not.toThrow()
      expect(Number.isFinite(estimatePathLength(d))).toBe(true)
    }
  })

  it('keeps the S and T approximations the length function always had', () => {
    // `S` uses the CURRENT POINT as its first control - no reflection of the
    // previous curve's - so the first control here is (0,0) and the second is
    // the (50,100) the author wrote. `Path2D` paints the reflected curve, so
    // this is an approximation; it is kept because the length and the bounds
    // must agree with each other, and two disagreeing approximations are worse
    // than one wrong one.
    const { calls, visitor } = record()
    walkPath('M0 0 S50 100 100 0', visitor)
    expect(calls[1]).toEqual({ kind: 'cubic', args: [0, 0, 0, 0, 50, 100, 100, 0] })

    const second = record()
    walkPath('M0 0 T100 0', second.visitor)
    expect(second.calls[1]).toEqual({ kind: 'line', args: [0, 0, 100, 0] })
  })

  it('stops where the old parser stopped', () => {
    // `X` is unknown: everything up to it is reported, nothing after it is.
    const { calls, visitor } = record()
    walkPath('M0 0 L10 10 X20 20 L30 30', visitor)
    expect(calls.map((c) => c.kind)).toEqual(['move', 'line'])
  })
})
