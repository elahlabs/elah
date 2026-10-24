import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FONT_BASE_URL,
  FONT_CATEGORY_LABELS,
  FONT_REGISTRY,
  fontFaceFamily,
  fontFamilyCss,
  fontFileUrl,
  fontHasItalic,
  fontWeights,
  getFont,
} from './registry'

describe('FONT_REGISTRY', () => {
  it('holds the twelve bundled families, with ids documents can store', () => {
    expect(FONT_REGISTRY).toHaveLength(12)
    const ids = FONT_REGISTRY.map((d) => d.id)
    expect(new Set(ids).size).toBe(12)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('licenses every family OFL and files it under a known category', () => {
    for (const def of FONT_REGISTRY) {
      expect(def.license).toBe('OFL')
      expect(Object.keys(FONT_CATEGORY_LABELS)).toContain(def.category)
    }
  })

  it('names every file from its own weight and style, with no duplicated pair', () => {
    let total = 0
    for (const def of FONT_REGISTRY) {
      const seen = new Set<string>()
      for (const file of def.files) {
        expect(file.file).toBe(`latin-${file.weight}-${file.style}.woff2`)
        const key = `${file.weight}/${file.style}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
        total++
      }
    }
    // 29 files is what the asset request and the bundle-size cap are built on.
    expect(total).toBe(29)
  })
})

describe('getFont', () => {
  it('finds a family by its document id and refuses anything else', () => {
    expect(getFont('inter')?.family).toBe('Inter')
    // The real name is NOT the id: a document says `inter`, never `Inter`.
    expect(getFont('Inter')).toBeUndefined()
    expect(getFont(42 as unknown as string)).toBeUndefined()
    expect(getFont(undefined as unknown as string)).toBeUndefined()
  })
})

describe('the family name a face is registered under', () => {
  it('is private, so it cannot collide with a legacy fontFamily string', () => {
    expect(fontFaceFamily(getFont('inter')!)).toBe('elah-inter')
    // Nothing in the registry may claim a real family name.
    for (const def of FONT_REGISTRY) {
      expect(fontFaceFamily(def)).not.toBe(def.family)
      expect(fontFaceFamily(def).startsWith('elah-')).toBe(true)
    }
  })

  it('produces a CSS list with the category generic as the fallback', () => {
    expect(fontFamilyCss('inter')).toBe('"elah-inter", sans-serif')
    expect(fontFamilyCss('playfair-display')).toBe('"elah-playfair-display", serif')
    expect(fontFamilyCss('roboto-mono')).toBe('"elah-roboto-mono", monospace')
    expect(fontFamilyCss('caveat')).toBe('"elah-caveat", cursive')
    // A display family falls back to sans-serif, not to a serif.
    expect(fontFamilyCss('bebas-neue')).toBe('"elah-bebas-neue", sans-serif')
    expect(fontFamilyCss('nope')).toBeUndefined()
  })
})

describe('per-family queries', () => {
  it('lists the weights a family ships, sorted and unique', () => {
    expect(fontWeights(getFont('poppins')!)).toEqual([400, 600, 800])
    expect(fontWeights(getFont('bebas-neue')!)).toEqual([400])
  })

  it('reports whether a family has an italic at all', () => {
    expect(fontHasItalic(getFont('inter')!)).toBe(true)
    expect(fontHasItalic(getFont('anton')!)).toBe(false)
  })
})

describe('fontFileUrl', () => {
  it('addresses a file under the family directory', () => {
    const inter = getFont('inter')!
    expect(fontFileUrl('/fonts/', inter, inter.files[0]!)).toBe('/fonts/inter/latin-400-normal.woff2')
    expect(fontFileUrl(DEFAULT_FONT_BASE_URL, inter, inter.files[1]!)).toBe(
      '/fonts/inter/latin-400-italic.woff2',
    )
  })

  it('is the URL the OFL.txt sits beside, so a family directory is self-contained', () => {
    const inter = getFont('inter')!
    for (const file of inter.files) {
      const url = fontFileUrl(DEFAULT_FONT_BASE_URL, inter, file)
      expect(url.startsWith(`/fonts/${inter.id}/`)).toBe(true)
      expect(url.endsWith('.woff2')).toBe(true)
    }
  })
})
