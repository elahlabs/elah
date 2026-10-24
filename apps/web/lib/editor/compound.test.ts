import { describe, expect, it } from 'vitest'
import { createCompoundClip, TimelineEngine, type Clip, type Project, type Track } from '@elah/core'
import {
  STALE_CHILD_MESSAGE,
  cancelCompound,
  commitAll,
  compoundForClip,
  compoundPath,
  currentProject,
  editCompoundDraft,
  enterCompound,
  foldTo,
  hasUnsavedDraft,
  resolveCompoundPath,
  rootSession,
  saveCompound,
} from './compound'

/**
 * Nested compound navigation (PV-P1c-1 step 3).
 *
 * The load-bearing claim of this ticket is that a nested edit must not go
 * through `loadProject`, because that resets undo. These tests therefore check
 * the ROOT PROJECT OBJECT, not just the visible result: if navigation ever
 * loaded a child into the engine, "the root is identical" would stop being true
 * and the history assertions below would start failing too.
 */

const TRACK: Track = {
  id: 'v1',
  name: 'V1',
  kind: 'video',
  order: 0,
  height: 54,
  locked: false,
  disabled: false,
  muted: false,
  solo: false,
}

function video(id: string, src: string, startFrame = 0): Clip {
  return {
    id,
    type: 'video',
    trackId: 'v1',
    name: src,
    src,
    startFrame,
    durationFrames: 20,
  } as Clip
}

/**
 * A project holding the given clips on one track.
 *
 * Every required `Project` field is filled in rather than cast, so a change to
 * the document shape breaks this fixture loudly instead of being cast away.
 */
function projectWith(...clips: Clip[]): Project {
  return {
    id: 'root',
    fps: 30,
    stage: { width: 1280, height: 720 },
    tracks: [TRACK],
    clips: { v1: clips },
    transitions: [],
    version: 1,
  }
}

/** A child project holding `id` as a video clip. */
const childWith = (id: string): Project => projectWith(video(id, `${id}.mp4`))

/**
 * "The user deleted everything", as a draft edit.
 *
 * Empties every track rather than a named one: the engine mints its own track
 * ids when it nests, so assuming a track called `v1` would quietly ADD an empty
 * track instead of clearing the draft, and the test would pass for the wrong
 * reason.
 */
const blank = (draft: Project): Project => ({ ...draft, clips: {} })

/** Every clip in a project, across all tracks, in track order. */
const allOf = (project: Project) => Object.values(project.clips).flat()

/** A compound clip holding `child`, addressed by the id given. */
function compound(id: string, child: Project, startFrame = 0): Clip {
  // `createCompoundClip` mints its own id; these fixtures need fixed ones, so
  // the minted clip is relabelled. Nothing downstream cares where it came from.
  return { ...createCompoundClip({ trackId: 'v1', name: id, startFrame, project: child }), id }
}

/** Two compounds side by side on the root track. */
const twoCompounds = (): { project: Project; a: string; b: string } => {
  const project = projectWith(compound('ca', childWith('x')), compound('cb', childWith('y'), 20))
  return { project, a: 'ca', b: 'cb' }
}

describe('enterCompound', () => {
  it('opens a compound and shows its child', () => {
    const { project, a } = twoCompounds()
    const opened = enterCompound(rootSession(), project, a)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(compoundPath(opened.data)).toEqual([a])
    // The UI is now pointed at the child, not the root.
    expect(currentProject(opened.data, project)).not.toBe(project)
    expect(currentProject(opened.data, project).clips.v1?.[0]?.id).toBe('x')
  })

  it('refuses a missing clip and a clip that is not a compound', () => {
    const { project } = twoCompounds()
    const missing = enterCompound(rootSession(), project, 'nope')
    expect(missing).toMatchObject({ ok: false, error: { code: 'clip-not-found' } })
    const plain = enterCompound(rootSession(), projectWith(video('p', 'p.mp4')), 'p')
    expect(plain).toMatchObject({ ok: false, error: { code: 'not-a-compound' } })
  })

  it('refuses to open a level deeper than the engine allows', () => {
    // A real chain, MAX_COMPOUND_DEPTH compounds deep. Walking in should give
    // exactly that many frames, and the next Enter is refused on depth — not on
    // a missing id, which is why the chain has to actually exist. Note the walk
    // runs outermost first: each wrap is the compound the previous one sits in.
    let deepest = projectWith(video('leaf', 'leaf.mp4'))
    for (let level = 0; level < 4; level++) deepest = projectWith(compound(`c${level}`, deepest))
    const order = ['c3', 'c2', 'c1', 'c0']

    let session = enterCompound(rootSession(), deepest, order[0]!)
    expect(session.ok).toBe(true)
    if (!session.ok) return
    for (const id of order.slice(1)) {
      const next = enterCompound(session.data, currentProject(session.data, deepest), id)
      expect(next.ok).toBe(true)
      if (!next.ok) return
      session = next
    }
    expect(session.data.frames).toHaveLength(4)

    const tooDeep = enterCompound(session.data, currentProject(session.data, deepest), 'c0')
    expect(tooDeep).toMatchObject({ ok: false, error: { code: 'too-deep' } })
  })
})

