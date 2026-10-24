import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { applyOps } from './apply'
import { opDescriber } from './describeOp'
import { sanitizeOps } from './sanitize'
import type { ApplyContext } from './apply'

/**
 * `insertSourceRange` (AGN-P2): a range of a library asset becomes ONE merged
 * clip, through the same `sanitizeOps` gate and the same single batch as every
 * other op. Run against a real engine, as the neighbouring op tests do.
 */

type Assets = NonNullable<ApplyContext['assets']>

const FPS = 30
const assets: Assets = new Map([
  ['talk', { id: 'talk', kind: 'video', name: 'Interview', src: 'blob:talk', durationSec: 20, hasAudio: true }],
  ['broll', { id: 'broll', kind: 'video', name: 'Harbour', src: 'blob:broll', durationSec: 10 }],
  ['song', { id: 'song', kind: 'audio', name: 'Theme', src: 'blob:song', durationSec: 60 }],
  ['logo', { id: 'logo', kind: 'image', name: 'Logo', src: 'blob:logo', durationSec: 0 }],
])

/** Sanitize against the library, then apply: the path the web layer takes. */
function run(engine: TimelineEngine, raw: unknown[]) {
  const clean = sanitizeOps(raw, engine.getProject(), { assets })
  const res = applyOps(engine, clean.ops, { assets })
  return { ...res, dropped: clean.dropped, ops: clean.ops }
}

const allClips = (engine: TimelineEngine) => Object.values(engine.getProject().clips).flat()

describe('insertSourceRange', () => {
  it('places one merged, trimmed video clip on a lane it creates (empty timeline)', () => {
    const engine = new TimelineEngine({ fps: FPS, initialTracks: [] })
    expect(engine.getProject().tracks).toHaveLength(0)
    const r = run(engine, [{ op: 'insertSourceRange', asset: 'talk', start: 12, end: 19 }])
    expect(r.dropped).toEqual([])
    expect(r.skipped).toEqual([])
    const clips = allClips(engine)
    // One clip, no separate audio clip, one lane.
    expect(clips).toHaveLength(1)
    expect(engine.getProject().tracks.map((t) => t.kind)).toEqual(['video'])
    const c = clips[0]!
    expect(c).toMatchObject({
      type: 'video',
      name: 'Interview',
      src: 'blob:talk',
      assetId: 'talk',
      startFrame: 0,
      durationFrames: 210,
      sourceStartFrame: 360,
      sourceDurationFrames: 210,
      assetFrames: 600,
      embeddedAudio: true,
    })
    expect(r.touched.added).toEqual([c.id])
  })

  it('appends after the last clip of the lane when `at` is omitted', () => {
    const engine = new TimelineEngine({ fps: FPS, initialTracks: [] })
    run(engine, [
      { op: 'insertSourceRange', asset: 'talk', start: 0, end: 4 },
      { op: 'insertSourceRange', asset: 'broll', start: 2, end: 5 },
    ])
    expect(engine.getProject().tracks).toHaveLength(1)
    expect(allClips(engine).map((c) => [c.name, c.startFrame, c.durationFrames])).toEqual([
      ['Interview', 0, 120],
      ['Harbour', 120, 90],
    ])
  })

  it('mute silences the clip but keeps its sound path', () => {
    const engine = new TimelineEngine({ fps: FPS, initialTracks: [] })
    run(engine, [{ op: 'insertSourceRange', asset: 'broll', start: 0, end: 3, mute: true }])
    const c = allClips(engine)[0]!
    expect(c.volume).toBe(0)
    expect(c.embeddedAudio).toBe(true)
  })

  it('speed 2 halves the clip and leaves the source window alone', () => {
    const engine = new TimelineEngine({ fps: FPS, initialTracks: [] })
    run(engine, [{ op: 'insertSourceRange', asset: 'talk', start: 12, end: 19, speed: 2 }])
    expect(allClips(engine)[0]).toMatchObject({ durationFrames: 105, sourceDurationFrames: 210, sourceStartFrame: 360, speed: 2 })
  })

  it('an audio asset lands as an audio clip on an audio lane', () => {
    const engine = new TimelineEngine({ fps: FPS, initialTracks: [] })
    const r = run(engine, [{ op: 'insertSourceRange', asset: 'song', start: 10, end: 20, at: 2 }])
    expect(r.skipped).toEqual([])
    const c = allClips(engine)[0]!
    expect(c).toMatchObject({ type: 'audio', startFrame: 60, durationFrames: 300, sourceStartFrame: 300, assetFrames: 1800 })
    expect(c.embeddedAudio).toBeUndefined()
    expect(engine.getProject().tracks.map((t) => t.kind)).toEqual(['audio'])
  })

  it('overlay lands above the base lane and does not overlap the clip below', () => {
    const engine = new TimelineEngine({ fps: FPS, initialTracks: [] })
    run(engine, [{ op: 'insertSourceRange', asset: 'talk', start: 0, end: 10 }])
    const base = allClips(engine)[0]!
    run(engine, [{ op: 'insertSourceRange', asset: 'broll', start: 0, end: 3, at: 2, overlay: true }])
    const over = allClips(engine).find((c) => c.name === 'Harbour')!
    expect(over.trackId).not.toBe(base.trackId)
    const order = (id: string) => engine.getProject().tracks.find((t) => t.id === id)!.order
    expect(order(over.trackId)).toBeGreaterThan(order(base.trackId))
    // The base clip is untouched and still the only thing on its lane.
    expect(engine.getClipsOnTrack(base.trackId)).toHaveLength(1)
    expect(engine.getClipsOnTrack(base.trackId)[0]).toMatchObject({ startFrame: 0, durationFrames: 300 })
    expect(over).toMatchObject({ startFrame: 60, durationFrames: 90 })
  })

  it('a ref can be trimmed later in the same plan, and cannot grow past the media', () => {
    const engine = new TimelineEngine({ fps: FPS, initialTracks: [] })
    const r = run(engine, [
      { op: 'insertSourceRange', ref: 'cut', asset: 'talk', start: 12, end: 19 },
      // Ask for 10s; only 240 frames (to the real end of the 20s file) exist.
      { op: 'trimClip', clip: '$cut', end: 10 },
    ])
    expect(r.dropped).toEqual([])
    expect(r.skipped).toEqual([])
    expect(allClips(engine)).toHaveLength(1)
    // "cannot be trimmed past its content": capped by assetFrames, not by the window.
    expect(allClips(engine)[0]!.durationFrames).toBe(240)
  })

  it('the whole plan is one undo step and discards byte for byte', () => {
    const engine = new TimelineEngine({ fps: FPS, initialTracks: [] })
    const before = engine.getProject()
    const rev = engine.getRevision()
    const r = run(engine, [
      { op: 'insertSourceRange', ref: 'a', asset: 'talk', start: 1, end: 3 },
      { op: 'insertSourceRange', ref: 'b', asset: 'broll', start: 0, end: 2 },
      { op: 'trimClip', clip: '$a', end: 1 },
    ])
    expect(r.skipped).toEqual([])
    expect(allClips(engine)).toHaveLength(2)
    expect(engine.getRevision()).toBeGreaterThan(rev)
    expect(engine.lastHistoryDescription()).toBe('Assistant edit')
    expect(engine.discardLast(engine.getRevision())).toBe(true)
    expect(engine.getProject()).toBe(before)
    expect(engine.canUndo()).toBe(false) // there was exactly one entry
    expect(engine.canRedo()).toBe(false)
  })
})

