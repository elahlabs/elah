/**
 * Clip paths for ops (EG-P4): walk `'compoundId/childId'` through a project's
 * nested compounds and rewrite one clip inside, immutably.
 *
 * `composition/instantiate.ts` has a private walker of its own; this one also
 * reports the child's track (so a locked lane is honoured) and can rewrite.
 * Pure: no engine, no mutation of the input.
 */

import type { Clip, Project } from '../types'

export type LocatedClip =
  | { ok: true; clip: Clip; trackId: string; locked: boolean }
  | { ok: false; reason: string }

/** Find the clip a path names, walking one compound per extra segment. */
export function locateClip(project: Pick<Project, 'clips' | 'tracks'>, segs: readonly string[]): LocatedClip {
  let p: Pick<Project, 'clips' | 'tracks'> = project
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!
    let found: Clip | undefined
    let trackId = ''
    for (const [tid, list] of Object.entries(p.clips)) {
      found = list.find((c) => c.id === seg)
      if (found) {
        trackId = tid
        break
      }
    }
    if (!found) return { ok: false, reason: `no clip "${seg}"` }
    if (i === segs.length - 1) {
      const track = p.tracks?.find((t) => t.id === trackId)
      return { ok: true, clip: found, trackId, locked: !!(track?.locked || track?.disabled) }
    }
    if (found.type !== 'compound' || !found.compound?.project) return { ok: false, reason: `"${seg}" is not a compound` }
    p = found.compound.project
  }
  return { ok: false, reason: 'empty path' }
}

/** `clip` with `patch` applied; a key whose value is `undefined` is removed, not left behind. */
export function applyPatch(clip: Clip, patch: Partial<Clip>): Clip {
  const next: Record<string, unknown> = { ...clip }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k]
    else next[k] = v
  }
  return next as unknown as Clip
}

/**
 * A copy of `project` in which the clip at `segs` (relative to `project`) has
 * `patch` applied. Every other clip, and every other field of the clip and of
 * each compound on the way down, is carried over untouched. `null` when the
 * path does not resolve.
 */
export function patchClipAtPath(project: Project, segs: readonly string[], patch: Partial<Clip>): Project | null {
  const [head, ...rest] = segs
  if (head === undefined) return null
  for (const [tid, list] of Object.entries(project.clips)) {
    const i = list.findIndex((c) => c.id === head)
    if (i < 0) continue
    const clip = list[i]!
    let replaced: Clip
    if (rest.length === 0) {
      replaced = applyPatch(clip, patch)
    } else {
      if (clip.type !== 'compound' || !clip.compound?.project) return null
      const inner = patchClipAtPath(clip.compound.project, rest, patch)
      if (!inner) return null
      replaced = { ...clip, compound: { ...clip.compound, project: inner } }
    }
    return { ...project, clips: { ...project.clips, [tid]: list.map((c, j) => (j === i ? replaced : c)) } }
  }
  return null
}
