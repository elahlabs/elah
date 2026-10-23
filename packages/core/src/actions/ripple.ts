/**
 * Ripple edits (EDX-P5): delete or trim, then close the gap on the same track.
 *
 * Pure over the engine: the caller passes the clip ids and the frame, so the
 * keyboard handler, the tool row and an agent op can share them. Each action
 * is one undo step (one `engine.batch`) and returns a reason instead of
 * throwing when it cannot run.
 */

import type { Clip } from '../types'
import type { TimelineEngine } from '../editor/TimelineEngine'
import { remapKeyframes } from '../resolver/keyframes'
import { sourceFramesAvailable } from '../resolver/sourceTime'
import type { ActionResult } from './types'

/** Thrown inside a batch to roll it back; never escapes this module. */
class RippleRejected extends Error {}

export interface RippleDeleteData {
  removed: number
  shifted: number
}

/**
 * Remove the clips and pull every later clip on each affected track left by
 * the removed length before it. Other tracks are untouched (no linked
 * ripple in v1).
 */
export function rippleDelete(
  engine: TimelineEngine,
  clipIds: Iterable<string>,
): ActionResult<RippleDeleteData> {
  const removed: { clip: Clip; trackId: string }[] = []
  for (const id of new Set(clipIds)) {
    const found = engine.findClip(id)
    if (!found) return { ok: false, reason: 'clip-not-found' }
    if (engine.isTrackLocked(found.trackId)) return { ok: false, reason: 'track-locked' }
    removed.push(found)
  }
  if (removed.length === 0) return { ok: false, reason: 'no-selection' }

  const removedIds = new Set(removed.map((r) => r.clip.id))
  const moves: { clipId: string; trackId: string; delta: number }[] = []
  for (const trackId of new Set(removed.map((r) => r.trackId))) {
    const gone = removed.filter((r) => r.trackId === trackId).map((r) => r.clip)
    for (const c of engine.getClipsOnTrack(trackId)) {
      if (removedIds.has(c.id)) continue
      const delta = -gone
        .filter((g) => g.startFrame < c.startFrame)
        .reduce((sum, g) => sum + g.durationFrames, 0)
      if (delta !== 0) moves.push({ clipId: c.id, trackId, delta })
    }
  }

  // `batch` rolls every partial change back when the recipe throws.
  try {
    engine.batch(() => {
      for (const r of removed) engine.removeClip(r.clip.id, r.trackId)
      if (!engine.shiftClips(moves)) throw new RippleRejected()
    }, 'Ripple delete')
  } catch (err) {
    if (err instanceof RippleRejected) return { ok: false, reason: 'engine-rejected' }
    throw err
  }
  return { ok: true, data: { removed: removed.length, shifted: moves.length } }
}

export type RippleEdge = 'start' | 'end'

/**
 * Trim one edge of a clip to `frame` and close the gap: trimming the start
 * keeps the clip's position (later clips follow it left); trimming the end
 * pulls later clips left. `frame` must be strictly inside the clip.
 */
export function rippleTrim(
  engine: TimelineEngine,
  clipId: string,
  edge: RippleEdge,
  frame: number,
): ActionResult<{ removedFrames: number }> {
  const found = engine.findClip(clipId)
  if (!found) return { ok: false, reason: 'clip-not-found' }
  const { clip, trackId } = found
  if (engine.isTrackLocked(trackId)) return { ok: false, reason: 'track-locked' }
  const f = Math.round(frame)
  const end = clip.startFrame + clip.durationFrames
  if (!(f > clip.startFrame && f < end)) return { ok: false, reason: 'playhead-outside-clip' }

  const removedFrames = edge === 'start' ? f - clip.startFrame : end - f
  const later = engine.getClipsOnTrack(trackId).filter((c) => c.startFrame >= end)

  try {
    engine.batch(() => {
      if (edge === 'start') {
        engine.trimClip(clip.id, trackId, f, end - f)
      } else {
        engine.trimClip(clip.id, trackId, clip.startFrame, f - clip.startFrame)
      }
      const trimmed = engine.findClip(clip.id)?.clip
      const expected = edge === 'start' ? f : clip.startFrame
      const expectedDuration = clip.durationFrames - removedFrames
      if (!trimmed || trimmed.startFrame !== expected || trimmed.durationFrames !== expectedDuration) {
        throw new RippleRejected()
      }
      const moves = [
        ...(edge === 'start' ? [{ clipId: clip.id, trackId, delta: -removedFrames }] : []),
        ...later.map((c) => ({ clipId: c.id, trackId, delta: -removedFrames })),
      ]
      if (!engine.shiftClips(moves)) throw new RippleRejected()
    }, edge === 'start' ? 'Ripple trim start' : 'Ripple trim end')
  } catch (err) {
    if (err instanceof RippleRejected) return { ok: false, reason: 'engine-rejected' }
    throw err
  }
  return { ok: true, data: { removedFrames } }
}

/** Clip types with no source media: they grow and shrink freely. */
const SOURCELESS: ReadonlySet<Clip['type']> = new Set(['text', 'image', 'shape', 'freehand', 'adjustment', 'generator'])

interface EdgeMember {
  clip: Clip
  trackId: string
  /** Timeline frames added (+) or removed (−) by this edit. */
  delta: number
  /** Frames cut off the head; negative grows it. 0 for an end-edge edit. */
  headCut: number
  /** Clips on the same track at or after this member's old end. */
  later: Clip[]
}

