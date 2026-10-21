/**
 * Pro trim modes (PV-T1): roll, slide and slip, as Premiere, Resolve and
 * Final Cut define them. Each is one undo step built from the engine's own
 * `trimClip` / `shiftClips` / `updateClip`, so every source-window and
 * overlap rule those enforce still applies; when any step comes back
 * different from what the edit needs, the whole batch rolls back and a
 * reason is returned.
 */

import type { Clip } from '../types'
import type { TimelineEngine } from '../editor/TimelineEngine'
import { hasTimeRemap } from '../resolver/sourceTime'
import type { ActionResult } from './types'

/** Thrown inside a batch to roll it back; never escapes this module. */
class Rejected extends Error {
  constructor(readonly reason: 'media-limit' | 'engine-rejected') {
    super(reason)
  }
}

/** Clips with no source media: nothing to slip. */
const SOURCELESS: ReadonlySet<Clip['type']> = new Set(['text', 'shape', 'freehand', 'adjustment', 'generator', 'sequence'])

/** Runs the batch; returns the failure, or null when it went through. */
function runBatch(
  engine: TimelineEngine,
  description: string,
  recipe: () => void,
): { ok: false; reason: 'media-limit' | 'engine-rejected' } | null {
  try {
    engine.batch(recipe, description)
  } catch (err) {
    if (err instanceof Rejected) return { ok: false, reason: err.reason }
    throw err
  }
  return null
}

/** `trimClip`, then insist it did exactly what was asked (it clamps and rejects silently). */
function trimExactly(engine: TimelineEngine, clip: Clip, start: number, duration: number): void {
  engine.trimClip(clip.id, clip.trackId, start, duration)
  const after = engine.findClip(clip.id)?.clip
  if (!after || after.startFrame !== start || after.durationFrames !== duration) throw new Rejected('media-limit')
}

/**
 * Roll the cut between two adjacent clips on one track by `delta` frames:
 * the left clip's end and the right clip's start move together, so nothing
 * else on the timeline moves. Both clips must keep at least one frame and
 * the media on each side must cover the new cut.
 */
export function rollEdit(
  engine: TimelineEngine,
  leftClipId: string,
  rightClipId: string,
  delta: number,
): ActionResult<{ cutFrame: number }> {
  const left = engine.findClip(leftClipId)?.clip
  const right = engine.findClip(rightClipId)?.clip
  if (!left || !right) return { ok: false, reason: 'clip-not-found' }
  if (left.trackId !== right.trackId || left.startFrame + left.durationFrames !== right.startFrame) {
    return { ok: false, reason: 'not-adjacent' }
  }
  if (engine.isTrackLocked(left.trackId)) return { ok: false, reason: 'track-locked' }

  const d = Math.round(delta)
  if (!Number.isFinite(d)) return { ok: false, reason: 'engine-rejected' }
  if (d === 0) return { ok: true, data: { cutFrame: right.startFrame } }
  const cut = right.startFrame + d
  const rightEnd = right.startFrame + right.durationFrames
  if (cut <= left.startFrame || cut >= rightEnd) return { ok: false, reason: 'media-limit' }

  const failed = runBatch(engine, 'Roll edit', () => {
    // Shrink first, then grow, so the two never overlap in between.
    if (d > 0) {
      trimExactly(engine, right, cut, rightEnd - cut)
      trimExactly(engine, left, left.startFrame, cut - left.startFrame)
    } else {
      trimExactly(engine, left, left.startFrame, cut - left.startFrame)
      trimExactly(engine, right, cut, rightEnd - cut)
    }
  })
  return failed ?? { ok: true, data: { cutFrame: cut } }
}

/**
 * Slide a clip by `delta` frames between its neighbours: the clip keeps its
 * content and length, the clip ending where it starts gives or takes frames
 * at its end, and the clip starting where it ends gives or takes frames at
 * its start. Only neighbours touching the clip take part; on a side with no
 * touching neighbour the clip moves into free space.
 */
