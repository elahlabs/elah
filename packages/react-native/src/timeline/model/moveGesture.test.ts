import { describe, expect, it } from 'vitest'
import { buildFixture } from './__fixtures__/project'
import { computeLaneSlots } from './layout'
import { beginMove, endMove, updateMove } from './moveGesture'

describe('beginMove', () => {
  it('freezes the clip, its lane and the snap points', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, true))
    expect(session).not.toBeNull()
    expect(session!.clip.startFrame).toBe(30)
    expect(session!.originTrackId).toBe(f.v1.id)
    expect(session!.ownLane.trackId).toBe(f.v1.id)
    // Snap points exclude the dragged clip: 0, B's edges, Title's edges.
    expect(session!.snapPoints).toEqual([0, 30, 120, 180])
  })

  it('has no snap points when snapping is off', () => {
    const f = buildFixture()
    expect(beginMove(f.a.id, f.snapshot(4, false))!.snapPoints).toBeNull()
  })

  it('refuses an unknown clip', () => {
    const f = buildFixture()
    expect(beginMove('nope', f.snapshot())).toBeNull()
  })

  it('refuses a clip on a locked lane (selectable, not draggable)', () => {
    const f = buildFixture()
    f.engine.updateTrack(f.v1.id, { locked: true })
    expect(beginMove(f.a.id, f.snapshot())).toBeNull()
  })

  it('accepts pre-computed lanes', () => {
    const f = buildFixture()
    const lanes = computeLaneSlots(f.snapshot().tracks)
    expect(beginMove(f.a.id, f.snapshot(), { lanes })!.lanes).toBe(lanes)
  })
})

describe('updateMove', () => {
  it('converts horizontal travel to frames and reports the visual offset', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    const preview = updateMove(session, { translationX: 40 })
    expect(preview).toEqual({ startFrame: 40, trackId: f.v1.id, dx: 40, dy: 0 })
  })

  it('never drags a clip before frame 0', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    const preview = updateMove(session, { translationX: -1000 })
    expect(preview.startFrame).toBe(0)
    expect(preview.dx).toBe(-120) // from x=120 back to x=0
  })

  it('snaps to a neighbouring edge within the tolerance, and only then', () => {
    const f = buildFixture()
    // zoom 1 -> tolerance 5 frames.
    const snapping = beginMove(f.a.id, f.snapshot(1, true))!
    expect(updateMove(snapping, { translationX: 88 }).startFrame).toBe(120) // 118 -> B's start
    expect(updateMove(snapping, { translationX: 80 }).startFrame).toBe(110) // 110, 10 away: no snap

    const free = beginMove(f.a.id, f.snapshot(1, false))!
    expect(updateMove(free, { translationX: 88 }).startFrame).toBe(118)
  })

  it('moves onto a compatible lane under the finger and offsets the block vertically', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    const preview = updateMove(session, { translationX: 0, pointerY: 90 }) // inside V2 (60..120)
    expect(preview.trackId).toBe(f.v2.id)
    expect(preview.dy).toBe(60)
  })

  it('stays on its own lane when the finger is over an incompatible lane', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    const preview = updateMove(session, { translationX: 0, pointerY: 150 }) // Elements lane
    expect(preview.trackId).toBe(f.v1.id)
    expect(preview.dy).toBe(0)
  })

  it('stays on its own lane when the hovered lane is locked', () => {
    const f = buildFixture()
    f.engine.updateTrack(f.v2.id, { locked: true })
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    const preview = updateMove(session, { translationX: 0, pointerY: 90 })
    expect(preview.trackId).toBe(f.v1.id)
  })

  it('stays on its own lane when the finger leaves every lane', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    expect(updateMove(session, { translationX: 0, pointerY: 999 }).trackId).toBe(f.v1.id)
    expect(updateMove(session, { translationX: 0 }).trackId).toBe(f.v1.id)
  })

  it('is pure: the same input yields the same preview', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, true))!
    const first = updateMove(session, { translationX: 200, pointerY: 90 })
    const second = updateMove(session, { translationX: 200, pointerY: 90 })
    expect(second).toEqual(first)
  })
})

describe('endMove', () => {
  it('returns null when the clip ends where it began', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    const preview = updateMove(session, { translationX: 1 }) // 0.25 frame rounds to 0
    expect(endMove(session, preview, f.snapshot())).toBeNull()
  })

  it('returns a moveClip command for a clean drop', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    const preview = updateMove(session, { translationX: 40 })
    expect(endMove(session, preview, f.snapshot())).toEqual({
      type: 'moveClip',
      clipId: f.a.id,
      fromTrackId: f.v1.id,
      toTrackId: f.v1.id,
      startFrame: 40,
    })
  })

  it('settles a large overlap AFTER the neighbour (the 40 % rule)', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    // A [100, 160) over B [120, 180): 40 of B's 60 frames -> ratio 0.67 > 0.4.
    const preview = updateMove(session, { translationX: 70 * 4 })
    expect(endMove(session, preview, f.snapshot())).toMatchObject({ type: 'moveClip', startFrame: 180 })
  })

  it('settles a small overlap BEHIND the neighbour', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    // A [110, 170) over B: 50/60 -> after. Use A [65, 125): 5/60 = 0.08 -> behind, at 120 - 60.
    const preview = updateMove(session, { translationX: 35 * 4 })
    expect(endMove(session, preview, f.snapshot())).toMatchObject({ type: 'moveClip', startFrame: 60 })
  })

  it('targets the hovered lane and settles against THAT lane', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    // Same frames as the overlap case, but V2 is empty, so nothing moves it.
    const preview = updateMove(session, { translationX: 70 * 4, pointerY: 90 })
    expect(endMove(session, preview, f.snapshot())).toEqual({
      type: 'moveClip',
      clipId: f.a.id,
      fromTrackId: f.v1.id,
      toTrackId: f.v2.id,
      startFrame: 100,
    })
  })

  it('emits a command for a pure lane change with no horizontal travel', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    const preview = updateMove(session, { translationX: 0, pointerY: 90 })
    expect(endMove(session, preview, f.snapshot())).toMatchObject({ type: 'moveClip', toTrackId: f.v2.id })
  })
})