describe('insertSourceRange on the default engine (one empty lane)', () => {
  it('reuses the lane that is already there', () => {
    const engine = new TimelineEngine({ fps: FPS })
    run(engine, [{ op: 'insertSourceRange', asset: 'talk', start: 0, end: 2 }])
    expect(engine.getProject().tracks).toHaveLength(1)
    expect(allClips(engine)).toHaveLength(1)
  })
})

describe('insertSourceRange on the magnetic main track', () => {
  function magnetic() {
    const engine = new TimelineEngine({ fps: FPS, initialTracks: [{ kind: 'video', name: 'V1' }] })
    const v1 = engine.getProject().tracks[0]!.id
    engine.addClip({ trackId: v1, type: 'video', src: 'a.mp4', name: 'A', startFrame: 0, durationFrames: 60 })
    engine.addClip({ trackId: v1, type: 'video', src: 'b.mp4', name: 'B', startFrame: 60, durationFrames: 60 })
    engine.setTimelineMode('magnetic')
    return { engine, v1 }
  }
  const layout = (engine: TimelineEngine, id: string) => engine.getClipsOnTrack(id).map((c) => [c.name, c.startFrame, c.durationFrames])

  it('is skipped with its reason when the main track already holds a clip, and nothing moves', () => {
    const { engine, v1 } = magnetic()
    const before = layout(engine, v1)
    const r = run(engine, [
      { op: 'insertSourceRange', asset: 'talk', start: 0, end: 4 },
      { op: 'insertSourceRange', asset: 'talk', start: 0, end: 4, at: 4 }, // the gap after B
    ])
    expect(r.applied).toEqual([])
    expect(r.skipped).toEqual([
      { index: 0, reason: 'the main track is magnetic; insert there by hand' },
      { index: 1, reason: 'the main track is magnetic; insert there by hand' },
    ])
    expect(layout(engine, v1)).toEqual(before)
    expect(engine.getProject().tracks).toHaveLength(1)
  })

  it('a range that would land ON a main-track clip goes to a free lane instead, and main does not ripple', () => {
    const { engine, v1 } = magnetic()
    const r = run(engine, [{ op: 'insertSourceRange', asset: 'broll', start: 0, end: 2, at: 1 }])
    expect(r.skipped).toEqual([])
    expect(layout(engine, v1)).toEqual([['A', 0, 60], ['B', 60, 60]])
    expect(engine.getProject().tracks).toHaveLength(2)
  })

  it('an overlay still works: it goes on its own lane', () => {
    const { engine, v1 } = magnetic()
    const r = run(engine, [{ op: 'insertSourceRange', asset: 'broll', start: 0, end: 2, at: 1, overlay: true }])
    expect(r.skipped).toEqual([])
    expect(layout(engine, v1)).toEqual([['A', 0, 60], ['B', 60, 60]])
    expect(engine.getProject().tracks).toHaveLength(2)
  })

  it('an empty magnetic main track takes its first clip', () => {
    const engine = new TimelineEngine({ fps: FPS, initialTracks: [] })
    engine.setTimelineMode('magnetic')
    const r = run(engine, [{ op: 'insertSourceRange', asset: 'talk', start: 0, end: 4 }])
    expect(r.skipped).toEqual([])
    expect(allClips(engine)).toHaveLength(1)
  })
})

