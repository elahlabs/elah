import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TimelineEngine } from '@elah/core'
import { useTimelineEngine, useSelectionStore } from '@elah/react'
import { EditorProvider } from '@elah/react'
import { TextOverlay } from './TextOverlay'

/**
 * The rotate knob must write `transform.rotation` through the same
 * previewClip → commitInteraction protocol as move/resize, and the selection
 * box must tilt with the glyphs (CSS rotate about the GPU/export pivot,
 * layout.center). A portrait (non-square) stage is used deliberately — see
 * GeometryParity: rotation errors hide on square stages.
 */

const STAGE = { width: 1080, height: 1920 }
/** Overlay display size in CSS px. Stage contains into it at x∈[31.25, 368.75]. */
const VIEW = { width: 400, height: 600 }

const mounted: Array<{ root: Root; container: HTMLElement }> = []

function render(element: ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  mounted.push({ root, container })
  return container
}

let engine: TimelineEngine

function GrabEngine() {
  engine = useTimelineEngine()
  return null
}

function mountOverlay(): HTMLElement {
  return render(
    <EditorProvider fps={30} stage={STAGE}>
      <GrabEngine />
      <TextOverlay />
    </EditorProvider>,
  )
}

function addText(): string {
  let id = ''
  act(() => {
    const trackId = engine.getProject().tracks[0].id
    const clip = engine.addClip({
      trackId,
      type: 'text',
      text: { content: 'Text 1' },
      startFrame: 0,
      durationFrames: 60,
    })
    id = clip.id
  })
  return id
}

/** The centred stage-space block centre (0.5, 0.5) mapped to client px. */
const CENTER = { x: 200, y: 300 }

/** The circular rotate knob: the only handle with a 50% border-radius. */
function rotateKnob(container: HTMLElement): HTMLElement {
  const knob = [...container.querySelectorAll<HTMLElement>('div')].find(
    (el) => el.style.borderRadius === '50%',
  )
  expect(knob).toBeDefined()
  return knob!
}

function firePointer(el: Element, type: string, clientX: number, clientY: number) {
  act(() => {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY })
    Object.defineProperty(ev, 'pointerId', { value: 1 })
    el.dispatchEvent(ev)
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom lays nothing out: the overlay early-returns on a zero-size viewport
  // (`fit.width <= 0`) and never observes a resize without ResizeObserver.
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => VIEW.width,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => VIEW.height,
  })
  // jsdom ships no 2D canvas: a width-per-char stub is enough for layout, and
  // no pointer capture: gestures call setPointerCapture unconditionally.
  HTMLCanvasElement.prototype.getContext = (() => ({
    font: '',
    measureText: (s: string) => ({ width: s.length * 10 }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.releasePointerCapture = () => {}
})

afterEach(() => {
  act(() => {
    useSelectionStore.getState().clearSelection()
  })
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

describe('TextOverlay rotate handle', () => {
  it('dragging the knob a quarter-turn commits rotation π/2', () => {
    const container = mountOverlay()
    const id = addText()
    act(() => {
      useSelectionStore.getState().selectClip(id)
    })

    const knob = rotateKnob(container)
    // Start due east of the pivot (angle 0), sweep to due south (angle π/2).
    firePointer(knob, 'pointerdown', CENTER.x + 100, CENTER.y)
    firePointer(knob, 'pointermove', CENTER.x, CENTER.y + 100)
    firePointer(knob, 'pointerup', CENTER.x, CENTER.y + 100)

    const clip = engine.findClip(id)?.clip
    expect(clip?.transform?.rotation).toBeCloseTo(Math.PI / 2, 5)
    // Position must survive the gesture untouched.
    expect(clip?.transform?.x).toBeCloseTo(0.5, 5)
    expect(clip?.transform?.y).toBeCloseTo(0.5, 5)
  })

  it('tilts the selection box with the clip, pivoted at the block centre', () => {
    const container = mountOverlay()
    const id = addText()
    act(() => {
      engine.updateClip(id, engine.getProject().tracks[0].id, {
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 1, anchor: { x: 0.5, y: 0.5 } },
      })
      useSelectionStore.getState().selectClip(id)
    })

    const box = [...container.querySelectorAll<HTMLElement>('div')].find(
      (el) => el.style.transform.includes('rotate(') && el.style.width !== '',
    )
    expect(box).toBeDefined()
    expect(box!.style.transform).toBe('rotate(1rad)')
    // The pivot is pinned via transform-origin, not assumed to be the element
    // centre (textAlign / MIN_BOX_PX clamps can offset the box).
    expect(box!.style.transformOrigin).not.toBe('')
  })
})
