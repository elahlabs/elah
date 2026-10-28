import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { playbackStore, tracksStore } from '@elah/core'
import { EditorProvider } from './EditorProvider'
import { useEditor, type EditorContextValue } from './editor-context'

/**
 * EditorProvider moved here from @elah/editor (RN-T2) so React Native can use
 * the same engine <-> store wiring. These pin the three wires it owns.
 */

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
    playbackStore.setState({ currentFrame: 0, isPlaying: false })
  })
  vi.restoreAllMocks()
})

function mount(onEditor: (value: EditorContextValue) => void): void {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const Capture = (): null => {
    onEditor(useEditor())
    return null
  }
  const element: ReactElement = createElement(EditorProvider, {
    fps: 30,
    initialTracks: [{ kind: 'elements' }],
    children: createElement(Capture),
  })
  act(() => root.render(element))
  mounted.push({ container, root })
}

describe('EditorProvider', () => {
  it('mirrors engine edits into tracksStore', () => {
    let editor!: EditorContextValue
    mount((v) => (editor = v))

    const trackId = editor.engine.getProject().tracks[0].id
    act(() => {
      editor.engine.addClip({
        trackId,
        type: 'text',
        text: { content: 'Hi' },
        startFrame: 0,
        durationFrames: 45,
      })
    })

    const state = tracksStore.getState()
    expect(state.clips[trackId].map((c) => c.content)).toEqual(['Hi'])
    expect(state.totalFrames).toBe(45)
    expect(state.canUndo).toBe(true)
  })

  it('moves the engine when the store seeks, without an echo seek', () => {
    let editor!: EditorContextValue
    mount((v) => (editor = v))
    const trackId = editor.engine.getProject().tracks[0].id
    act(() => {
      editor.engine.addClip({ trackId, type: 'text', text: { content: 'Hi' }, startFrame: 0, durationFrames: 90 })
    })

    const seek = vi.spyOn(editor.playback, 'seek')
    act(() => playbackStore.getState().setCurrentFrame(30))

    expect(editor.playback.currentFrame).toBe(30)
    // One seek for the store change. The engine's notify back into the store
    // sees the same frame and must not trigger a second one.
    expect(seek).toHaveBeenCalledTimes(1)
  })

  it('rewinds the transport when a project is loaded', () => {
    let editor!: EditorContextValue
    mount((v) => (editor = v))
    const trackId = editor.engine.getProject().tracks[0].id
    act(() => {
      editor.engine.addClip({ trackId, type: 'text', text: { content: 'Hi' }, startFrame: 0, durationFrames: 90 })
      playbackStore.getState().setCurrentFrame(40)
    })
    expect(playbackStore.getState().currentFrame).toBe(40)

    act(() => {
      editor.engine.loadProject(editor.engine.getProject(), { transport: 'rewind' })
    })
    expect(playbackStore.getState().currentFrame).toBe(0)
    expect(editor.playback.currentFrame).toBe(0)
  })
})
