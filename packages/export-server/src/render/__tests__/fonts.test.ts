import { describe, it, expect, vi, beforeEach } from 'vitest'

// `@napi-rs/canvas` ships prebuilt native binaries; mocking it here keeps this
// suite exercising pure substitution logic without depending on the package
// being installed or on real font files existing on the test host.
const registerFromPath = vi.fn((_path: string, _family?: string) => true)
vi.mock('@napi-rs/canvas', () => ({
  GlobalFonts: {
    registerFromPath: (path: string, family?: string) => registerFromPath(path, family),
    families: [] as Array<{ family: string }>,
  },
}))

const { createFontRegistry } = await import('../fonts')

beforeEach(() => {
  registerFromPath.mockReset()
  registerFromPath.mockReturnValue(true)
})

describe('createFontRegistry / substitute', () => {
  it('substitutes an unknown family with something non-empty and records it as missing', () => {
    const registry = createFontRegistry({ availableFamilies: ['Arial'] })
    const result = registry.substitute('Definitely Not A Font')
    expect(result.length).toBeGreaterThan(0)
    expect(registry.missing).toContain('Definitely Not A Font')
  })

  it('picks the first available member of a CSS font stack', () => {
    const registry = createFontRegistry({ availableFamilies: ['Bar', 'Baz'] })
    expect(registry.substitute('Foo, Bar, Baz')).toBe('Bar')
    expect(registry.missing).toEqual([])
  })

  it('trims whitespace and quotes from stack entries', () => {
    const registry = createFontRegistry({ availableFamilies: ['Inter'] })
    expect(registry.substitute(`"Foo",  'Inter' `)).toBe('Inter')
  })

  it('an explicit fallbackFamily wins over the first registered/available family', () => {
    const registry = createFontRegistry({
      fallbackFamily: 'Roboto',
      availableFamilies: ['Roboto', 'Arial'],
    })
    expect(registry.substitute('Unknown Family')).toBe('Roboto')
  })

  it('ignores fallbackFamily if it is not itself available', () => {
    const registry = createFontRegistry({
      fallbackFamily: 'Not Installed',
      availableFamilies: ['Arial'],
    })
    expect(registry.substitute('Unknown Family')).toBe('Arial')
  })

  it('returns a known family unchanged', () => {
    const registry = createFontRegistry({ availableFamilies: ['Arial', 'Roboto'] })
    expect(registry.substitute('Roboto')).toBe('Roboto')
    expect(registry.missing).toEqual([])
  })

  it('treats undefined as the sans-serif default and substitutes it', () => {
    const registry = createFontRegistry({ availableFamilies: ['Arial'] })
    expect(registry.substitute(undefined)).toBe('Arial')
    expect(registry.missing).toContain('sans-serif')
  })

  it('treats CSS generics as unresolved even without a fallbackFamily', () => {
    const registry = createFontRegistry({ availableFamilies: ['Arial'] })
    expect(registry.substitute('monospace')).toBe('Arial')
    expect(registry.missing).toContain('monospace')
  })

  it('dedupes repeated misses of the same family', () => {
    const registry = createFontRegistry({ availableFamilies: ['Arial'] })
    registry.substitute('Ghost Font')
    registry.substitute('Ghost Font')
    expect(registry.missing).toEqual(['Ghost Font'])
  })

  it('falls back to the first registered font when no fallbackFamily is set', () => {
    const registry = createFontRegistry({
      fonts: [{ path: '/fonts/brand.ttf', family: 'Brand Sans' }],
      availableFamilies: ['Brand Sans'],
    })
    expect(registry.substitute('Unknown')).toBe('Brand Sans')
  })

  it('falls back to the literal sans-serif default when nothing is available at all', () => {
    const registry = createFontRegistry({ availableFamilies: [] })
    expect(registry.substitute('Unknown')).toBe('sans-serif')
  })

  it('exposes the available family list verbatim', () => {
    const registry = createFontRegistry({ availableFamilies: ['Arial', 'Roboto'] })
    expect(registry.available).toEqual(['Arial', 'Roboto'])
  })
})

describe('createFontRegistry / registration', () => {
  it('registers each FontSpec via GlobalFonts.registerFromPath', () => {
    createFontRegistry({
      fonts: [{ path: '/fonts/a.ttf', family: 'A' }, { path: '/fonts/b.ttf' }],
      availableFamilies: [],
    })
    expect(registerFromPath).toHaveBeenCalledTimes(2)
    expect(registerFromPath).toHaveBeenNthCalledWith(1, '/fonts/a.ttf', 'A')
    expect(registerFromPath).toHaveBeenNthCalledWith(2, '/fonts/b.ttf', undefined)
  })

  it('throws ExportServerError(FONT_LOAD_FAILED) naming the path when registration returns false', async () => {
    registerFromPath.mockReturnValueOnce(false)
    const { ExportServerError } = await import('../../errors')
    expect(() =>
      createFontRegistry({ fonts: [{ path: '/fonts/broken.ttf', family: 'Broken' }] }),
    ).toThrow(ExportServerError)
    try {
      createFontRegistry({ fonts: [{ path: '/fonts/broken.ttf', family: 'Broken' }] })
    } catch (err) {
      expect((err as InstanceType<typeof ExportServerError>).message).toContain('/fonts/broken.ttf')
    }
  })

  it('throws ExportServerError(FONT_LOAD_FAILED) naming the path when registration throws', async () => {
    registerFromPath.mockImplementationOnce(() => {
      throw new Error('bad font file')
    })
    const { ExportServerError } = await import('../../errors')
    expect(() => createFontRegistry({ fonts: [{ path: '/fonts/corrupt.ttf' }] })).toThrow(ExportServerError)
  })
})
