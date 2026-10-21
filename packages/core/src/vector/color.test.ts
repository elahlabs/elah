import { describe, expect, it } from 'vitest'
import { formatCssColor, mixRgba, parseCssColor, withAlpha, type Rgba } from './color'

describe('parseCssColor', () => {
  it('parses #rgb', () => {
    expect(parseCssColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 })
  })

  it('parses #rgbaAA with the alpha channel', () => {
    const c = parseCssColor('#11223380')!
    expect(c.r).toBe(17)
    expect(c.g).toBe(34)
    expect(c.b).toBe(51)
    expect(c.a).toBeCloseTo(0.502, 3)
  })

  it('parses comma rgb()', () => {
    expect(parseCssColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 })
  })

  it('parses comma rgba() with alpha', () => {
    expect(parseCssColor('rgba(10,20,30,0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
  })

  it('parses space syntax with a slash alpha percentage', () => {
    const c = parseCssColor('rgb(10 20 30 / 50%)')!
    expect(c.a).toBeCloseTo(0.5, 6)
    expect(c.r).toBe(10)
  })

  it('parses percentage channels', () => {
    expect(parseCssColor('rgb(100%, 0%, 0%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
  })

  it('is case-insensitive on named colours', () => {
    expect(parseCssColor('RED')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
  })

  it('parses transparent', () => {
    expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('returns null for hsl(), an unlisted name, and garbage', () => {
    expect(parseCssColor('hsl(0, 100%, 50%)')).toBeNull()
    expect(parseCssColor('gold')).toBeNull()
    expect(parseCssColor('nope')).toBeNull()
  })
})

describe('formatCssColor', () => {
  it('formats an opaque colour as hex', () => {
    expect(formatCssColor({ r: 255, g: 0, b: 0, a: 1 })).toBe('#ff0000')
  })

  it('formats a translucent colour as rgba()', () => {
    expect(formatCssColor({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('rgba(255, 0, 0, 0.5)')
  })
})

describe('withAlpha', () => {
  it('multiplies alpha and reformats as rgba', () => {
    expect(withAlpha('#0f172a', 0.9)).toBe('rgba(15, 23, 42, 0.9)')
  })

  it('composes with an already-translucent colour', () => {
    expect(withAlpha('rgba(0,0,0,0.5)', 0.5)).toBe('rgba(0, 0, 0, 0.25)')
  })

  it('returns an unparseable colour unchanged', () => {
    expect(withAlpha('gold', 0.5)).toBe('gold')
  })

  it('returns the input unchanged when alphaMul >= 1', () => {
    expect(withAlpha('#fff', 1)).toBe('#fff')
  })
})

describe('mixRgba', () => {
  it('mixes linearly, rounding r/g/b', () => {
    const black: Rgba = { r: 0, g: 0, b: 0, a: 1 }
    const white: Rgba = { r: 255, g: 255, b: 255, a: 1 }
    expect(mixRgba(black, white, 0.5)).toEqual({ r: 128, g: 128, b: 128, a: 1 })
  })

  it('interpolates alpha too', () => {
    const a: Rgba = { r: 0, g: 0, b: 0, a: 0 }
    const b: Rgba = { r: 0, g: 0, b: 0, a: 1 }
    expect(mixRgba(a, b, 0.25).a).toBeCloseTo(0.25, 6)
  })
})
