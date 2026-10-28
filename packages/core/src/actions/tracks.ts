/**
 * Lane rules shared by every action that has to put a clip somewhere without
 * being told where: drop-to-timeline in `packages/timeline`, and the detach
 * action in this package. They live in core because core cannot import the
 * timeline package, and one rule beats two copies that drift.
 */

import type { TimelineEngine } from '../editor/TimelineEngine'
import type { Track, TrackKind } from '../types'
import { clipsOverlap } from '../utils/frames'

/** A lane a clip may go on. `created` is true when this call made it. */
export interface TrackTarget {
  ok: true
  trackId: string
  created: boolean
}

/** Every lane of the kind exists but is locked, so nothing was created. */
export interface TrackTargetRefusal {
  ok: false
  reason: 'locked'
}

/**
 * The first unlocked lane of `kind`; failing that, a new one.
 *
 * If lanes of the kind exist and every one is locked, this refuses rather than
 * creating another: a new lane would silently route around the user's lock.
 * `name` is only used for a lane this call creates (callers own naming, since
 * the label vocabulary lives in the timeline package).
 */
export function ensureTrackOfKind(
  engine: TimelineEngine,
  kind: TrackKind,
  name?: string,
): TrackTarget | TrackTargetRefusal {
  const ofKind = engine.getProject().tracks.filter((t) => t.kind === kind)
  const unlocked = ofKind.find((t) => !t.locked)
  if (unlocked) return { ok: true, trackId: unlocked.id, created: false }
  if (ofKind.length > 0) return { ok: false, reason: 'locked' }
  const track = engine.addTrack(kind, name !== undefined ? { name } : undefined)
  return { ok: true, trackId: track.id, created: true }
}

/** First unlocked video lane, else a new one. Video and image clips both go here. */
export function ensureVideoTrack(engine: TimelineEngine, name?: string): TrackTarget | TrackTargetRefusal {
  return ensureTrackOfKind(engine, 'video', name)
}

/** First unlocked audio lane, else a new one. */
export function ensureAudioTrack(engine: TimelineEngine, name?: string): TrackTarget | TrackTargetRefusal {
  return ensureTrackOfKind(engine, 'audio', name)
}

/** First unlocked elements lane, else a new one (text, shapes, drawings). */
export function ensureElementsTrack(engine: TimelineEngine, name?: string): TrackTarget | TrackTargetRefusal {
  return ensureTrackOfKind(engine, 'elements', name)
}

/**
 * The first unlocked lane of `kind` with nothing in `[startFrame, startFrame +
 * durationFrames)`, in project track order, or `undefined` when none qualifies.
 * `engine.addClip` throws on overlap, so anything placing a clip it did not
 * position itself asks this first. `excludeTrackId` skips one lane (the lane
 * the partner clip is already on).
 */
export function findFreeTrackAt(
  engine: TimelineEngine,
  kind: TrackKind,
  startFrame: number,
  durationFrames: number,
  excludeTrackId?: string,
): Track | undefined {
  const project = engine.getProject()
  const span = { startFrame, durationFrames }
  return project.tracks.find(
    (t) =>
      t.kind === kind &&
      !t.locked &&
      t.id !== excludeTrackId &&
      !(project.clips[t.id] ?? []).some((c) => clipsOverlap(c, span)),
  )
}
