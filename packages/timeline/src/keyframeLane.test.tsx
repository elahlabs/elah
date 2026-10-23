/**
 * `<KeyframeLane>` — the diamonds on a selected clip.
 *
 * Mounted inside a real `ClipBlock` rather than in isolation, because two of
 * the things worth asserting are about that relationship: a press on a marker
 * must NOT start a clip drag, and a drag must end as exactly one undo entry.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PlaybackEngine, TimelineEngine, type Clip, type ClipKeyframes, type KeyframeChannel } from '@elah/core'
import {
  EditorContext,
  usePlaybackStore,
  useSelectionStore,
  useTracksStore,
} from '@elah/react'
import { ClipBlock } from './ClipBlock'
import { useKeySelectionStore } from './keySelection.store'
import { KeyframeLane } from './KeyframeLane'

const mounted: Array<{ container: HTMLElement; root: Root }> = []
const playbacks: PlaybackEngine[] = []

afterEach(() => {
  for (const { root, container } of mounted.splice(0).reverse()) {
    act(() => root.unmount())
    container.remove()
  }
  for (const playback of playbacks.splice(0)) playback.destroy()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const ZOOM = 4

function keyframes(spec: Partial<Record<KeyframeChannel, number[]>>): ClipKeyframes {
  const channels: ClipKeyframes['channels'] = {}
  for (const [channel, frames] of Object.entries(spec) as [KeyframeChannel, number[]][]) {
    channels[channel] = {
      source: { kind: 'keyframes' },
      keys: frames.map((frame, i) => ({
        id: `${channel}-${i}`,
        frame,
        value: 0.5,
        easing: 'linear' as const,
      })),
    }
  }
  return { channels }
}

function setup(options: {
  keys?: Partial<Record<KeyframeChannel, number[]>>
  selected?: boolean
  zoom?: number
  currentFrame?: number
  snap?: boolean
} = {}) {
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
  if (options.keys) {
    engine.updateClip(clip.id, track.id, { keyframes: keyframes(options.keys) })
  }

  act(() => {
    useTracksStore.setState({
      tracks: [], clips: {}, stage: { width: 1080, height: 1920 },
      totalFrames: 0, canUndo: false, canRedo: false,
    })
    useSelectionStore.setState({
      selectedClipIds: new Set(options.selected === false ? [] : [clip.id]),
      activeTrackId: null,
    })
    usePlaybackStore.setState({
      currentFrame: options.currentFrame ?? 0,
      currentFrameEpoch: 0, isPlaying: false, playbackRate: 1, loop: false,
      volume: 1, muted: false, zoom: ZOOM, snapEnabled: options.snap ?? false,
    })
  })
  useTracksStore.getState().sync(engine.getProject(), { canUndo: false, canRedo: false })

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(
        EditorContext.Provider,
        { value: { engine, playback } },
        createElement(ClipBlock, {
          clip: engine.findClip(clip.id)!.clip,
          zoom: options.zoom ?? ZOOM,
          trackHeight: track.height,
        }),
      ),
    ),
  )
  mounted.push({ container, root })

  return { engine, container, clipId: clip.id, trackId: track.id }
}

function markers(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll('[data-keyframe-marker]')] as HTMLElement[]
}

function markerAt(container: HTMLElement, frame: number): HTMLElement {
  const el = container.querySelector(`[data-keyframe-marker="${frame}"]`)
  if (!el) throw new Error(`no marker at frame ${frame}; have ${markers(container).map((m) => m.dataset.keyframeMarker)}`)
  return el as HTMLElement
}

function pointer(target: EventTarget, type: string, clientX: number, init: PointerEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true, cancelable: true, button: 0,
        buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
        clientX, clientY: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true,
        ...init,
      }),
    )
  })
}

function keyFramesOf(engine: TimelineEngine, clipId: string, channel: KeyframeChannel): number[] {
  return (engine.findClip(clipId)!.clip.keyframes?.channels?.[channel]?.keys ?? []).map((k) => k.frame)
}

describe('rendering', () => {
  it('draws one marker per distinct frame, not one per key', () => {
    // x and y keyed together is ONE keyframe to the user.
    const { container } = setup({ keys: { x: [0, 20], y: [0, 20], opacity: [10] } })
    expect(markers(container).map((m) => m.dataset.keyframeMarker)).toEqual(['0', '10', '20'])
  })

  it('positions markers at clip-relative frames', () => {
    const { container } = setup({ keys: { x: [0, 20] } })
    expect(markerAt(container, 20).style.left).toBe(`${20 * ZOOM}px`)
    expect(markerAt(container, 0).style.left).toBe('0px')
  })

  it('renders nothing when the clip is not selected', () => {
    const { container } = setup({ keys: { x: [0] }, selected: false })
    expect(markers(container)).toHaveLength(0)
  })

  it('renders nothing when the clip has no keys', () => {
    const { container } = setup({})
    expect(container.querySelector('[data-keyframe-lane]')).toBeNull()
  })

  it('folds keys too close together into one cluster marker at a far-out zoom', () => {
    const { container } = setup({ keys: { x: [0, 1, 2] }, zoom: 0.05 })
    const all = markers(container)
    expect(all).toHaveLength(1)
    expect(all[0]!.dataset.keyframeCluster).toBe('3')
  })

  it('a cluster click seeks to its first key and does not start a drag', () => {
    const { container } = setup({ keys: { x: [0, 1, 2, 200] }, zoom: 0.05 })
    const cluster = markerAt(container, 0)
    expect(cluster.dataset.keyframeCluster).toBe('3')
    pointer(cluster, 'pointerdown', 0)
    expect([...useKeySelectionStore.getState().frames]).toEqual([0])
    expect(usePlaybackStore.getState().currentFrame).toBe(10)
    // The far key is still its own, draggable marker.
    expect(markerAt(container, 200).dataset.keyframeCluster).toBeUndefined()
  })

  it('pins a key pushed outside the trim to the edge and makes it inert', () => {
    const { container } = setup({ keys: { x: [-5, 10] } })
    const outside = markerAt(container, -5)
    expect(outside.style.left).toBe('0px')
    expect(outside.style.pointerEvents).toBe('none')
  })
})

describe('dragging', () => {
  it('retimes every channel keyed at that frame, as one undo entry', () => {
    const { container, engine, clipId } = setup({ keys: { x: [0, 20], y: [20] } })

    pointer(markerAt(container, 20), 'pointerdown', 0)
    pointer(window, 'pointermove', 10 * ZOOM)
    pointer(window, 'pointerup', 10 * ZOOM)

    expect(keyFramesOf(engine, clipId, 'x')).toEqual([0, 30])
    expect(keyFramesOf(engine, clipId, 'y')).toEqual([30])

    engine.undo()
    expect(keyFramesOf(engine, clipId, 'x')).toEqual([0, 20])
    expect(keyFramesOf(engine, clipId, 'y')).toEqual([20])
  })

  it('stops one frame short of a neighbouring key instead of merging', () => {
    const { container, engine, clipId } = setup({ keys: { x: [0, 10, 20] } })

    pointer(markerAt(container, 10), 'pointerdown', 0)
    pointer(window, 'pointermove', 40 * ZOOM) // way past frame 20
    pointer(window, 'pointerup', 40 * ZOOM)

    expect(keyFramesOf(engine, clipId, 'x')).toEqual([0, 19, 20])
  })

  it('clamps at the clip ends', () => {
    const { container, engine, clipId } = setup({ keys: { x: [20] } })

    pointer(markerAt(container, 20), 'pointerdown', 0)
    pointer(window, 'pointermove', -100 * ZOOM)
    pointer(window, 'pointerup', -100 * ZOOM)

    expect(keyFramesOf(engine, clipId, 'x')).toEqual([0])
  })

  it('reverts on pointercancel', () => {
    const { container, engine, clipId } = setup({ keys: { x: [20] } })

    pointer(markerAt(container, 20), 'pointerdown', 0)
    pointer(window, 'pointermove', 5 * ZOOM)
    pointer(window, 'pointercancel', 5 * ZOOM)

    expect(keyFramesOf(engine, clipId, 'x')).toEqual([20])
    // No history entry was added: one undo still reaches past the setup's own
    // keyframe write, back to a clip with no keys at all.
    engine.undo()
    expect(engine.findClip(clipId)!.clip.keyframes).toBeUndefined()
  })

  it('does not drag the clip itself', () => {
    const { container, engine, clipId } = setup({ keys: { x: [20] } })

    pointer(markerAt(container, 20), 'pointerdown', 0)
    pointer(window, 'pointermove', 5 * ZOOM)
    pointer(window, 'pointerup', 5 * ZOOM)

    expect(engine.findClip(clipId)!.clip.startFrame).toBe(10)
  })

  it('a press with no travel seeks to the key instead of editing it', () => {
    const { container, engine, clipId } = setup({ keys: { x: [20] } })

    pointer(markerAt(container, 20), 'pointerdown', 0)
    pointer(window, 'pointerup', 0)

    // Keys are clip-relative; the playhead is absolute (clip starts at 10).
    expect(usePlaybackStore.getState().currentFrame).toBe(30)
    expect(keyFramesOf(engine, clipId, 'x')).toEqual([20])
    // Seeking is not an edit: one undo still reaches past the setup's write.
    engine.undo()
    expect(engine.findClip(clipId)!.clip.keyframes).toBeUndefined()
  })

  it('a locked track blocks the edit but still allows the seek', () => {
    const { container, engine, clipId, trackId } = setup({ keys: { x: [20] } })
    act(() => {
      engine.updateTrack(trackId, { locked: true })
      useTracksStore.getState().sync(engine.getProject(), { canUndo: false, canRedo: false })
    })

    pointer(markerAt(container, 20), 'pointerdown', 0)
    pointer(window, 'pointermove', 5 * ZOOM)
    pointer(window, 'pointerup', 5 * ZOOM)

    expect(keyFramesOf(engine, clipId, 'x')).toEqual([20])
  })
})


describe('key selection (PV-T7-3)', () => {
  it('a click selects the key and seeks to it', () => {
    const { container } = setup({ keys: { x: [0, 10, 20] } })
    pointer(markerAt(container, 10), 'pointerdown', 0)
    pointer(window, 'pointerup', 0)
    expect(useKeySelectionStore.getState().clipId).not.toBeNull()
    expect([...useKeySelectionStore.getState().frames]).toEqual([10])
    // The click still seeks, which is what the lane has always done.
    expect(usePlaybackStore.getState().currentFrame).toBe(10 + 10)
  })

  it('marks the selected diamond so the selection is visible', () => {
    const { container } = setup({ keys: { x: [0, 10] } })
    pointer(markerAt(container, 10), 'pointerdown', 0)
    pointer(window, 'pointerup', 0)
    expect(markerAt(container, 10).dataset.keyframeSelected).toBe('true')
    expect(markerAt(container, 0).dataset.keyframeSelected).toBeUndefined()
  })

  it('Shift+click adds a key, and Shift+click again takes it back out', () => {
    const { container } = setup({ keys: { x: [0, 10, 20] } })
    pointer(markerAt(container, 10), 'pointerdown', 0)
    pointer(window, 'pointerup', 0)
    pointer(markerAt(container, 20), 'pointerdown', 0, { shiftKey: true })
    pointer(window, 'pointerup', 0)
    expect([...useKeySelectionStore.getState().frames].sort((a, b) => a - b)).toEqual([10, 20])
    pointer(markerAt(container, 10), 'pointerdown', 0, { shiftKey: true })
    pointer(window, 'pointerup', 0)
    expect([...useKeySelectionStore.getState().frames]).toEqual([20])
  })

  it('a plain click replaces the selection rather than adding to it', () => {
    const { container } = setup({ keys: { x: [0, 10, 20] } })
    pointer(markerAt(container, 10), 'pointerdown', 0)
    pointer(window, 'pointerup', 0)
    pointer(markerAt(container, 20), 'pointerdown', 0, { shiftKey: true })
    pointer(window, 'pointerup', 0)
    pointer(markerAt(container, 0), 'pointerdown', 0)
    pointer(window, 'pointerup', 0)
    expect([...useKeySelectionStore.getState().frames]).toEqual([0])
  })
})

describe('multi-key drag (PV-T7-3)', () => {
  /** Keys at 0, 10, 20, 30 on a 40-frame clip; 10 and 20 selected. */
  function twoSelected() {
    const s = setup({ keys: { x: [0, 10, 20, 30] }, zoom: 1, snap: false })
    act(() => useKeySelectionStore.getState().select(s.clipId, [10, 20]))
    return s
  }

  it('moves every selected key together, in one undo step', () => {
    const { container, engine, clipId } = twoSelected()
    pointer(markerAt(container, 10), 'pointerdown', 0)
    pointer(window, 'pointermove', 5)
    pointer(window, 'pointerup', 5)
    expect(keyFramesOf(engine, clipId, 'x')).toEqual([0, 15, 25, 30])
    engine.undo()
    expect(keyFramesOf(engine, clipId, 'x')).toEqual([0, 10, 20, 30])
  })

  it('clamps the block at the clip end rather than past it', () => {
    const { container, engine, clipId } = twoSelected()
    pointer(markerAt(container, 10), 'pointerdown', 0)
    pointer(window, 'pointermove', 25)
    pointer(window, 'pointerup', 25)
    expect(keyFramesOf(engine, clipId, 'x')).toEqual([0, 29, 30, 39])
  })

  it('keeps the last good preview when a move would land on an unselected key', () => {
    const { container, engine, clipId } = twoSelected()
    pointer(markerAt(container, 10), 'pointerdown', 0)
    pointer(window, 'pointermove', 9)
    // +10 would put the key at 20 onto the unselected key at 30.
    pointer(window, 'pointermove', 10)
    pointer(window, 'pointerup', 10)
    expect(keyFramesOf(engine, clipId, 'x')).toEqual([0, 19, 29, 30])
  })

  it('Escape mid-drag puts every key back', () => {
    const { container, engine, clipId } = twoSelected()
    pointer(markerAt(container, 10), 'pointerdown', 0)
    pointer(window, 'pointermove', 12)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(keyFramesOf(engine, clipId, 'x')).toEqual([0, 10, 20, 30])
  })

  it('dragging an unselected key takes that key alone', () => {
    const s = setup({ keys: { x: [0, 10, 20, 30] }, zoom: 1, snap: false })
    act(() => useKeySelectionStore.getState().select(s.clipId, [10, 20]))
    pointer(markerAt(s.container, 30), 'pointerdown', 0)
    pointer(window, 'pointermove', 5)
    pointer(window, 'pointerup', 5)
    expect(keyFramesOf(s.engine, s.clipId, 'x')).toEqual([0, 10, 20, 35])
  })

  it('follows the selection to the frames it committed', () => {
    const { container, clipId } = twoSelected()
    pointer(markerAt(container, 10), 'pointerdown', 0)
    pointer(window, 'pointermove', 5)
    pointer(window, 'pointerup', 5)
    expect([...useKeySelectionStore.getState().frames].sort((a, b) => a - b)).toEqual([15, 25])
    expect(useKeySelectionStore.getState().clipId).toBe(clipId)
  })
})

