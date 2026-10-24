/**
 * Nested compound navigation, ported from the premium editor (`compound.ts`) with only what the artifact needs.
 *
 * A compound holds a whole timeline inside a clip. Navigation is a stack of immutable snapshots; the ONLY way
 * an edit reaches the document is one `updateCompoundProject` commit at Done, so:
 *
 *  - Cancel is free: nothing was ever written to the root.
 *  - A stale parent is detectable: each frame keeps the child as it was when that level was entered, and that
 *    is handed to the engine as `expectedChild`, turning "someone else moved this" into a refusal.
 *  - A deeper level folds into its parent frame's draft, so a deep edit is one commit at the outermost Done.
 *
 * Pure: no React, no DOM. The one impure edge is `saveCompound`, which calls a method on an engine the caller
 * supplies. The artifact drives this by loading each level's draft into its own engine (`loadProject`), then
 * loading the root snapshot back before `commitAll`; this module does not care how the draft is edited.
 */

import { MAX_COMPOUND_DEPTH, type Clip, type Project, type TimelineEngine } from '@elah/core'

/** Why a navigation or Save was refused: the engine's own codes plus the two only this layer raises. */
export type CompoundNavCode =
  | 'not-editing'
  | 'no-change'
  | 'clip-not-found'
  | 'not-a-compound'
  | 'track-locked'
  | 'track-disabled'
  | 'fps-mismatch'
  | 'too-deep'
  | 'stale-child'

/** What the user is told when the parent moved while the compound was open. */
export const STALE_CHILD_MESSAGE = 'Compound changed outside this editor; reopen it.'

export type CompoundNavResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: CompoundNavCode; message: string } }

const refuse = (code: CompoundNavCode, message: string): CompoundNavResult<never> => ({
  ok: false,
  error: { code, message },
})

/** One open level of the nested editor. */
export interface CompoundFrame {
  /** The compound clip being edited at this level. */
  readonly compoundId: string
  /** Full path from the root document: this level's compound ids, outermost first. */
  readonly path: readonly string[]
  /** The child project as it was when this level was entered (frozen; "unchanged" is measured against it). */
  readonly base: Project
  /** The working copy. Starts as the same object as `base` and is REPLACED, never mutated. */
  readonly draft: Project
}

export interface CompoundSession {
  /** Open levels, outermost first. Empty means the root document is being edited. */
  readonly frames: readonly CompoundFrame[]
}

/** A session editing the root document. */
export const rootSession = (): CompoundSession => ({ frames: [] })

/** The project the UI should be showing: the open draft, or the root. */
export function currentProject(session: CompoundSession, project: Project): Project {
  return session.frames.length ? session.frames[session.frames.length - 1]!.draft : project
}

/** True while a compound is open. */
export const isEditingCompound = (session: CompoundSession): boolean => session.frames.length > 0

/** The open compound ids, outermost first. Empty at the root. */
export const compoundPath = (session: CompoundSession): readonly string[] =>
  session.frames.map((f) => f.compoundId)

/** Find a clip by id anywhere in one project's tracks. */
function findClipIn(project: Project, clipId: string): Clip | null {
  for (const list of Object.values(project.clips)) {
    for (const clip of list) if (clip.id === clipId) return clip
  }
  return null
}

/**
 * The child project at `path`, or `null` if the path does not exist. Walks from the root every time instead of
 * searching for the leaf id, so duplicate ids under different parents stay distinct.
 */
export function resolveCompoundPath(project: Project, path: readonly string[]): Project | null {
  let current = project
  for (const compoundId of path) {
    const clip = findClipIn(current, compoundId)
    if (!clip || clip.type !== 'compound' || !clip.compound) return null
    current = clip.compound.project
  }
  return current
}

/** The clip a Edit-contents action should open, or null (a guard rather than a cast). */
export function compoundForClip(clip: Clip | null | undefined): Clip | null {
  if (!clip || clip.type !== 'compound' || !clip.compound) return null
  return clip
}

/**
 * Open the compound `compoundId` for editing, pushing a level. Searches the project currently being edited, so
 * entering a nested compound works from inside its parent. Refuses a non-compound, a missing id, and a level
 * beyond `MAX_COMPOUND_DEPTH` (the same ceiling the engine enforces).
 */
export function enterCompound(
  session: CompoundSession,
  project: Project,
  compoundId: string,
): CompoundNavResult<CompoundSession> {
  if (session.frames.length >= MAX_COMPOUND_DEPTH) {
    return refuse('too-deep', `compounds cannot nest more than ${MAX_COMPOUND_DEPTH} deep`)
  }
  const here = currentProject(session, project)
  const clip = findClipIn(here, compoundId)
  if (!clip) return refuse('clip-not-found', `No clip "${compoundId}" in this timeline`)
  if (clip.type !== 'compound' || !clip.compound) {
    return refuse('not-a-compound', 'Only a compound clip can be opened')
  }
  const child = clip.compound.project
  return {
    ok: true,
    data: {
      frames: [
        ...session.frames,
        { compoundId, path: [...compoundPath(session), compoundId], base: child, draft: child },
      ],
    },
  }
}

