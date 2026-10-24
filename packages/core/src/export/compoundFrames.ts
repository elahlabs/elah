/**
 * Every clip occurrence an export has to prepare, and which source frame each
 * one needs at a given output frame (PV-P1b-1).
 *
 * A compound makes the export's "one canvas per clip id" assumption false. Two
 * occurrences of the same nested clip can be on screen at different nested
 * frames, and the same nested clip id can appear in two different compounds. So
 * everything downstream is keyed by OCCURRENCE — the chain of clip ids from the
 * root to the clip — and the key is `JSON.stringify` of that chain, because a
 * joined string collides the moment an id contains the separator.
 *
 * Pure and DOM-free: this walks documents and asks the same `sourceFrameFor` the
 * resolver asks, so the export and the preview agree on which nested frame a
 * parent frame shows. No canvas, no decode, no await — the caller prepares
 * frames with the keys from here and paints with them afterwards.
 */

import { MAX_COMPOUND_DEPTH, type Clip, type Project } from '../types'
import { sourceFrameFor } from '../resolver/sourceTime'

/** One clip, and where in the document it sits. */
export interface ClipOccurrence {
  clip: Clip
  /** Ancestor clip ids, outermost first, ending with this clip's own id. */
  path: string[]
  /** `JSON.stringify(path)`. The identity of this occurrence, everywhere below. */
  key: string
}

/** A track is a map from id to the clips on it; clips on no known track are skipped. */
function clipsOnTracks(project: Project, enabledTrackIds: ReadonlySet<string>): Clip[] {
  const out: Clip[] = []
  for (const track of project.tracks) {
    if (!enabledTrackIds.has(track.id)) continue
    for (const clip of project.clips[track.id] ?? []) out.push(clip)
  }
  return out
}

/**
 * Tracks whose clips can be on screen at all.
 *
 * A disabled track never draws, so its clips are never decoded. Solo is
 * deliberately NOT evaluated: a solo'd-out clip being decoded costs one frame of
 * work, while a clip wrongly excluded would paint black — so this over-collects
 * on purpose rather than under-collecting.
 */
function enabledTracks(project: Project): Set<string> {
  return new Set(project.tracks.filter((t) => !t.disabled).map((t) => t.id))
}

/** Whether `clip` can be on screen at all: not disabled. */
function isDrawable(clip: Clip): boolean {
  return !clip.disabled
}

/** Whether `clip` is inside its own active window on `project`'s timeline. */
function isActiveAt(clip: Clip, frame: number): boolean {
  if (!isDrawable(clip)) return false
  return frame >= clip.startFrame && frame < clip.startFrame + clip.durationFrames
}

/**
 * Every clip occurrence in `project`, depth-first, compounds expanded.
 *
 * The root's own clips come first in track order, and a compound's nested clips
 * immediately after the compound itself, so the list reads like the document.
 * Nesting stops at {@link MAX_COMPOUND_DEPTH}: a compound deeper than the reader
 * allows contributes no children, exactly as the resolver draws nothing there.
 */
export function collectClips(project: Project): ClipOccurrence[] {
  const out: ClipOccurrence[] = []
  walk(project, [], 0, out)
  return out
}

function walk(project: Project, parentPath: string[], depth: number, out: ClipOccurrence[]): void {
  const tracks = enabledTracks(project)
  for (const clip of clipsOnTracks(project, tracks)) {
    // A disabled clip is never drawn, so it is not an occurrence anything
    // downstream has to prepare. Skipping it here keeps the inventory and
    // `compoundSourceFrames` describing the same set of clips.
    if (!isDrawable(clip)) continue
    const path = [...parentPath, clip.id]
    out.push({ clip, path, key: JSON.stringify(path) })
    if (clip.type !== 'compound' || !clip.compound) continue
    // The reader refuses a document nested deeper than this, and the resolver
    // draws nothing there; walking further would decode frames nobody sees.
    if (depth >= MAX_COMPOUND_DEPTH) continue
    walk(clip.compound.project, path, depth + 1, out)
  }
}

/**
 * Which source frame each ACTIVE occurrence needs at output `frame`, keyed by
 * occurrence key.
 *
 * The recursion is the resolver's: a compound's own source frame IS the nested
 * timeline's frame, so its children are asked about that frame rather than the
 * output frame. A clip that is not active at its level is absent from the map,
 * which is what lets the caller skip decoding it.
 */
export function compoundSourceFrames(project: Project, frame: number): Map<string, number> {
  const out = new Map<string, number>()
  collectActive(project, [], 0, frame, out)
  return out
}

function collectActive(
  project: Project,
  parentPath: string[],
  depth: number,
  frame: number,
  out: Map<string, number>,
): void {
  const tracks = enabledTracks(project)
  for (const clip of clipsOnTracks(project, tracks)) {
    if (!isActiveAt(clip, frame)) continue
    const path = [...parentPath, clip.id]
    const key = JSON.stringify(path)
    // The source frame at THIS level. For a compound it is the nested frame.
    out.set(key, sourceFrameFor(clip, frame))
    if (clip.type !== 'compound' || !clip.compound) continue
    if (depth >= MAX_COMPOUND_DEPTH) continue
    collectActive(clip.compound.project, path, depth + 1, out.get(key)!, out)
  }
}

/** The occurrence key for a clip id at a known path — the same string the walk builds. */
export function occurrenceKey(path: ReadonlyArray<string>): string {
  return JSON.stringify(path)
}