describe('channels prop (PV-T7-3)', () => {
  it('shows only the frames keyed on the channels it is given', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const playback = new PlaybackEngine({ fps: 30, getTotalFrames: () => engine.getTotalFrames(), now: () => 0 })
    playbacks.push(playback)
    const track = engine.addTrack('elements')
    const clip = engine.addClip({
      trackId: track.id,
      type: 'text',
      name: 'C',
      text: { content: 'C' },
      startFrame: 0,
      durationFrames: 60,
    })
    engine.updateClip(clip.id, track.id, { keyframes: keyframes({ x: [0, 10], y: [20, 30] }) })
    // The clip object addClip returned predates the keyframes; the engine is
    // the truth.
    const keyed = engine.findClip(clip.id)!.clip

    const seen: number[][] = []
    for (const channels of [undefined, ['x'] as const]) {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      act(() =>
        root.render(
          createElement(
            EditorContext.Provider,
            { value: { engine, playback } },
            createElement(KeyframeLane, { clip: keyed, zoom: 4, channels }),
          ),
        ),
      )
      seen.push(markers(container).map((m) => Number(m.dataset.keyframeMarker)))
      act(() => root.unmount())
      container.remove()
    }
    expect(seen[0]).toEqual([0, 10, 20, 30])
    expect(seen[1]).toEqual([0, 10])
  })
})