/**
 * Replace the open draft. Pass a project, or a function of the current draft. Returns the session unchanged when
 * nothing is open or the draft is the same object.
 */
export function editCompoundDraft(
  session: CompoundSession,
  next: Project | ((draft: Project) => Project),
): CompoundSession {
  if (!session.frames.length) return session
  const top = session.frames[session.frames.length - 1]!
  const draft = typeof next === 'function' ? next(top.draft) : next
  if (draft === top.draft) return session
  return { frames: [...session.frames.slice(0, -1), { ...top, draft }] }
}

/**
 * `project` with the compound at `path` re-parented to hold `child`. Returns null if the path does not name a
 * compound. Everything not on the path is carried over by reference.
 */
function withChildReplaced(project: Project, path: readonly string[], child: Project): Project | null {
  if (!path.length) return child
  const [head, ...rest] = path
  for (const [trackId, list] of Object.entries(project.clips)) {
    const index = list.findIndex((c) => c.id === head)
    if (index === -1) continue
    const clip = list[index]!
    if (clip.type !== 'compound' || !clip.compound) return null
    const nextChild = rest.length ? withChildReplaced(clip.compound.project, rest, child) : child
    if (!nextChild) return null
    const next = [...list]
    next[index] = { ...clip, compound: { project: nextChild } }
    return { ...project, clips: { ...project.clips, [trackId]: next } }
  }
  return null
}

/** Leave the open compound, discarding the draft: a pop, because nothing was ever written. */
export function cancelCompound(session: CompoundSession): CompoundSession {
  if (!session.frames.length) return session
  return { frames: session.frames.slice(0, -1) }
}

export interface CompoundSaveOutcome {
  /** The session after leaving this level. */
  readonly session: CompoundSession
  /** True when the draft reached the root engine (one commit, one undo step); false when folded into the parent. */
  readonly committed: boolean
}

/**
 * Leave the open compound, committing the draft. The outermost level commits to the engine with `expectedChild`
 * set to the child as it was entered; a deeper level folds into the parent frame's draft and waits.
 */
export function saveCompound(
  session: CompoundSession,
  engine: TimelineEngine,
): CompoundNavResult<CompoundSaveOutcome> {
  if (!session.frames.length) return refuse('not-editing', 'No compound is open')
  const top = session.frames[session.frames.length - 1]!
  const left = cancelCompound(session)

  if (top.draft === top.base) {
    // Entered and left without touching anything: no commit, no undo entry.
    return { ok: true, data: { session: left, committed: false } }
  }

  if (session.frames.length > 1) {
    // A frame's draft is the project AT that compound, so the level below is a direct child of it.
    const parent = session.frames[session.frames.length - 2]!
    const folded = withChildReplaced(parent.draft, [top.compoundId], top.draft)
    if (!folded) {
      return refuse('clip-not-found', `"${top.compoundId}" is no longer in the compound being edited`)
    }
    // The parent's `base` stays as it was: it is what the engine will still expect at the final commit.
    const frames = [...left.frames.slice(0, -1), { ...parent, draft: folded }]
    return { ok: true, data: { session: { frames }, committed: false } }
  }

  const result = engine.updateCompoundProject(top.compoundId, top.draft, { expectedChild: top.base })
  if (!result.ok) {
    const code = result.error.code as CompoundNavCode
    return {
      ok: false,
      error: { code, message: code === 'stale-child' ? STALE_CHILD_MESSAGE : result.error.message },
    }
  }
  return { ok: true, data: { session: left, committed: true } }
}

/** True when any open level holds a draft that differs from what it was entered with. */
export function hasUnsavedDraft(session: CompoundSession): boolean {
  return session.frames.some((frame) => frame.draft !== frame.base)
}

/**
 * Leave levels until `depth` remain, folding each one's draft into its parent. A breadcrumb jump goes through
 * this, so navigating up never loses an edit. `depth` must be at least 1: reaching the root is `commitAll`.
 */
export function foldTo(
  session: CompoundSession,
  engine: TimelineEngine,
  depth: number,
): CompoundNavResult<CompoundSession> {
  if (depth < 1) return refuse('not-editing', 'Folding stops at the outermost level; use commitAll to save')
  let current = session
  while (current.frames.length > depth) {
    // Every step here has a parent level, so saveCompound folds and never reaches the engine.
    const step = saveCompound(current, engine)
    if (!step.ok) return step
    current = step.data.session
  }
  return { ok: true, data: current }
}

/**
 * Save every open level, innermost first, ending with ONE commit to the root engine. When nothing was changed
 * anywhere, nothing is committed. On a refusal the session reached so far is returned with the error.
 */
export function commitAll(
  session: CompoundSession,
  engine: TimelineEngine,
):
  | { ok: true; committed: boolean }
  | { ok: false; error: { code: CompoundNavCode; message: string }; session: CompoundSession } {
  let current = session
  let committed = false
  while (current.frames.length > 0) {
    const step = saveCompound(current, engine)
    if (!step.ok) return { ok: false, error: step.error, session: current }
    committed = committed || step.data.committed
    current = step.data.session
  }
  return { ok: true, committed }
}
