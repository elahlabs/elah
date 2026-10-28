import { clampZoom, computeAnchoredScrollLeft, pinchZoom, resolveZoomAnchorX } from '@elah/core/engine'

/**
 * Zoom that keeps a chosen point still. Two entry points: a pinch (anchored
 * under the fingers) and a discrete step (toolbar button, slider), anchored
 * on the playhead when it is visible, else the viewport centre. Both return
 * the clamped zoom AND the scroll offset to apply with it; the component sets
 * the zoom through a `setZoom` command and scrolls the lanes to `scrollX`.
 *
 * All x values are lane space: px from the lanes' left edge in the viewport,
 * after any track-label sidebar.
 */

export interface PinchSession {
  readonly startZoom: number
  readonly startScrollX: number
  /** Lane x of the pinch midpoint when the gesture began. */
  readonly focalX: number
}

export interface ZoomPreview {
  /** Clamped to the store's range. */
  zoom: number
  /** Horizontal scroll offset that keeps the anchor still at `zoom`. Never negative. */
  scrollX: number
}

/** Freeze the pinch's starting state. `scale` later arrives relative to this start. */
export function beginPinch(zoom: number, scrollX: number, focalX: number): PinchSession {
  return { startZoom: zoom, startScrollX: scrollX, focalX }
}

/**
 * `scale` is the pinch's current/start distance ratio (gesture-handler's
 * `Pinch.scale`). Pass the current `focalX` to let the content follow the
 * fingers as they drift; omit it to anchor on the starting midpoint.
 */
export function updatePinch(
  session: PinchSession,
  scale: number,
  focalX: number = session.focalX,
): ZoomPreview {
  const zoom = clampZoom(pinchZoom(session.startZoom, scale))
  // The frame under the starting midpoint must sit under the current one:
  // the same derivation as computeAnchoredScrollLeft, with the anchor allowed to move.
  const anchorFrame = (session.startScrollX + session.focalX) / session.startZoom
  const scrollX = Math.max(0, anchorFrame * zoom - focalX)
  return { zoom, scrollX }
}

/**
 * Transform that shows `preview` on content laid out at `session.startZoom` and
 * scrolled to `session.startScrollX`. A content point at lane x `c` lands at
 * `c * scale + tx - startScrollX` while the ScrollView is still at its start offset.
 */
export function pinchPreviewTransform(
  session: PinchSession,
  preview: ZoomPreview,
): { scale: number; tx: number } {
  return { scale: preview.zoom / session.startZoom, tx: session.startScrollX - preview.scrollX }
}

/** A discrete zoom change anchored at `anchorX` (lane space). */
export function anchoredZoom(
  prevZoom: number,
  scrollX: number,
  anchorX: number,
  nextZoom: number,
): ZoomPreview {
  const zoom = clampZoom(nextZoom)
  return { zoom, scrollX: computeAnchoredScrollLeft(prevZoom, zoom, scrollX, anchorX) }
}

/** A discrete zoom change anchored on the playhead when it is in view, else the viewport centre (toolbar buttons, slider). */
export function zoomAtPlayhead(
  prevZoom: number,
  scrollX: number,
  currentFrame: number,
  laneWidth: number,
  nextZoom: number,
): ZoomPreview {
  const anchorX = resolveZoomAnchorX(currentFrame, prevZoom, scrollX, laneWidth)
  return anchoredZoom(prevZoom, scrollX, anchorX, nextZoom)
}

/**
 * Zoom so the whole timeline fits the visible lane width; falls back to a
 * 10-second baseline (matching the ruler) when the timeline is empty.
 */
export function fitToWindowZoom(laneWidth: number, totalFrames: number, fps: number): number {
  const frames = Math.max(totalFrames, fps * 10)
  return clampZoom(laneWidth / frames)
}
