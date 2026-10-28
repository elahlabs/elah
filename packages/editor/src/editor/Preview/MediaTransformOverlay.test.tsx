import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TimelineEngine } from '@elah/core'
import { useTimelineEngine, useSelectionStore } from '@elah/react'
import { EditorProvider } from '@elah/react'
import { MediaTransformOverlay } from './MediaTransformOverlay'

/**
 * The selection box has to sit exactly where the renderer draws the media —
 * including rotation. The box is laid out axis-aligned and then CSS-rotated
 * about its own centre, mirroring `buildTransformMatrixFromRect`'s rotation
 * about the draw rect's centre; if that transform ever goes missing the box
 * stays horizontal under rotated media, which is what these assert against.
 */

const STAGE = { width: 1080, height: 1920 }
/** Overlay display size in CSS px. Any non-zero box works — `fit` scales into it. */
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

/** The overlay's selection box: the only absolutely-positioned div carrying a border. */
function boxes(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('div[style*="border"]')].filter(
    (el) => el.style.position === 'absolute' && el.style.width !== '',
  )
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
      <MediaTransformOverlay />
    </EditorProvider>,
  )
}

/** Add a full-stage image clip carrying `rotation` (radians) and return its id. */
function addRotatedImage(rotation: number): string {
  let id = ''
  act(() => {
    const trackId = engine.getProject().tracks[0].id
    const clip = engine.addClip({
      trackId,
      type: 'image',
      src: 'sheet.png',
      startFrame: 0,
      durationFrames: 60,
      transform: {
        x: 0.5,
        y: 0.5,
        scale: 1,
        rotation,
        anchor: { x: 0.5, y: 0.5 },
      },
    })
    id = clip.id
  })
  return id
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

describe('MediaTransformOverlay selection box', () => {
  it('rotates the box with the clip', () => {
    const container = mountOverlay()
    addRotatedImage(Math.PI / 2)

    const [box] = boxes(container)
    expect(box).toBeDefined()
    expect(box.style.transform).toContain('rotate(')
    expect(box.style.transform).toBe(`rotate(${Math.PI / 2}rad)`)
  })

  it('leaves an unrotated clip axis-aligned', () => {
    const container = mountOverlay()
    addRotatedImage(0)

    const [box] = boxes(container)
    expect(box).toBeDefined()
    expect(box.style.transform).toBe('')
  })
})
