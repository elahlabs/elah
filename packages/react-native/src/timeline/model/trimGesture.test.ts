import { describe, expect, it } from 'vitest'
import { buildFixture } from './__fixtures__/project'
import { MIN_CLIP_WIDTH_PX } from './layout'
import { beginTrim, endTrim, trimPreviewRect, updateTrim } from './trimGesture'

describe('beginTrim', () => {
  it('computes speed-aware limits from the clip, the zoom and the lane', () => {
    const f = buildFixture()
    const session = beginTrim(f.a.id, 'left', f.snapshot(4))!
    expect(session.trackId).toBe(f.v1.id)
    // A's end is at 90 and nothing precedes it on V1, so the left edge may grow
    // to 90 frames: the lane, not the 120-frame source, is the bound here.
    expect(session.limits).toEqual({ minDuration: 4, maxDuration: 90 })
  })

  it('uses the source as the bound when the lane has more room than the source', () => {
    const f = buildFixture()
    f.engine.removeClip(f.b.id, f.v1.id)
    expect(beginTrim(f.a.id, 'right', f.snapshot(4))!.limits.maxDuration).toBe(120)
  })

  it('widens the minimum for a bigger touch handle', () => {
    const f = buildFixture()
    expect(beginTrim(f.a.id, 'right', f.snapshot(4), { handleWidthPx: 16 })!.limits.minDuration).toBe(8)
  })

  it('has no maximum for generated clips', () => {
    const f = buildFixture()
    expect(beginTrim(f.title.id, 'right', f.snapshot())!.limits.maxDuration).toBe(Infinity)
  })

  it('halves the maximum for a clip playing at 2x', () => {
    const f = buildFixture()
    f.engine.setClipSpeed(f.a.id, f.v1.id, 2)
    expect(beginTrim(f.a.id, 'right', f.snapshot())!.limits.maxDuration).toBe(60)
  })

  it('stops the right edge at the next clip on the lane', () => {
    const f = buildFixture()
    // A [30, 90) has 120 source frames but B starts at 120: room for 90 frames.
    expect(beginTrim(f.a.id, 'right', f.snapshot())!.limits.maxDuration).toBe(90)
  })

  it('stops the left edge at the previous clip on the lane', () => {
    const f = buildFixture()
    // Give B source frames before its in-point so the source bound is not the limit.
    f.engine.updateClip(f.b.id, f.v1.id, { sourceStartFrame: 100, sourceDurationFrames: 200 })
    // B [120, 180) could reach back 100 frames, but A ends at 90: room for 90 frames.
    expect(beginTrim(f.b.id, 'left', f.snapshot())!.limits.maxDuration).toBe(90)
  })

  it('refuses an unknown clip or a locked lane', () => {
    const f = buildFixture()
    expect(beginTrim('nope', 'left', f.snapshot())).toBeNull()
    f.engine.updateTrack(f.v1.id, { locked: true })
    expect(beginTrim(f.a.id, 'left', f.snapshot())).toBeNull()
  })
})

describe('updateTrim (left edge)', () => {
  it('moves the start and keeps the end anchored', () => {
    const f = buildFixture()
    const session = beginTrim(f.a.id, 'left', f.snapshot(4))!
    expect(updateTrim(session, -40)).toEqual({ startFrame: 20, durationFrames: 70 })
    expect(updateTrim(session, 40)).toEqual({ startFrame: 40, durationFrames: 50 })
  })

  it('stops at the source left bound (20 source frames before the in-point)', () => {
    const f = buildFixture()
    const session = beginTrim(f.a.id, 'left', f.snapshot(4))!
    expect(updateTrim(session, -400)).toEqual({ startFrame: 10, durationFrames: 80 })
  })

  it('cannot extend a clip whose in-point is already the first source frame', () => {
    const f = buildFixture()
    const session = beginTrim(f.b.id, 'left', f.snapshot(4))!
    expect(updateTrim(session, -40)).toEqual({ startFrame: 120, durationFrames: 60 })
  })

  it('never shrinks below the minimum duration', () => {
    const f = buildFixture()
    const session = beginTrim(f.a.id, 'left', f.snapshot(4))!
    expect(updateTrim(session, 1000)).toEqual({ startFrame: 86, durationFrames: 4 })
  })

  it('lets a text clip grow left to frame 0', () => {
    const f = buildFixture()
    const session = beginTrim(f.title.id, 'left', f.snapshot(4))!
    expect(updateTrim(session, -1000)).toEqual({ startFrame: 0, durationFrames: 120 })
  })
})

