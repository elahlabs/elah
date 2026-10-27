import { describe, expect, it } from 'vitest'
import { VECTOR_INLINE_MAX_CHARS, isVectorAsset, vectorOriginLine } from './vector'
import type { MediaAsset } from './types'
import { snapshotMediaLibrary } from './librarySnapshot'

/** SVG-1a: what counts as a vector asset, and the one line that says where it came from. */

const asset = (extra: Partial<MediaAsset>): MediaAsset =>
  ({ id: 'a', kind: 'image', name: 'thing', src: 'blob:a', durationSec: 0, byteSize: 1, lastModified: 0, addedAt: 0, ...extra }) as MediaAsset

const proxied = (target: string) => `/api/gallery/asset?url=${encodeURIComponent(target)}`

describe('isVectorAsset', () => {
  it('is true for a vector record, even when the name and src say nothing', () => {
    expect(isVectorAsset(asset({ vector: { origin: 'upload' } }))).toBe(true)
  })

  it('is true for a hosted vector whose src is a proxied .svg URL and whose name has no extension', () => {
    expect(isVectorAsset(asset({ name: 'mark', src: proxied('https://cdn.example.com/u/abc.svg'), vector: { origin: 'upload', hostedUrl: 'https://cdn.example.com/u/abc.svg' } }))).toBe(true)
  })

  it('is true for a legacy data-URL icon and for a plain .svg name or URL, with no vector record', () => {
    expect(isVectorAsset(asset({ name: 'mdi/home', src: 'data:image/svg+xml;base64,PHN2Zy8+' }))).toBe(true)
    expect(isVectorAsset(asset({ name: 'Logo.svg' }))).toBe(true)
    expect(isVectorAsset(asset({ name: 'x', src: 'https://cdn.example.com/a.svg?v=2' }))).toBe(true)
  })

  it('recognises a proxied URL whose wrapped target ends in .svg even when the proxy URL has a trailing parameter', () => {
    expect(isVectorAsset(asset({ name: 'x', src: `${proxied('https://cdn.example.com/a.svg')}&kind=image` }))).toBe(true)
  })

  it('is false for a PNG, a proxied PNG, and anything that is not an image', () => {
    expect(isVectorAsset(asset({ name: 'Skyline.png', src: 'https://cdn.example.com/a.png' }))).toBe(false)
    expect(isVectorAsset(asset({ name: 'x', src: proxied('https://cdn.example.com/a.png') }))).toBe(false)
    expect(isVectorAsset(asset({ kind: 'video', name: 'a.svg' }))).toBe(false)
    expect(isVectorAsset(asset({ kind: 'audio', vector: { origin: 'upload' } }))).toBe(false)
  })
})

describe('vectorOriginLine', () => {
  it('states facts for each origin', () => {
    expect(vectorOriginLine({ origin: 'iconify', source: { provider: 'iconify', set: 'material-symbols', setName: 'Material Symbols', name: 'home', licence: 'Apache-2.0', pageUrl: 'https://x' } })).toBe(
      'Open-source icon · Material Symbols (Apache-2.0)',
    )
    expect(vectorOriginLine({ origin: 'iconify', source: { provider: 'iconify', set: 'mdi', name: 'home', licence: 'MIT', pageUrl: 'https://x' } })).toBe('Open-source icon · mdi (MIT)')
    expect(vectorOriginLine({ origin: 'model' })).toBe('Drawn by the assistant')
    expect(vectorOriginLine({ origin: 'upload' })).toBe('Uploaded')
  })
})

describe('the vector record persists with the library', () => {
  it('snapshotMediaLibrary keeps `vector` on the entry', () => {
    const a = asset({ id: 'v', vector: { origin: 'upload', hostedUrl: 'https://cdn.example.com/a.svg' } })
    const [entry] = snapshotMediaLibrary({ assets: { v: a }, order: ['v'] })
    expect(entry!.vector).toEqual({ origin: 'upload', hostedUrl: 'https://cdn.example.com/a.svg' })
  })

  it('the inline cap is 32,768 characters', () => {
    expect(VECTOR_INLINE_MAX_CHARS).toBe(32_768)
  })
})