describe('enter → edit → Cancel leaves the root identical', () => {
  it('writes nothing and leaves the same project object in place', () => {
    const { project, a } = twoCompounds()
    const before = JSON.stringify(project)

    const opened = enterCompound(rootSession(), project, a)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const edited = editCompoundDraft(opened.data, (draft) => ({
      ...draft,
      clips: { ...draft.clips, v1: [...(draft.clips.v1 ?? []), video('extra', 'extra.mp4', 20)] },
    }))
    // The edit is visible in the draft...
    expect(currentProject(edited, project).clips.v1).toHaveLength(2)
    // ...and nowhere else.
    expect(JSON.stringify(project)).toBe(before)

    const left = cancelCompound(edited)
    expect(compoundPath(left)).toEqual([])
    expect(currentProject(left, project)).toBe(project)
    expect(JSON.stringify(project)).toBe(before)
  })

  it('leaves an engine untouched: no history entry, same project', () => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1280, height: 720 } })
    const track = engine.addTrack('video')
    const first = engine.addClip({ type: 'video', src: 'a.mp4', trackId: track.id, startFrame: 0, durationFrames: 20 })
    const second = engine.addClip({ type: 'video', src: 'b.mp4', trackId: track.id, startFrame: 20, durationFrames: 20 })
    const nested = engine.nestClips([first.id, second.id])
    expect(nested.ok).toBe(true)
    if (!nested.ok) return

    const before = engine.getProject()
    const canUndoBefore = engine.canUndo()
    const opened = enterCompound(rootSession(), before, nested.data)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const edited = editCompoundDraft(opened.data, blank)
    cancelCompound(edited)

    // Same object, and no history entry was added by entering or cancelling.
    expect(engine.getProject()).toBe(before)
    expect(engine.canUndo()).toBe(canUndoBefore)
  })
})

