/**
 * Edits that behave differently on the magnetic main track (PV-T1).
 *
 * In free mode each function is exactly the engine call the timeline and the
 * op layer made before modes existed. On the magnetic main track they keep
 * the track gapless the way CapCut and Final Cut do: removing closes the gap,
 * moving lifts the clip and inserts it at a cut, trimming keeps the clip's
 * start and ripples by the change in length. Overlay clips downstream move
 * with the main track; overlays starting inside a moved clip ride with it.
 *
 * Every function is one undo step and returns a reason instead of throwing.
 */

import type { Clip, ClipKeyframes, Project } from '../types'
import type { TimelineEngine } from '../editor/TimelineEngine'
import { remapKeyframes } from '../resolver/keyframes'
import { sourceFramesAvailable } from '../resolver/sourceTime'
import { toFrame } from '../utils/frames'
import type { ActionResult } from './types'

/** Thrown inside a batch to roll it back; never escapes this module. */
class Rejected extends Error {
  constructor(readonly reason: 'engine-rejected' | 'media-limit') {
    super(reason)
  }
}

/** Clips with no source media: they have no trim window to keep aligned. */
const SOURCELESS: ReadonlySet<Clip['type']> = new Set(['text', 'image', 'shape', 'freehand', 'adjustment', 'generator', 'sequence'])

/**
 * The magnetic main track: the video track with `role: 'main'`, else the
 * topmost video lane (order 0 side, the bottom compositing layer). Undefined
 * in free mode — the main track only means something when the project is
 * magnetic, so a stray role left on a free project changes nothing.
 */
export function resolveMainTrackId(project: Pick<Project, 'tracks' | 'timelineMode'>): string | undefined {
  if (project.timelineMode !== 'magnetic') return undefined
  const videos = project.tracks.filter((t) => t.kind === 'video')
  const marked = videos.find((t) => t.role === 'main')
  if (marked) return marked.id
  return [...videos].sort((a, b) => a.order - b.order)[0]?.id
}

/** Whether edits on `trackId` follow the magnetic rules. */
export function isMagneticMain(project: Pick<Project, 'tracks' | 'timelineMode'>, trackId: string): boolean {
  return resolveMainTrackId(project) === trackId
}

/**
 * The cut on a track nearest to `frame`: the starts and ends of its clips,
 * and frame 0. Clips in `excludeIds` are treated as absent. Ties go to the
 * earlier cut.
 */
export function nearestCut(
  clips: ReadonlyArray<Pick<Clip, 'id' | 'startFrame' | 'durationFrames'>>,
  frame: number,
  excludeIds: ReadonlySet<string> = new Set(),
): number {
  const cuts = new Set<number>([0])
  for (const c of clips) {
    if (excludeIds.has(c.id)) continue
    cuts.add(c.startFrame)
    cuts.add(c.startFrame + c.durationFrames)
  }
  let best = 0
  let bestDistance = Infinity
  for (const cut of [...cuts].sort((a, b) => a - b)) {
    const distance = Math.abs(cut - frame)
    if (distance < bestDistance) {
      best = cut
      bestDistance = distance
    }
  }
  return best
}

/**
 * Remove a clip. On the magnetic main track the gap it leaves closes, and
 * downstream overlays follow.
 */
export function removeForMode(engine: TimelineEngine, clipId: string): ActionResult<{ rippled: boolean }> {
  const found = engine.findClip(clipId)
  if (!found) return { ok: false, reason: 'clip-not-found' }
  const { clip, trackId } = found
  if (engine.isTrackLocked(trackId)) return { ok: false, reason: 'track-locked' }

  if (!isMagneticMain(engine.getProject(), trackId)) {
    engine.removeClip(clip.id, trackId)
    return { ok: true, data: { rippled: false } }
  }

  try {
    engine.batch(() => {
      engine.removeClip(clip.id, trackId)
      if (!engine.rippleMain(clip.startFrame + clip.durationFrames, -clip.durationFrames).ok) {
        throw new Rejected('engine-rejected')
      }
    }, 'Ripple delete')
  } catch (err) {
    if (err instanceof Rejected) return { ok: false, reason: err.reason }
    throw err
  }
  return { ok: true, data: { rippled: true } }
}

/**
 * Move a clip on its own track to start at `frame`. On the magnetic main
 * track the clip is lifted (the gap closes) and inserted at the cut nearest
 * `frame` in what remains; clips after the cut move right to make room.
 * Overlays that start inside the moved clip, and clips linked to it, ride
 * with it; other overlays follow the ripple. One `shiftClips`, validated
 * against the final layout; when the overlays would collide, the main track
 * reorders alone.
 */