export interface RippleEdgeTrimData {
  /** The change actually made, in timeline frames. */
  delta: number
}

/**
 * Ripple one edge by dragging (PV-T5-2).
 *
 * Unlike `rippleTrim` above — the Q/W shortcut, which only ever removes frames
 * — the edge here may grow or shrink. An end-edge edit moves the out-point to
 * `frame`. A start-edge edit keeps the clip where it is and moves its in-point
 * by `frame − startFrame`, which is Premiere's ripple on an in-point: the
 * clip's neighbours follow its length, not its position.
 *
 * `partners` are linked clips (the audio half of a linked A/V pair) whose same
 * edge already sits on the same frame. They get the same change on their own
 * tracks, which is what makes a linked pair behave as one thing.
 *
 * One undo step, and a reason instead of a throw when it cannot run.
 */
export function rippleEdgeTrim(
  engine: TimelineEngine,
  clipId: string,
  edge: RippleEdge,
  frame: number,
  partners: ReadonlyArray<string> = [],
): ActionResult<RippleEdgeTrimData> {
  const lead = engine.findClip(clipId)
  if (!lead) return { ok: false, reason: 'clip-not-found' }

  const members: EdgeMember[] = []
  for (const id of [clipId, ...partners]) {
    const found = engine.findClip(id)
    if (!found) return { ok: false, reason: 'clip-not-found' }
    if (engine.isTrackLocked(found.trackId)) return { ok: false, reason: 'track-locked' }
    const planned = planMember(engine, found.clip, found.trackId, edge, Math.round(frame))
    if (!planned.ok) return { ok: false, reason: planned.reason }
    members.push(planned.member)
  }
  // The members share the edge frame, so they must agree on the change. If they
  // do not, something moved under us between the preview and the release.
  if (members.some((m) => m.delta !== members[0]!.delta)) return { ok: false, reason: 'engine-rejected' }
  const delta = members[0]!.delta
  if (delta === 0) return { ok: true, data: { delta: 0 } }

  const memberIds = new Set(members.map((m) => m.clip.id))
  try {
    engine.batch(() => {
      // Growing must shift BEFORE resizing: `shiftClips` validates the final
      // layout, so a resize that already overlaps the next clip is refused.
      if (delta > 0) shiftLater(engine, members, memberIds, delta)
      for (const m of members) {
        if (edge === 'end') {
          engine.trimClip(m.clip.id, m.trackId, m.clip.startFrame, m.clip.durationFrames + delta)
          const after = engine.findClip(m.clip.id)?.clip
          // trimClip refuses an overlap silently, so the result is checked.
          if (!after || after.durationFrames !== m.clip.durationFrames + delta) throw new RippleRejected()
        } else {
          const speed = m.clip.speed ?? 1
          const keyframes =
            m.clip.keyframes && m.headCut !== 0
              ? remapKeyframes(m.clip.keyframes, { shift: -m.headCut })
              : undefined
          engine.updateClip(m.clip.id, m.trackId, {
            durationFrames: m.clip.durationFrames - m.headCut,
            ...(SOURCELESS.has(m.clip.type)
              ? {}
              : { sourceStartFrame: Math.max(0, m.clip.sourceStartFrame + Math.round(m.headCut * speed)) }),
            ...(keyframes ? { keyframes } : {}),
          })
        }
      }
      if (delta < 0) shiftLater(engine, members, memberIds, delta)
    }, edge === 'start' ? 'Ripple trim start' : 'Ripple trim end')
  } catch (err) {
    if (err instanceof RippleRejected) return { ok: false, reason: 'engine-rejected' }
    throw err
  }
  return { ok: true, data: { delta } }
}

/** What one clip would do, and which clips follow it. Never mutates. */
function planMember(
  engine: TimelineEngine,
  clip: Clip,
  trackId: string,
  edge: RippleEdge,
  frame: number,
): { ok: true; member: EdgeMember } | { ok: false; reason: 'media-limit' | 'engine-rejected' } {
  const speed = clip.speed ?? 1
  const media = !SOURCELESS.has(clip.type)
  const end = clip.startFrame + clip.durationFrames
  const headCut = edge === 'start' ? frame - clip.startFrame : 0
  const delta = edge === 'start' ? -headCut : frame - end
  const at = (reason: 'media-limit' | 'engine-rejected') => ({ ok: false as const, reason })

  if (clip.durationFrames + delta < 1) return at('engine-rejected')
  if (edge === 'start') {
    // The head cannot come off before the media does.
    if (media && headCut < -Math.floor(clip.sourceStartFrame / speed)) return at('media-limit')
  } else if (media) {
    const maxDuration = Math.floor(sourceFramesAvailable(clip) / speed)
    if (clip.durationFrames + delta > maxDuration) return at('media-limit')
  }

  return {
    ok: true,
    member: {
      clip,
      trackId,
      delta,
      headCut,
      later: engine.getClipsOnTrack(trackId).filter((c) => c.startFrame >= end && c.id !== clip.id),
    },
  }
}

function shiftLater(engine: TimelineEngine, members: EdgeMember[], memberIds: ReadonlySet<string>, delta: number): void {
  const moves = members.flatMap((m) =>
    m.later
      .filter((c) => !memberIds.has(c.id))
      .map((c) => ({ clipId: c.id, trackId: m.trackId, delta })),
  )
  if (moves.length > 0 && !engine.shiftClips(moves)) throw new RippleRejected()
}
