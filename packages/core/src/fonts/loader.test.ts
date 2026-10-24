import { beforeEach, describe, expect, it } from 'vitest'
import { ensureFonts, fontsEpoch, onFontsChange, resolveFontBaseUrl, collectFontIds } from './loader'
import { getFont } from './registry'

/**
 * A fake `FontFace` that records what it was built with, and a fake
 * `FontFaceSet`. Nothing here touches a real font: the point of the loader is
 * that it takes both by injection, which is also what makes it testable in Node
 * where neither exists.
 *
 * `failing` holds substrings; a face whose source contains one rejects, which
 * is how the "a file is missing on the CDN" path is exercised.
 */
let failing: string[] = []
const built: Array<{ family: string; source: string; descriptors: FontFaceDescriptors }> = []

class FakeFace {
  readonly family: string
  readonly source: string
  readonly descriptors: FontFaceDescriptors
  constructor(family: string, source: string, descriptors: FontFaceDescriptors) {
    this.family = family
    this.source = source
    this.descriptors = descriptors
    built.push({ family, source, descriptors })
  }
  load(): Promise<this> {
    if (failing.some((f) => this.source.includes(f))) return Promise.reject(new Error('404'))
    return Promise.resolve(this)
  }
}

class FakeSet {
  readonly faces = new Set<unknown>()
  add(face: unknown): this {
    this.faces.add(face)
    return this
  }
  delete(face: unknown): boolean {
    return this.faces.delete(face)
  }
  has(face: unknown): boolean {
    return this.faces.has(face)
  }
  get size(): number {
    return this.faces.size
  }
}

const set = () => new FakeSet() as unknown as FontFaceSet
const OPTS = (fonts: FontFaceSet, onWarning?: (m: string) => void) => ({
  baseUrl: '/fonts/',
  fonts,
  FontFaceCtor: FakeFace as unknown as typeof FontFace,
  ...(onWarning ? { onWarning } : {}),
})

beforeEach(() => {
  failing = []
  built.length = 0
})

describe('ensureFonts — the happy path', () => {
  it('adds one face for a one-file family, under the private family name', async () => {
    const fonts = set()
    const before = fontsEpoch()
    await ensureFonts(['bebas-neue'], OPTS(fonts))
    expect(built).toHaveLength(1)
    expect(built[0]!.family).toBe('elah-bebas-neue')
    expect(built[0]!.source).toBe('url("/fonts/bebas-neue/latin-400-normal.woff2") format("woff2")')
    expect(built[0]!.descriptors).toEqual({ weight: '400', style: 'normal' })
    expect(fonts.size).toBe(1)
    expect(fontsEpoch()).toBe(before + 1)
  })

  it('adds every file a family ships', async () => {
    const fonts = set()
    await ensureFonts(['inter'], OPTS(fonts))
    expect(built.map((b) => [b.descriptors.weight, b.descriptors.style])).toEqual([
      ['400', 'normal'],
      ['400', 'italic'],
      ['700', 'normal'],
      ['900', 'normal'],
    ])
    expect(fonts.size).toBe(4)
  })
})

describe('the per-set cache', () => {
  it('does not rebuild a face it already loaded on the same set', async () => {
    const fonts = set()
    await ensureFonts(['bebas-neue'], OPTS(fonts))
    const after = built.length
    const before = fontsEpoch()
    await ensureFonts(['bebas-neue'], OPTS(fonts))
    expect(built).toHaveLength(after)
    expect(fonts.size).toBe(1)
    // Nothing NEW landed, so the epoch must not move: this is what a preview
    // repaint keys on, and a spurious bump repaints for no reason.
    expect(fontsEpoch()).toBe(before)
  })

  it('rebuilds on a different set, because a worker has its own', async () => {
    await ensureFonts(['bebas-neue'], OPTS(set()))
    const before = built.length
    await ensureFonts(['bebas-neue'], OPTS(set()))
    expect(built).toHaveLength(before + 1)
  })

  it('de-duplicates a repeated id within one call', async () => {
    const fonts = set()
    await ensureFonts(['anton', 'anton'], OPTS(fonts))
    expect(built).toHaveLength(1)
    expect(fonts.size).toBe(1)
  })

  it('de-duplicates two concurrent calls for the same face', async () => {
    const fonts = set()
    const opts = OPTS(fonts)
    const before = fontsEpoch()
    await Promise.all([ensureFonts(['oswald'], opts), ensureFonts(['oswald'], opts)])
    expect(built).toHaveLength(2) // oswald ships 400 and 700
    expect(fonts.size).toBe(2)
    // Only ONE bump for the pair, because only the first call created anything.
    expect(fontsEpoch()).toBe(before + 1)
  })
})

