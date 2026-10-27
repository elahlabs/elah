import { describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'
import type { Clip, Project } from '../types'

/**
 * The engine half of nest and unnest (PV-P1a-3).
 *
 * The pure half is in `compound.edit.test.ts`. What is left to prove here is the
 * part only the engine can get wrong: that an edit is ONE undo step rather than
 * a project load, that a refusal writes nothing at all, and that nesting leaves
 * every unselected clip exactly where it was - which in magnetic mode is the
 * difference between a re-parent and a ripple.
 */

function engine(): TimelineEngine {
  return new TimelineEngine({ fps: 30, stage: { width: 1280, height: 720 } })
}

/** Two video lanes and two clips on the top one, plus an unselected clip. */
function twoLanes(e: TimelineEngine): { a: string; b: string; keep: string } {
  const v1 = e.addTrack('video', { name: 'V1' })
  const v2 = e.addTrack('video', { name: 'V2' })
  const a = e.addClip({ type: 'video', src: 'a.mp4', trackId: v1.id, startFrame: 10, durationFrames: 20 })
  const b = e.addClip({ type: 'video', src: 'b.mp4', trackId: v2.id, startFrame: 20, durationFrames: 30 })
  const keep = e.addClip({ type: 'video', src: 'keep.mp4', trackId: v1.id, startFrame: 60, durationFrames: 10 })
  return { a: a.id, b: b.id, keep: keep.id }
}

const allClips = (e: TimelineEngine): Clip[] => Object.values(e.getProject().clips).flat()

describe('TimelineEngine.nestClips', () => {
  it('is one undo step, and redo brings it back', () => {
    const e = engine()
    const { a, b } = twoLanes(e)
    const before = e.getProject()

    const result = e.nestClips([a, b])
    expect(result.ok).toBe(true)
    const compoundId = result.ok ? result.data : ''
    const after = e.getProject()

    // The picture is one clip now, on the topmost selected lane.
    expect(allClips(e).some((c) => c.id === compoundId)).toBe(true)
    expect(allClips(e)).toHaveLength(2)
    expect(after.version).toBe(4)

    // Exactly the project as it was, object for object.
    expect(e.undo()).toBe(true)
    expect(e.getProject()).toEqual(before)

    expect(e.redo()).toBe(true)
    expect(e.getProject()).toEqual(after)
  })

  it('leaves every unselected start frame alone, in magnetic mode', () => {
    const e = engine()
    const { a, b, keep } = twoLanes(e)
    e.setTimelineMode('magnetic')
    const startsBefore = new Map(allClips(e).map((c) => [c.id, c.startFrame]))

    expect(e.nestClips([a, b]).ok).toBe(true)

    // Nesting re-parents the selection; it is not an insertion, so nothing
    // downstream may slide. This is the assertion that would fail if a nest
    // went through the placement path.
    const keepClip = e.findClip(keep)!.clip
    expect(keepClip.startFrame).toBe(startsBefore.get(keep))
  })

  it('refuses without writing anything', () => {
    const e = engine()
    const { a, keep } = twoLanes(e)
    const before = e.getProject()
    // The label of the next undo. A refusal that pushed an entry would replace
    // it with its own, which is the failure this catches.
    const next = e.lastHistoryDescription()

    const result = e.nestClips([a, 'does-not-exist'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('clip-not-found')
    expect(e.getProject()).toBe(before)
    expect(e.lastHistoryDescription()).toBe(next)
    // And the undo it would have added is not there: the next undo still undoes
    // the user's own last edit, not a nest that never happened.
    expect(e.undo()).toBe(true)
    expect(e.findClip('keep')).toBeNull()
    expect(e.findClip(a)).not.toBeNull()
  })
})

describe('TimelineEngine.unnestClip', () => {
  it('is one undo step in the other direction too', () => {
    const e = engine()
    const { a, b } = twoLanes(e)
    const before = e.getProject()
    const nested = e.nestClips([a, b])
    expect(nested.ok).toBe(true)
    const compoundId = nested.ok ? nested.data : ''

    const result = e.unnestClip(compoundId)
    expect(result.ok).toBe(true)
    const restored = result.ok ? result.data : []
    expect(restored).toHaveLength(2)
    // The timeline is the two clips again, on fresh lanes, at their old frames.
    const positions = restored.map((id) => {
      const found = e.findClip(id)!
      return [found.clip.startFrame, found.clip.durationFrames] as const
    })
    expect(positions).toEqual([
      [10, 20],
      [20, 30],
    ])
    expect(e.getProject().version).toBe(1)

    expect(e.undo()).toBe(true)
    expect(e.getProject()).toEqual(
      // The state with the compound in it, not the original: one step back.
      expect.objectContaining({ version: 4 }),
    )
    expect(e.findClip(compoundId)).not.toBeNull()

    expect(e.redo()).toBe(true)
    expect(e.findClip(compoundId)).toBeNull()
  })

  it('refuses a compound that cannot be restored, and says why', () => {
    const e = engine()
    const { a, b } = twoLanes(e)
    const nested = e.nestClips([a, b])
    expect(nested.ok).toBe(true)
    const compoundId = nested.ok ? nested.data : ''
    const trackId = e.findClip(compoundId)!.trackId
    e.updateClip(compoundId, trackId, {
      transform: { x: 0.5, y: 0.5, scale: 0.5, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
    })
    const before = e.getProject()

    const result = e.unnestClip(compoundId)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('not-lossless')
      expect(result.error.message).toContain('Reset compound transforms and trim before unnesting')
    }
    expect(e.getProject()).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// Child-project commits (PV-P1c-1 step 1)
//
// The commit half of a child editor. Two properties matter and are easy to get
// wrong in opposite directions: it must be ONE undo step, not a project load
// (which resets history and autosave context) and not a per-clip edit (many
// entries); and it must REFUSE rather than clobber when the document moved under
// the session, because the session is editing a snapshot of a child that may
// since have changed.
// ---------------------------------------------------------------------------

/** A project holding `n` text clips, used as a child document. */
function childWith(fps: number, text: string, clips = 1): Project {
  const child = new TimelineEngine({ fps, stage: { width: 640, height: 360 } })
  const track = child.addTrack('elements')
  for (let i = 0; i < clips; i++) {
    child.addClip({ type: 'text', text: { content: `${text}-${i}` }, trackId: track.id, startFrame: i * 10, durationFrames: 10 })
  }
  return child.getProject()
}

/** A parent document with one compound holding a child we control. */
function withCompound(): { e: TimelineEngine; compoundId: string } {
  const e = engine()
  const v1 = e.addTrack('video')
  const a = e.addClip({ type: 'video', src: 'a.mp4', trackId: v1.id, startFrame: 0, durationFrames: 20 })
  const b = e.addClip({ type: 'video', src: 'b.mp4', trackId: v1.id, startFrame: 20, durationFrames: 20 })

  const nested = e.nestClips([a.id, b.id])
  expect(nested.ok).toBe(true)
  const compoundId = nested.ok ? nested.data : ''

  // Replace whatever the nest put in the compound with a known child, so a test
  // can assert on it without knowing how nest orders or trims clips.
  const put = e.updateCompoundProject(compoundId, childWith(30, 'inner'))
  expect(put.ok).toBe(true)
  return { e, compoundId }
}

const childOf = (e: TimelineEngine, clipId: string): Project | undefined => {
  const found = e.findClip(clipId)
  const clip = found?.clip as (Clip & { compound?: { project: Project } }) | undefined
  return clip?.compound?.project
}

describe('updateCompoundProject — the happy path', () => {
  it('writes the child and is ONE undo step that restores the previous child', () => {
    const { e, compoundId } = withCompound()
    const before = childOf(e, compoundId)

    const edited = childWith(30, 'edited', 2)
    const result = e.updateCompoundProject(compoundId, edited)
    expect(result.ok).toBe(true)
    expect(childOf(e, compoundId)).toEqual(edited)

    // A single undo puts the OLD child back, whole.
    expect(e.undo()).toBe(true)
    expect(childOf(e, compoundId)).toEqual(before)
  })

  it('leaves every other clip and the document frame rate alone', () => {
    const { e, compoundId } = withCompound()
    const others = allClips(e).filter((c) => c.id !== compoundId)
    e.updateCompoundProject(compoundId, childWith(30, 'edited', 3))
    expect(allClips(e).filter((c) => c.id !== compoundId)).toEqual(others)
    expect(e.getProject().fps).toBe(30)
  })

  it('accepts a child that matches the expected snapshot', () => {
    const { e, compoundId } = withCompound()
    const base = childOf(e, compoundId)!
    const result = e.updateCompoundProject(compoundId, childWith(30, 'edited'), { expectedChild: base })
    expect(result.ok).toBe(true)
  })
})

describe('updateCompoundProject — refusals', () => {
  it('refuses an unknown clip id', () => {
    const { e } = withCompound()
    const result = e.updateCompoundProject('nope', childWith(30, 'x'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('clip-not-found')
  })

  it('refuses a clip that is not a compound', () => {
    const e = engine()
    const v1 = e.addTrack('video')
    const clip = e.addClip({ type: 'video', src: 'a.mp4', trackId: v1.id, startFrame: 0, durationFrames: 10 })
    const result = e.updateCompoundProject(clip.id, childWith(30, 'x'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not-a-compound')
  })

  it('refuses a child at a different frame rate', () => {
    const { e, compoundId } = withCompound()
    const before = childOf(e, compoundId)
    const result = e.updateCompoundProject(compoundId, childWith(24, 'x'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('fps-mismatch')
    // A refusal writes NOTHING.
    expect(childOf(e, compoundId)).toEqual(before)
  })

  it('refuses a stale child snapshot, and leaves the newer child in place', () => {
    const { e, compoundId } = withCompound()
    const base = childOf(e, compoundId)!

    // Somebody else edits the compound while the session is open.
    const theirs = childWith(30, 'theirs')
    expect(e.updateCompoundProject(compoundId, theirs).ok).toBe(true)

    // The session now tries to save what it was working on.
    const result = e.updateCompoundProject(compoundId, childWith(30, 'mine'), { expectedChild: base })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('stale-child')
    expect(childOf(e, compoundId)).toEqual(theirs)
  })

  it('refuses a child nested deeper than the reader allows', () => {
    const { e, compoundId } = withCompound()
    // Build a chain MAX_COMPOUND_DEPTH deep and offer it as a child of a compound
    // that already sits one level down — the total would be one too many.
    let deep = childWith(30, 'd0')
    for (let i = 1; i <= 4; i++) {
      const outer = new TimelineEngine({ fps: 30, stage: { width: 640, height: 360 } })
      const track = outer.addTrack('elements')
      outer.addClip({ type: 'compound', trackId: track.id, startFrame: 0, durationFrames: 30, compound: { project: deep } })
      deep = outer.getProject()
    }
    const result = e.updateCompoundProject(compoundId, deep)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('too-deep')
  })

  it('refuses when the compound sits on a locked track', () => {
    const { e, compoundId } = withCompound()
    e.updateTrack(e.getProject().tracks.find((t) => t.id === e.findClip(compoundId)!.trackId)!.id, { locked: true })
    const result = e.updateCompoundProject(compoundId, childWith(30, 'x'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(['track-locked', 'track-disabled']).toContain(result.error.code)
  })
})

