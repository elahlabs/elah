import { describe, expect, it } from 'vitest'
import {
  clampLeftTrim,
  clampRightTrim,
  clampZoom,
  computeAnchoredScrollLeft,
  computeRulerTicks,
  formatRulerLabel,
  isClipAllowedOnTrack,
  isCompatibleTrackKind,
  isUnlimitedClipType,
  maxTrimDuration,
  minLeftTrimStart,
  minTrimDuration,
  neighbourBounds,
  pinchZoom,
  pxToFrames,
  resolveZoomAnchorX,
  seekFrameAtX,
  snapThresholdFrames,
  timelineContentWidth,
  TIMELINE_MIN_CONTENT_WIDTH,
  wheelZoomStep,
  xToFrame,
  ZOOM_MAX,
  ZOOM_MIN,
} from './timelineMath'

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe('timelineContentWidth', () => {
  it('is frames times zoom once the content is wider than the floor', () => {
    expect(timelineContentWidth(1000, 4)).toBe(4000)
  })

  it('never drops below the floor, so an empty timeline still has a lane to tap', () => {
    expect(timelineContentWidth(0, 4)).toBe(TIMELINE_MIN_CONTENT_WIDTH)
    expect(timelineContentWidth(10, 0.02)).toBe(TIMELINE_MIN_CONTENT_WIDTH)
  })
})

describe('pxToFrames / xToFrame', () => {
  it('rounds a signed drag delta to the nearest frame, keeping the sign', () => {
    expect(pxToFrames(10, 4)).toBe(3) // 2.5 rounds to 3
    expect(pxToFrames(-10, 4)).toBe(-2) // -2.5 rounds to -2 (JS rounding)
    expect(pxToFrames(0, 4)).toBe(0)
  })

  it('maps an absolute x to a non-negative frame', () => {
    expect(xToFrame(100, 4)).toBe(25)
    expect(xToFrame(-30, 4)).toBe(0)
  })
})

describe('seekFrameAtX', () => {
  it('adds scrollX before converting to a frame', () => {
    expect(seekFrameAtX(100, 0, 4)).toBe(25)
    expect(seekFrameAtX(100, 200, 4)).toBe(75)
  })

  it('clamps a touch left of the lanes to frame 0', () => {
    expect(seekFrameAtX(-50, 0, 4)).toBe(0)
  })
})

describe('snapThresholdFrames', () => {
  it('grows as the user zooms out and never drops below one frame', () => {
    expect(snapThresholdFrames(5)).toBe(1) // 5 px / 5 px-per-frame
    expect(snapThresholdFrames(0.5)).toBe(10)
    expect(snapThresholdFrames(50)).toBe(1)
  })

  it('honours a custom pixel tolerance for touch', () => {
    expect(snapThresholdFrames(1, 12)).toBe(12)
  })
})

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

describe('clampZoom', () => {
  it('keeps zoom inside the store range', () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN)
    expect(clampZoom(1e9)).toBe(ZOOM_MAX)
    expect(clampZoom(4)).toBe(4)
  })
})

describe('computeAnchoredScrollLeft', () => {
  it('keeps the anchored frame at the same on-screen x when zooming in', () => {
    // Frame under the anchor at prevZoom=1, scrollLeft=100, anchorX=50 is frame 150.
    const scrollLeft = computeAnchoredScrollLeft(1, 2, 100, 50)
    // At nextZoom=2, frame 150 sits at px 300; scrollLeft must be 300 - 50 = 250.
    expect(scrollLeft).toBe(250)
  })

  it('keeps the anchored frame at the same on-screen x when zooming out', () => {
    const scrollLeft = computeAnchoredScrollLeft(2, 1, 300, 50)
    // Frame under anchor: (300+50)/2 = 175. At zoom 1: 175*1 - 50 = 125.
    expect(scrollLeft).toBe(125)
  })

  it('is a no-op (returns the same effective scrollLeft) when zoom is unchanged', () => {
    const scrollLeft = computeAnchoredScrollLeft(1.5, 1.5, 200, 40)
    // anchorFrame = (200+40)/1.5; result = anchorFrame*1.5 - 40 = 200.
    expect(scrollLeft).toBeCloseTo(200, 10)
  })

  it('clamps to zero instead of returning a negative scrollLeft', () => {
    // Zooming out from an anchor near the left edge can otherwise go negative.
    const scrollLeft = computeAnchoredScrollLeft(4, 0.1, 5, 2)
    expect(scrollLeft).toBeGreaterThanOrEqual(0)
    // anchorFrame = (5+2)/4 = 1.75; raw = 1.75*0.1 - 2 = -1.825 -> clamped to 0.
    expect(scrollLeft).toBe(0)
  })

  it('handles anchorX = 0 (anchor at the lane seam)', () => {
    const scrollLeft = computeAnchoredScrollLeft(1, 2, 100, 0)
    expect(scrollLeft).toBe(200)
  })

  it('handles a very small prevZoom without producing NaN/Infinity', () => {
    const scrollLeft = computeAnchoredScrollLeft(0.02, 0.04, 10, 5)
    expect(Number.isFinite(scrollLeft)).toBe(true)
  })
})

