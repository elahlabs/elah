import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  PlaybackEngine,
  TimelineEngine,
  createGenerator,
  type Clip,
  type CreateClipOptions,
} from '@elah/core'
import { EditorContext, useSelectionStore, useTracksStore } from '@elah/react'
import { ClipBlock } from './ClipBlock'

/**
 * The converged core's clip types (CONV-4): the open-source timeline has no
 * editor for them, but each must draw as an ordinary labelled block in an
 * existing token colour, and a sourceless one must trim as `engine.trimClip()`
 * allows.
 */

const mounted: { root: Root; container: HTMLElement }[] = []
const playbacks: PlaybackEngine[] = []

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
  for (const p of playbacks.splice(0)) p.destroy()
  act(() => {
    useTracksStore.setState({ tracks: [], clips: {} })
    useSelectionStore.setState({ selectedClipIds: new Set(), activeTrackId: null })
  })
})

type NewType = 'adjustment' | 'generator' | 'compound' | 'sequence'

function optionsFor(type: NewType, trackId: string): CreateClipOptions {
  const base = { trackId, name: `My ${type}`, startFrame: 10, durationFrames: 40 }
  switch (type) {
    case 'adjustment':
      return { ...base, type }
    case 'generator':
      return { ...base, type, generator: createGenerator('gradientBackground') }
    case 'compound': {
      const inner = new TimelineEngine({ fps: 30, initialTracks: [{ kind: 'elements', name: 'Inner' }] })
      inner.addClip({
        type: 'text',
        trackId: inner.getProject().tracks[0].id,
        startFrame: 0,
        durationFrames: 40,
        text: { content: 'Inside' },
      })
      return { ...base, type, compound: { project: inner.getProject() } }
    }
    case 'sequence':
      return {
        ...base,
        type,
        sequence: { kind: 'frames', frameUrlTemplate: '/f/{frame}.png', frameCount: 10, fps: 10 },
      }
  }
}

function setup(type: NewType): { block: HTMLElement; clip: Clip; engine: TimelineEngine } {
  const engine = new TimelineEngine({ fps: 30 })
  const playback = new PlaybackEngine({ fps: 30, getTotalFrames: () => engine.getTotalFrames(), now: () => 0 })
  playbacks.push(playback)
  const trackId = engine.getProject().tracks[0].id
  const clip = engine.addClip(optionsFor(type, trackId))
  act(() => {
    useTracksStore.getState().sync(engine.getProject(), { canUndo: false, canRedo: false })
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(
        EditorContext.Provider,
        { value: { engine, playback } },
        createElement(ClipBlock, { clip, zoom: 1, trackHeight: 64 }),
      ),
    ),
  )
  mounted.push({ root, container })
  return { block: container.firstElementChild as HTMLElement, clip, engine }
}

function pointer(target: EventTarget, type: string, clientX: number) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, pointerId: 1, pointerType: 'mouse' }),
    )
  })
}

describe('ClipBlock with the converged clip types', () => {
  it.each(['adjustment', 'generator', 'compound', 'sequence'] as const)('draws a %s clip as a labelled block', (type) => {
    const { block } = setup(type)
    expect(block.dataset.clipType).toBe(type)
    expect(block.textContent).toContain(`My ${type}`)
    expect(block.className).toMatch(/\bbg-clip-[a-z]+-(mid|bottom)\b/)
    expect(block.className).toMatch(/\btext-clip-[a-z]+-accent\b/)
  })

  it.each(['adjustment', 'generator', 'sequence'] as const)('lets a %s clip grow past its source length', (type) => {
    const { block, clip, engine } = setup(type)
    const right = block.querySelector('.elah-trim-handle-right') as HTMLElement
    pointer(right, 'pointerdown', 100)
    pointer(window, 'pointermove', 130)
    pointer(window, 'pointerup', 130)
    expect(engine.findClip(clip.id)!.clip.durationFrames).toBe(70)
  })

  it('keeps a compound clip inside its nested timeline', () => {
    const { block, clip, engine } = setup('compound')
    const right = block.querySelector('.elah-trim-handle-right') as HTMLElement
    pointer(right, 'pointerdown', 100)
    pointer(window, 'pointermove', 130)
    pointer(window, 'pointerup', 130)
    expect(engine.findClip(clip.id)!.clip.durationFrames).toBe(40)
  })
})