export function slideClip(engine: TimelineEngine, clipId: string, delta: number): ActionResult<{ startFrame: number }> {
  const clip = engine.findClip(clipId)?.clip
  if (!clip) return { ok: false, reason: 'clip-not-found' }
  if (engine.isTrackLocked(clip.trackId)) return { ok: false, reason: 'track-locked' }
  const d = Math.round(delta)
  if (!Number.isFinite(d)) return { ok: false, reason: 'engine-rejected' }
  if (d === 0) return { ok: true, data: { startFrame: clip.startFrame } }

  const end = clip.startFrame + clip.durationFrames
  const siblings = engine.getClipsOnTrack(clip.trackId)
  const left = siblings.find((c) => c.id !== clip.id && c.startFrame + c.durationFrames === clip.startFrame)
  const right = siblings.find((c) => c.id !== clip.id && c.startFrame === end)
  if (left && left.durationFrames + d < 1) return { ok: false, reason: 'media-limit' }
  if (right && right.durationFrames - d < 1) return { ok: false, reason: 'media-limit' }

  const move = () => {
    if (!engine.shiftClips([{ clipId: clip.id, trackId: clip.trackId, delta: d }], 'Slide clip')) {
      throw new Rejected('engine-rejected')
    }
  }
  const failed = runBatch(engine, 'Slide clip', () => {
    if (d > 0) {
      if (right) trimExactly(engine, right, right.startFrame + d, right.durationFrames - d)
      move()
      if (left) trimExactly(engine, left, left.startFrame, left.durationFrames + d)
    } else {
      if (left) trimExactly(engine, left, left.startFrame, left.durationFrames + d)
      move()
      if (right) trimExactly(engine, right, right.startFrame + d, right.durationFrames - d)
    }
  })
  return failed ?? { ok: true, data: { startFrame: clip.startFrame + d } }
}

/**
 * The range `sourceStartFrame` may take when slipping a clip.
 *
 * The lower bound is the start of the media. The upper bound is where the
 * clip's last frame meets the end of what `sourceDurationFrames` says the
 * source holds — never below the current in-point: a clip that came out of
 * a split carries the length of its own window rather than the asset's
 * (see `visitor/split.ts`), so the true end is unknown and slipping later
 * than today is refused rather than guessed.
 */
export function slipBounds(clip: Clip): { min: number; max: number } {
  const used = Math.round(clip.durationFrames * (clip.speed ?? 1))
  // With the real media length the window is not the limit: the content can
  // slide to any in-point that still fits inside the asset (PV-T5-1).
  return {
    min: 0,
    max:
      clip.assetFrames !== undefined
        ? Math.max(clip.sourceStartFrame, clip.assetFrames - used)
        : Math.max(clip.sourceStartFrame, clip.sourceDurationFrames - used),
  }
}

/**
 * Slip a clip's content by `delta` source frames: its position and length on
 * the timeline stay, the part of the media it shows moves. Clamped to
 * `slipBounds`. Keyframes stay put — they animate the clip, not the media.
 */
export function slipClip(engine: TimelineEngine, clipId: string, delta: number): ActionResult<{ sourceStartFrame: number }> {
  const clip = engine.findClip(clipId)?.clip
  if (!clip) return { ok: false, reason: 'clip-not-found' }
  if (SOURCELESS.has(clip.type) || hasTimeRemap(clip)) return { ok: false, reason: 'not-slippable' }
  if (engine.isTrackLocked(clip.trackId)) return { ok: false, reason: 'track-locked' }
  const d = Math.round(delta)
  if (!Number.isFinite(d)) return { ok: false, reason: 'engine-rejected' }

  const { min, max } = slipBounds(clip)
  const next = Math.max(min, Math.min(max, clip.sourceStartFrame + d))
  if (next !== clip.sourceStartFrame) {
    engine.updateClip(clip.id, clip.trackId, { sourceStartFrame: next })
  }
  return { ok: true, data: { sourceStartFrame: next } }
}
