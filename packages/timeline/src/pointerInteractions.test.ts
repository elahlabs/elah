import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PlaybackEngine, TimelineEngine, type Clip } from '@elah/core'
import {
  EditorContext,
  usePlaybackStore,
  useSelectionStore,
  useTracksStore,
} from '@elah/react'
import { ClipBlock } from './ClipBlock'
import { Playhead } from './Playhead'
import { Ruler } from './Ruler'

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
  resetStores()
  vi.restoreAllMocks()
})

describe('ClipBlock pointer gestures', () => {
  it('commits clip body drag on pointerup', () => {
    const { block, clip, engine } = setupClip()

    dispatchPointer(block, 'pointerdown', { clientX: 100 })
    dispatchPointer(window, 'pointermove', { clientX: 110 })
    dispatchPointer(window, 'pointerup', { clientX: 110 })

    expect(currentClip(engine, clip.id).startFrame).toBe(20)
  })

  it('reverts clip body drag on pointercancel', () => {
    const { block, clip, engine } = setupClip()

    dispatchPointer(block, 'pointerdown', { clientX: 100 })
    dispatchPointer(window, 'pointermove', { clientX: 110 })
    dispatchPointer(window, 'pointercancel', { clientX: 110 })

    expect(currentClip(engine, clip.id).startFrame).toBe(10)
    expect(block.style.transform).toBe('')
  })

  it('commits and reverts left trim gestures', () => {
    const commit = setupClip()
    const commitLeftHandle = commit.block.querySelector(
      '.elah-trim-handle-left',
    ) as HTMLElement

    dispatchPointer(commitLeftHandle, 'pointerdown', { clientX: 100 })
    dispatchPointer(window, 'pointermove', { clientX: 110 })
    dispatchPointer(window, 'pointerup', { clientX: 110 })

    expect(currentClip(commit.engine, commit.clip.id).startFrame).toBe(20)
    expect(currentClip(commit.engine, commit.clip.id).durationFrames).toBe(30)

    const cancel = setupClip()
    const cancelLeftHandle = cancel.block.querySelector(
      '.elah-trim-handle-left',
    ) as HTMLElement

    dispatchPointer(cancelLeftHandle, 'pointerdown', { clientX: 100 })
    dispatchPointer(window, 'pointermove', { clientX: 110 })
    dispatchPointer(window, 'pointercancel', { clientX: 110 })

    expect(currentClip(cancel.engine, cancel.clip.id).startFrame).toBe(10)
    expect(currentClip(cancel.engine, cancel.clip.id).durationFrames).toBe(40)
    expect(cancel.block.style.left).toBe('10px')
    expect(cancel.block.style.width).toBe('40px')
  })

  it('commits and reverts right trim gestures', () => {
    const commit = setupClip()
    const commitRightHandle = commit.block.querySelector(
      '.elah-trim-handle-right',
    ) as HTMLElement

    dispatchPointer(commitRightHandle, 'pointerdown', { clientX: 100 })
    dispatchPointer(window, 'pointermove', { clientX: 110 })
    dispatchPointer(window, 'pointerup', { clientX: 110 })

    expect(currentClip(commit.engine, commit.clip.id).durationFrames).toBe(50)

    const cancel = setupClip()
    const cancelRightHandle = cancel.block.querySelector(
      '.elah-trim-handle-right',
    ) as HTMLElement

    dispatchPointer(cancelRightHandle, 'pointerdown', { clientX: 100 })
    dispatchPointer(window, 'pointermove', { clientX: 110 })
    dispatchPointer(window, 'pointercancel', { clientX: 110 })

    expect(currentClip(cancel.engine, cancel.clip.id).startFrame).toBe(10)
    expect(currentClip(cancel.engine, cancel.clip.id).durationFrames).toBe(40)
    expect(cancel.block.style.width).toBe('40px')
  })

  it('applies the touch threshold while mouse drags move immediately', () => {
    const smallTouch = setupClip()

    dispatchPointer(smallTouch.block, 'pointerdown', {
      clientX: 100,
      pointerType: 'touch',
    })
    dispatchPointer(window, 'pointermove', {
      clientX: 105,
      pointerType: 'touch',
    })
    dispatchPointer(window, 'pointerup', {
      clientX: 105,
      pointerType: 'touch',
    })

    expect(currentClip(smallTouch.engine, smallTouch.clip.id).startFrame).toBe(10)
    expect(smallTouch.block.style.transform).toBe('')

    const largeTouch = setupClip()

    dispatchPointer(largeTouch.block, 'pointerdown', {
      clientX: 100,
      pointerType: 'touch',
    })
    dispatchPointer(window, 'pointermove', {
      clientX: 107,
      pointerType: 'touch',
    })
    dispatchPointer(window, 'pointerup', {
      clientX: 107,
      pointerType: 'touch',
    })

    expect(currentClip(largeTouch.engine, largeTouch.clip.id).startFrame).toBe(17)

    const mouse = setupClip()

    dispatchPointer(mouse.block, 'pointerdown', { clientX: 100 })
    dispatchPointer(window, 'pointermove', { clientX: 105 })
    dispatchPointer(window, 'pointerup', { clientX: 105 })

    expect(currentClip(mouse.engine, mouse.clip.id).startFrame).toBe(15)
  })

  it('removes window listeners after pointerup and pointercancel', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const up = setupClip()

    dispatchPointer(up.block, 'pointerdown', { clientX: 100 })
    dispatchPointer(window, 'pointerup', { clientX: 100 })

    expect(pointerRemoves(removeSpy.mock.calls, 'pointermove')).toHaveLength(1)
    expect(pointerRemoves(removeSpy.mock.calls, 'pointerup')).toHaveLength(1)
    expect(pointerRemoves(removeSpy.mock.calls, 'pointercancel')).toHaveLength(1)

    const cancel = setupClip()

    dispatchPointer(cancel.block, 'pointerdown', { clientX: 100 })
    dispatchPointer(window, 'pointercancel', { clientX: 100 })

    expect(pointerRemoves(removeSpy.mock.calls, 'pointermove')).toHaveLength(2)
    expect(pointerRemoves(removeSpy.mock.calls, 'pointerup')).toHaveLength(2)
    expect(pointerRemoves(removeSpy.mock.calls, 'pointercancel')).toHaveLength(2)
  })
})

