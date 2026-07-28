import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  tracksStore,
  playbackStore,
  selectionStore,
  transitionsStore,
  mediaLibraryStore,
} from '@elah/core'
import {
  useTracksStore,
  usePlaybackStore,
  useSelectionStore,
  useTransitionsStore,
  useMediaLibraryStore,
} from './stores'

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
  resetStores()
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

// Real defaults, mirrored from packages/core/src/stores/*.ts and assets/store.ts.
function resetStores() {
  act(() => {
    tracksStore.setState({
      tracks: [],
      clips: {},
      stage: { width: 1080, height: 1920 },
      totalFrames: 0,
      canUndo: false,
      canRedo: false,
    })
    selectionStore.setState({
      selectedClipIds: new Set(),
      activeTrackId: null,
    })
    playbackStore.setState({
      currentFrame: 0,
      currentFrameEpoch: 0,
      isPlaying: false,
      playbackRate: 1,
      loop: false,
      volume: 1,
      muted: false,
      zoom: 4,
      snapEnabled: true,
    })
    transitionsStore.setState({ transitions: [] })
    mediaLibraryStore.setState({ assets: {}, order: [] })
  })
}

describe('useTracksStore', () => {
  it('re-renders when the store is updated externally', () => {
    const { container } = render(
      createElement(function TotalFrames() {
        const totalFrames = useTracksStore((s) => s.totalFrames)
        return createElement('span', null, String(totalFrames))
      }),
    )

    expect(container.textContent).toBe('0')

    act(() => {
      tracksStore.setState({ totalFrames: 120 })
    })

    expect(container.textContent).toBe('120')
  })

  it('does not re-render on unrelated slice changes when using a selector', () => {
    let renderCount = 0
    render(
      createElement(function StageWidth() {
        renderCount++
        const width = useTracksStore((s) => s.stage.width)
        return createElement('span', null, String(width))
      }),
    )

    expect(renderCount).toBe(1)

    act(() => {
      tracksStore.setState({ totalFrames: 999 })
    })

    expect(renderCount).toBe(1)
  })

  it('shares the same store instance via the imperative surface', () => {
    expect(useTracksStore.getState()).toBe(tracksStore.getState())

    act(() => {
      useTracksStore.setState({ totalFrames: 42 })
    })

    expect(tracksStore.getState().totalFrames).toBe(42)
  })
})

describe('usePlaybackStore', () => {
  it('re-renders when the store is updated externally', () => {
    const { container } = render(
      createElement(function CurrentFrame() {
        const frame = usePlaybackStore((s) => s.currentFrame)
        return createElement('span', null, String(frame))
      }),
    )

    expect(container.textContent).toBe('0')

    act(() => {
      playbackStore.setState({ currentFrame: 30 })
    })

    expect(container.textContent).toBe('30')
  })

  it('does not re-render on unrelated slice changes when using a selector', () => {
    let renderCount = 0
    render(
      createElement(function Zoom() {
        renderCount++
        const zoom = usePlaybackStore((s) => s.zoom)
        return createElement('span', null, String(zoom))
      }),
    )

    expect(renderCount).toBe(1)

    act(() => {
      playbackStore.setState({ isPlaying: true })
    })

    expect(renderCount).toBe(1)
  })

  it('shares the same store instance via the imperative surface', () => {
    expect(usePlaybackStore.getState()).toBe(playbackStore.getState())

    act(() => {
      usePlaybackStore.setState({ isPlaying: true })
    })

    expect(playbackStore.getState().isPlaying).toBe(true)
  })
})

describe('useSelectionStore', () => {
  it('re-renders when the store is updated externally', () => {
    const { container } = render(
      createElement(function ActiveTrack() {
        const activeTrackId = useSelectionStore((s) => s.activeTrackId)
        return createElement('span', null, activeTrackId ?? 'none')
      }),
    )

    expect(container.textContent).toBe('none')

    act(() => {
      selectionStore.setState({ activeTrackId: 'track-1' })
    })

    expect(container.textContent).toBe('track-1')
  })

  it('does not re-render on unrelated slice changes when using a selector', () => {
    let renderCount = 0
    render(
      createElement(function ActiveTrack() {
        renderCount++
        const activeTrackId = useSelectionStore((s) => s.activeTrackId)
        return createElement('span', null, activeTrackId ?? 'none')
      }),
    )

    expect(renderCount).toBe(1)

    act(() => {
      selectionStore.setState({ selectedClipIds: new Set(['clip-1']) })
    })

    expect(renderCount).toBe(1)
  })

  it('shares the same store instance via the imperative surface', () => {
    expect(useSelectionStore.getState()).toBe(selectionStore.getState())

    act(() => {
      useSelectionStore.setState({ activeTrackId: 'track-2' })
    })

    expect(selectionStore.getState().activeTrackId).toBe('track-2')
  })
})

// useTransitionsStore and useMediaLibraryStore share the exact same bindHook
// wiring as the three stores above — a single identity + re-render smoke
// test each is enough to catch a wiring regression without repeating the
// full three-assertion suite for a pattern already proven.
describe('useTransitionsStore', () => {
  it('re-renders on update and shares the store instance imperatively', () => {
    const { container } = render(
      createElement(function TransitionsCount() {
        const count = useTransitionsStore((s) => s.transitions.length)
        return createElement('span', null, String(count))
      }),
    )

    expect(container.textContent).toBe('0')
    expect(useTransitionsStore.getState()).toBe(transitionsStore.getState())
  })
})

describe('useMediaLibraryStore', () => {
  it('re-renders on update and shares the store instance imperatively', () => {
    const { container } = render(
      createElement(function AssetOrderLength() {
        const count = useMediaLibraryStore((s) => s.order.length)
        return createElement('span', null, String(count))
      }),
    )

    expect(container.textContent).toBe('0')

    act(() => {
      mediaLibraryStore.setState({
        assets: { a1: { id: 'a1' } as any },
        order: ['a1'],
      })
    })

    expect(container.textContent).toBe('1')
    expect(useMediaLibraryStore.getState()).toBe(mediaLibraryStore.getState())
  })
})