describe('resolveZoomAnchorX', () => {
  it('anchors on the playhead when it is within the visible lane', () => {
    // currentFrame=50, prevZoom=2 -> content x = 100; scrollLeft=20 -> on-screen x = 80.
    const anchorX = resolveZoomAnchorX(50, 2, 20, 400)
    expect(anchorX).toBe(80)
  })

  it('falls back to lane center when the playhead is scrolled off to the left', () => {
    // on-screen x = 10*2 - 100 = -80 (before the visible lane).
    const anchorX = resolveZoomAnchorX(10, 2, 100, 400)
    expect(anchorX).toBe(200)
  })

  it('falls back to lane center when the playhead is scrolled off to the right', () => {
    // on-screen x = 1000*2 - 0 = 2000, far past laneWidth=400.
    const anchorX = resolveZoomAnchorX(1000, 2, 0, 400)
    expect(anchorX).toBe(200)
  })

  it('treats the exact lane edges (0 and laneWidth) as in-view, not off-screen', () => {
    expect(resolveZoomAnchorX(0, 1, 0, 400)).toBe(0)
    expect(resolveZoomAnchorX(400, 1, 0, 400)).toBe(400)
  })
})

describe('wheelZoomStep', () => {
  it('zooms in on negative deltaY (scroll up)', () => {
    expect(wheelZoomStep(1, -100)).toBeGreaterThan(1)
  })

  it('zooms out on positive deltaY (scroll down)', () => {
    expect(wheelZoomStep(1, 100)).toBeLessThan(1)
  })

  it('is a no-op at deltaY = 0', () => {
    expect(wheelZoomStep(3.5, 0)).toBe(3.5)
  })

  it('produces a consistent multiplicative ratio regardless of the starting zoom', () => {
    const ratioAtLow = wheelZoomStep(0.02, -100) / 0.02
    const ratioAtHigh = wheelZoomStep(40, -100) / 40
    expect(ratioAtLow).toBeCloseTo(ratioAtHigh, 10)
  })
})

describe('pinchZoom', () => {
  it('scales the starting zoom by the pinch ratio', () => {
    expect(pinchZoom(4, 1.5)).toBe(6)
    expect(pinchZoom(4, 0.5)).toBe(2)
  })

  it('ignores a degenerate ratio instead of collapsing the zoom', () => {
    expect(pinchZoom(4, 0)).toBe(4)
    expect(pinchZoom(4, -1)).toBe(4)
    expect(pinchZoom(4, Number.NaN)).toBe(4)
    expect(pinchZoom(4, Number.POSITIVE_INFINITY)).toBe(4)
  })

  it('is unclamped: the caller clamps and then anchors on the clamped value', () => {
    expect(pinchZoom(40, 10)).toBe(400)
    expect(clampZoom(pinchZoom(40, 10))).toBe(ZOOM_MAX)
  })
})

// ---------------------------------------------------------------------------
// Ruler
// ---------------------------------------------------------------------------

/**
 * The ruler used to format its own labels, hardcoding the minutes segment as
 * "00" and never rolling seconds over, so a 90-second project showed "00:90"
 * while every other timecode in the UI showed "00:01:30:00". These cases pin
 * the agreement with `framesToTimecode`.
 */
describe('formatRulerLabel', () => {
  const fps = 30

  it('rolls seconds into minutes', () => {
    expect(formatRulerLabel(90 * fps, fps, false)).toBe('01:30')
  })

  it('starts at zero', () => {
    expect(formatRulerLabel(0, fps, false)).toBe('00:00')
  })

  it('keeps the frames segment for sub-second ticks', () => {
    expect(formatRulerLabel(90 * fps + 7, fps, true)).toBe('01:30:07')
  })

  it('shows hours once they are non-zero, so the hour mark is not 00:00', () => {
    expect(formatRulerLabel(3600 * fps, fps, false)).toBe('01:00:00')
  })

  it('omits hours below one hour so short projects stay compact', () => {
    expect(formatRulerLabel(59 * 60 * fps, fps, false)).toBe('59:00')
  })
})

