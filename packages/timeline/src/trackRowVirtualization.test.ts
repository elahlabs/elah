import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PlaybackEngine, TimelineEngine, type Clip, type Track } from '@elah/core'
import { EditorContext, useSelectionStore, useTracksStore } from '@elah/react'
import { TrackRow } from './TrackRow'
import { VisibleWindowContext, type VisibleWindow } from './visible-window'

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
})

// 50 clips laid end-to-end, 30 frames each, zoom 1 => clip i spans px
// [i*30, i*30+30). Window [500, 600] + VIRTUALIZATION_BUFFER_PX (200) makes
// the effective visible span (300, 800): clip i is visible iff
// i*30+30 > 300 && i*30 < 800, i.e. i in [10, 26] inclusive => 17 clips.
// (Expected count is hardcoded from this independent hand computation, not
// derived by calling isClipVisible in the test.)
const CLIP_COUNT = 50
const CLIP_DURATION = 30
const ZOOM = 1
const NARROW_WINDOW: VisibleWindow = { start: 500, end: 600 }
const EXPECTED_VISIBLE_IN_NARROW_WINDOW = 17

describe('TrackRow clip virtualization', () => {
  it('culls clips outside the visible window (+ buffer)', () => {
    const { container } = setupTrack(CLIP_COUNT, NARROW_WINDOW)
    expect(mountedClipCount(container)).toBe(EXPECTED_VISIBLE_IN_NARROW_WINDOW)
  })

  it('mounts all clips under the default context (SHOW_ALL_WINDOW backward-compat)', () => {
    const { container } = setupTrack(CLIP_COUNT, undefined)
    expect(mountedClipCount(container)).toBe(CLIP_COUNT)
  })

  it('keeps a selected clip mounted even when its pixels are far outside the window', () => {
    const { container, clips } = setupTrack(CLIP_COUNT, NARROW_WINDOW, { selectIndex: 40 })
    // clip 40 spans [1200, 1230) px — well outside (300, 800), so it would be
    // culled if selection didn't exempt it.
    const clip40 = clips[40]
    expect(clip40.startFrame * ZOOM).toBeGreaterThanOrEqual(800)

    expect(mountedClipCount(container)).toBe(EXPECTED_VISIBLE_IN_NARROW_WINDOW + 1)
    const selectedBlock = container.querySelector('[data-clip-type][data-selected="true"]')
    expect(selectedBlock).not.toBeNull()
  })

  it.each([5, 20, 50])(
    'renders all %i clips under SHOW_ALL_WINDOW',
    (count) => {
      const { container } = setupTrack(count, undefined)
      expect(mountedClipCount(container)).toBe(count)
    },
  )
})

function mountedClipCount(container: HTMLElement): number {
  return container.querySelectorAll('[data-clip-type]').length
}

function setupTrack(
  clipCount: number,
  visibleWindow: VisibleWindow | undefined,
  options: { selectIndex?: number } = {},
) {
  resetStores()
  const engine = new TimelineEngine({ fps: 30 })
  const playback = new PlaybackEngine({
    fps: 30,
    getTotalFrames: () => engine.getTotalFrames(),
    now: () => 0,
  })
  playbacks.push(playback)
  const track: Track = engine.addTrack('elements')
  const clips: Clip[] = []
  for (let i = 0; i < clipCount; i++) {
    const clip = engine.addClip({
      trackId: track.id,
      type: 'text',
      name: `Caption ${i}`,
      text: { content: `Caption ${i}` },
      startFrame: i * CLIP_DURATION,
      durationFrames: CLIP_DURATION,
    })
    clips.push(clip)
  }
  syncTracks(engine)

  if (options.selectIndex !== undefined) {
    act(() => {
      useSelectionStore.getState().selectClip(clips[options.selectIndex!].id)
    })
  }

  const trackRow = createElement(TrackRow, {
    track,
    totalFrames: engine.getTotalFrames(),
    zoom: ZOOM,
    fps: 30,
  })

  const tree = createElement(
    EditorContext.Provider,
    { value: { engine, playback } },
    visibleWindow
      ? createElement(VisibleWindowContext.Provider, { value: visibleWindow }, trackRow)
      : trackRow,
  )

  const { container } = render(tree)
  return { container, clips, engine }
}

function render(element: ReturnType<typeof createElement>): Rendered {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  const rendered = { container, root }
  mounted.push(rendered)
  return rendered
}

function resetStores() {
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
  })
}

function syncTracks(engine: TimelineEngine) {
  useTracksStore.getState().sync(engine.getProject(), {
    canUndo: engine.canUndo(),
    canRedo: engine.canRedo(),
  })
}
