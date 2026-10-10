import type { Clip, ClipType, TrackKind } from '../types'
import type { MediaKind } from '../assets/types'
import { framesToTimecode } from './frames'

/**
 * Pure timeline geometry shared by every timeline UI (the DOM `@elah/timeline`
 * and the React Native `@elah/react-native`). Nothing here touches a store, an
 * engine or a platform API: every function maps numbers to numbers so the two
 * timelines agree on where a frame sits on screen and what a gesture means.
 *
 * All x / scroll values are in the track lane's own coordinate space: pixels
 * from the lane's left edge, AFTER any sticky track-label sidebar has been
 * subtracted by the caller. `zoom` is pixels per frame everywhere.
 */

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Floor for the content width so a near-empty or fully zoomed-out timeline
 * still gives the user something to scroll and tap on.
 */
export const TIMELINE_MIN_CONTENT_WIDTH = 800

/**
 * Shared content width for the ruler and every track lane.
 *
 * Both must use the SAME formula: the floor keeps a usable timeline on small
 * screens, and if only the lanes applied it (as they historically did) the
 * ruler ticks and clip positions desynced horizontally at very low zoom.
 */
export function timelineContentWidth(totalFrames: number, zoom: number): number {
  return Math.max(totalFrames * zoom, TIMELINE_MIN_CONTENT_WIDTH)
}

/** Signed pixel delta of a drag to a signed frame delta, rounded to the nearest frame. */
export function pxToFrames(px: number, zoom: number): number {
  return Math.round(px / zoom)
}

/** Absolute lane x to a non-negative frame: the seek / scrub mapping. */
export function xToFrame(x: number, zoom: number): number {
  return Math.max(0, Math.round(x / zoom))
}

/** Viewport x (a touch on a ruler fixed above scrolled lanes) to a non-negative frame. */
export function seekFrameAtX(x: number, scrollX: number, zoom: number): number {
  return xToFrame(x + scrollX, zoom)
}

/**
 * Snap distance in frames for a given pixel tolerance. Snapping is a screen
 * property (how close the finger or pointer is), so the frame threshold grows
 * as the user zooms out. Never less than one frame.
 */
export function snapThresholdFrames(zoom: number, thresholdPx = 5): number {
  return Math.max(1, Math.round(thresholdPx / zoom))
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

/**
 * Zoom range in pixels per frame. The lower bound is deliberately tiny so long
 * timelines (30 min at 30 fps is ~54k frames) can be zoomed out far enough to
 * fit on screen. `playbackStore.setZoom` clamps with the same constants.
 */
export const ZOOM_MIN = 0.02
export const ZOOM_MAX = 50

export function clampZoom(zoom: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom))
}

/**
 * Given the zoom level before and after a change (the "after" value must
 * already be clamped), the scrollLeft before the change, and the anchor point
 * that should stay visually fixed, returns the scrollLeft to apply once the
 * lanes are laid out at the new zoom.
 *
 * Derivation: the frame under the anchor is `(scrollLeft + anchorX) / prevZoom`.
 * After zoom changes, that same frame must again sit at `anchorX`:
 *   anchorFrame * nextZoom - scrollLeft' = anchorX
 *   scrollLeft' = anchorFrame * nextZoom - anchorX
 *
 * Clamped to >= 0: scrollLeft can never go negative, and zooming out from an
 * anchor near the left edge can otherwise compute a small negative value.
 */
export function computeAnchoredScrollLeft(
  prevZoom: number,
  nextZoom: number,
  scrollLeft: number,
  anchorX: number,
): number {
  const anchorFrame = (scrollLeft + anchorX) / prevZoom
  return Math.max(0, anchorFrame * nextZoom - anchorX)
}

/**
 * Resolve the anchor x for a playhead-or-center zoom (toolbar buttons, the
 * zoom slider, and editor-wide ctrl+scroll forwarding all use this): the
 * playhead's current on-screen x when it's within the visible lane, else the
 * lane's horizontal center.
 */
export function resolveZoomAnchorX(
  currentFrame: number,
  prevZoom: number,
  scrollLeft: number,
  laneWidth: number,
): number {
  const playheadX = currentFrame * prevZoom - scrollLeft
  return playheadX >= 0 && playheadX <= laneWidth ? playheadX : laneWidth / 2
}

/**
 * Multiplicative zoom step for a wheel notch. `deltaY > 0` (scroll down) zooms
 * out, `deltaY < 0` zooms in. Exponential rather than linear so the same
 * notch feels consistent across the whole zoom range: a fixed +/-0.5 step is a
 * 25x jump at the low end and noise at the high end.
 */