describe('computeRulerTicks', () => {
  const fps = 30

  it('picks the nearest clean interval at or above the target spacing', () => {
    // zoom 4 px/frame -> 120 px/s; 80 px target -> 0.67 s raw -> 1 s ticks.
    const ticks = computeRulerTicks(fps, 300, 4)
    expect(ticks.map((t) => t.frame)).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330])
    expect(ticks[1].label).toBe('00:01')
  })

  it('uses per-frame ticks (with the frames segment) when zoomed far in', () => {
    // zoom 50 -> 1500 px/s; 80 px target -> 0.053 s -> 1/fps = 0.033 s is too small,
    // 0.5 s is the first interval >= raw; so expect 15-frame ticks with frames shown.
    const ticks = computeRulerTicks(fps, 30, 50)
    expect(ticks.map((t) => t.frame)).toEqual([0, 15, 30, 45])
    expect(ticks[1].label).toBe('00:00:15')
  })

  it('falls back to per-frame ticks when even 1/fps exceeds the raw spacing', () => {
    // zoom 1000 -> 30000 px/s; 80 px -> 0.0027 s; 1/fps (0.033) is the first >=.
    const ticks = computeRulerTicks(fps, 3, 1000)
    expect(ticks.map((t) => t.frame)).toEqual([0, 1, 2, 3, 4])
  })

  it('uses the coarsest interval when zoomed out past the table', () => {
    // zoom 0.02 -> 0.6 px/s; 80 px -> 133 s -> 300 s ticks.
    const ticks = computeRulerTicks(fps, 20 * 60 * fps, 0.02)
    expect(ticks[1].frame).toBe(300 * fps)
    expect(ticks[1].label).toBe('05:00')
  })

  it('always extends one interval past the last frame', () => {
    const ticks = computeRulerTicks(fps, 45, 4) // 1 s ticks
    expect(ticks[ticks.length - 1].frame).toBe(60)
  })

  it('respects a custom target spacing', () => {
    // 160 px target at zoom 4 -> 1.33 s raw -> 2 s ticks.
    const ticks = computeRulerTicks(fps, 120, 4, 160)
    expect(ticks.map((t) => t.frame)).toEqual([0, 60, 120, 180])
  })
})

// ---------------------------------------------------------------------------
// Track compatibility
// ---------------------------------------------------------------------------

describe('isCompatibleTrackKind', () => {
  it('matches media kinds to the lanes that can hold them', () => {
    expect(isCompatibleTrackKind('video', 'video')).toBe(true)
    expect(isCompatibleTrackKind('video', 'image')).toBe(true)
    expect(isCompatibleTrackKind('video', 'audio')).toBe(false)
    expect(isCompatibleTrackKind('audio', 'audio')).toBe(true)
    expect(isCompatibleTrackKind('audio', 'video')).toBe(false)
    expect(isCompatibleTrackKind('elements', 'image')).toBe(false)
  })
})

