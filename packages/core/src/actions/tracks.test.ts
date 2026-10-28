import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import {
  ensureAudioTrack,
  ensureElementsTrack,
  ensureTrackOfKind,
  ensureVideoTrack,
  findFreeTrackAt,
} from './tracks'

/** Lane rules shared by drop-to-timeline and the detach action. */

function emptyEngine() {
  const engine = new TimelineEngine({ fps: 30 })
  for (const t of engine.getProject().tracks) engine.removeTrack(t.id)
  return engine
}

describe('ensureTrackOfKind', () => {
  it('creates a lane with the given name when none of that kind exists', () => {
    const engine = emptyEngine()
    const r = ensureVideoTrack(engine, 'Video 1')
    if (!r.ok) throw new Error('expected a lane')
    expect(r.created).toBe(true)
    const track = engine.getProject().tracks.find((t) => t.id === r.trackId)!
    expect(track).toMatchObject({ kind: 'video', name: 'Video 1' })
  })

  it('creates audio and elements lanes of their own kind', () => {
    const engine = emptyEngine()
    const a = ensureAudioTrack(engine, 'Audio 1')
    const e = ensureElementsTrack(engine, 'Text 1')
    if (!a.ok || !e.ok) throw new Error('expected lanes')
    const tracks = engine.getProject().tracks
    expect(tracks.find((t) => t.id === a.trackId)).toMatchObject({ kind: 'audio', name: 'Audio 1' })
    expect(tracks.find((t) => t.id === e.trackId)).toMatchObject({ kind: 'elements', name: 'Text 1' })
  })

  it('reuses the first unlocked lane instead of creating one', () => {
    const engine = emptyEngine()
    const locked = engine.addTrack('audio')
    engine.updateTrack(locked.id, { locked: true })
    const open = engine.addTrack('audio')
    expect(ensureAudioTrack(engine)).toEqual({ ok: true, trackId: open.id, created: false })
    expect(engine.getProject().tracks).toHaveLength(2)
  })

  it('refuses when every lane of the kind is locked, and creates nothing', () => {
    const engine = emptyEngine()
    const t = engine.addTrack('video')
    engine.updateTrack(t.id, { locked: true })
    expect(ensureTrackOfKind(engine, 'video')).toEqual({ ok: false, reason: 'locked' })
    expect(engine.getProject().tracks).toHaveLength(1)
  })

  it('falls back to the engine default name when none is given', () => {
    const engine = emptyEngine()
    const r = ensureAudioTrack(engine)
    if (!r.ok) throw new Error('expected a lane')
    const track = engine.getProject().tracks.find((t) => t.id === r.trackId)!
    expect(typeof track.name).toBe('string')
    expect(track.name).not.toBe('undefined')
  })
})

describe('findFreeTrackAt', () => {
  function setup() {
    const engine = emptyEngine()
    const v1 = engine.addTrack('video')
    const v2 = engine.addTrack('video')
    engine.addClip({ trackId: v1.id, type: 'video', src: 'a.mp4', name: 'A', startFrame: 10, durationFrames: 20 })
    return { engine, v1, v2 }
  }

  it('skips a lane whose clips overlap the span', () => {
    const { engine, v1, v2 } = setup()
    expect(findFreeTrackAt(engine, 'video', 15, 10)?.id).toBe(v2.id)
    expect(findFreeTrackAt(engine, 'video', 30, 10)?.id).toBe(v1.id) // abutting is not overlap
  })

  it('skips locked lanes and the excluded lane', () => {
    const { engine, v1, v2 } = setup()
    engine.updateTrack(v2.id, { locked: true })
    expect(findFreeTrackAt(engine, 'video', 100, 10)?.id).toBe(v1.id)
    expect(findFreeTrackAt(engine, 'video', 100, 10, v1.id)).toBeUndefined()
  })

  it('only considers lanes of the requested kind', () => {
    const { engine } = setup()
    expect(findFreeTrackAt(engine, 'audio', 0, 10)).toBeUndefined()
  })
})
