import { describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'
import { resolveTimeline } from '../resolver/resolveTimeline'

/**
 * Sequence clips through the engine (PV-P8a): the document version bump, and
 * the sourceless trim/split rules a generator/text/shape clip already gets —
 * a sequence joins that list so a looping animation can grow past one cycle
 * and a split continues it rather than restarting it.
 */

function addSequence(engine: TimelineEngine, overrides: Partial<{ startFrame: number; durationFrames: number }> = {}) {
  const track = engine.addTrack('video')
  const clip = engine.addClip({
    type: 'sequence',
    trackId: track.id,
    startFrame: overrides.startFrame ?? 0,
    durationFrames: overrides.durationFrames ?? 12,
    src: 'blob:g',
    sequence: { kind: 'animated-image', frameCount: 4, fps: 10 },
  })
  return { track, clip }
}

describe('TimelineEngine — sequence clips (PV-P8a)', () => {
  it('adding a sequence clip raises the project version to 5 in the same undo step', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const versionBefore = engine.getProject().version
    addSequence(engine)
    expect(engine.getProject().version).toBe(5)
    engine.undo()
    expect(engine.getProject().version).toBe(versionBefore)
    engine.redo()
    expect(engine.getProject().version).toBe(5)
  })

  it('trimClip lets a sequence grow past its one-cycle length', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const { track, clip } = addSequence(engine)
    engine.trimClip(clip.id, track.id, 0, 90)
    const trimmed = engine.getProject().clips[track.id]!.find((c) => c.id === clip.id)!
    expect(trimmed.durationFrames).toBe(90)
  })

  it('a left trim keeps sourceStartFrame at 0 (the animation starts at its first frame)', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const { track, clip } = addSequence(engine)
    engine.trimClip(clip.id, track.id, 4, 8)
    const trimmed = engine.getProject().clips[track.id]!.find((c) => c.id === clip.id)!
    expect(trimmed.sourceStartFrame).toBe(0)
  })

  it('splitClip continues the animation across the cut', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const { track, clip } = addSequence(engine)
    const before = resolveTimeline(5, engine.getProject()).sequences!.find((s) => s.id === clip.id)!.frameIndex
    expect(before).toBe(1)

    const result = engine.splitClip(clip.id, track.id, 5)
    expect(result).not.toBeNull()
    const [, rightId] = result!
    const right = engine.getProject().clips[track.id]!.find((c) => c.id === rightId)!
    expect(right.sourceStartFrame).toBe(5)

    const after = resolveTimeline(5, engine.getProject()).sequences!.find((s) => s.id === rightId)!.frameIndex
    expect(after).toBe(before)
  })
})