describe('Playhead pointer gestures', () => {
  it('seeks while the playhead is dragged', () => {
    resetStores({ zoom: 2 })
    const parent = document.createElement('div')
    mockRect(parent, { left: 100 })

    const { container } = render(
      createElement(Playhead, { zoom: 2, height: 100 }),
      parent,
    )
    const needle = container.firstElementChild as HTMLElement

    dispatchPointer(needle, 'pointerdown', { clientX: 100 })
    dispatchPointer(window, 'pointermove', { clientX: 130 })
    dispatchPointer(window, 'pointerup', { clientX: 130 })

    expect(usePlaybackStore.getState().currentFrame).toBe(15)
  })
})

describe('Ruler pointer gestures', () => {
  it('seeks once per tap and ignores the synthesized click', () => {
    const onSeek = vi.fn()
    const { container } = render(
      createElement(Ruler, {
        fps: 30,
        totalFrames: 120,
        zoom: 2,
        onSeek,
      }),
    )
    const ruler = container.firstElementChild as HTMLElement
    mockRect(ruler, { left: 50 })

    dispatchPointer(ruler, 'pointerdown', { clientX: 70 })
    dispatchPointer(window, 'pointerup', { clientX: 70 })
    dispatchMouse(ruler, 'click', { clientX: 70 })

    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenLastCalledWith(10)
  })

  it('scrubs continuously on pointermove', () => {
    const onSeek = vi.fn()
    const { container } = render(
      createElement(Ruler, {
        fps: 30,
        totalFrames: 120,
        zoom: 2,
        onSeek,
      }),
    )
    const ruler = container.firstElementChild as HTMLElement
    mockRect(ruler, { left: 50 })

    dispatchPointer(ruler, 'pointerdown', { clientX: 70 })
    dispatchPointer(window, 'pointermove', { clientX: 90 })
    dispatchPointer(window, 'pointerup', { clientX: 90 })

    expect(onSeek.mock.calls.map(([frame]) => frame)).toEqual([10, 20])
  })
})

function render(element: ReactElement, container = document.createElement('div')): Rendered {
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  const rendered = { container, root }
  mounted.push(rendered)
  return rendered
}

function setupClip(): {
  block: HTMLElement
  clip: Clip
  engine: TimelineEngine
} {
  resetStores()
  const engine = new TimelineEngine({ fps: 30 })
  const playback = new PlaybackEngine({
    fps: 30,
    getTotalFrames: () => engine.getTotalFrames(),
    now: () => 0,
  })
  playbacks.push(playback)
  const track = engine.addTrack('elements')
  const clip = engine.addClip({
    trackId: track.id,
    type: 'text',
    name: 'Caption',
    text: { content: 'Caption' },
    startFrame: 10,
    durationFrames: 40,
  })
  syncTracks(engine)

  const { container } = render(
    createElement(
      EditorContext.Provider,
      { value: { engine, playback } },
      createElement(ClipBlock, {
        clip,
        zoom: 1,
        trackHeight: track.height,
      }),
    ),
  )
  const block = container.firstElementChild as HTMLElement
  return { block, clip, engine }
}

function resetStores(overrides: Partial<ReturnType<typeof usePlaybackStore.getState>> = {}) {
  act(() => {
    useTracksStore.setState({
      tracks: [],
      clips: {},
      stage: { width: 1080, height: 1920 },
      totalFrames: 0,
      canUndo: false,
      canRedo: false,
    })
    useSelectionStore.setState({
      selectedClipIds: new Set(),
      activeTrackId: null,
    })
    usePlaybackStore.setState({
      currentFrame: 0,
      currentFrameEpoch: 0,
      isPlaying: false,
      playbackRate: 1,
      loop: false,
      volume: 1,
      muted: false,
      zoom: 4,
      snapEnabled: false,
      ...overrides,
    })
  })
}

function syncTracks(engine: TimelineEngine) {
  useTracksStore.getState().sync(engine.getProject(), {
    canUndo: engine.canUndo(),
    canRedo: engine.canRedo(),
  })
}

function currentClip(engine: TimelineEngine, clipId: string): Clip {
  const found = engine.findClip(clipId)
  if (!found) throw new Error(`Missing clip ${clipId}`)
  return found.clip
}

function dispatchPointer(
  target: EventTarget,
  type: string,
  init: PointerEventInit = {},
) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        ...init,
      }),
    )
  })
}

function dispatchMouse(target: EventTarget, type: string, init: MouseEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 0,
        clientY: 0,
        ...init,
      }),
    )
  })
}

function mockRect(element: Element, rect: Partial<DOMRect>) {
  const fullRect = {
    bottom: rect.bottom ?? 0,
    height: rect.height ?? 0,
    left: rect.left ?? 0,
    right: rect.right ?? 0,
    top: rect.top ?? 0,
    width: rect.width ?? 0,
    x: rect.x ?? rect.left ?? 0,
    y: rect.y ?? rect.top ?? 0,
    toJSON: () => ({}),
  }
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => fullRect,
  })
}

function pointerRemoves(calls: ReadonlyArray<readonly [unknown, ...unknown[]]>, type: string) {
  return calls.filter(([eventType]) => eventType === type)
}
