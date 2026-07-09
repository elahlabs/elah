import { toFrame } from '../utils/frames'

/**
 * Map a video-understanding event (expressed in SOURCE seconds) onto TIMELINE
 * frames for a specific clip.
 *
 * A clip plays a trimmed window of its source: source frames
 * [sourceStartFrame, sourceStartFrame + durationFrames). An event at
 * `startSec` in the source lands on the timeline at:
 *
 *   timelineFrame = clip.startFrame + (sourceFrame - clip.sourceStartFrame)
 *
 * where sourceFrame = round(startSec * fps). Events that fall entirely outside
 * the clip's trimmed window are dropped; events that overlap it are clamped to
 * the clip's timeline bounds. This is deterministic on purpose — the model
 * locates moments, but the seconds→frames conversion must not be left to an LLM.
 */

export interface SourceVideoEvent {
  label: string
  /** Event start, seconds from the beginning of the SOURCE video. */
  startSec: number
  /** Optional event end, seconds from the beginning of the SOURCE video. */
  endSec?: number
  /** Model confidence 0..1. */
  confidence: number
}

/** Just the clip geometry the mapping needs. */
export interface ClipGeometry {
  clipId: string
  trackId: string
  startFrame: number
  durationFrames: number
  sourceStartFrame: number
}

export interface TimelineEvent {
  label: string
  clipId: string
  trackId: string
  /** Inclusive timeline start frame, clamped to the clip. */
  startFrame: number
  /** Exclusive timeline end frame, clamped to the clip. Always > startFrame. */
  endFrame: number
  confidence: number
}

/**
 * Convert source-time events to clip-relative timeline-frame events. Returns
 * only events that intersect the clip's trimmed window, clamped to its bounds.
 */
export function mapVideoEventsToTimeline(
  clip: ClipGeometry,
  events: SourceVideoEvent[],
  fps: number,
): TimelineEvent[] {
  const clipStart = clip.startFrame
  const clipEnd = clip.startFrame + clip.durationFrames // exclusive
  const out: TimelineEvent[] = []

  for (const ev of events) {
    const startSourceFrame = toFrame(ev.startSec * fps)
    // Point events (no endSec) become a one-frame window so a range is well-formed.
    const endSourceFrame =
      typeof ev.endSec === 'number' && ev.endSec > ev.startSec
        ? toFrame(ev.endSec * fps)
        : startSourceFrame + 1

    // Shift from source frames into timeline frames for this clip.
    const offset = clipStart - clip.sourceStartFrame
    let startFrame = startSourceFrame + offset
    let endFrame = endSourceFrame + offset

    // Drop events that don't intersect the clip's timeline span at all.
    if (endFrame <= clipStart || startFrame >= clipEnd) continue

    // Clamp to the clip bounds; guarantee endFrame > startFrame.
    startFrame = Math.max(clipStart, startFrame)
    endFrame = Math.min(clipEnd, endFrame)
    if (endFrame <= startFrame) endFrame = Math.min(clipEnd, startFrame + 1)
    if (endFrame <= startFrame) continue // clip too short to hold even one frame

    out.push({
      label: ev.label,
      clipId: clip.clipId,
      trackId: clip.trackId,
      startFrame,
      endFrame,
      confidence: ev.confidence,
    })
  }

  return out
}