export function wheelZoomStep(prevZoom: number, deltaY: number): number {
  return prevZoom * Math.exp(-deltaY * 0.0015)
}

/**
 * Zoom for a pinch in progress. `scale` is the gesture's current distance
 * divided by its starting distance (what `react-native-gesture-handler`'s
 * Pinch reports as `scale`, and what the web computes from two touches).
 * Unclamped: pass the result through `clampZoom` (or the store) and compute the
 * anchored scroll from the clamped value. A degenerate scale (zero, negative or
 * non-finite) leaves the zoom where it was.
 */
export function pinchZoom(startZoom: number, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return startZoom
  return startZoom * scale
}

// ---------------------------------------------------------------------------
// Ruler
// ---------------------------------------------------------------------------

export interface RulerTick {
  frame: number
  label: string
}

/**
 * Candidate label spacings in seconds. The per-frame interval (`1 / fps`) is
 * prepended at call time because it depends on the project.
 */
export const RULER_TICK_INTERVALS_SEC = [
  0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800,
] as const

/**
 * Ruler label from the shared timecode formatter, so it agrees with the rest of
 * the UI (a 90 s mark reads 01:30, not 00:90). Whole-second ticks drop the
 * frames segment; sub-second ticks keep it. The hours segment appears only once
 * it is non-zero, otherwise the one-hour mark renders as 00:00 and collides
 * with the start of the project.
 */
export function formatRulerLabel(frame: number, fps: number, showFrames: boolean): string {
  const full = framesToTimecode(frame, fps) // HH:MM:SS:FF
  const hours = full.slice(0, 2)
  const body = showFrames ? full.slice(3) : full.slice(3, 8)
  return hours === '00' ? body : `${hours}:${body}`
}

/**
 * Tick marks for a ruler at the given zoom. Tick density adapts so labels are
 * about `targetSpacingPx` apart and never overlap: the nearest clean interval
 * at or above the raw spacing wins. The last tick lands one interval past
 * `totalFrames` so the ruler always extends beyond the final clip.
 */
export function computeRulerTicks(
  fps: number,
  totalFrames: number,
  zoom: number,
  targetSpacingPx = 80,
): RulerTick[] {
  const pixelsPerSecond = fps * zoom
  const rawSeconds = targetSpacingPx / pixelsPerSecond
  const intervals: readonly number[] = [1 / fps, ...RULER_TICK_INTERVALS_SEC]
  const secondsPerTick =
    intervals.find((i) => i >= rawSeconds) ?? intervals[intervals.length - 1]

  const framesPerTick = Math.max(1, Math.round(secondsPerTick * fps))
  const showFrames = framesPerTick < fps
  const result: RulerTick[] = []

  for (let frame = 0; frame <= totalFrames + framesPerTick; frame += framesPerTick) {
    result.push({ frame, label: formatRulerLabel(frame, fps, showFrames) })
  }

  return result
}

// ---------------------------------------------------------------------------
// Track compatibility
// ---------------------------------------------------------------------------

/**
 * Whether a media asset can be placed on a track of the given kind. Shared by
 * the drop gate, the insertion path and the mobile "Add to timeline" button,
 * so the rule cannot silently diverge between them.
 */
export function isCompatibleTrackKind(trackKind: TrackKind, mediaKind: MediaKind): boolean {
  if (trackKind === 'audio') return mediaKind === 'audio'
  if (trackKind === 'video') return mediaKind === 'video' || mediaKind === 'image'
  return false
}

/**
 * Whether an existing clip (identified by its `ClipType`) may move onto a
 * track of the given kind: the same compatibility rule as
 * `isCompatibleTrackKind`, but keyed on a clip already on the timeline rather
 * than an asset being dropped from the media library. Used by the cross-track
 * drag gesture.
 */
export function isClipAllowedOnTrack(clipType: ClipType, trackKind: TrackKind): boolean {
  if (clipType === 'video' || clipType === 'image') return trackKind === 'video'
  if (clipType === 'audio') return trackKind === 'audio'
  return trackKind === 'elements' // text | shape | freehand
}

// ---------------------------------------------------------------------------
// Trim
// ---------------------------------------------------------------------------

/** Width of a trim handle in the DOM timeline; mobile passes its own, larger, value. */
export const TRIM_HANDLE_WIDTH_PX = 8

type TrimClip = Pick<
  Clip,
  'type' | 'startFrame' | 'durationFrames' | 'sourceStartFrame' | 'sourceDurationFrames' | 'speed'
>