describe('saveCompound', () => {
  /** An engine with one compound, and the session helpers to drive it. */
  function sessionOn(engine: TimelineEngine): { compoundId: string; enter: () => ReturnType<typeof enterCompound> } {
    const project = engine.getProject()
    const clip = Object.values(project.clips)
      .flat()
      .find((c) => c.type === 'compound')
    if (!clip) throw new Error('no compound in project')
    return { compoundId: clip.id, enter: () => enterCompound(rootSession(), project, clip.id) }
  }

  it('commits the draft in ONE undo step, and root undo restores the old child', () => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1280, height: 720 } })
    const track = engine.addTrack('video')
    const a = engine.addClip({ type: 'video', src: 'a.mp4', trackId: track.id, startFrame: 0, durationFrames: 20 })
    const b = engine.addClip({ type: 'video', src: 'b.mp4', trackId: track.id, startFrame: 20, durationFrames: 20 })
    const nested = engine.nestClips([a.id, b.id])
    expect(nested.ok).toBe(true)
    if (!nested.ok) return

    const before = engine.getProject()
    const childBefore = JSON.stringify((engine.findClip(nested.data)!.clip as { compound: { project: Project } }).compound.project)

    const { enter } = sessionOn(engine)
    const opened = enter()
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const edited = editCompoundDraft(opened.data, blank)

    const saved = saveCompound(edited, engine)
    expect(saved).toMatchObject({ ok: true, data: { committed: true } })
    if (!saved.ok) return
    expect(compoundPath(saved.data.session)).toEqual([])
    const childAfter = JSON.stringify((engine.findClip(nested.data)!.clip as { compound: { project: Project } }).compound.project)
    expect(childAfter).not.toBe(childBefore)

    // ONE undo restores the whole previous child.
    expect(engine.undo()).toBe(true)
    const restored = JSON.stringify((engine.findClip(nested.data)!.clip as { compound: { project: Project } }).compound.project)
    expect(restored).toBe(childBefore)
    expect(engine.getProject()).toEqual(before)
  })

  it('refuses with the user-facing message when the parent changed underneath', () => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1280, height: 720 } })
    const track = engine.addTrack('video')
    const a = engine.addClip({ type: 'video', src: 'a.mp4', trackId: track.id, startFrame: 0, durationFrames: 20 })
    const b = engine.addClip({ type: 'video', src: 'b.mp4', trackId: track.id, startFrame: 20, durationFrames: 20 })
    const nested = engine.nestClips([a.id, b.id])
    expect(nested.ok).toBe(true)
    if (!nested.ok) return

    const { enter } = sessionOn(engine)
    const opened = enter()
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const edited = editCompoundDraft(opened.data, blank)

    // Someone else edits the same child while the modal is open.
    const current = engine.findClip(nested.data)!.clip as { compound: { project: Project } }
    const rival = {
      ...current.compound.project,
      clips: { ...current.compound.project.clips, v1: [video('rival', 'rival.mp4')] },
    }
    const hijack = engine.updateCompoundProject(nested.data, rival)
    expect(hijack.ok).toBe(true)

    const saved = saveCompound(edited, engine)
    expect(saved).toMatchObject({ ok: false, error: { code: 'stale-child', message: STALE_CHILD_MESSAGE } })
    // The rival's edit stands: a refusal overwrites nothing.
    const after = engine.findClip(nested.data)!.clip as { compound: { project: Project } }
    expect(after.compound.project.clips.v1?.map((c) => c.id)).toEqual(['rival'])
  })

  it('refuses when nothing is open, and pops without committing when unchanged', () => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1280, height: 720 } })
    expect(saveCompound(rootSession(), engine)).toMatchObject({ ok: false, error: { code: 'not-editing' } })

    const track = engine.addTrack('video')
    const a = engine.addClip({ type: 'video', src: 'a.mp4', trackId: track.id, startFrame: 0, durationFrames: 20 })
    const b = engine.addClip({ type: 'video', src: 'b.mp4', trackId: track.id, startFrame: 20, durationFrames: 20 })
    engine.nestClips([a.id, b.id])
    const before = engine.getProject()

    const { enter } = sessionOn(engine)
    const opened = enter()
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    // Entered and left with no edit at all: no commit, and no history entry.
    const saved = saveCompound(opened.data, engine)
    expect(saved).toMatchObject({ ok: true, data: { committed: false } })
    expect(engine.getProject()).toBe(before)
  })
})

