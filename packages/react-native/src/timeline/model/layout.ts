import type { Clip, Track } from '@elah/core'
import { xToFrame } from '@elah/core/engine'
import type { ClipRect, LaneSlot } from './types'

/** Vertical inset of a clip block inside its lane, px. Matches the DOM timeline (`top: 5`, height `trackHeight - 10`). */
export const CLIP_INSET_PX = 5

/** A clip never renders narrower than this, so a one-frame clip at low zoom stays tappable. */
export const MIN_CLIP_WIDTH_PX = 4

/**
 * Stack the tracks into lane slots, top to bottom, in `order`. The engine
 * keeps `tracks` sorted and `order` normalised; sorting here again is cheap
 * and makes the function correct for any caller-supplied list.
 */
export function computeLaneSlots(tracks: readonly Track[]): LaneSlot[] {
  const ordered = [...tracks].sort((a, b) => a.order - b.order)
  const slots: LaneSlot[] = []
  let top = 0
  for (const track of ordered) {
    const height = track.height
    slots.push({
      trackId: track.id,
      kind: track.kind,
      locked: track.locked,
      top,
      bottom: top + height,
      height,
    })
    top += height
  }
  return slots
}

/** Total height of the stacked lanes, px. */
export function lanesHeight(lanes: readonly LaneSlot[]): number {
  return lanes.length === 0 ? 0 : lanes[lanes.length - 1].bottom
}

/** The lane under a y coordinate in lanes space (`top <= y < bottom`), or `undefined` outside every lane. */
export function laneAtY(lanes: readonly LaneSlot[], y: number): LaneSlot | undefined {
  return lanes.find((lane) => y >= lane.top && y < lane.bottom)
}

export function laneForTrack(lanes: readonly LaneSlot[], trackId: string): LaneSlot | undefined {
  return lanes.find((lane) => lane.trackId === trackId)
}

/**
 * Where a clip block sits in lane-content space. `x` and `width` come from
 * frames times zoom, the same mapping the DOM `ClipBlock` uses; the caller
 * subtracts the horizontal scroll offset to get viewport coordinates.
 */
export function clipRect(
  clip: Pick<Clip, 'startFrame' | 'durationFrames'>,
  zoom: number,
  lane: Pick<LaneSlot, 'top' | 'height'>,
  inset = CLIP_INSET_PX,
): ClipRect {
  return {
    x: clip.startFrame * zoom,
    y: lane.top + inset,
    width: Math.max(clip.durationFrames * zoom, MIN_CLIP_WIDTH_PX),
    height: Math.max(0, lane.height - inset * 2),
  }
}

/**
 * Frame under a tap or scrub on the ruler. `viewportX` is measured from the
 * lanes' left edge in the viewport (after any track-label sidebar);
 * `scrollX` is the horizontal scroll offset.
 */
export function seekFrameAtX(viewportX: number, scrollX: number, zoom: number): number {
  return xToFrame(viewportX + scrollX, zoom)
}
