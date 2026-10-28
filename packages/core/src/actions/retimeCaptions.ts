/**
 * Captions follow a speed change on the clip they were made from (AGN-P8).
 *
 * Captions are text clips holding `words[]` in clip-local frames, linked to
 * their source through `Clip.linkId`. A speed change scales the source's
 * length by some factor; the captions scale by the SAME factor, measured from
 * the source's start, so they stay on the same source moment.
 *
 * The factor is the source clip's ACTUAL length ratio, not the speed ratio:
 * `TimelineEngine.setClipSpeed` clamps a slow-down that would run into the
 * next clip, and captions scaled by the speed ratio would then run past the
 * end of their own source.
 *
 * `planCaptionRetime` is the one place the maths lives. `TimelineEngine.
 * setClipSpeed` applies the plan inside its own commit (one undo entry with
 * the speed change); `retimeCaptions` applies it through the engine for
 * callers that changed a source some other way. Neither ever throws on a
 * collision: a caption that cannot move is skipped and left where it is.
 */

import type { TimelineEngine } from '../editor/TimelineEngine'
import type { CaptionWord, Clip } from '../types'
import { findOverlaps } from '../utils/frames'

/** The source clip's timing before the change. */
export interface RetimePrev {
  speed: number
  sourceStartFrame: number
  durationFrames: number
}

export interface CaptionRetimePatch {
  clipId: string
  trackId: string
  startFrame: number
  durationFrames: number
  words: CaptionWord[]
}

export interface CaptionRetimePlan {
  patches: CaptionRetimePatch[]
  /** Captions that could not move (they would overlap a neighbour) and were left as they are. */
  skipped: string[]
}

function scaleWords(words: ReadonlyArray<CaptionWord>, scale: number, duration: number): CaptionWord[] {
  return words.map((w) => {
    const start = Math.max(0, Math.min(duration - 1, Math.round(w.start * scale)))
    const end = Math.max(start + 1, Math.min(duration, Math.round(w.end * scale)))
    return { ...w, start, end }
  })
}

/**
 * Pure plan for re-timing `captions` (members of one link group; anything that
 * is not a `type:'text'` clip with `words` is ignored) by `scale`.
 *
 * `source` is the source's geometry BEFORE the change; `newSourceEnd` is where
 * it ends AFTER. `trackClips` reads the clips currently on a track (the plan
 * itself simulates its own earlier moves). A caption never ends past
 * `newSourceEnd` when it did not end past the old source end.
 */
export function planCaptionRetime(
  captions: ReadonlyArray<Clip>,
  source: { startFrame: number; durationFrames: number },
  scale: number,
  newSourceEnd: number,
  trackClips: (trackId: string) => ReadonlyArray<Clip>,
): CaptionRetimePlan {
  const patches: CaptionRetimePatch[] = []
  const skipped: string[] = []
  if (!(scale > 0) || scale === 1) return { patches, skipped }

  const oldSourceEnd = source.startFrame + source.durationFrames
  const eligible = captions.filter((c) => c.type === 'text' && c.words && c.words.length > 0)
  // Growing stretches later captions away from the source; go last-first so a
  // caption never lands on its not-yet-moved neighbour. Shrinking goes first-first.
  eligible.sort((a, b) => (scale > 1 ? b.startFrame - a.startFrame : a.startFrame - b.startFrame))

  const moved = new Map<string, Clip>()
  for (const cap of eligible) {
    const startFrame = Math.max(0, source.startFrame + Math.round((cap.startFrame - source.startFrame) * scale))
    let durationFrames = Math.max(1, Math.round(cap.durationFrames * scale))
    if (cap.startFrame + cap.durationFrames <= oldSourceEnd && startFrame < newSourceEnd) {
      durationFrames = Math.max(1, Math.min(durationFrames, newSourceEnd - startFrame))
    }
    const others = trackClips(cap.trackId).map((c) => moved.get(c.id) ?? c)
    if (findOverlaps(others, { startFrame, durationFrames }, cap.id).length > 0) {
      skipped.push(cap.id)
      continue
    }
    moved.set(cap.id, { ...cap, startFrame, durationFrames })
    patches.push({
      clipId: cap.id,
      trackId: cap.trackId,
      startFrame,
      durationFrames,
      words: scaleWords(cap.words!, scale, durationFrames),
    })
  }
  return { patches, skipped }
}

/**
 * Re-time every caption in the source's link group after the source clip's
 * length changed from `prev.durationFrames` to what it is now. One batch, one
 * undo. Captions without `words`, other link members and the source itself are
 * not touched; a caption that would collide is skipped (returned in `skipped`).
 */
export function retimeCaptions(
  engine: TimelineEngine,
  sourceClipId: string,
  prev: RetimePrev,
): { retimed: string[]; skipped: string[] } {
  const found = engine.findClip(sourceClipId)
  if (!found || !found.clip.linkId || !(prev.durationFrames > 0)) return { retimed: [], skipped: [] }
  const source = found.clip
  const scale = source.durationFrames / prev.durationFrames
  const captions = engine.getLinked(sourceClipId).filter((c) => c.id !== sourceClipId)
  const plan = planCaptionRetime(
    captions,
    { startFrame: source.startFrame, durationFrames: prev.durationFrames },
    scale,
    source.startFrame + source.durationFrames,
    (trackId) => engine.getClipsOnTrack(trackId),
  )
  if (plan.patches.length === 0) return { retimed: [], skipped: plan.skipped }
  engine.batch(() => {
    for (const p of plan.patches) {
      engine.updateClip(p.clipId, p.trackId, {
        startFrame: p.startFrame,
        durationFrames: p.durationFrames,
        words: p.words,
      })
    }
  }, 'Retime captions')
  return { retimed: plan.patches.map((p) => p.clipId), skipped: plan.skipped }
}
