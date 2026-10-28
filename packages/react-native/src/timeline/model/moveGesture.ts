import type { Clip } from '@elah/core'
import {
  buildSnapPoints,
  DEFAULT_OVERLAP_TOLERANCE,
  isClipAllowedOnTrack,
  pxToFrames,
  resolveOverlapEdgeSnap,
  snapFrame,
  snapThresholdFrames,
} from '@elah/core/engine'
import type { EngineCommand } from './commands'
import { computeLaneSlots, laneAtY, laneForTrack } from './layout'
import { findClipInSnapshot } from './snapshot'
import type { GestureSnapshot, LaneSlot } from './types'

/**
 * Move a clip along its lane or onto another lane. Mirrors the DOM
 * `ClipBlock` body drag: everything is measured once at the start, the live
 * preview is a visual offset, and the engine is called exactly once on
 * release, after the drop position has been settled against overlaps.
 *
 * The component owns the gesture recogniser (long-press then pan, so a plain
 * pan still scrolls the lanes). These three functions own the meaning.
 */

/** How close (px) the dragged edge must be to a snap point to snap. The DOM timeline uses 5; touch may want more. */
export const DEFAULT_SNAP_TOLERANCE_PX = 5

export interface MoveSession {
  readonly clip: Clip
  readonly originTrackId: string
  readonly zoom: number
  /** `null` when snapping is off. */
  readonly snapPoints: readonly number[] | null
  readonly snapThreshold: number
  readonly lanes: readonly LaneSlot[]
  readonly ownLane: LaneSlot
}

export interface MoveInput {
  /** Horizontal finger travel since the gesture began, px (Pan `translationX`). */
  translationX: number
  /**
   * Finger y in lanes space (0 = top of the first lane, scroll applied by the
   * caller). Omit to keep the clip on its own lane, e.g. for a horizontal-only
   * drag handle.
   */
  pointerY?: number
}

export interface MovePreview {
  /** Where the clip's start would land, after snapping. */
  startFrame: number
  /** The lane it would land on: the hovered lane when allowed, else its own. */
  trackId: string
  /** Visual offset for the block, px, relative to its resting position. */
  dx: number
  dy: number
}

export interface MoveOptions {
  snapTolerancePx?: number
  /** Pre-computed lane slots (avoids recomputing per gesture). Defaults to `computeLaneSlots(snapshot.tracks)`. */
  lanes?: readonly LaneSlot[]
}

/**
 * Freeze everything the drag needs. Returns `null` when the clip is gone or its
 * lane is locked (a locked clip is selectable but not draggable, as on the web).
 */
export function beginMove(
  clipId: string,
  snapshot: GestureSnapshot,
  options: MoveOptions = {},
): MoveSession | null {
  const found = findClipInSnapshot(snapshot, clipId)
  if (!found) return null
  const lanes = options.lanes ?? computeLaneSlots(snapshot.tracks)
  const ownLane = laneForTrack(lanes, found.trackId)
  if (!ownLane || ownLane.locked) return null

  const { zoom } = snapshot
  return {
    clip: found.clip,
    originTrackId: found.trackId,
    zoom,
    snapPoints: snapshot.snapEnabled ? buildSnapPoints(snapshot.clips, clipId) : null,
    snapThreshold: snapThresholdFrames(zoom, options.snapTolerancePx ?? DEFAULT_SNAP_TOLERANCE_PX),
    lanes,
    ownLane,
  }
}

/** Pure: the same input always yields the same preview. Safe to call from a worklet via `runOnJS` or on the JS thread. */
export function updateMove(session: MoveSession, input: MoveInput): MovePreview {
  const { clip, zoom } = session
  const deltaFrames = pxToFrames(input.translationX, zoom)
  let startFrame = Math.max(0, clip.startFrame + deltaFrames)
  if (session.snapPoints) {
    startFrame = snapFrame(startFrame, session.snapPoints as number[], session.snapThreshold)
  }

  // Resolve which lane the finger is over, and whether this clip's type may
  // actually land there: an incompatible or locked lane keeps the clip on its
  // own track instead of accepting a bad drop target.
  let trackId = session.originTrackId
  let dy = 0
  if (input.pointerY !== undefined) {
    const hovered = laneAtY(session.lanes, input.pointerY)
    if (hovered && !hovered.locked && isClipAllowedOnTrack(clip.type, hovered.kind)) {
      trackId = hovered.trackId
      dy = hovered.top - session.ownLane.top
    }
  }

  return {
    startFrame,
    trackId,
    dx: startFrame * zoom - clip.startFrame * zoom,
    dy,
  }
}

/**
 * The command for the release, or `null` when nothing changed (a tap that
 * never travelled). The drop position is settled against the target lane's
 * clips with the same 40 % overlap rule as the web, so a clip dropped half
 * over a neighbour slides into the nearest gap rather than being rejected.
 */
export function endMove(
  session: MoveSession,
  preview: MovePreview,
  snapshot: Pick<GestureSnapshot, 'clips'>,
): EngineCommand | null {
  const { clip, originTrackId } = session
  if (preview.startFrame === clip.startFrame && preview.trackId === originTrackId) return null

  const targetClips = snapshot.clips[preview.trackId] ?? []
  const startFrame = resolveOverlapEdgeSnap(
    preview.startFrame,
    clip,
    targetClips,
    DEFAULT_OVERLAP_TOLERANCE,
  )
  if (startFrame === clip.startFrame && preview.trackId === originTrackId) return null

  return {
    type: 'moveClip',
    clipId: clip.id,
    fromTrackId: originTrackId,
    toTrackId: preview.trackId,
    startFrame,
  }
}
