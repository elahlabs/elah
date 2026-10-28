import { describe, expect, it } from 'vitest'
import * as root from './index'
import * as engine from './engine'

/**
 * `@elah/core` and `@elah/core/engine` must hand out the SAME store and class
 * objects. A web app that imports both entries (or @elah/react on one and the
 * host on the other) would otherwise mirror the engine into one tracksStore
 * and render from another.
 */
describe('@elah/core/engine shares identity with @elah/core', () => {
  it('re-exports the same store singletons', () => {
    expect(engine.tracksStore).toBe(root.tracksStore)
    expect(engine.playbackStore).toBe(root.playbackStore)
    expect(engine.selectionStore).toBe(root.selectionStore)
    expect(engine.transitionsStore).toBe(root.transitionsStore)
    expect(engine.clipLoadStore).toBe(root.clipLoadStore)
    expect(engine.textStylePresetsStore).toBe(root.textStylePresetsStore)
    expect(engine.mediaLibraryStore).toBe(root.mediaLibraryStore)
  })

  it('re-exports the same engine classes and pure functions', () => {
    expect(engine.TimelineEngine).toBe(root.TimelineEngine)
    expect(engine.PlaybackEngine).toBe(root.PlaybackEngine)
    expect(engine.resolveTimeline).toBe(root.resolveTimeline)
    expect(engine.computeRulerTicks).toBe(root.computeRulerTicks)
  })

  it('every value it exports also exists on the root entry', () => {
    const missing = Object.keys(engine).filter((name) => !(name in root))
    expect(missing).toEqual([])
  })

  it('is a working engine on its own', () => {
    const e = new engine.TimelineEngine({ fps: 30 })
    const track = e.addTrack('elements')
    e.addClip({ trackId: track.id, type: 'text', text: { content: 'Hi' }, startFrame: 0, durationFrames: 30 })
    const scene = engine.resolveTimeline(10, e.getProject())
    expect(scene.texts.map((t) => t.content)).toEqual(['Hi'])
  })
})
