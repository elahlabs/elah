import { beforeEach, describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'
import { readProjectDocument } from './projectDocument'
import { rippleDelete, rippleTrim } from '../actions/ripple'

/** EDX-P5: markers, in/out, atomic shifts and ripple edits. */

function text(engine: TimelineEngine, trackId: string, startFrame: number, durationFrames: number) {
  return engine.addClip({
    trackId,
    type: 'text',
    name: `T${startFrame}`,
    text: { content: 'x' },
    startFrame,
    durationFrames,
  }).id
}

function starts(engine: TimelineEngine, trackId: string) {
  return engine.getClipsOnTrack(trackId).map((c) => [c.startFrame, c.durationFrames])
}

describe('markers', () => {
  let engine: TimelineEngine
  beforeEach(() => {
    engine = new TimelineEngine({ fps: 30 })
  })

  it('adds sorted markers, each one undo step', () => {
    engine.addMarker(90, { name: 'b' })
    engine.addMarker(30, { name: 'a' })
    expect(engine.getProject().markers?.map((m) => m.name)).toEqual(['a', 'b'])
    engine.undo()
    expect(engine.getProject().markers?.map((m) => m.name)).toEqual(['b'])
    engine.undo()
    expect(engine.getProject().markers ?? []).toEqual([])
  })

  it('renames and moves, re-sorting', () => {
    const a = engine.addMarker(10, { name: 'a' })
    engine.addMarker(20, { name: 'b' })
    engine.updateMarker(a.id, { name: 'A', frame: 40 })
    expect(engine.getProject().markers?.map((m) => [m.name, m.frame])).toEqual([
      ['b', 20],
      ['A', 40],
    ])
    engine.undo()
    expect(engine.getProject().markers?.[0]).toMatchObject({ name: 'a', frame: 10 })
  })

  it('removing the last marker drops the field', () => {
    const a = engine.addMarker(10)
    engine.removeMarker(a.id)
    expect('markers' in engine.getProject()).toBe(false)
  })

  it('clamps a negative frame to zero', () => {
    expect(engine.addMarker(-5).frame).toBe(0)
  })
})

describe('in/out', () => {
  let engine: TimelineEngine
  let trackId: string
  beforeEach(() => {
    engine = new TimelineEngine({ fps: 30 })
    trackId = engine.addTrack('elements').id
    text(engine, trackId, 0, 300)
  })

  it('sets either end alone and undoes in one step', () => {
    engine.setInOut({ in: 30 })
    expect(engine.getProject().inOut).toEqual({ in: 30, out: 300 })
    engine.setInOut({ out: 120 })
    expect(engine.getProject().inOut).toEqual({ in: 30, out: 120 })
    engine.undo()
    expect(engine.getProject().inOut).toEqual({ in: 30, out: 300 })
  })

  it('an empty or inverted range clears it', () => {
    engine.setInOut({ in: 30, out: 60 })
    engine.setInOut({ in: 90 })
    expect(engine.getProject().inOut).toBeUndefined()
    engine.setInOut({ in: 10, out: 20 })
    engine.setInOut(null)
    expect(engine.getProject().inOut).toBeUndefined()
  })

  it('survives a save and restore', () => {
    engine.setInOut({ in: 15, out: 45 })
    engine.addMarker(20, { name: 'hit' })
    const restored = readProjectDocument(JSON.parse(JSON.stringify(engine.getProject())))
    expect(restored.inOut).toEqual({ in: 15, out: 45 })
    expect(restored.markers?.[0]).toMatchObject({ frame: 20, name: 'hit' })
  })
})

describe('shiftClips', () => {
  let engine: TimelineEngine
  let trackId: string
  beforeEach(() => {
    engine = new TimelineEngine({ fps: 30 })
    trackId = engine.addTrack('elements').id
  })

  it('moves several clips in one step, validated on the final layout', () => {
    const a = text(engine, trackId, 0, 30)
    const b = text(engine, trackId, 30, 30)
    // Swap-free leftward shift that would collide if applied b-first.
    expect(
      engine.shiftClips([
        { clipId: a, trackId, delta: 10 },
        { clipId: b, trackId, delta: 10 },
      ]),
    ).toBe(true)
    expect(starts(engine, trackId)).toEqual([
      [10, 30],
      [40, 30],
    ])
    engine.undo()
    expect(starts(engine, trackId)).toEqual([
      [0, 30],
      [30, 30],
    ])
  })

  it('refuses overlaps and negative starts without changing anything', () => {
    const a = text(engine, trackId, 0, 30)
    const b = text(engine, trackId, 40, 30)
    expect(engine.shiftClips([{ clipId: b, trackId, delta: -20 }])).toBe(false)
    expect(engine.shiftClips([{ clipId: a, trackId, delta: -1 }])).toBe(false)
    expect(starts(engine, trackId)).toEqual([
      [0, 30],
      [40, 30],
    ])
    expect(engine.canUndo()).toBe(true) // only the two addClips
  })

  it('keeps a transition whose two clips move together, shifted with them', () => {
    const video = engine.addTrack('video').id
    const mk = (start: number) =>
      engine.addClip({ trackId: video, type: 'video', name: 'v', src: 'x.mp4', startFrame: start, durationFrames: 30 }).id
    const a = mk(40)
    const b = mk(70)
    const t = engine.addTransition({ fromClipId: a, toClipId: b, trackId: video, kind: 'fade', durationFrames: 10 })!
    expect(engine.shiftClips([
      { clipId: a, trackId: video, delta: -40 },
      { clipId: b, trackId: video, delta: -40 },
    ])).toBe(true)
    const moved = engine.getProject().transitions.find((x) => x.id === t.id)
    expect(moved?.startFrame).toBe(t.startFrame - 40)
  })
})

describe('rippleDelete', () => {
  let engine: TimelineEngine
  let trackId: string
  let other: string
  beforeEach(() => {
    engine = new TimelineEngine({ fps: 30 })
    trackId = engine.addTrack('elements').id
    other = engine.addTrack('elements').id
  })

  it('closes the gap on its own track only, as one undo step', () => {
    const a = text(engine, trackId, 0, 30)
    const b = text(engine, trackId, 30, 20)
    text(engine, trackId, 60, 30)
    text(engine, other, 60, 30)
    void a
    const r = rippleDelete(engine, [b])
    expect(r.ok).toBe(true)
    expect(starts(engine, trackId)).toEqual([
      [0, 30],
      [40, 30],
    ])
    expect(starts(engine, other)).toEqual([[60, 30]])
    engine.undo()
    expect(starts(engine, trackId)).toEqual([
      [0, 30],
      [30, 20],
      [60, 30],
    ])
  })

  it('handles several clips on several tracks', () => {
    const a = text(engine, trackId, 0, 10)
    text(engine, trackId, 10, 10)
    const c = text(engine, other, 0, 5)
    text(engine, other, 20, 5)
    expect(rippleDelete(engine, [a, c]).ok).toBe(true)
    expect(starts(engine, trackId)).toEqual([[0, 10]])
    expect(starts(engine, other)).toEqual([[15, 5]])
  })

  it('reports instead of throwing', () => {
    expect(rippleDelete(engine, ['missing'])).toEqual({ ok: false, reason: 'clip-not-found' })
    expect(rippleDelete(engine, [])).toEqual({ ok: false, reason: 'no-selection' })
    const a = text(engine, trackId, 0, 10)
    engine.updateTrack(trackId, { locked: true })
    expect(rippleDelete(engine, [a])).toEqual({ ok: false, reason: 'track-locked' })
  })
})

describe('rippleTrim', () => {
  let engine: TimelineEngine
  let trackId: string
  beforeEach(() => {
    engine = new TimelineEngine({ fps: 30 })
    trackId = engine.addTrack('elements').id
  })

  it('trims the end to the frame and pulls later clips left', () => {
    const a = text(engine, trackId, 0, 60)
    text(engine, trackId, 60, 30)
    const r = rippleTrim(engine, a, 'end', 40)
    expect(r).toEqual({ ok: true, data: { removedFrames: 20 } })
    expect(starts(engine, trackId)).toEqual([
      [0, 40],
      [40, 30],
    ])
    engine.undo()
    expect(starts(engine, trackId)).toEqual([
      [0, 60],
      [60, 30],
    ])
  })

  it('trims the start and keeps the clip where it was', () => {
    const a = text(engine, trackId, 10, 60)
    text(engine, trackId, 70, 30)
    expect(rippleTrim(engine, a, 'start', 30).ok).toBe(true)
    expect(starts(engine, trackId)).toEqual([
      [10, 40],
      [50, 30],
    ])
  })

  it('does nothing outside the clip', () => {
    const a = text(engine, trackId, 10, 60)
    expect(rippleTrim(engine, a, 'end', 10)).toEqual({ ok: false, reason: 'playhead-outside-clip' })
    expect(rippleTrim(engine, a, 'start', 70)).toEqual({ ok: false, reason: 'playhead-outside-clip' })
    expect(starts(engine, trackId)).toEqual([[10, 60]])
  })
})
