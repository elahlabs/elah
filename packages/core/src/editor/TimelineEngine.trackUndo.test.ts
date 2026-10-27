import { describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'

const ids = (e: TimelineEngine) => e.getProject().tracks.map((t) => t.id)

describe('TimelineEngine - track add/remove are single undo steps', () => {
  it('Undo right after addTrack removes that track and leaves earlier history intact', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const first = engine.addTrack('video')
    engine.updateTrack(first.id, { name: 'Renamed' })
    const before = ids(engine)
    const added = engine.addTrack('video')
    expect(ids(engine)).toHaveLength(before.length + 1)

    expect(engine.undo()).toBe(true)
    expect(ids(engine)).toEqual(before)
    expect(engine.getProject().tracks.find((t) => t.id === first.id)?.name).toBe('Renamed')
    expect(engine.getProject().clips[added.id]).toBeUndefined()

    expect(engine.redo()).toBe(true)
    expect(ids(engine)).toContain(added.id)
  })

  it('a track:added listener that styles the new lane joins the same undo step (the host FirstLaneStyler case)', () => {
    const engine = new TimelineEngine({ fps: 30 })
    engine.on('track:added', (track) => engine.updateTrack(track.id, { height: 80 }))
    const before = ids(engine)
    const added = engine.addTrack('video')
    expect(engine.getProject().tracks.find((t) => t.id === added.id)?.height).toBe(80)

    expect(engine.undo()).toBe(true)
    expect(ids(engine)).toEqual(before)
    expect(engine.canUndo()).toBe(false)
  })

  it('Undo right after removeTrack restores the track', () => {
    const engine = new TimelineEngine({ fps: 30 })
    engine.addTrack('video')
    const b = engine.addTrack('video')
    engine.removeTrack(b.id)
    expect(ids(engine)).not.toContain(b.id)
    engine.undo()
    expect(ids(engine)).toContain(b.id)
  })
})
