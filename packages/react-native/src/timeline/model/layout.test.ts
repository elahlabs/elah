import { describe, expect, it } from 'vitest'
import { buildFixture } from './__fixtures__/project'
import {
  CLIP_INSET_PX,
  clipRect,
  computeLaneSlots,
  laneAtY,
  laneForTrack,
  lanesHeight,
  MIN_CLIP_WIDTH_PX,
  seekFrameAtX,
} from './layout'

describe('computeLaneSlots', () => {
  it('stacks the tracks top to bottom in order', () => {
    const { v1, v2, elements, snapshot } = buildFixture()
    const lanes = computeLaneSlots(snapshot().tracks)
    expect(lanes.map((l) => [l.trackId, l.top, l.bottom])).toEqual([
      [v1.id, 0, 60],
      [v2.id, 60, 120],
      [elements.id, 120, 180],
    ])
    expect(lanes[2].kind).toBe('elements')
    expect(lanesHeight(lanes)).toBe(180)
  })

  it('sorts by track order even if the list arrives shuffled', () => {
    const { snapshot } = buildFixture()
    const shuffled = [...snapshot().tracks].reverse()
    const lanes = computeLaneSlots(shuffled)
    expect(lanes.map((l) => l.top)).toEqual([0, 60, 120])
    expect(lanes[0].kind).toBe('video')
  })

  it('carries the lock flag so reducers can refuse a locked drop target', () => {
    const { engine, v2, snapshot } = buildFixture()
    engine.updateTrack(v2.id, { locked: true })
    const lanes = computeLaneSlots(snapshot().tracks)
    expect(laneForTrack(lanes, v2.id)?.locked).toBe(true)
  })

  it('is empty for no tracks', () => {
    expect(computeLaneSlots([])).toEqual([])
    expect(lanesHeight([])).toBe(0)
  })
})

describe('laneAtY', () => {
  const lanes = computeLaneSlots(buildFixture().snapshot().tracks)

  it('uses half-open ranges so a boundary y belongs to the lane below it', () => {
    expect(laneAtY(lanes, 0)?.top).toBe(0)
    expect(laneAtY(lanes, 59.9)?.top).toBe(0)
    expect(laneAtY(lanes, 60)?.top).toBe(60)
  })

  it('is undefined above the first lane and below the last', () => {
    expect(laneAtY(lanes, -1)).toBeUndefined()
    expect(laneAtY(lanes, 180)).toBeUndefined()
  })
})

describe('clipRect', () => {
  const lane = { top: 60, height: 60 }

  it('maps frames to pixels with the inset the DOM ClipBlock uses', () => {
    const rect = clipRect({ startFrame: 30, durationFrames: 60 }, 4, lane)
    expect(rect).toEqual({ x: 120, y: 60 + CLIP_INSET_PX, width: 240, height: 60 - CLIP_INSET_PX * 2 })
  })

  it('never renders narrower than the minimum width', () => {
    const rect = clipRect({ startFrame: 0, durationFrames: 1 }, 0.02, lane)
    expect(rect.width).toBe(MIN_CLIP_WIDTH_PX)
  })

  it('accepts a custom inset', () => {
    const rect = clipRect({ startFrame: 0, durationFrames: 10 }, 1, lane, 0)
    expect(rect.y).toBe(60)
    expect(rect.height).toBe(60)
  })
})

describe('seekFrameAtX', () => {
  it('adds the scroll offset before converting to a frame', () => {
    expect(seekFrameAtX(100, 200, 4)).toBe(75)
  })

  it('clamps at frame 0 for taps left of the origin', () => {
    expect(seekFrameAtX(-50, 0, 4)).toBe(0)
  })
})
