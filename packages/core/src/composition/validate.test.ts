import { describe, it, expect } from 'vitest'
import { coerceProp, fallbackValue, isMediaUrl, validateProps } from './validate'
import type { PropDef } from './types'
import { FONT_REGISTRY } from '../fonts/registry'

const DEFAULT_FONT = FONT_REGISTRY[0]!.id

const P: PropDef[] = [
  { name: 'title', type: 'text', label: 'Title', default: 'Hello', maxLength: 10 },
  { name: 'size', type: 'number', label: 'Size', default: 48, min: 8, max: 200, integer: true },
  { name: 'accent', type: 'color', label: 'Accent', default: '#ffcc00' },
  { name: 'show', type: 'boolean', label: 'Show', default: true },
  { name: 'style', type: 'enum', label: 'Style', default: 'bold', options: ['bold', 'light'] },
  { name: 'logo', type: 'image', label: 'Logo', default: '' },
  { name: 'font', type: 'fontId', label: 'Font', default: DEFAULT_FONT },
]

describe('validateProps', () => {
  it('gives the defaults for empty input, no issues, ok', () => {
    const result = validateProps(P, {})
    expect(result.values).toEqual({
      title: 'Hello',
      size: 48,
      accent: '#ffcc00',
      show: true,
      style: 'bold',
      logo: '',
      font: DEFAULT_FONT,
    })
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('reads CSV-shaped strings', () => {
    const result = validateProps(P, {
      title: 'Hi',
      size: '64',
      accent: '#FF0000',
      show: 'no',
      style: 'light',
      logo: 'https://cdn.example/l.png',
    })
    expect(result.values).toEqual({
      title: 'Hi',
      size: 64,
      accent: '#ff0000',
      show: false,
      style: 'light',
      logo: 'https://cdn.example/l.png',
      font: DEFAULT_FONT,
    })
    expect(result.ok).toBe(true)
  })

  it('clamps an out-of-range number with a warning; ok stays true', () => {
    const result = validateProps(P, { size: '300' })
    expect(result.values.size).toBe(200)
    expect(result.issues).toEqual([
      expect.objectContaining({ kind: 'prop', prop: 'size', code: 'out-of-range', severity: 'warning' }),
    ])
    expect(result.ok).toBe(true)
  })

  it('rounds a fractional number with no issue', () => {
    expect(validateProps(P, { size: '63.6' }).values.size).toBe(64)
    expect(validateProps(P, { size: '63.6' }).issues).toEqual([])
    expect(validateProps(P, { size: 12.5 }).values.size).toBe(13)
  })

  it('reports a wrong-type number as an error, falling back to default or base', () => {
    const noBase = validateProps(P, { size: 'big' })
    expect(noBase.values.size).toBe(48)
    expect(noBase.ok).toBe(false)
    expect(noBase.issues).toEqual([
      expect.objectContaining({ prop: 'size', code: 'wrong-type', severity: 'error' }),
    ])

    const withBase = validateProps(P, { size: 'big' }, { size: 72 })
    expect(withBase.values.size).toBe(72)
    expect(withBase.ok).toBe(false)
  })

  it('expands a 3-digit colour and rejects a non-hex string', () => {
    expect(validateProps(P, { accent: '#f00' }).values.accent).toBe('#ff0000')
    const bad = validateProps(P, { accent: 'red' })
    expect(bad.issues).toEqual([expect.objectContaining({ prop: 'accent', code: 'bad-color', severity: 'error' })])
    expect(bad.ok).toBe(false)
  })

  it('rejects an enum value outside its options', () => {
    const result = validateProps(P, { style: 'heavy' })
    expect(result.issues).toEqual([expect.objectContaining({ prop: 'style', code: 'not-an-option', severity: 'error' })])
    expect(result.ok).toBe(false)
  })

  it('truncates text past maxLength with a warning', () => {
    const result = validateProps(P, { title: 'Hello there world' })
    expect(result.values.title).toBe('Hello ther')
    expect(result.issues).toEqual([expect.objectContaining({ prop: 'title', code: 'too-long', severity: 'warning' })])
    expect(result.ok).toBe(true)
  })

  it('rejects unsafe or non-web logo URLs and accepts safe ones', () => {
    for (const bad of ['javascript:alert(1)', '//evil.example/x.png', 'file:///c/x.png']) {
      const result = validateProps(P, { logo: bad })
      expect(result.issues, bad).toEqual([expect.objectContaining({ prop: 'logo', code: 'bad-url', severity: 'error' })])
      expect(result.ok, bad).toBe(false)
    }
    for (const good of ['/media/a.png', 'blob:http://localhost:3001/abc', 'data:image/png;base64,AAAA']) {
      const result = validateProps(P, { logo: good })
      expect(result.issues, good).toEqual([])
      expect(result.values.logo, good).toBe(good)
    }
  })

  it('rejects an unregistered font id', () => {
    const result = validateProps(P, { font: 'no-such-font' })
    expect(result.issues).toEqual([expect.objectContaining({ prop: 'font', code: 'unknown-font', severity: 'error' })])
    expect(result.ok).toBe(false)
  })

  it('treats an empty string as absent', () => {
    const result = validateProps(P, { title: '' })
    expect(result.values.title).toBe('Hello')
    expect(result.issues).toEqual([])
  })

  it('reports an unknown key as a warning, and keeps ok true', () => {
    const result = validateProps(P, { colour: '#fff' })
    expect(result.issues).toEqual([
      expect.objectContaining({ kind: 'prop', prop: 'colour', code: 'unknown-prop', severity: 'warning' }),
    ])
    expect(result.ok).toBe(true)
  })

  it('falls back to a base value when input is absent', () => {
    const result = validateProps(P, {}, { title: 'Saved' })
    expect(result.values.title).toBe('Saved')
  })

  it.each([
    ['TRUE', true],
    [' yes ', true],
    ['1', true],
    [1, true],
    [true, true],
  ])('coerces boolean input %j -> %j', (raw, expected) => {
    const result = validateProps(P, { show: raw })
    expect(result.values.show).toBe(expected)
    expect(result.issues).toEqual([])
  })

  it('rejects an unrecognised boolean string', () => {
    const result = validateProps(P, { show: 'maybe' })
    expect(result.issues).toEqual([expect.objectContaining({ prop: 'show', code: 'wrong-type', severity: 'error' })])
    expect(result.ok).toBe(false)
  })
})

describe('coerceProp — absent input', () => {
  it('treats undefined, null and empty string as absent', () => {
    const def = P[0]!
    expect(coerceProp(def, undefined)).toEqual({})
    expect(coerceProp(def, null)).toEqual({})
    expect(coerceProp(def, '')).toEqual({})
  })
})

describe('fallbackValue', () => {
  it('gives a safe default per type', () => {
    expect(fallbackValue({ name: 'n', type: 'number', label: 'N', default: 0, min: 8, max: 200 })).toBe(8)
    expect(fallbackValue({ name: 'n', type: 'number', label: 'N', default: 0 })).toBe(0)
    expect(fallbackValue({ name: 'c', type: 'color', label: 'C', default: '#000' })).toBe('#ffffff')
    expect(fallbackValue({ name: 'b', type: 'boolean', label: 'B', default: true })).toBe(false)
    expect(fallbackValue({ name: 'e', type: 'enum', label: 'E', default: 'a', options: ['a', 'b'] })).toBe('a')
    expect(fallbackValue({ name: 'e2', type: 'enum', label: 'E2', default: '' })).toBe('')
    expect(fallbackValue({ name: 't', type: 'text', label: 'T', default: '' })).toBe('')
    expect(fallbackValue({ name: 'i', type: 'image', label: 'I', default: '' })).toBe('')
    expect(fallbackValue({ name: 'f', type: 'fontId', label: 'F', default: '' })).toBe('')
  })
})

describe('isMediaUrl', () => {
  it.each([
    ['https://cdn.example/a.png', true],
    ['http://cdn.example/a.png', true],
    ['blob:http://localhost:3001/abc', true],
    ['data:image/png;base64,AAAA', true],
    ['/media/a.png', true],
    ['//evil.example/x.png', false],
    ['javascript:alert(1)', false],
    ['file:///c/x.png', false],
    ['/has space.png', false],
  ])('%s -> %j', (value, expected) => {
    expect(isMediaUrl(value)).toBe(expected)
  })
})