describe('insertSourceRange in sanitizeOps', () => {
  const reasons = (raw: unknown[]) => sanitizeOps(raw, { clips: {} }, { assets }).dropped.map((d) => d.reason)

  it('drops a range that ends after the clip does, with a readable reason', () => {
    const r = sanitizeOps([{ op: 'insertSourceRange', asset: 'talk', start: 15, end: 25 }], { clips: {} }, { assets })
    expect(r.ops).toEqual([])
    expect(r.dropped).toHaveLength(1)
    expect(r.dropped[0]!.reason).toMatch(/ends after the clip ends/)
  })

  it('allows the 0.05s of slack the probe leaves, and not more', () => {
    expect(sanitizeOps([{ op: 'insertSourceRange', asset: 'talk', start: 15, end: 20.04 }], { clips: {} }, { assets }).ops).toHaveLength(1)
    expect(reasons([{ op: 'insertSourceRange', asset: 'talk', start: 15, end: 20.2 }])).toHaveLength(1)
  })

  it('drops an unknown asset, an image, and an empty or backwards range, without throwing', () => {
    const got = reasons([
      { op: 'insertSourceRange', asset: 'nope', start: 0, end: 2 },
      { op: 'insertSourceRange', asset: 'logo', start: 0, end: 2 },
      { op: 'insertSourceRange', asset: 'talk', start: 5, end: 5 },
      { op: 'insertSourceRange', asset: 'talk', start: 6, end: 2 },
      { op: 'insertSourceRange', asset: 'talk', start: -1, end: 2 },
      { op: 'insertSourceRange', asset: '', start: 0, end: 2 },
      { op: 'insertSourceRange', asset: 'talk', start: 'x', end: 2 },
    ])
    expect(got).toHaveLength(7)
    expect(got[0]).toBe('no media “nope” in the library')
    expect(got[1]).toMatch(/image/)
    expect(got[2]).toMatch(/empty or runs backwards/)
    expect(got[3]).toMatch(/empty or runs backwards/)
    expect(got[4]).toMatch(/before the beginning/)
  })

  it('without a library it still checks the range but not the id', () => {
    expect(sanitizeOps([{ op: 'insertSourceRange', asset: 'whatever', start: 0, end: 99 }], { clips: {} }).ops).toHaveLength(1)
    expect(sanitizeOps([{ op: 'insertSourceRange', asset: 'whatever', start: 3, end: 1 }], { clips: {} }).dropped).toHaveLength(1)
  })

  it('clamps speed to 0.25..4 and reads strict-mode nulls and strings', () => {
    const [op] = sanitizeOps(
      [{ op: 'insertSourceRange', asset: 'talk', start: '1', end: '3', at: null, speed: 99, mute: 'true', overlay: null, ref: '$x' }],
      { clips: {} },
      { assets },
    ).ops
    expect(op).toEqual({ op: 'insertSourceRange', ref: 'x', asset: 'talk', start: 1, end: 3, speed: 4, mute: true })
  })

  it('an unknown asset reaching applyOps is skipped rather than thrown', () => {
    const engine = new TimelineEngine({ fps: FPS, initialTracks: [] })
    const r = applyOps(engine, [{ op: 'insertSourceRange', asset: 'ghost', start: 0, end: 2 }], { assets })
    expect(r.skipped).toEqual([{ index: 0, reason: 'that media is not in the library' }])
    const r2 = applyOps(engine, [{ op: 'insertSourceRange', asset: 'talk', start: 0, end: 2 }])
    expect(r2.skipped[0]!.reason).toBe('that media is not in the library')
  })
})

describe('insertSourceRange described', () => {
  it('reads as a sentence with the asset name when the library is known', () => {
    const engine = new TimelineEngine({ fps: FPS, initialTracks: [] })
    const op = { op: 'insertSourceRange', asset: 'talk', start: 12, end: 19, at: 0 } as const
    expect(opDescriber(engine.getProject(), assets)(op)).toBe('Insert “Interview” 0:12–0:19 at 0:00')
    expect(opDescriber(engine.getProject())(op)).toBe('Insert “talk” 0:12–0:19 at 0:00')
    expect(opDescriber(engine.getProject(), assets)({ ...op, mute: true, overlay: true })).toBe('Insert “Interview” 0:12–0:19 at 0:00 · muted · overlay')
  })
})
