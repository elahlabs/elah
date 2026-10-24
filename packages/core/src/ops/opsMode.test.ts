import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { applyOps } from './apply'
import { describeProject } from './describe'

/**
 * The op layer in both timeline modes (PV-T1). Free mode must run exactly
 * today's code path; on the magnetic main track the same plan ripples.
 */

function setup(magnetic: boolean) {
  const engine = new TimelineEngine({
    fps: 30,
    stage: { width: 1920, height: 1080 },
    initialTracks: [
      { kind: 'video', name: 'V1' },
      { kind: 'video', name: 'V2' },
    ],
  })
  const [v1, v2] = engine.getProject().tracks.map((t) => t.id) as [string, string]
  if (magnetic) engine.setTimelineMode('magnetic')
  const add = (trackId: string, name: string, start: number, dur: number) =>
    engine.addClip({ trackId, type: 'video', src: `${name}.mp4`, name, startFrame: start, durationFrames: dur }).id
  const A = add(v1, 'A', 0, 60)
  const B = add(v1, 'B', 60, 60)
  const C = add(v1, 'C', 120, 60)
  const title = add(v2, 'title', 130, 30)
  engine.updateClip(A, v1, { sourceDurationFrames: 120 })
  const layout = (trackId: string) =>
    engine.getClipsOnTrack(trackId).map((c) => [c.name, c.startFrame, c.durationFrames] as const)
  return { engine, v1, v2, A, B, C, title, layout }
}

describe('removeClip', () => {
  it('free mode leaves the gap', () => {
    const { engine, v1, B, layout } = setup(false)
    const r = applyOps(engine, [{ op: 'removeClip', clip: B }])
    expect(r.skipped).toEqual([])
    expect(layout(v1)).toEqual([['A', 0, 60], ['C', 120, 60]])
  })

  it('magnetic main closes it, moves the overlay, and reports what rippled', () => {
    const { engine, v1, v2, B, C, title, layout } = setup(true)
    const r = applyOps(engine, [{ op: 'removeClip', clip: B }])
    expect(r.skipped).toEqual([])
    expect(layout(v1)).toEqual([['A', 0, 60], ['C', 60, 60]])
    expect(layout(v2)).toEqual([['title', 70, 30]])
    expect(r.touched.removed.map((x) => x.id)).toEqual([B])
    expect(r.touched.changed.sort()).toEqual([C, title].sort())
  })
})

describe('moveClip', () => {
  it('magnetic main inserts at the nearest cut', () => {
    const { engine, v1, A, layout } = setup(true)
    const r = applyOps(engine, [{ op: 'moveClip', clip: A, at: 3.9 }]) // frame 117
    expect(r.skipped).toEqual([])
    expect(layout(v1)).toEqual([['B', 0, 60], ['C', 60, 60], ['A', 120, 60]])
  })

  it('free mode still refuses an overlapping move with the same reason', () => {
    const { engine, A } = setup(false)
    const r = applyOps(engine, [{ op: 'moveClip', clip: A, at: 1 }])
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]!.reason).toMatch(/would overlap another clip/)
  })
})

describe('trimClip', () => {
  it('magnetic main keeps the clip’s start and ripples the rest', () => {
    const { engine, v1, v2, A, layout } = setup(true)
    const r = applyOps(engine, [{ op: 'trimClip', clip: A, start: 1, end: 2 }]) // keep frames 30..60 of the timeline
    expect(r.skipped).toEqual([])
    expect(layout(v1)).toEqual([['A', 0, 30], ['B', 30, 60], ['C', 90, 60]])
    expect(engine.findClip(A)!.clip.sourceStartFrame).toBe(30)
    expect(layout(v2)).toEqual([['title', 100, 30]])
  })

  it('free mode trims in place', () => {
    const { engine, v1, A, layout } = setup(false)
    applyOps(engine, [{ op: 'trimClip', clip: A, end: 1 }])
    expect(layout(v1)).toEqual([['A', 0, 30], ['B', 60, 60], ['C', 120, 60]])
  })
})

describe('describeProject', () => {
  it('names the mode and the main track only for a magnetic project', () => {
    const free = describeProject(setup(false).engine.getProject())
    expect(free).not.toHaveProperty('timelineMode')
    expect(free.tracks.some((t) => 'main' in t)).toBe(false)

    const mag = setup(true)
    const described = describeProject(mag.engine.getProject())
    expect(described.timelineMode).toBe('magnetic')
    expect(described.tracks.filter((t) => t.main).map((t) => t.id)).toEqual([mag.v1])
  })
})