/** Generated clips have no source media and may grow freely in either direction. */
export function isUnlimitedClipType(type: ClipType): boolean {
  return type === 'text' || type === 'shape' || type === 'freehand'
}

/**
 * Longest a clip may be on the timeline. Speed-aware so a live drag preview
 * matches what `engine.trimClip()` will actually commit: every timeline frame
 * of a speed-changed clip consumes `speed` source frames, so
 * `durationFrames * speed <= sourceDurationFrames`.
 */
export function maxTrimDuration(clip: Pick<TrimClip, 'type' | 'sourceDurationFrames' | 'speed'>): number {
  if (isUnlimitedClipType(clip.type)) return Infinity
  return Math.floor(clip.sourceDurationFrames / (clip.speed ?? 1))
}

/**
 * Shortest a clip may be made by dragging, in frames: enough that both trim
 * handles still fit side by side at this zoom. Never less than one frame.
 */
export function minTrimDuration(zoom: number, handleWidthPx = TRIM_HANDLE_WIDTH_PX): number {
  return Math.max(1, Math.ceil((handleWidthPx * 2) / zoom))
}

/**
 * Leftmost start a left-edge trim may reach. A media clip cannot extend further
 * left than its source has frames before the current in-point
 * (`sourceStartFrame / speed` timeline frames); generated clips may reach 0.
 * This is the rule `engine.trimClip()` enforces on commit; applying it during
 * the gesture keeps the preview honest instead of snapping on release.
 */
export function minLeftTrimStart(
  clip: Pick<TrimClip, 'type' | 'startFrame' | 'sourceStartFrame' | 'speed'>,
): number {
  if (isUnlimitedClipType(clip.type)) return 0
  const speed = clip.speed ?? 1
  return Math.max(0, clip.startFrame - Math.floor(clip.sourceStartFrame / speed))
}

/**
 * The nearest neighbours' edges on the clip's own track: the previous clip's
 * end (0 when there is none) and the next clip's start (`Infinity` when there
 * is none). A trim that reaches past either would overlap, which
 * `engine.trimClip()` rejects silently; clamping the gesture to these bounds
 * keeps the preview honest instead of snapping back on release.
 */
export function neighbourBounds(
  clip: Pick<Clip, 'id' | 'startFrame' | 'durationFrames'>,
  trackClips: readonly Pick<Clip, 'id' | 'startFrame' | 'durationFrames'>[],
): { prevEnd: number; nextStart: number } {
  const start = clip.startFrame
  const end = start + clip.durationFrames
  let prevEnd = 0
  let nextStart = Infinity
  for (const other of trackClips) {
    if (other.id === clip.id) continue
    const otherEnd = other.startFrame + other.durationFrames
    if (otherEnd <= start && otherEnd > prevEnd) prevEnd = otherEnd
    if (other.startFrame >= end && other.startFrame < nextStart) nextStart = other.startFrame
  }
  return { prevEnd, nextStart }
}

export interface TrimResult {
  startFrame: number
  durationFrames: number
}

export interface TrimLimits {
  /** From `minTrimDuration`. */
  minDuration: number
  /** From `maxTrimDuration`. */
  maxDuration: number
}

/**
 * Left-edge trim: the clip's END stays anchored while the start follows the
 * drag by `deltaFrames` (signed). Clamped so the start never crosses the
 * source's left bound, the clip never shrinks below `minDuration`, and it
 * never grows past `maxDuration` (in which case the start is pushed right to
 * keep the end anchored).
 */
export function clampLeftTrim(
  clip: TrimClip,
  deltaFrames: number,
  limits: TrimLimits,
): TrimResult {
  const anchorEnd = clip.startFrame + clip.durationFrames
  let newStart = Math.max(minLeftTrimStart(clip), clip.startFrame + deltaFrames)
  newStart = Math.min(newStart, anchorEnd - limits.minDuration)
  let newDuration = anchorEnd - newStart
  if (newDuration > limits.maxDuration) {
    newDuration = limits.maxDuration
    newStart = anchorEnd - limits.maxDuration
  }
  return { startFrame: newStart, durationFrames: newDuration }
}

/**
 * Right-edge trim: the start stays put and the duration follows the drag by
 * `deltaFrames` (signed), clamped to `[minDuration, maxDuration]`.
 */
export function clampRightTrim(
  clip: Pick<TrimClip, 'durationFrames'>,
  deltaFrames: number,
  limits: TrimLimits,
): number {
  return Math.min(
    limits.maxDuration,
    Math.max(limits.minDuration, clip.durationFrames + deltaFrames),
  )
}
