import { describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'
import { moveForMode, nearestCut, removeForMode, resolveMainTrackId, trimForMode } from '../actions/placement'

/**
 * Magnetic mode (PV-T1): one main track that never keeps a gap an edit made,
 * with overlay clips downstream riding the ripple. Free mode must behave
 * exactly as the engine did before modes existed.
 */

function setup() {
  const engine = new TimelineEngine({
    fps: 30,
    initialTracks: [
      { kind: 'video', name: 'V1' },
      { kind: 'video', name: 'V2' },
      { kind: 'audio', name: 'A1' },
    ],
  })
  const [v1, v2, a1] = engine.getProject().tracks.map((t) => t.id) as [string, string, string]
  const clip = (trackId: string, name: string, start: number, duration: number, sourceDuration = duration) => {
    const c = engine.addClip({ trackId, type: 'video', src: `${name}.mp4`, name, startFrame: start, durationFrames: duration })
    if (sourceDuration !== duration) engine.updateClip(c.id, trackId, { sourceDurationFrames: sourceDuration })
    return c.id
  }
  const layout = (trackId: string) =>
    engine.getClipsOnTrack(trackId).map((c) => [c.name, c.startFrame, c.durationFrames] as const)
  /** Main: A [0,30) B [30,60) C [60,90). Overlays on V2 and A1. */
  const sequence = () => {
    const A = clip(v1, 'A', 0, 30, 60)
    const B = clip(v1, 'B', 30, 30, 60)
    const C = clip(v1, 'C', 60, 30, 60)
    return { A, B, C }
  }
  return { engine, v1, v2, a1, clip, layout, sequence }
}

describe('setTimelineMode and the main track', () => {
  it('free is stored as absence; magnetic picks the topmost video lane as main', () => {
    const { engine, v1 } = setup()
    expect('timelineMode' in engine.getProject()).toBe(false)
    expect(engine.getMainTrackId()).toBeUndefined()

    engine.setTimelineMode('magnetic')
    expect(engine.getProject().timelineMode).toBe('magnetic')
    expect(engine.getTrack(v1)!.role).toBe('main')
    expect(engine.getMainTrackId()).toBe(v1)

    engine.setTimelineMode('free')
    expect('timelineMode' in engine.getProject()).toBe(false)
    // The role stays: switching back is lossless and free mode ignores it.
    expect(engine.getTrack(v1)!.role).toBe('main')
    expect(engine.getMainTrackId()).toBeUndefined()
  })

  it('setMainTrack moves the role, and only to a video track', () => {
    const { engine, v1, v2, a1 } = setup()
    engine.setTimelineMode('magnetic')
    expect(engine.setMainTrack(a1)).toBe(false)
    expect(engine.setMainTrack(v2)).toBe(true)
    expect(engine.getTrack(v1)!.role).toBeUndefined()
    expect(engine.getMainTrackId()).toBe(v2)
  })

  it('resolves to the topmost video lane when no track carries the role', () => {
    const { engine, v1 } = setup()
    const project = { ...engine.getProject(), timelineMode: 'magnetic' as const }
    expect(resolveMainTrackId(project)).toBe(v1)
  })
})

describe('rippleMain', () => {
  it('moves main and unlocked overlay clips from the frame on, as one step', () => {
    const { engine, v1, v2, a1, clip, layout, sequence } = setup()
    engine.setTimelineMode('magnetic')
    sequence()
    clip(v2, 'early', 10, 10)
    clip(v2, 'late', 70, 10)
    clip(a1, 'music', 60, 20)
    engine.updateTrack(a1, { locked: true })

    const r = engine.rippleMain(60, 15)

    expect(r).toEqual({ ok: true, linked: true })
    expect(layout(v1)).toEqual([['A', 0, 30], ['B', 30, 30], ['C', 75, 30]])
    expect(layout(v2)).toEqual([['early', 10, 10], ['late', 85, 10]])
    expect(layout(a1)).toEqual([['music', 60, 20]])
    expect(engine.lastHistoryDescription()).toBe('Ripple')
  })

  it('moves the main track alone when an overlay would collide', () => {
    const { engine, v1, v2, clip, layout } = setup()
    engine.setTimelineMode('magnetic')
    clip(v1, 'A', 0, 30)
    clip(v1, 'C', 60, 30) // a 30-frame gap before it
    clip(v2, 'before', 20, 45) // ends at 65, starts before the ripple point
    clip(v2, 'after', 70, 10) // would land inside 'before'

    const r = engine.rippleMain(60, -20)

    expect(r).toEqual({ ok: true, linked: false })
    expect(layout(v1)).toEqual([['A', 0, 30], ['C', 40, 30]])
    expect(layout(v2)).toEqual([['before', 20, 45], ['after', 70, 10]])
  })

  it('refuses a ripple the main track itself cannot take', () => {
    const { engine, sequence } = setup()
    engine.setTimelineMode('magnetic')
    sequence()
    const before = engine.getProject()
    expect(engine.rippleMain(60, -20)).toEqual({ ok: false, linked: false })
    expect(engine.getProject()).toBe(before)
  })

  it('does nothing in free mode', () => {
    const { engine, sequence } = setup()
    sequence()
    const before = engine.getProject()
    expect(engine.rippleMain(0, 10).ok).toBe(false)
    expect(engine.getProject()).toBe(before)
  })
})

describe('closeGap', () => {
  it('on the magnetic main track ripples the overlays', () => {
    const { engine, v1, v2, clip, layout } = setup()
    engine.setTimelineMode('magnetic')
    clip(v1, 'A', 0, 30)
    clip(v1, 'B', 50, 30)
    clip(v2, 'title', 55, 10)

    expect(engine.closeGap(v1, 40)).toBe(true)
    expect(layout(v1)).toEqual([['A', 0, 30], ['B', 30, 30]])
    expect(layout(v2)).toEqual([['title', 35, 10]])
  })

  it('on any other track moves only that track', () => {
    const { engine, v1, v2, clip, layout } = setup()
    clip(v2, 'x', 0, 10)
    clip(v2, 'y', 25, 10)
    clip(v1, 'A', 40, 10)

    expect(engine.closeGap(v2, 15)).toBe(true)
    expect(layout(v2)).toEqual([['x', 0, 10], ['y', 10, 10]])
    expect(layout(v1)).toEqual([['A', 40, 10]])
  })

  it('refuses a frame inside a clip and a trailing gap', () => {
    const { engine, v2, clip } = setup()
    clip(v2, 'x', 0, 10)
    expect(engine.closeGap(v2, 5)).toBe(false)
    expect(engine.closeGap(v2, 50)).toBe(false)
  })
})

describe('mode-aware edits', () => {
  it('removeForMode leaves a gap in free mode and closes it on the magnetic main track', () => {
    const free = setup()
    const f = free.sequence()
    expect(removeForMode(free.engine, f.B).ok).toBe(true)
    expect(free.layout(free.v1)).toEqual([['A', 0, 30], ['C', 60, 30]])

    const mag = setup()
    mag.engine.setTimelineMode('magnetic')
    const m = mag.sequence()
    mag.clip(mag.v2, 'title', 70, 10)
    const r = removeForMode(mag.engine, m.B)
    expect(r).toEqual({ ok: true, data: { rippled: true } })
    expect(mag.layout(mag.v1)).toEqual([['A', 0, 30], ['C', 30, 30]])
    expect(mag.layout(mag.v2)).toEqual([['title', 40, 10]])
    expect(mag.engine.lastHistoryDescription()).toBe('Ripple delete')
  })

  it('moveForMode reorders the main track at a cut, with overlays riding or following', () => {
    const { engine, v1, v2, clip, layout, sequence } = setup()
    engine.setTimelineMode('magnetic')
    const { A } = sequence()
    clip(v2, 'onA', 5, 10) // starts inside A: rides with it
    clip(v2, 'onC', 70, 10) // over C: follows C

    const r = moveForMode(engine, A, 90)

    expect(r).toEqual({ ok: true, data: { startFrame: 60 } })
    expect(layout(v1)).toEqual([['B', 0, 30], ['C', 30, 30], ['A', 60, 30]])
    expect(layout(v2)).toEqual([['onC', 40, 10], ['onA', 65, 10]])
  })

  it('moveForMode in free mode is moveClip', () => {
    const { engine, v1, layout, sequence } = setup()
    const { C } = sequence()
    expect(moveForMode(engine, C, 200).ok).toBe(true)
    expect(layout(v1)).toEqual([['A', 0, 30], ['B', 30, 30], ['C', 200, 30]])
    expect(moveForMode(engine, C, 10)).toEqual({ ok: false, reason: 'engine-rejected' })
  })

  it('trimForMode on the main track keeps the clip’s start and ripples by the change', () => {
    const { engine, v1, layout, sequence } = setup()
    engine.setTimelineMode('magnetic')
    const { A } = sequence()

    // Tail in by 10.
    expect(trimForMode(engine, A, 0, 20).ok).toBe(true)
    expect(layout(v1)).toEqual([['A', 0, 20], ['B', 20, 30], ['C', 50, 30]])

    // Head in by 5: position stays, the source window moves.
    expect(trimForMode(engine, A, 5, 20).ok).toBe(true)
    expect(layout(v1)).toEqual([['A', 0, 15], ['B', 15, 30], ['C', 45, 30]])
    expect(engine.findClip(A)!.clip.sourceStartFrame).toBe(5)

    // Grow the tail by 25 into media that exists: the rest makes room first.
    expect(trimForMode(engine, A, 0, 40).ok).toBe(true)
    expect(layout(v1)).toEqual([['A', 0, 40], ['B', 40, 30], ['C', 70, 30]])
  })

  it('trimForMode clamps to the media, as trimClip does', () => {
    const { engine, v1, clip, layout } = setup()
    engine.setTimelineMode('magnetic')
    const A = clip(v1, 'A', 0, 30) // source is exactly 30 frames
    clip(v1, 'B', 30, 30)
    expect(trimForMode(engine, A, 0, 45)).toEqual({ ok: true, data: { startFrame: 0, durationFrames: 30 } })
    expect(layout(v1)).toEqual([['A', 0, 30], ['B', 30, 30]])
  })

  it('nearestCut prefers the earlier cut on a tie and ignores excluded clips', () => {
    const clips = [
      { id: 'a', startFrame: 0, durationFrames: 30 },
      { id: 'b', startFrame: 30, durationFrames: 30 },
    ]
    expect(nearestCut(clips, 44)).toBe(30)
    expect(nearestCut(clips, 45)).toBe(30)
    expect(nearestCut(clips, 46)).toBe(60)
    expect(nearestCut(clips, 46, new Set(['b']))).toBe(30)
  })
})
describe('trimForMode measures against the real media length (PV-T5-1)', () => {
  it('a split right half on a magnetic main track grows to the media end and ripples', () => {
    const engine = new TimelineEngine({ fps: 30, initialTracks: [{ kind: 'video', name: 'V1' }] })
    const v1 = engine.getProject().tracks[0]!.id
    engine.setTimelineMode('magnetic')
    engine.setMainTrack(v1)
    const a = engine.addClip({ trackId: v1, type: 'video', src: 'a.mp4', name: 'a', startFrame: 0, durationFrames: 40 })
    engine.updateClip(a.id, v1, { assetFrames: 100 })
    const overlay = engine.addClip({ trackId: v1, type: 'video', src: 'b.mp4', name: 'b', startFrame: 60, durationFrames: 10 })
    const [, right] = engine.splitClip(a.id, v1, 20)!
    // The right half holds 20 of 100 media frames and starts at source 20, so
    // 80 frames of media are left — legacy would cap it at its own 20.
    expect(trimForMode(engine, right, 20, 200).ok).toBe(true)
    const grown = engine.findClip(right)!.clip
    expect(grown.durationFrames).toBe(80)
    // Magnetic: the 60 frames of growth rippled the clip downstream rather than
    // overwriting it. The gap left behind is closed by `closeGap`, not here.
    expect(engine.findClip(overlay.id)!.clip.startFrame).toBe(120)
    expect(engine.lastHistoryDescription()).toBe('Trim clip')
  })
})