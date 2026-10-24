import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { packageFontsBaseUrl, packageFontsBaseUrlFrom } from './packageFonts'
import { DEFAULT_FONT_BASE_URL, FONT_REGISTRY, fontFileUrl } from './registry'

describe('packageFontsBaseUrl', () => {
  it('resolves from the built module (dist/fonts/) to the package root fonts/', () => {
    expect(packageFontsBaseUrlFrom('https://cdn.jsdelivr.net/npm/@elah/core@1.0.0/dist/fonts/packageFonts.js')).toBe(
      'https://cdn.jsdelivr.net/npm/@elah/core@1.0.0/fonts/',
    )
    expect(packageFontsBaseUrlFrom('http://127.0.0.1:4301/packages/core/dist/fonts/packageFonts.js')).toBe(
      'http://127.0.0.1:4301/packages/core/fonts/',
    )
  })

  it('points at the package fonts directory when run from source', () => {
    const dir = fileURLToPath(packageFontsBaseUrl())
    expect(statSync(dir).isDirectory()).toBe(true)
    expect(packageFontsBaseUrl().endsWith('/fonts/')).toBe(true)
  })

  it('leaves the /fonts/ default alone (opt-in only)', () => {
    expect(DEFAULT_FONT_BASE_URL).toBe('/fonts/')
  })
})

describe('the package ships every registry font', () => {
  const base = packageFontsBaseUrl()

  it.each(FONT_REGISTRY.map((def) => [def.id, def] as const))('%s: every woff2 file and its OFL.txt', (_id, def) => {
    for (const file of def.files) {
      const path = fileURLToPath(fontFileUrl(base, def, file))
      expect(existsSync(path), path).toBe(true)
      // A woff2 file starts with the "wOF2" signature.
      expect(readFileSync(path).subarray(0, 4).toString('latin1'), path).toBe('wOF2')
    }
    const ofl = fileURLToPath(new URL(`${def.id}/OFL.txt`, base))
    expect(existsSync(ofl), ofl).toBe(true)
    expect(readFileSync(ofl, 'utf8')).toMatch(/SIL OPEN FONT LICENSE/i)
  })
})
