import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaLibraryStore, type MediaAsset } from '@elah/core'
import * as native from './useMediaLibrary.native'
import type { UseMediaLibraryApi } from './useMediaLibrary'

/**
 * The `.native` variant Metro picks on iOS / Android. Same API shape and the
 * same store as the web hook; the browser importers throw instead of being
 * bundled. The source check is what keeps Metro able to bundle @elah/react.
 */

afterEach(() => {
  document.body.replaceChildren()
  act(() => mediaLibraryStore.setState({ assets: {}, order: [] }))
})

function capture(): UseMediaLibraryApi {
  let api!: UseMediaLibraryApi
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(function Consumer() {
        api = native.useMediaLibrary()
        return null
      }),
    ),
  )
  act(() => root.unmount())
  return api
}

describe('useMediaLibrary (native)', () => {
  it('reads assets from the shared store in insertion order', () => {
    act(() => {
      mediaLibraryStore.getState().addAsset({ id: 'b', name: 'b' } as MediaAsset)
      mediaLibraryStore.getState().addAsset({ id: 'a', name: 'a' } as MediaAsset)
    })
    expect(capture().assets.map((a) => a.id)).toEqual(['b', 'a'])
  })

  it('throws a pointed error from each browser importer', () => {
    const api = capture()
    expect(() => api.importFiles([])).toThrow(/not available on React Native/)
    expect(() => api.importUrl('https://x')).toThrow(/importUrl/)
    expect(() => api.importBlob(new Blob())).toThrow(/importBlob/)
  })

  it('keeps useAssets as an alias', () => {
    expect(native.useAssets).toBe(native.useMediaLibrary)
  })

  it('imports nothing from @elah/core by value', () => {
    const source = readFileSync(join(__dirname, 'useMediaLibrary.native.ts'), 'utf8')
    const valueImports = source
      .split('\n')
      .filter((line) => /from '@elah\/core/.test(line) && !/^import type /.test(line))
    expect(valueImports).toEqual([])
  })
})
