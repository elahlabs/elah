import { describe, expect, it } from 'vitest'
import { pathBounds } from '../layers/pathBounds'

/**
 * Path bounds (PV-P2b).
 *
 * The numbers are the whole point: a freehand clip's box IS its path, so a bound
 * that is 2 px short is a selection box that does not fit its own drawing. The
 * fixtures are chosen for the cases where a naive bound is wrong - a curve's
 * true extreme is not on its endpoints, an arc bulges away from its chord, and a
 * `Z` that closes back to the start must not add a phantom corner.
 */

function expectBox(
  d: string,
  expected: { x: number; y: number; width: number; height: number },
): void {
  const box = pathBounds(d)!
  expect(box).toBeDefined()
  expect(box.x).toBeCloseTo(expected.x, 6)
  expect(box.y).toBeCloseTo(expected.y, 6)
  expect(box.width).toBeCloseTo(expected.width, 6)
  expect(box.height).toBeCloseTo(expected.height, 6)
}

describe('pathBounds', () => {
  it('bounds a closed path by its corners', () => {
    expectBox('M10 20 L110 20 L110 70 Z', { x: 10, y: 20, width: 100, height: 50 })
    // Relative spelling of the same shape: the walk resolves it to the same
    // absolute numbers, which is the point of sharing one parser.
    expectBox('m10 20 h100 v50 z', { x: 10, y: 20, width: 100, height: 50 })
  })

  it('bounds a cubic by its sampled curve, not its control hull', () => {
    // The control points reach y=100, the curve only 75. A hull-based bound
    // would be 25 px too tall.
    expectBox('M0 0 C0 100 100 100 100 0', { x: 0, y: 0, width: 100, height: 75 })
  })

  it('bounds a quadratic through its converted cubic', () => {
    expectBox('M0 0 Q50 100 100 0', { x: 0, y: 0, width: 100, height: 50 })
  })

  it('bounds an arc by the arc, not the chord', () => {
    // Sweep 1 bulges up through (50, 0); sweep 0 bulges down through (50, 100).
    expectBox('M0 50 A50 50 0 0 1 100 50', { x: 0, y: 0, width: 100, height: 50 })
    expectBox('M0 50 A50 50 0 0 0 100 50', { x: 0, y: 50, width: 100, height: 50 })
  })

  it('treats a zero radius as a straight line, per SVG', () => {
    expectBox('M0 0 A0 10 0 0 1 20 0', { x: 0, y: 0, width: 20, height: 0 })
  })

  it('bounds a lone moveto as a zero-size box at that point', () => {
    expectBox('M5 5', { x: 5, y: 5, width: 0, height: 0 })
  })

  it('stops where the walk stops', () => {
    // `X` is unknown, so the last segment is not part of the path.
    expectBox('M0 0 L10 10 X20 20', { x: 0, y: 0, width: 10, height: 10 })
  })

  it('has no box for input that yields no point', () => {
    expect(pathBounds('')).toBeNull()
    expect(pathBounds('garbage')).toBeNull()
  })

  it('covers both extremes of an S path, as the shared walk sees it', () => {
    // `S` uses the current point as its first control (see walkPath), so the
    // curve it walks differs from the one Path2D paints. The box is the box of
    // what the walk measured - the two are approximations on purpose, and
    // agreeing with each other is worth more than either being exact.
    const box = pathBounds('M0 0 S50 100 100 0')!
    expect(box.x).toBeCloseTo(0, 6)
    expect(box.x + box.width).toBeCloseTo(100, 6)
    expect(box.y).toBeCloseTo(0, 6)
    expect(box.height).toBeGreaterThan(40)
    expect(box.height).toBeLessThan(60)
  })
})
