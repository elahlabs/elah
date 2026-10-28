import { describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'

/**
 * Trim and speed limits measured against the real length of the media
 * (PV-T5-1). `assetFrames` is what makes a split half trimmable back out to the
 * media it came from; a clip without it keeps exactly the legacy limits.
 */

function engineWithVideo(durationFrames: number, extra: Record<string, unknown> = {}) {
  const engine = new TimelineEngine({ fps: 30, initialTracks: [{ kind: 'video', name: 'V1' }] })
  const track = engine.getProject().tracks[0]!
  const clip = engine.addClip({
    trackId: track.id,
    type: 'video',
    src: 'a.mp4',
    name: 'A',
    startFrame: 0,
    durationFrames,
    ...extra,
  } as never)
  if (extra.assetFrames !== undefined) engine.updateClip(clip.id, track.id, { assetFrames: extra.assetFrames as number })
  return { engine, trackId: track.id, clipId: clip.id }
}

const at = (engine: TimelineEngine, clipId: string) => engine.findClip(clipId)!.clip

describe('trimClip limits without assetFrames (legacy)', () => {
  it('still caps a duration at the trim window', () => {
    const { engine, trackId, clipId } = engineWithVideo(30)
    expect(at(engine, clipId).sourceDurationFrames).toBe(30)
    engine.trimClip(clipId, trackId, 0, 60)
    expect(at(engine, clipId).durationFrames).toBe(30)
  })

  it('caps a left-extended clip at its own window too', () => {
    // Head extended to 0 moves sourceStartFrame to 0, and the window is still
    // 30 frames, so the clip may not grow past it.
    const { engine, trackId, clipId } = engineWithVideo(30)
    engine.updateClip(clipId, trackId, { sourceStartFrame: 20, sourceDurationFrames: 30 })
    engine.trimClip(clipId, trackId, 0, 200)
    expect(at(engine, clipId).durationFrames).toBe(30)
  })
})

describe('trimClip limits with assetFrames', () => {
  it('grows to the end of the media, not the window', () => {
    const { engine, trackId, clipId } = engineWithVideo(40, { assetFrames: 100 })
    engine.trimClip(clipId, trackId, 0, 150)
    expect(at(engine, clipId).durationFrames).toBe(100)
  })

  it('a split left half can be trimmed back out to the whole media', () => {
    // The bug: the left half inherited sourceDurationFrames 20 and could never
    // grow again, so recovering a bad cut was impossible.
    const { engine, trackId, clipId } = engineWithVideo(40, { assetFrames: 100 })
    const [left, right] = engine.splitClip(clipId, trackId, 20)!
    expect(at(engine, left)).toMatchObject({ startFrame: 0, durationFrames: 20, assetFrames: 100 })
    expect(at(engine, right)).toMatchObject({ startFrame: 20, durationFrames: 20, sourceStartFrame: 20, assetFrames: 100 })

    engine.removeClip(right, trackId)
    engine.trimClip(left, trackId, 0, 100)
    expect(at(engine, left).durationFrames).toBe(100)
  })

  it('a split right half stops where the media ends, and its head can move', () => {
    const { engine, trackId, clipId } = engineWithVideo(40, { assetFrames: 100 })
    const [left, right] = engine.splitClip(clipId, trackId, 20)!
    // The media ends at source frame 100 and this half starts at 20, so 80
    // frames are left — not the 20 it happened to hold.
    engine.trimClip(right, trackId, 20, 200)
    expect(at(engine, right).durationFrames).toBe(80)

    // The left half goes first: extending the head below frame 20 would run
    // into it, and the overlap check is doing its job.
    engine.removeClip(left, trackId)
    engine.trimClip(right, trackId, 5, 95)
    // Extending the head consumes media, and the cap follows it down.
    const c = at(engine, right)
    expect([c.startFrame, c.sourceStartFrame, c.durationFrames]).toEqual([5, 5, 95])
  })
})

describe('setClipSpeed with assetFrames', () => {
  it('slowing down is limited by the media, not the window', () => {
    const { engine, trackId, clipId } = engineWithVideo(40, { assetFrames: 100 })
    engine.setClipSpeed(clipId, trackId, 2)
    expect(at(engine, clipId).durationFrames).toBe(20)
    // At 2x the 100 source frames are 50 timeline frames.
    engine.trimClip(clipId, trackId, 0, 80)
    expect(at(engine, clipId).durationFrames).toBe(50)
  })
})
