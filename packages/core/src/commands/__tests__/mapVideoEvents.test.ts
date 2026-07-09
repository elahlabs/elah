import { describe, expect, it } from 'vitest'
import { mapVideoEventsToTimeline, type ClipGeometry } from '../mapVideoEvents'

/**
 * Covers source-seconds → timeline-frames mapping: the trim offset
 * (sourceStartFrame), the timeline offset (startFrame), point vs range events,
 * and clamping / dropping of events outside the clip's trimmed window.
 */
describe('mapVideoEventsToTimeline', () => {
  const fps = 30

  // Clip plays source frames [0, 300) at timeline frame 0. Untrimmed, unshifted.
  const untrimmed: ClipGeometry = {
    clipId: 'c1',
    trackId: 't1',
    startFrame: 0,
    durationFrames: 300,
    sourceStartFrame: 0,
  }

  it('maps a source-second event straight to timeline frames (no trim, no shift)', () => {
    const [e] = mapVideoEventsToTimeline(untrimmed, [
      { label: 'Hi', startSec: 2, endSec: 3, confidence: 0.9 },
    ], fps)
    expect(e).toMatchObject({ clipId: 'c1', trackId: 't1', startFrame: 60, endFrame: 90 })
  })

  it('turns a point event (no endSec) into a one-frame window', () => {
    const [e] = mapVideoEventsToTimeline(untrimmed, [
      { label: 'jump', startSec: 1, confidence: 0.8 },
    ], fps)
    expect(e.startFrame).toBe(30)
    expect(e.endFrame).toBe(31)
  })

  it('applies the timeline offset (clip.startFrame)', () => {
    const shifted: ClipGeometry = { ...untrimmed, startFrame: 100 }
    const [e] = mapVideoEventsToTimeline(shifted, [
      { label: 'Hi', startSec: 2, endSec: 3, confidence: 1 },
    ], fps)
    // source frame 60 → timeline 100 + 60 = 160
    expect(e).toMatchObject({ startFrame: 160, endFrame: 190 })
  })

  it('applies the trim offset (sourceStartFrame)', () => {
    // Clip trims off the first 1s (30 frames) of source and sits at timeline 0.
    const trimmed: ClipGeometry = { ...untrimmed, sourceStartFrame: 30 }
    const [e] = mapVideoEventsToTimeline(trimmed, [
      { label: 'Hi', startSec: 2, endSec: 3, confidence: 1 },
    ], fps)
    // source frame 60, minus 30 trimmed = timeline 30..60
    expect(e).toMatchObject({ startFrame: 30, endFrame: 60 })
  })

  it('drops events entirely outside the clip window', () => {
    // Clip only holds source [0,60) → an event at 5s is past the end.
    const shortClip: ClipGeometry = { ...untrimmed, durationFrames: 60 }
    const events = mapVideoEventsToTimeline(shortClip, [
      { label: 'late', startSec: 5, endSec: 6, confidence: 1 },
    ], fps)
    expect(events).toHaveLength(0)
  })

  it('clamps an event that partially overlaps the clip end', () => {
    const shortClip: ClipGeometry = { ...untrimmed, durationFrames: 90 } // timeline [0,90)
    const [e] = mapVideoEventsToTimeline(shortClip, [
      { label: 'spans', startSec: 2.5, endSec: 4, confidence: 1 }, // 75..120
    ], fps)
    expect(e.startFrame).toBe(75)
    expect(e.endFrame).toBe(90) // clamped to clip end
  })
})
