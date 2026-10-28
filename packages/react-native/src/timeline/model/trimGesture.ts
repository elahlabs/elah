import type { Clip, TrimLimits } from '@elah/core'
import {
  clampLeftTrim,
  clampRightTrim,
  maxTrimDuration,
  minTrimDuration,
  neighbourBounds,
  pxToFrames,
  TRIM_HANDLE_WIDTH_PX,
} from '@elah/core/engine'
import type { EngineCommand } from './commands'
import { MIN_CLIP_WIDTH_PX } from './layout'
import { findClipInSnapshot, isTrackLockedInSnapshot } from './snapshot'
import type { GestureSnapshot } from './types'

/**
 * Drag a clip's edge. Mirrors the DOM `ClipBlock` trim handles: the
 * opposite edge stays anchored, the limits are speed-aware so the preview
 * matches what `engine.trimClip()` will commit, and the engine is called once
 * on release.
 *
 * Two bounds are applied during the gesture that the web only discovers on
 * commit (where `trimClip` silently rejects and the block snaps back): the
 * source's left bound (`minLeftTrimStart`) and the neighbouring clips' edges
 * (`neighbourBounds`). So the preview never shows a position the commit
 * would then refuse or correct; `commands.test.ts` proves it against the engine.
 */

export type TrimEdge = 'left' | 'right'

export interface TrimSession {
  readonly clip: Clip
  readonly trackId: string
  readonly edge: TrimEdge
  readonly zoom: number
  /** Already neighbour-aware: `maxDuration` stops at the next (or previous) clip. */
  readonly limits: TrimLimits
}

export interface TrimPreview {
  startFrame: number
  durationFrames: number
}

export interface TrimOptions {
  /** Width of the touch handle, px; sets the minimum clip width so both handles stay grabbable. */
  handleWidthPx?: number
}

/** Returns `null` when the clip is gone or its lane is locked. */
export function beginTrim(
  clipId: string,
  edge: TrimEdge,
  snapshot: GestureSnapshot,
  options: TrimOptions = {},
): TrimSession | null {
  const found = findClipInSnapshot(snapshot, clipId)
  if (!found) return null
  if (isTrackLockedInSnapshot(snapshot, found.trackId)) return null

  const { clip, trackId } = found
  const { zoom } = snapshot
  const { prevEnd, nextStart } = neighbourBounds(clip, snapshot.clips[trackId] ?? [])
  // Growing the right edge is bounded by the next clip's start; growing the
  // left edge by the previous clip's end (the end stays anchored, so that is a
  // duration bound too).
  const roomInLane =
    edge === 'right'
      ? nextStart - clip.startFrame
      : clip.startFrame + clip.durationFrames - prevEnd

  return {
    clip,
    trackId,
    edge,
    zoom,
    limits: {
      minDuration: minTrimDuration(zoom, options.handleWidthPx ?? TRIM_HANDLE_WIDTH_PX),
      maxDuration: Math.min(maxTrimDuration(clip), roomInLane),
    },
  }
}

/** Pure. `translationX` is the finger's horizontal travel since the gesture began, px. */
export function updateTrim(session: TrimSession, translationX: number): TrimPreview {
  const deltaFrames = pxToFrames(translationX, session.zoom)
  if (session.edge === 'left') {
    return clampLeftTrim(session.clip, deltaFrames, session.limits)
  }
  return {
    startFrame: session.clip.startFrame,
    durationFrames: clampRightTrim(session.clip, deltaFrames, session.limits),
  }
}

/**
 * How to draw the block during a trim, relative to its resting rect: `dx` shifts its left edge (left trim),
 * `width` is its new width (same min-width rule as `clipRect`).
 */
export function trimPreviewRect(session: TrimSession, preview: TrimPreview): { dx: number; width: number } {
  return {
    dx: (preview.startFrame - session.clip.startFrame) * session.zoom,
    width: Math.max(preview.durationFrames * session.zoom, MIN_CLIP_WIDTH_PX),
  }
}

/** The command for the release, or `null` when the edge ended where it started. */
export function endTrim(session: TrimSession, preview: TrimPreview): EngineCommand | null {
  const { clip } = session
  if (preview.startFrame === clip.startFrame && preview.durationFrames === clip.durationFrames) {
    return null
  }
  return {
    type: 'trimClip',
    clipId: clip.id,
    trackId: session.trackId,
    startFrame: preview.startFrame,
    durationFrames: preview.durationFrames,
  }
}
