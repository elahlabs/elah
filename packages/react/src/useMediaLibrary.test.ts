import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  mediaLibraryStore,
  importFiles,
  importUrl,
  importBlob,
  type MediaAsset,
} from '@elah/core'
import { useMediaLibrary, useAssets, type UseMediaLibraryApi } from './useMediaLibrary'

interface Rendered {
  container: HTMLElement
  root: Root
}

const mounted: Rendered[] = []

afterEach(() => {
  for (const { root, container } of mounted.splice(0).reverse()) {
    act(() => root.unmount())
    container.remove()
  }
  document.body.replaceChildren()
  act(() => {
    mediaLibraryStore.setState({ assets: {}, order: [] })
  })
})

function render(element: ReactElement): Rendered {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  const rendered = { container, root }
  mounted.push(rendered)
  return rendered
}

function fakeAsset(id: string): MediaAsset {
  return { id, name: id } as MediaAsset
}

function capture(onApi: (api: UseMediaLibraryApi) => void): ReactElement {
  return createElement(function Consumer() {
    onApi(useMediaLibrary())
    return null
  })
}

describe('useMediaLibrary', () => {
  it('returns assets in the order recorded by the store, not object-key order', () => {
    act(() => {
      mediaLibraryStore.setState({
        assets: { a: fakeAsset('a'), b: fakeAsset('b') },
        order: ['b', 'a'],
      })
    })

    let api: UseMediaLibraryApi | undefined
    render(capture((a) => (api = a)))

    expect(api!.assets.map((a) => a.id)).toEqual(['b', 'a'])
  })

  it('filters out ids present in order but missing from assets', () => {
    act(() => {
      mediaLibraryStore.setState({
        assets: { a: fakeAsset('a') },
        order: ['missing', 'a'],
      })
    })

    let api: UseMediaLibraryApi | undefined
    render(capture((a) => (api = a)))

    expect(api!.assets.map((a) => a.id)).toEqual(['a'])
  })

  it('returns the store actions themselves, not wrapped copies', () => {
    let api: UseMediaLibraryApi | undefined
    render(capture((a) => (api = a)))

    const state = mediaLibraryStore.getState()
    expect(api!.getAsset).toBe(state.getAsset)
    expect(api!.removeAsset).toBe(state.removeAsset)
    expect(api!.updateAsset).toBe(state.updateAsset)
  })

  it('re-exports the @elah/core import functions unchanged', () => {
    let api: UseMediaLibraryApi | undefined
    render(capture((a) => (api = a)))

    expect(api!.importFiles).toBe(importFiles)
    expect(api!.importUrl).toBe(importUrl)
    expect(api!.importBlob).toBe(importBlob)
  })
})

describe('useAssets', () => {
  it('is a true alias of useMediaLibrary', () => {
    expect(useAssets).toBe(useMediaLibrary)
  })
})