describe('nested Save updates only the selected branch', () => {
  it('folds a deep edit into the parent draft, committing once at the outermost Save', () => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1280, height: 720 } })
    const track = engine.addTrack('video')
    const a = engine.addClip({ type: 'video', src: 'a.mp4', trackId: track.id, startFrame: 0, durationFrames: 20 })
    const b = engine.addClip({ type: 'video', src: 'b.mp4', trackId: track.id, startFrame: 20, durationFrames: 20 })
    const inner = engine.nestClips([a.id, b.id])
    expect(inner.ok).toBe(true)
    if (!inner.ok) return
    // A third clip on the SAME track, then nest the compound with it. P1a-3
    // refuses a selection that reaches across tracks, so a sibling on another
    // track would be rejected here for an unrelated reason.
    const c = engine.addClip({ type: 'video', src: 'c.mp4', trackId: track.id, startFrame: 40, durationFrames: 20 })
    const outer = engine.nestClips([inner.data, c.id])
    expect(outer.ok).toBe(true)
    if (!outer.ok) return

    const project = engine.getProject()
    // After the outer nest the inner clip is no longer top level, so it is read
    // back by PATH — which is the whole reason paths exist.
    const childAt = (path: string[]) => {
      const found = resolveCompoundPath(engine.getProject(), path)
      expect(found, `no compound at ${path.join(' > ')}`).toBeTruthy()
      return JSON.stringify(found)
    }
    const outerBefore = childAt([outer.data])
    const innerBefore = childAt([outer.data, inner.data])

    // Enter the outer compound, then the inner one inside it.
    const step1 = enterCompound(rootSession(), project, outer.data)
    expect(step1.ok).toBe(true)
    if (!step1.ok) return
    const step2 = enterCompound(step1.data, project, inner.data)
    expect(step2.ok).toBe(true)
    if (!step2.ok) return
    expect(compoundPath(step2.data)).toEqual([outer.data, inner.data])

    const edited = editCompoundDraft(step2.data, blank)

    // Saving the INNER level must not touch the engine at all.
    const innerSave = saveCompound(edited, engine)
    expect(innerSave).toMatchObject({ ok: true, data: { committed: false } })
    if (!innerSave.ok) return
    expect(childAt([outer.data])).toBe(outerBefore)
    expect(compoundPath(innerSave.data.session)).toEqual([outer.data])

    // The folded draft is now the outer level's draft, ready to commit.
    const folded = currentProject(innerSave.data.session, project)
    expect(JSON.stringify(folded)).not.toBe(outerBefore)

    const outerSave = saveCompound(innerSave.data.session, engine)
    expect(outerSave).toMatchObject({ ok: true, data: { committed: true } })
    if (!outerSave.ok) return
    expect(compoundPath(outerSave.data.session)).toEqual([])

    // Only the selected branch moved: the outer child changed, and inside it the
    // inner child changed too. Nothing else in the document did.
    expect(childAt([outer.data])).not.toBe(outerBefore)
    expect(childAt([outer.data, inner.data])).not.toBe(innerBefore)
    // The sibling that shared the outer compound is still there. A fold that
    // replaced the parent's whole child would have taken it — and the inner
    // compound itself — with it.
    const outerAfter = resolveCompoundPath(engine.getProject(), [outer.data])!
    expect(allOf(outerAfter).map((x) => (x as { src?: string }).src ?? x.type)).toEqual([
      'compound',
      'c.mp4',
    ])
    // One commit, so one undo puts the whole branch back.
    expect(engine.undo()).toBe(true)
    expect(childAt([outer.data])).toBe(outerBefore)
    expect(childAt([outer.data, inner.data])).toBe(innerBefore)
  })

  it('cancelling a deep level leaves the parent draft exactly as it was', () => {
    // p1 holds a compound called `inner`; entering p1 then inner and cancelling
    // must give back the p1 draft untouched.
    const project = projectWith(compound('p1', projectWith(compound('inner', childWith('x')))))
    const step1 = enterCompound(rootSession(), project, 'p1')
    expect(step1.ok).toBe(true)
    if (!step1.ok) return
    const parentBefore = JSON.stringify(currentProject(step1.data, project))

    const step2 = enterCompound(step1.data, project, 'inner')
    expect(step2.ok).toBe(true)
    if (!step2.ok) return
    expect(compoundPath(step2.data)).toEqual(['p1', 'inner'])

    const edited = editCompoundDraft(step2.data, blank)
    const cancelled = cancelCompound(edited)
    expect(compoundPath(cancelled)).toEqual(['p1'])
    expect(JSON.stringify(currentProject(cancelled, project))).toBe(parentBefore)
  })
})