/** Which clip types may live on which kind of track. */
describe('isClipAllowedOnTrack', () => {
  it('keeps each clip type on its own kind of lane', () => {
    expect(isClipAllowedOnTrack('video', 'video')).toBe(true)
    expect(isClipAllowedOnTrack('text', 'video')).toBe(false)
    expect(isClipAllowedOnTrack('audio', 'audio')).toBe(true)
    expect(isClipAllowedOnTrack('text', 'elements')).toBe(true)
    expect(isClipAllowedOnTrack('image', 'video')).toBe(true)
    expect(isClipAllowedOnTrack('shape', 'elements')).toBe(true)
    expect(isClipAllowedOnTrack('freehand', 'audio')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Trim
// ---------------------------------------------------------------------------

const videoClip = {
  type: 'video' as const,
  startFrame: 100,
  durationFrames: 60,
  sourceStartFrame: 20,
  sourceDurationFrames: 120,
  speed: undefined as number | undefined,
}

const textClip = {
  type: 'text' as const,
  startFrame: 100,
  durationFrames: 60,
  sourceStartFrame: 0,
  sourceDurationFrames: 60,
  speed: undefined as number | undefined,
}

describe('isUnlimitedClipType / maxTrimDuration', () => {
  it('lets generated clips grow without bound', () => {
    expect(isUnlimitedClipType('text')).toBe(true)
    expect(isUnlimitedClipType('shape')).toBe(true)
    expect(isUnlimitedClipType('freehand')).toBe(true)
    expect(isUnlimitedClipType('video')).toBe(false)
    expect(maxTrimDuration(textClip)).toBe(Infinity)
  })

  it('caps media clips at the source length, scaled by speed', () => {
    expect(maxTrimDuration(videoClip)).toBe(120)
    expect(maxTrimDuration({ ...videoClip, speed: 2 })).toBe(60)
    expect(maxTrimDuration({ ...videoClip, speed: 0.5 })).toBe(240)
  })
})

describe('minTrimDuration', () => {
  it('keeps both handles visible at the current zoom, never under one frame', () => {
    expect(minTrimDuration(4)).toBe(4) // 16 px / 4 px-per-frame
    expect(minTrimDuration(50)).toBe(1)
    expect(minTrimDuration(4, 16)).toBe(8) // a bigger touch handle
  })
})

describe('minLeftTrimStart', () => {
  it('lets a media clip extend left only as far as its source has frames', () => {
    // 20 source frames before the in-point -> start may reach 100 - 20 = 80.
    expect(minLeftTrimStart(videoClip)).toBe(80)
  })

  it('scales the available source frames by speed, as the engine does', () => {
    expect(minLeftTrimStart({ ...videoClip, speed: 2 })).toBe(90)
  })

  it('never goes below frame 0', () => {
    expect(minLeftTrimStart({ ...videoClip, startFrame: 5 })).toBe(0)
  })

  it('lets generated clips reach frame 0', () => {
    expect(minLeftTrimStart(textClip)).toBe(0)
  })
})

describe('neighbourBounds', () => {
  const track = [
    { id: 'a', startFrame: 0, durationFrames: 30 },
    { id: 'me', startFrame: 50, durationFrames: 20 },
    { id: 'b', startFrame: 100, durationFrames: 10 },
    { id: 'c', startFrame: 200, durationFrames: 10 },
  ]

  it('finds the closest clip on each side, ignoring the clip itself', () => {
    expect(neighbourBounds(track[1], track)).toEqual({ prevEnd: 30, nextStart: 100 })
  })

  it('reports 0 and Infinity when a side is empty', () => {
    expect(neighbourBounds(track[0], track)).toEqual({ prevEnd: 0, nextStart: 50 })
    expect(neighbourBounds(track[3], track)).toEqual({ prevEnd: 110, nextStart: Infinity })
    expect(neighbourBounds(track[1], [track[1]])).toEqual({ prevEnd: 0, nextStart: Infinity })
  })

  it('treats a touching neighbour as a bound (no overlap allowed, abutting is fine)', () => {
    const touching = [
      { id: 'a', startFrame: 0, durationFrames: 50 },
      { id: 'me', startFrame: 50, durationFrames: 20 },
      { id: 'b', startFrame: 70, durationFrames: 10 },
    ]
    expect(neighbourBounds(touching[1], touching)).toEqual({ prevEnd: 50, nextStart: 70 })
  })
})

describe('clampLeftTrim', () => {
  const limits = { minDuration: 4, maxDuration: maxTrimDuration(videoClip) }

  it('moves the start and keeps the end anchored', () => {
    expect(clampLeftTrim(videoClip, 10, limits)).toEqual({ startFrame: 110, durationFrames: 50 })
    expect(clampLeftTrim(videoClip, -10, limits)).toEqual({ startFrame: 90, durationFrames: 70 })
  })

  it('stops at the source left bound instead of snapping on commit', () => {
    expect(clampLeftTrim(videoClip, -50, limits)).toEqual({ startFrame: 80, durationFrames: 80 })
  })

  it('never shrinks the clip below the minimum duration', () => {
    expect(clampLeftTrim(videoClip, 100, limits)).toEqual({ startFrame: 156, durationFrames: 4 })
  })

  it('pushes the start right to honour maxDuration while keeping the end anchored', () => {
    const generous = { ...videoClip, sourceStartFrame: 100, sourceDurationFrames: 80 }
    const lim = { minDuration: 4, maxDuration: maxTrimDuration(generous) } // 80
    // Asking for 100 frames to the left (start 0) exceeds maxDuration 80: start = 160 - 80.
    expect(clampLeftTrim(generous, -100, lim)).toEqual({ startFrame: 80, durationFrames: 80 })
  })

  it('lets a text clip grow left to frame 0', () => {
    const lim = { minDuration: 4, maxDuration: Infinity }
    expect(clampLeftTrim(textClip, -500, lim)).toEqual({ startFrame: 0, durationFrames: 160 })
  })
})

describe('clampRightTrim', () => {
  const limits = { minDuration: 4, maxDuration: maxTrimDuration(videoClip) }

  it('follows the drag within the limits', () => {
    expect(clampRightTrim(videoClip, 10, limits)).toBe(70)
    expect(clampRightTrim(videoClip, -10, limits)).toBe(50)
  })

  it('clamps to the min and max durations', () => {
    expect(clampRightTrim(videoClip, -100, limits)).toBe(4)
    expect(clampRightTrim(videoClip, 1000, limits)).toBe(120)
  })

  it('has no upper bound for generated clips', () => {
    expect(clampRightTrim(textClip, 100000, { minDuration: 1, maxDuration: Infinity })).toBe(100060)
  })
})