describe('updateTrim (right edge)', () => {
  it('changes the duration only', () => {
    const f = buildFixture()
    const session = beginTrim(f.a.id, 'right', f.snapshot(4))!
    expect(updateTrim(session, 40)).toEqual({ startFrame: 30, durationFrames: 70 })
    expect(updateTrim(session, -40)).toEqual({ startFrame: 30, durationFrames: 50 })
  })

  it('clamps to the room before the next clip and to the minimum', () => {
    const f = buildFixture()
    const session = beginTrim(f.a.id, 'right', f.snapshot(4))!
    expect(updateTrim(session, 10000).durationFrames).toBe(90) // abuts B at 120
    expect(updateTrim(session, -10000).durationFrames).toBe(4)
  })

  it('clamps to the source length when the lane has room', () => {
    const f = buildFixture()
    f.engine.removeClip(f.b.id, f.v1.id)
    const session = beginTrim(f.a.id, 'right', f.snapshot(4))!
    expect(updateTrim(session, 10000).durationFrames).toBe(120)
  })

  it('clamps a left drag to the previous clip, keeping the end anchored', () => {
    const f = buildFixture()
    f.engine.updateClip(f.b.id, f.v1.id, { sourceStartFrame: 100, sourceDurationFrames: 200 })
    const session = beginTrim(f.b.id, 'left', f.snapshot(4))!
    expect(updateTrim(session, -10000)).toEqual({ startFrame: 90, durationFrames: 90 })
  })
})

describe('endTrim', () => {
  it('returns null when nothing changed', () => {
    const f = buildFixture()
    const session = beginTrim(f.a.id, 'right', f.snapshot(4))!
    expect(endTrim(session, updateTrim(session, 1))).toBeNull()
  })

  it('returns a trimClip command otherwise', () => {
    const f = buildFixture()
    const session = beginTrim(f.a.id, 'left', f.snapshot(4))!
    expect(endTrim(session, updateTrim(session, -40))).toEqual({
      type: 'trimClip',
      clipId: f.a.id,
      trackId: f.v1.id,
      startFrame: 20,
      durationFrames: 70,
    })
  })
})

describe('trimPreviewRect', () => {
  it('leaves the left edge in place for a right trim and widens to the new duration', () => {
    const f = buildFixture()
    const session = beginTrim(f.a.id, 'right', f.snapshot(4))!
    const preview = updateTrim(session, 40) // A [30, 90) -> [30, 100)
    expect(trimPreviewRect(session, preview)).toEqual({ dx: 0, width: 70 * 4 })
  })

  it('shifts the left edge by the start change and sets the width to the new duration', () => {
    const f = buildFixture()
    const session = beginTrim(f.a.id, 'left', f.snapshot(4))!
    const preview = updateTrim(session, -40) // A [30, 90) -> [20, 90)
    expect(trimPreviewRect(session, preview)).toEqual({ dx: (20 - 30) * 4, width: 70 * 4 })
  })

  it('never draws narrower than the minimum clip width', () => {
    const f = buildFixture()
    const session = beginTrim(f.a.id, 'right', f.snapshot(4))!
    const tiny = { startFrame: 30, durationFrames: 1 }
    expect(trimPreviewRect(session, tiny).width).toBe(MIN_CLIP_WIDTH_PX)
  })
})
