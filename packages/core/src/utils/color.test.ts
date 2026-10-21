import { describe, expect, it } from 'vitest'
import { formatColor, lerpColor, parseColor, toRgba, vecToHex } from './color'

describe('parseColor', () => {
  it('parses hex forms', () => {
    expect(parseColor('#fff')).toEqual([1, 1, 1, 1])
    expect(parseColor('#ff000080')).toEqual([1, 0, 0, 128 / 255])
    expect(parseColor('#0f08')).toEqual([0, 1, 0, 136 / 255])
  })

  it('parses rgb()/rgba() with commas or spaces', () => {
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual([1, 0, 0, 0.5])
    expect(parseColor('rgb(0 128 255)')).toEqual([0, 128 / 255, 1, 1])
  })

  it('parses named colours, trimmed and case-insensitive', () => {
    expect(parseColor(' Transparent ')).toEqual([0, 0, 0, 0])
    expect(parseColor('WHITE')).toEqual([1, 1, 1, 1])
    expect(parseColor('black')).toEqual([0, 0, 0, 1])
  })

  it('returns undefined for unusable input', () => {
    expect(parseColor('nope')).toBeUndefined()
    expect(parseColor('')).toBeUndefined()
    expect(parseColor(undefined)).toBeUndefined()
    expect(parseColor('#12345')).toBeUndefined()
  })
})

describe('formatColor', () => {
  it('formats opaque colours as hex', () => {
    expect(formatColor([1, 0, 0, 1])).toBe('#ff0000')
  })

  it('formats translucent colours as rgba()', () => {
    expect(formatColor([1, 0, 0, 0.5])).toBe('rgba(255, 0, 0, 0.5)')
    expect(formatColor([0, 0, 0, 0])).toBe('rgba(0, 0, 0, 0)')
  })

  it('clamps out-of-range components', () => {
    expect(formatColor([2, -1, 0.25, 1])).toBe('#ff0040')
  })
})

describe('vecToHex', () => {
  it('ignores alpha', () => {
    expect(vecToHex([1, 0, 0, 0.2])).toBe('#ff0000')
  })
})

describe('lerpColor', () => {
  it('interpolates premultiplied so transparent -> red does not pass through black', () => {
    expect(lerpColor([0, 0, 0, 0], [1, 0, 0, 1], 0.5)).toEqual([1, 0, 0, 0.5])
  })

  it('interpolates two opaque colours', () => {
    expect(lerpColor([1, 0, 0, 1], [0, 0, 1, 1], 0.25)).toEqual([0.75, 0, 0.25, 1])
  })
})

describe('toRgba', () => {
  it('pads a 3-element array with alpha 1', () => {
    expect(toRgba([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3, 1])
  })

  it('rejects non-finite, wrong-length or non-array input', () => {
    expect(toRgba([1, NaN, 0])).toBeUndefined()
    expect(toRgba([1, 2])).toBeUndefined()
    expect(toRgba('x')).toBeUndefined()
  })
})