export function moveForMode(engine: TimelineEngine, clipId: string, frame: number): ActionResult<{ startFrame: number }> {
  const found = engine.findClip(clipId)
  if (!found) return { ok: false, reason: 'clip-not-found' }
  const { clip, trackId } = found
  if (engine.isTrackLocked(trackId)) return { ok: false, reason: 'track-locked' }
  const target = toFrame(frame)
  const project = engine.getProject()

  if (!isMagneticMain(project, trackId)) {
    engine.moveClip(clip.id, trackId, trackId, target)
    const after = engine.findClip(clip.id)?.clip
    if (!after || (after.startFrame !== target && target !== clip.startFrame)) {
      return { ok: false, reason: 'engine-rejected' }
    }
    return { ok: true, data: { startFrame: after.startFrame } }
  }

  const S = clip.startFrame
  const D = clip.durationFrames
  const main = engine.getClipsOnTrack(trackId).filter((c) => c.id !== clip.id)
  // Where everything on main sits once the clip is lifted and the gap closed.
  const lifted = main.map((c) => ({ ...c, startFrame: c.startFrame >= S + D ? c.startFrame - D : c.startFrame }))
  const X = nearestCut(lifted, target)
  if (X === S) return { ok: true, data: { startFrame: S } }

  const netDelta = (z: number) => {
    const z1 = z >= S + D ? z - D : z
    const z2 = z1 >= X ? z1 + D : z1
    return z2 - z
  }
  const linked = new Set(clip.linkId ? engine.getLinked(clip.id).map((c) => c.id) : [])

  const mainMoves = [
    { clipId: clip.id, trackId, delta: X - S },
    ...main.map((c) => ({ clipId: c.id, trackId, delta: netDelta(c.startFrame) })),
  ]
  const overlayMoves: typeof mainMoves = []
  for (const track of project.tracks) {
    if (track.id === trackId || track.locked) continue
    for (const c of engine.getClipsOnTrack(track.id)) {
      const rides = linked.has(c.id) || (c.startFrame >= S && c.startFrame < S + D)
      overlayMoves.push({ clipId: c.id, trackId: track.id, delta: rides ? X - S : netDelta(c.startFrame) })
    }
  }

  const description = 'Move clip'
  if (engine.shiftClips([...mainMoves, ...overlayMoves], description) || engine.shiftClips(mainMoves, description)) {
    return { ok: true, data: { startFrame: X } }
  }
  return { ok: false, reason: 'engine-rejected' }
}

/**
 * Trim a clip to `[start, end)` as if the timeline were free. On the
 * magnetic main track the clip keeps its start — the head trim is applied to
 * the source window only, as Q does — and everything after it ripples by the
 * change in length. Extending past the media clamps to what the source has,
 * matching `TimelineEngine.trimClip`.
 */
export function trimForMode(
  engine: TimelineEngine,
  clipId: string,
  start: number,
  end: number,
): ActionResult<{ startFrame: number; durationFrames: number }> {
  const found = engine.findClip(clipId)
  if (!found) return { ok: false, reason: 'clip-not-found' }
  const { clip, trackId } = found
  if (engine.isTrackLocked(trackId)) return { ok: false, reason: 'track-locked' }
  const newStart = toFrame(start)
  const newEnd = toFrame(end)
  if (newEnd - newStart < 1) return { ok: false, reason: 'engine-rejected' }

  if (!isMagneticMain(engine.getProject(), trackId)) {
    engine.trimClip(clip.id, trackId, newStart, newEnd - newStart)
    const after = engine.findClip(clip.id)!.clip
    return { ok: true, data: { startFrame: after.startFrame, durationFrames: after.durationFrames } }
  }

  const speed = clip.speed ?? 1
  const sourceless = SOURCELESS.has(clip.type)
  // Frames taken off the head (negative = the head extends), clamped to the
  // source frames available before the clip's in-point.
  let headCut = newStart - clip.startFrame
  if (!sourceless) headCut = Math.max(headCut, -Math.floor(clip.sourceStartFrame / speed))
  // The real end of the media when the clip knows it, measured from wherever
  // the head ends up (PV-T5-1); otherwise the window, as before.
  const maxDuration = sourceless
    ? Infinity
    : Math.floor(
        sourceFramesAvailable(clip, Math.max(0, clip.sourceStartFrame + Math.round(headCut * speed))) / speed,
      )
  const duration = Math.max(1, Math.min(maxDuration, newEnd - (clip.startFrame + headCut)))
  const growth = duration - clip.durationFrames
  const oldEnd = clip.startFrame + clip.durationFrames
  if (headCut === 0 && growth === 0) return { ok: true, data: { startFrame: clip.startFrame, durationFrames: clip.durationFrames } }

  const keyframes =
    clip.keyframes && headCut !== 0 ? remapKeyframes(clip.keyframes as ClipKeyframes, { shift: -headCut }) : undefined

  try {
    engine.batch(() => {
      if (growth > 0 && !engine.rippleMain(oldEnd, growth, 'Trim clip').ok) throw new Rejected('engine-rejected')
      engine.updateClip(clip.id, trackId, {
        durationFrames: duration,
        ...(sourceless ? {} : { sourceStartFrame: Math.max(0, clip.sourceStartFrame + Math.round(headCut * speed)) }),
        ...(keyframes ? { keyframes } : {}),
      })
      if (growth < 0 && !engine.rippleMain(oldEnd, growth, 'Trim clip').ok) throw new Rejected('engine-rejected')
    }, 'Trim clip')
  } catch (err) {
    if (err instanceof Rejected) return { ok: false, reason: err.reason }
    // `updateClip` throws on overlap; the batch has already rolled back.
    if (err instanceof Error && /overlap/.test(err.message)) return { ok: false, reason: 'engine-rejected' }
    throw err
  }
  return { ok: true, data: { startFrame: clip.startFrame, durationFrames: duration } }
}
