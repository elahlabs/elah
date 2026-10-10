/**
 * The platform-free timeline model: what the lanes look like and what a
 * gesture means. No React, no react-native, no gesture-handler import is
 * allowed in this directory (enforced by `src/dependencyRules.test.ts`), so
 * every function here runs, and is tested, in plain Node against the real
 * `TimelineEngine`.
 *
 * Shape of every gesture: `begin*` freezes a session from a `GestureSnapshot`,
 * `update*` is pure and returns a preview for the component to draw, `end*`
 * returns an `EngineCommand` (or `null`) that `applyEngineCommand` performs.
 */

export type { GestureSnapshot, LaneSlot, ClipRect } from './types'
export { snapshotFromStores, findClipInSnapshot, isTrackLockedInSnapshot } from './snapshot'

export {
  CLIP_INSET_PX,
  MIN_CLIP_WIDTH_PX,
  computeLaneSlots,
  lanesHeight,
  laneAtY,
  laneForTrack,
  clipRect,
  seekFrameAtX,
} from './layout'

export { applyEngineCommand, defaultCommandTargets } from './commands'
export type { EngineCommand, CommandTargets } from './commands'

export { DEFAULT_SNAP_TOLERANCE_PX, beginMove, updateMove, endMove } from './moveGesture'
export type { MoveSession, MoveInput, MovePreview, MoveOptions } from './moveGesture'

export { beginTrim, updateTrim, endTrim } from './trimGesture'
export type { TrimEdge, TrimSession, TrimPreview, TrimOptions } from './trimGesture'

export {
  beginPinch,
  updatePinch,
  pinchPreviewTransform,
  anchoredZoom,
  zoomAtPlayhead,
  fitToWindowZoom,
} from './zoomGesture'
export type { PinchSession, ZoomPreview } from './zoomGesture'
