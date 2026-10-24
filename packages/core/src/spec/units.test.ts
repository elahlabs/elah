import { describe, expect, it } from 'vitest'
import { clampIssue, designColorMap, designFontMap, isHexColor, pixelBox, resolveToken, toDurationFrames, toFrames, toRadians } from './units'
import type { SpecIssue } from './types'

describe('toFrames / toDurationFrames', () => {
  it('rounds seconds to the nearest frame at the given fps', () => {
    expect(toFrames(1, 30)).toBe(30)
    expect(toFrames(0.5, 30)).toBe(15)
    expect(toFrames(1.017, 30)).toBe(31) // rounds, does not floor
  })

  it('toFrames floors at 0 — a position can be the first frame, never before it', () => {
    expect(toFrames(-5, 30)).toBe(0)
  })

  it('toDurationFrames floors at 1 — a zero-length clip must be impossible', () => {
    expect(toDurationFrames(0, 30)).toBe(1)
    expect(toDurationFrames(-1, 30)).toBe(1)
    expect(toDurationFrames(0.001, 30)).toBe(1)
  })

  it('non-finite input reads as 0 seconds rather than throwing or producing NaN', () => {
    expect(toFrames(NaN, 30)).toBe(0)
    expect(toDurationFrames(NaN, 30)).toBe(1)
  })
})

describe('toRadians', () => {
  it('converts degrees to radians', () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI, 10)
    expect(toRadians(90)).toBeCloseTo(Math.PI / 2, 10)
    expect(toRadians(0)).toBe(0)
  })
})

describe('pixelBox — against a NON-square stage', () => {
  const stage = { width: 1080, height: 1920 } // portrait: short side is width
  it('scale is always 1 for an exact box', () => {
    expect(pixelBox({ w: 300, h: 300 }, stage).scale).toBe(1)
  })

  it('scaleX / scaleY are w/h divided by the SHORTER stage side', () => {
    const short = Math.min(stage.width, stage.height) // 1080
    const box = pixelBox({ w: 540, h: 216 }, stage)
    expect(box.scaleX).toBeCloseTo(540 / short, 10)
    expect(box.scaleY).toBeCloseTo(216 / short, 10)
  })

  it('the same w/h box scales differently against a stage with a different SHORT side', () => {
    const a = { width: 800, height: 600 } // short = 600
    const b = { width: 1200, height: 900 } // short = 900
    const boxA = pixelBox({ w: 300, h: 150 }, a)
    const boxB = pixelBox({ w: 300, h: 150 }, b)
    expect(boxA.scaleX).toBeCloseTo(0.5, 10)
    expect(boxB.scaleX).toBeCloseTo(300 / 900, 10)
    expect(boxA.scaleX).not.toBeCloseTo(boxB.scaleX, 5)
  })

  it('degenerate stage (non-positive short side) returns 0, not Infinity/NaN', () => {
    const box = pixelBox({ w: 100, h: 100 }, { width: 0, height: 500 })
    expect(box.scaleX).toBe(0)
    expect(box.scaleY).toBe(0)
    expect(Number.isFinite(box.scaleX)).toBe(true)
  })
})

describe('resolveToken', () => {
  it('passes a literal (non-$) value through unchanged', () => {
    expect(resolveToken('#ff0000', { accent: '#00ff00' })).toBe('#ff0000')
  })
  it('resolves a $token from the map', () => {
    expect(resolveToken('$accent', { accent: '#00ff00' })).toBe('#00ff00')
  })
  it('returns undefined for a $token with no entry, rather than the literal "$name" string', () => {
    expect(resolveToken('$missing', { accent: '#00ff00' })).toBeUndefined()
  })
})

describe('designColorMap / designFontMap', () => {
  it('builds a name -> value map from design.colors', () => {
    expect(designColorMap({ colors: [{ name: 'accent', value: '#22c55e' }] })).toEqual({ accent: '#22c55e' })
  })
  it('builds a role -> font id map from design.fonts', () => {
    expect(designFontMap({ fonts: [{ role: 'serif', font: 'playfair-display' }] })).toEqual({ serif: 'playfair-display' })
  })
  it('is {} for undefined design', () => {
    expect(designColorMap(undefined)).toEqual({})
    expect(designFontMap(undefined)).toEqual({})
  })
})

describe('isHexColor', () => {
  it('accepts #rgb and #rrggbb', () => {
    expect(isHexColor('#fff')).toBe(true)
    expect(isHexColor('#ffffff')).toBe(true)
    expect(isHexColor('#AbC123')).toBe(true)
  })
  it('rejects anything else', () => {
    expect(isHexColor('red')).toBe(false)
    expect(isHexColor('#ffff')).toBe(false)
    expect(isHexColor('#gggggg')).toBe(false)
    expect(isHexColor('')).toBe(false)
  })
})

describe('clampIssue', () => {
  it('returns the value unchanged and pushes no issue when it is already in range', () => {
    const issues: SpecIssue[] = []
    expect(clampIssue(0.5, 0, 1, 'x', issues)).toBe(0.5)
    expect(issues).toHaveLength(0)
  })
  it('clamps and pushes a warn issue when the value is out of range', () => {
    const issues: SpecIssue[] = []
    expect(clampIssue(5, 0, 1, 'x', issues)).toBe(1)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'warn', path: 'x', code: 'clamped' })
  })
})