describe('duplicate child ids in different parents resolve by full path', () => {
  /** p1 and p2 each hold a compound called `shared`, holding different clips. */
  const twins = (): Project =>
    projectWith(
      compound('p1', projectWith(compound('shared', projectWith(video('a', 'a.mp4'))))),
      compound('p2', projectWith(compound('shared', projectWith(video('b', 'b.mp4')))), 20),
    )

  it('resolves the same compound id under two parents to two different projects', () => {
    const project = twins()
    const viaLeft = resolveCompoundPath(project, ['p1', 'shared'])
    const viaRight = resolveCompoundPath(project, ['p2', 'shared'])
    expect(viaLeft?.clips.v1?.[0]?.src).toBe('a.mp4')
    expect(viaRight?.clips.v1?.[0]?.src).toBe('b.mp4')
    expect(viaLeft).not.toBe(viaRight)

    // The bare id is not resolvable from the root: nothing called `shared` is a
    // compound up there, so an ambiguous path fails instead of guessing.
    expect(resolveCompoundPath(project, ['shared'])).toBeNull()
    // A path that walks a parent which does not hold the child fails.
    expect(resolveCompoundPath(project, ['p1', 'p2'])).toBeNull()
    // The empty path is the root document itself.
    expect(resolveCompoundPath(project, [])).toBe(project)
  })

  it('Enter reaches the same id under the parent you are standing in', () => {
    const project = twins()
    // From the root, `shared` is not reachable at all.
    expect(enterCompound(rootSession(), project, 'shared')).toMatchObject({
      ok: false,
      error: { code: 'clip-not-found' },
    })

    // Inside p1, `shared` is p1's. Inside p2, it is p2's.
    const inLeft = enterCompound(rootSession(), project, 'p1')
    expect(inLeft.ok).toBe(true)
    if (!inLeft.ok) return
    const deeperLeft = enterCompound(inLeft.data, project, 'shared')
    expect(deeperLeft.ok).toBe(true)
    if (!deeperLeft.ok) return
    expect(currentProject(deeperLeft.data, project).clips.v1?.[0]?.src).toBe('a.mp4')
    expect(deeperLeft.data.frames.at(-1)!.path).toEqual(['p1', 'shared'])

    const inRight = enterCompound(rootSession(), project, 'p2')
    expect(inRight.ok).toBe(true)
    if (!inRight.ok) return
    const deeperRight = enterCompound(inRight.data, project, 'shared')
    expect(deeperRight.ok).toBe(true)
    if (!deeperRight.ok) return
    expect(currentProject(deeperRight.data, project).clips.v1?.[0]?.src).toBe('b.mp4')
    expect(deeperRight.data.frames.at(-1)!.path).toEqual(['p2', 'shared'])
  })
})

/**
 * What the dialog's Save is claimed to do (PV-P1c-2 step 3).
 *
 * The dialog's own behaviour is browser-only — `apps/web` has no component test setup —
 * so the load-bearing half of "Save adds one root undo" is pinned HERE, against a real
 * engine, on the same helpers the dialog calls. If this stops being true the dialog's
 * central promise is false, and it is worth a failing test rather than a comment.
 */
describe('a nested edit is one root commit and one undo', () => {
  it('undoes the whole child in a single step after a two-level edit', () => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1280, height: 720 } })
    const track = engine.addTrack('video')
    const first = engine.addClip({ type: 'video', src: 'a.mp4', trackId: track.id, startFrame: 0, durationFrames: 20 })
    const second = engine.addClip({ type: 'video', src: 'b.mp4', trackId: track.id, startFrame: 20, durationFrames: 20 })
    const nested = engine.nestClips([first.id, second.id])
    expect(nested.ok).toBe(true)
    if (!nested.ok) return

    // Enter the compound and delete everything inside it — one draft, many changes.
    const root = engine.getProject()
    const entered = enterCompound(rootSession(), root, nested.data)
    expect(entered.ok).toBe(true)
    if (!entered.ok) return
    const saved = saveCompound(editCompoundDraft(entered.data, blank), engine)
    expect(saved).toMatchObject({ ok: true, data: { committed: true } })

    // The compound is now empty, and there is exactly ONE thing to undo.
    const emptied = resolveCompoundPath(engine.getProject(), [nested.data])
    expect(Object.keys(emptied?.clips ?? {})).toHaveLength(0)
    const canUndo = engine.canUndo()
    expect(canUndo).toBe(true)
    engine.undo()
    // The whole previous child came back in one step, not one clip at a time.
    const restored = resolveCompoundPath(engine.getProject(), [nested.data])
    expect(Object.values(restored?.clips ?? {}).flat()).toHaveLength(2)
    // And the nest itself is still the state before the edit.
    expect(engine.canUndo()).toBe(true)
  })
})

describe('compoundForClip', () => {
  it('names the compound an Edit contents action should open, or nothing', () => {
    const c = compound('c', projectWith(video('a', 'a.mp4')))
    expect(compoundForClip(c)).toBe(c)
    expect(compoundForClip(video('a', 'a.mp4'))).toBeNull()
    expect(compoundForClip(null)).toBeNull()
  })
})

