import { current, isDraft, type Draft } from 'immer'
import type { Clip, ClipKeyframes, Project } from '../types'
import { remapKeyframes } from '../resolver/keyframes'
import { splitClip } from './split'

/**
 * Clearing and opening room on one track (PV-T1): the two ways a clip can
 * land where another already sits. Both work on an Immer draft so a caller
 * composes them into ONE commit; neither prunes transitions — the caller does
 * that once, after everything has moved.
 */

/** Clips with no source media: they have no trim window to keep aligned. */
const SOURCELESS: ReadonlySet<Clip['type']> = new Set(['text', 'image', 'shape', 'freehand', 'adjustment', 'generator', 'sequence'])

function plainKeyframes(kf: ClipKeyframes | Draft<ClipKeyframes>): ClipKeyframes {
  return (isDraft(kf) ? current(kf) : kf) as ClipKeyframes
}

/**
 * Move a clip's left edge right to `newStart`, keeping the picture where it
 * was — the same bookkeeping `TimelineEngine.trimClip` does for a left trim:
 * the source window advances by the frames removed and keyframes, which are
 * counted from the clip's start, shift back by the same amount.
 */
function trimHeadTo(clip: Draft<Clip>, newStart: number): void {
  const delta = newStart - clip.startFrame
  if (delta <= 0) return
  const speed = clip.speed ?? 1
  clip.startFrame = newStart
  clip.durationFrames = Math.max(1, clip.durationFrames - delta)
  if (!SOURCELESS.has(clip.type)) {
    clip.sourceStartFrame = Math.max(0, clip.sourceStartFrame + Math.round(delta * speed))
  }
  if (clip.keyframes) {
    clip.keyframes = remapKeyframes(plainKeyframes(clip.keyframes), { shift: -delta }) as Draft<ClipKeyframes> | undefined
  }
}

/**
 * Clear `[start, end)` on a track, as an overwrite edit does: a clip wholly
 * inside is removed, a clip overlapping one edge is trimmed back to it (the
 * surviving part keeps its id), and a clip spanning the whole range is split
 * so its head and tail survive around the hole.
 */
export function overwriteRange(draft: Draft<Project>, trackId: string, start: number, end: number): void {
  const list = draft.clips[trackId]
  if (!list || end <= start) return

  const hits = list
    .filter((c) => c.startFrame < end && c.startFrame + c.durationFrames > start)
    .map((c) => c.id)

  for (const id of hits) {
    const idx = list.findIndex((c) => c.id === id)
    if (idx === -1) continue
    const clip = list[idx]!
    const clipEnd = clip.startFrame + clip.durationFrames

    if (clip.startFrame >= start && clipEnd <= end) {
      list.splice(idx, 1)
    } else if (clip.startFrame < start && clipEnd > end) {
      // The split keeps the head's id and gives the tail a new one; the head
      // is then cut back to the start of the range.
      splitClip(draft, id, trackId, end)
      clip.durationFrames = start - clip.startFrame
    } else if (clip.startFrame < start) {
      clip.durationFrames = start - clip.startFrame
    } else {
      trimHeadTo(clip, end)
    }
  }

  list.sort((a, b) => a.startFrame - b.startFrame)
}

/**
 * Open `length` frames at `at` on a track, as an insert edit does: a clip
 * straddling `at` is split there, and every clip starting at or after `at`
 * moves right by `length`. Transitions ride with their incoming clip, as
 * `TimelineEngine.shiftClips` does; the caller prunes the ones a split or a
 * shift has left without an adjacent pair.
 */
export function insertGap(draft: Draft<Project>, trackId: string, at: number, length: number): void {
  const list = draft.clips[trackId]
  if (!list || length <= 0) return

  const straddler = list.find((c) => c.startFrame < at && c.startFrame + c.durationFrames > at)
  if (straddler) splitClip(draft, straddler.id, trackId, at)

  const shifted = new Set<string>()
  for (const clip of list) {
    if (clip.startFrame >= at) {
      clip.startFrame += length
      shifted.add(clip.id)
    }
  }
  for (const t of draft.transitions) {
    if (shifted.has(t.toClipId)) t.startFrame += length
  }
  list.sort((a, b) => a.startFrame - b.startFrame)
}