describe('failure never throws and never leaves a face behind', () => {
  it('drops the face that failed, keeps the rest, and reports it once', async () => {
    failing = ['inter/latin-700']
    const fonts = set()
    const warnings: string[] = []
    const before = fontsEpoch()
    await ensureFonts(['inter'], OPTS(fonts, (m) => warnings.push(m)))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Inter')
    expect(warnings[0]).toContain('700')
    expect(warnings[0]).toContain('/fonts/inter/latin-700-normal.woff2')
    // The three that loaded are in the set; the one that did not is not.
    expect(fonts.size).toBe(3)
    expect([...(fonts as unknown as FakeSet).faces].some((f) => (f as FakeFace).descriptors.weight === '700')).toBe(
      false,
    )
    // Three faces landed, so the epoch still moves — a partial load is progress.
    expect(fontsEpoch()).toBe(before + 1)
  })

  it('does not move the epoch when every face failed', async () => {
    failing = ['caveat/']
    const fonts = set()
    const before = fontsEpoch()
    const warnings: string[] = []
    await ensureFonts(['caveat'], OPTS(fonts, (m) => warnings.push(m)))
    expect(warnings).toHaveLength(2)
    expect(fonts.size).toBe(0)
    expect(fontsEpoch()).toBe(before)
  })

  it('warns once per unknown id, however many times it is asked for', async () => {
    const warnings: string[] = []
    const opts = OPTS(set(), (m) => warnings.push(m))
    await ensureFonts(['unknown-1'], opts)
    await ensureFonts(['unknown-1'], opts)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Unknown font id "unknown-1"')
  })

  it('warns and resolves when there is no FontFace at all', async () => {
    const warnings: string[] = []
    // Node has no FontFace, which is the case this guard exists for.
    await ensureFonts(['inter'], { baseUrl: '/fonts/', fonts: set(), onWarning: (m) => warnings.push(m) })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('FontFace is not available')
  })
})

describe('fontsEpoch and onFontsChange', () => {
  it('calls each listener once per bump, and stops after unsubscribe', async () => {
    let calls = 0
    const off = onFontsChange(() => calls++)
    await ensureFonts(['bebas-neue'], OPTS(set()))
    expect(calls).toBe(1)
    off()
    await ensureFonts(['anton'], OPTS(set()))
    expect(calls).toBe(1)
  })
})

describe('resolveFontBaseUrl', () => {
  it('always ends in a slash', () => {
    expect(resolveFontBaseUrl('/fonts/', 'http://localhost:3001/editor')).toBe('http://localhost:3001/fonts/')
    expect(resolveFontBaseUrl('/fonts', undefined)).toBe('/fonts/')
  })

  it('leaves an absolute base alone', () => {
    expect(resolveFontBaseUrl('https://cdn.example.com/f/', 'http://a.test/')).toBe('https://cdn.example.com/f/')
  })

  it('resolves a relative base against the page, which a worker needs', () => {
    // A module worker has no document base URL, so a relative path would fail
    // there; resolving it on the main thread is what makes one loader serve both.
    expect(resolveFontBaseUrl('fonts/', 'http://h.test/app/editor')).toBe('http://h.test/app/fonts/')
  })

  it('falls back to the plain path when the base cannot be resolved', () => {
    expect(resolveFontBaseUrl('/fonts/', 'not a url')).toBe('/fonts/')
  })
})

describe('the registry the loader reads', () => {
  it('resolves the same ids the registry defines', () => {
    expect(getFont('bebas-neue')!.files[0]!.file).toBe('latin-400-normal.woff2')
  })
})

describe('collectFontIds (PV-P4a-2)', () => {
  /** A minimal clip; only the fields collectFontIds reads are meaningful. */
  const clip = (extra: Record<string, unknown> = {}) => ({ id: 'c', type: 'text', ...extra }) as never
  const project = (clips: Record<string, unknown[]>) => ({ clips }) as never

  it('collects unique ids from text clips, sorted, ignoring everything else', () => {
    const ids = collectFontIds(
      project({
        t1: [clip({ id: 'a', fontId: 'inter' }), clip({ id: 'b', fontId: 'anton' })],
        t2: [clip({ id: 'c', fontId: 'inter' })],
        // The video clip names a font NO text clip names. If it repeated 'anton'
        // the case could not tell "only text clips contribute" from "every clip
        // contributes" — the set would come out the same either way, and the
        // assertion would be decorative.
        t3: [{ id: 'd', type: 'video', src: 'v.mp4', fontId: 'oswald' } as never],
        t4: [clip({ id: 'e' })],
        // A fontId of the wrong TYPE must not reach the loader: it is read as a
        // string in the family line, and `ensureFonts` would warn about it.
        t5: [clip({ id: 'f', fontId: 42 })],
      }),
    )
    expect(ids).toEqual(['anton', 'inter'])
  })

  it('reads inside a nested compound project, because that title exports too', () => {
    const ids = collectFontIds(
      project({
        t1: [
          clip({
            id: 'a',
            fontId: 'inter',
            compound: { project: project({ inner: [clip({ id: 'b', fontId: 'caveat' })] }) },
          }),
        ],
      }),
    )
    expect(ids).toEqual(['caveat', 'inter'])
  })

  it('stops recursing at the depth bound, so a cyclic hand-edited document cannot hang', () => {
    // `hops` compound levels below the root, with the font on the innermost
    // clip. walk(root, 0) reads c0 then recurses, so the leaf is read at depth
    // `hops` — and it is read only if depth `hops - 1` passed `depth < 4`.
    // That puts the boundary at hops 4 (read) vs hops 5 (not), asserted on both
    // sides so the bound cannot drift by one unnoticed.
    const nest = (hops: number): unknown => {
      let node = project({ leaf: [clip({ id: 'leaf', fontId: 'oswald' })] })
      for (let i = 0; i < hops; i++) {
        node = project({ [`t${i}`]: [clip({ id: `c${i}`, compound: { project: node } })] })
      }
      return node
    }
    expect(collectFontIds(nest(4) as never)).toEqual(['oswald'])
    expect(collectFontIds(nest(5) as never)).toEqual([])
  })

  it('returns nothing for a project that names no font', () => {
    expect(collectFontIds(project({ t1: [clip({ id: 'a' })] }))).toEqual([])
    expect(collectFontIds(project({}))).toEqual([])
  })
})
