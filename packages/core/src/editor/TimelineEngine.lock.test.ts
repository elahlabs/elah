import { beforeEach, describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'

/**
 * Covers the `locked` track guard: a track flagged locked must reject structural
 * clip edits (remove / move / trim / split / clone) from the single mutation
 * funnel, so every caller (drag handles, keyboard, paste) honors it. Visibility
 * (`disabled`) and `muted` are handled separately by the resolver.
 */
describe('TimelineEngine — locked track guards', () => {
  let engine: TimelineEngine
  let trackId: string
  let clipId: string

  beforeEach(() => {
    engine = new TimelineEngine({ fps: 30 })
    trackId = engine.addTrack('elements').id
    clipId = engine.addClip({
      trackId,
      type: 'text',
      name: 'Text 1',
      text: { content: 'Hello' },
      startFrame: 10,
      durationFrames: 60,
    }).id
    engine.updateTrack(trackId, { locked: true })
  })

  it('isTrackLocked reflects the flag', () => {
    expect(engine.isTrackLocked(trackId)).toBe(true)
  })

  it('removeClip is rejected on a locked track', () => {
    engine.removeClip(clipId, trackId)
    expect(engine.findClip(clipId)?.clip).toBeDefined()
  })

  it('moveClip is rejected on a locked track', () => {
    engine.moveClip(clipId, trackId, trackId, 200)
    expect(engine.findClip(clipId)?.clip.startFrame).toBe(10)
  })

  it('trimClip is rejected on a locked track', () => {
    engine.trimClip(clipId, trackId, 10, 20)
    expect(engine.findClip(clipId)?.clip.durationFrames).toBe(60)
  })

  it('splitClip returns null on a locked track', () => {
    expect(engine.splitClip(clipId, trackId, 40)).toBeNull()
  })

  it('cloneClip returns null on a locked track', () => {
    expect(engine.cloneClip(clipId, trackId, 100)).toBeNull()
  })

  it('moving a clip INTO a locked track is rejected', () => {
    const free = engine.addTrack('elements').id
    const movable = engine.addClip({
      trackId: free,
      type: 'text',
      name: 'Text 2',
      text: { content: 'Move me' },
      startFrame: 0,
      durationFrames: 30,
    }).id

    engine.moveClip(movable, free, trackId, 0)

    // Rejected because the destination is locked — clip stays on its track.
    expect(engine.findClip(movable)?.clip.trackId).toBe(free)
  })

  it('unlocking the track restores edits', () => {
    engine.updateTrack(trackId, { locked: false })
    engine.trimClip(clipId, trackId, 10, 20)
    expect(engine.findClip(clipId)?.clip.durationFrames).toBe(20)
  })
})