describe('editing across levels (CMP-EDIT-1)', () => {
  /** Root → outer compound → inner compound → two videos, built through the engine. */
  function twoLevels() {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1280, height: 720 } })
    const track = engine.addTrack('video')
    const a = engine.addClip({ type: 'video', src: 'a.mp4', trackId: track.id, startFrame: 0, durationFrames: 20 })
    const b = engine.addClip({ type: 'video', src: 'b.mp4', trackId: track.id, startFrame: 20, durationFrames: 20 })
    const inner = engine.nestClips([a.id, b.id])
    if (!inner.ok) throw new Error('inner nest refused')
    const c = engine.addClip({ type: 'video', src: 'c.mp4', trackId: track.id, startFrame: 40, durationFrames: 20 })
    const outer = engine.nestClips([inner.data, c.id])
    if (!outer.ok) throw new Error('outer nest refused')
    const project = engine.getProject()
    const s1 = enterCompound(rootSession(), project, outer.data)
    if (!s1.ok) throw new Error('enter outer refused')
    return { engine, project, outer: outer.data, inner: inner.data, s1: s1.data }
  }
  /** Drop the clip with this src from every track of a draft. */
  const without = (src: string) => (draft: Project): Project => ({
    ...draft,
    clips: Object.fromEntries(
      Object.entries(draft.clips).map(([t, list]) => [t, list.filter((x) => (x as { src?: string }).src !== src)]),
    ),
  })
  const srcsOf = (project: Project | null) =>
    allOf(project ?? projectWith()).map((x) => (x as { src?: string }).src ?? x.type)
  const srcsAt = (engine: TimelineEngine, path: string[]) => srcsOf(resolveCompoundPath(engine.getProject(), path))

  it('reports an unsaved draft at any level, not only the top one', () => {
    const { project, inner, s1 } = twoLevels()
    expect(hasUnsavedDraft(s1)).toBe(false)
    const editedOuter = editCompoundDraft(s1, without('c.mp4'))
    expect(hasUnsavedDraft(editedOuter)).toBe(true)
    // Drill in: the top level is clean, the level above is not.
    const s2 = enterCompound(editedOuter, project, inner)
    expect(s2.ok).toBe(true)
    if (!s2.ok) return
    expect(s2.data.frames.at(-1)!.draft).toBe(s2.data.frames.at(-1)!.base)
    expect(hasUnsavedDraft(s2.data)).toBe(true)
  })

  it('an edit made before drilling in survives the trip down and back up', () => {
    const { engine, project, outer, inner, s1 } = twoLevels()
    const s2 = enterCompound(editCompoundDraft(s1, without('c.mp4')), project, inner)
    if (!s2.ok) throw new Error('enter inner refused')
    expect(compoundPath(s2.data)).toEqual([outer, inner])
    const back = foldTo(editCompoundDraft(s2.data, without('a.mp4')), engine, 1)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.data.frames).toHaveLength(1)
    // Both edits sit in the outer draft; nothing has reached the engine yet.
    expect(srcsAt(engine, [outer])).toEqual(['compound', 'c.mp4'])
    expect(srcsOf(currentProject(back.data, project))).toEqual(['compound'])
    expect(srcsOf(resolveCompoundPath(currentProject(back.data, project), [inner]))).toEqual(['b.mp4'])
  })

  it('commitAll lands every level as ONE undo step', () => {
    const { engine, project, outer, inner, s1 } = twoLevels()
    const s2 = enterCompound(editCompoundDraft(s1, without('c.mp4')), project, inner)
    if (!s2.ok) throw new Error('enter inner refused')
    const saved = commitAll(editCompoundDraft(s2.data, without('a.mp4')), engine)
    expect(saved).toEqual({ ok: true, committed: true })
    expect(srcsAt(engine, [outer])).toEqual(['compound'])
    expect(srcsAt(engine, [outer, inner])).toEqual(['b.mp4'])
    expect(engine.undo()).toBe(true)
    expect(srcsAt(engine, [outer])).toEqual(['compound', 'c.mp4'])
    expect(srcsAt(engine, [outer, inner])).toEqual(['a.mp4', 'b.mp4'])
  })

  it('commitAll with nothing changed commits nothing', () => {
    const { engine, project, inner, s1 } = twoLevels()
    const s2 = enterCompound(s1, project, inner)
    if (!s2.ok) throw new Error('enter inner refused')
    const before = engine.getProject()
    expect(commitAll(s2.data, engine)).toEqual({ ok: true, committed: false })
    expect(engine.getProject()).toBe(before)
  })

  it('foldTo refuses to fold past the outermost level', () => {
    const { engine, s1 } = twoLevels()
    expect(foldTo(s1, engine, 0)).toMatchObject({ ok: false })
  })
})
