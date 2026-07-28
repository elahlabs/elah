import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PlaybackEngine, TimelineEngine } from '@elah/core'
import {
  EditorContext,
  useEditor,
  usePlaybackEngine,
  useTimelineEngine,
  type EditorContextValue,
} from './editor-context'

interface Rendered {
  container: HTMLElement
  root: Root
}

const mounted: Rendered[] = []
const playbacks: PlaybackEngine[] = []

afterEach(() => {
  for (const { root, container } of mounted.splice(0).reverse()) {
    act(() => root.unmount())
    container.remove()
  }
  for (const playback of playbacks.splice(0)) {
    playback.destroy()
  }
  document.body.replaceChildren()
  vi.restoreAllMocks()
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

function makeContextValue(): EditorContextValue {
  const engine = new TimelineEngine({ fps: 30 })
  const playback = new PlaybackEngine({
    fps: 30,
    getTotalFrames: () => engine.getTotalFrames(),
    now: () => 0,
  })
  playbacks.push(playback)
  return { engine, playback }
}

describe('useEditor', () => {
  it('throws when used outside an EditorContext.Provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    function Consumer() {
      useEditor()
      return null
    }

    expect(() => render(createElement(Consumer))).toThrow(
      'useEditor must be used inside <EditorProvider>',
    )
  })

  it('returns the exact value passed into the Provider', () => {
    const value = makeContextValue()
    let seen: EditorContextValue | undefined

    function Consumer() {
      seen = useEditor()
      return null
    }

    render(
      createElement(
        EditorContext.Provider,
        { value },
        createElement(Consumer),
      ),
    )

    expect(seen).toBeDefined()
    expect(seen!.engine).toBe(value.engine)
    expect(seen!.playback).toBe(value.playback)
  })
})

describe('useTimelineEngine / usePlaybackEngine', () => {
  it('return the engine and playback instances from context', () => {
    const value = makeContextValue()
    let seenEngine: unknown
    let seenPlayback: unknown

    function Consumer() {
      seenEngine = useTimelineEngine()
      seenPlayback = usePlaybackEngine()
      return null
    }

    render(
      createElement(
        EditorContext.Provider,
        { value },
        createElement(Consumer),
      ),
    )

    expect(seenEngine).toBe(value.engine)
    expect(seenPlayback).toBe(value.playback)
  })

  it('throw outside an EditorContext.Provider (delegate to useEditor)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    function EngineConsumer() {
      useTimelineEngine()
      return null
    }
    function PlaybackConsumer() {
      usePlaybackEngine()
      return null
    }

    expect(() => render(createElement(EngineConsumer))).toThrow(
      'useEditor must be used inside <EditorProvider>',
    )
    expect(() => render(createElement(PlaybackConsumer))).toThrow(
      'useEditor must be used inside <EditorProvider>',
    )
  })
})
