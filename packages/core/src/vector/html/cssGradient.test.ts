import { describe, it, expect } from 'vitest'
import { cssGradientToPaint } from './cssGradient'

function linear(css: string, box?: { width: number; height: number }) {
  const r = cssGradientToPaint(css, box)
  if (!r.ok || r.paint.type !== 'linear') throw new Error('expected a linear paint: ' + JSON.stringify(r))
  return r.paint
}

describe('cssGradientToPaint linear', () => {
  it('maps the CSS angle origin (0deg = up) onto the engine angle (0 = right)', () => {
    expect(linear('linear-gradient(90deg, #000, #fff)').angle).toBe(0)
    expect(linear('linear-gradient(180deg, #000, #fff)').angle).toBe(90)
    expect(linear('linear-gradient(0deg, #000, #fff)').angle).toBe(270)
  })

  it('defaults to "to bottom"', () => {
    expect(linear('linear-gradient(#000, #fff)').angle).toBe(90)
  })

  it('reads side keywords and turn units', () => {
    expect(linear('linear-gradient(to right, #000, #fff)').angle).toBe(0)
    expect(linear('linear-gradient(to top, #000, #fff)').angle).toBe(270)
    expect(linear('linear-gradient(0.25turn, #000, #fff)').angle).toBe(0)
  })

  it('computes corner directions from the box', () => {
    // A square: to bottom right is 135deg CSS = 45 engine.
    expect(linear('linear-gradient(to bottom right, #000, #fff)', { width: 100, height: 100 }).angle).toBeCloseTo(45, 6)
  })

  it('spreads unpositioned stops evenly and keeps explicit ones', () => {
    const p = linear('linear-gradient(90deg, #000, #888, #fff)')
    expect(p.stops.map((s) => s.offset)).toEqual([0, 0.5, 1])
    const q = linear('linear-gradient(90deg, #f00 10%, rgba(0, 0, 255, 0.5) 60%, #fff)')
    expect(q.stops.map((s) => s.offset)).toEqual([0.1, 0.6, 1])
    expect(q.stops[1].color).toBe('rgba(0, 0, 255, 0.5)')
  })

  it('reads px positions against the gradient line', () => {
    const p = linear('linear-gradient(90deg, #000 0px, #fff 50px)', { width: 200, height: 40 })
    expect(p.stops.map((s) => s.offset)).toEqual([0, 0.25])
  })

  it('never lets a position go backwards', () => {
    const p = linear('linear-gradient(90deg, #000 60%, #888 20%, #fff)')
    const offsets = p.stops.map((s) => s.offset)
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
  })
})

describe('cssGradientToPaint radial', () => {
  it('centres by default and reaches the farthest corner', () => {
    const r = cssGradientToPaint('radial-gradient(#fff, #000)')
    expect(r.ok && r.paint.type === 'radial' && r.paint.cx).toBe(0.5)
    expect(r.ok && r.paint.type === 'radial' && r.paint.r).toBeCloseTo(1, 6)
  })

  it('reads "circle at x% y%"', () => {
    const r = cssGradientToPaint('radial-gradient(circle at 20% 30%, #fff, #000)', { width: 100, height: 100 })
    if (!r.ok || r.paint.type !== 'radial') throw new Error('expected radial')
    expect(r.paint.cx).toBeCloseTo(0.2, 6)
    expect(r.paint.cy).toBeCloseTo(0.3, 6)
    expect(r.paint.r).toBeGreaterThan(1)
  })
})

describe('cssGradientToPaint refusals', () => {
  it('returns a reason, never throws', () => {
    for (const bad of ['repeating-conic-gradient(#fff, #000)', 'repeating-linear-gradient(#fff, #000)', 'linear-gradient(red-ish, #000)', 'linear-gradient(90deg, #000 10)', 'none', '']) {
      const r = cssGradientToPaint(bad)
      expect(r.ok).toBe(false)
    }
  })
})
