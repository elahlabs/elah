import { beforeEach, describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'

/**
 * Track model: a single video track (the renderer composites one), with any
 * number of audio and text tracks. addTrack('video') is idempotent — it returns
 * the existing video track instead of creating a second.
 */
describe('TimelineEngine — track model (single video, multi audio/text)', () => {
  let engine: TimelineEngine

  beforeEach(() => {
    engine = new TimelineEngine({ fps: 30 })
  })

  const countKind = (kind: string) =>
    engine.getProject().tracks.filter((t) => t.kind === kind).length

  it('addTrack("video") a second time returns the existing video track', () => {
    const first = engine.addTrack('video')
    const second = engine.addTrack('video')
    expect(second.id).toBe(first.id)
    expect(countKind('video')).toBe(1)
  })

  it('allows multiple audio tracks', () => {
    engine.addTrack('audio')
    engine.addTrack('audio')
    engine.addTrack('audio')
    expect(countKind('audio')).toBe(3)
  })

  it('allows multiple elements tracks', () => {
    engine.addTrack('elements')
    engine.addTrack('elements')
    expect(countKind('elements')).toBe(2)
  })
})
