import { describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'
import { isUnlimitedClipType, maxTrimDuration, minLeftTrimStart } from '../utils/timelineMath'
import { rippleEdgeTrim } from '../actions/ripple'
import { resolveTimeline } from '../resolver/resolveTimeline'

/**
 * Still images through the engine's trim rules: an image has no length of its
 * own, so the window it was inserted with (and any `assetFrames` a host
 * stamped on it) must not cap how far it can be stretched — the same rule
 * text and shape clips already get.
 */

function addImage(engine: TimelineEngine, overrides: Partial<{ startFrame: number; durationFrames: number; assetFrames: number }> = {}) {
  const track = engine.addTrack('video')
  const clip = engine.addClip({
    type: 'image',
    trackId: track.id,
    startFrame: overrides.startFrame ?? 0,
    durationFrames: overrides.durationFrames ?? 90,
    src: 'blob:still',
  })
  if (overrides.assetFrames !== undefined) engine.updateClip(clip.id, track.id, { assetFrames: overrides.assetFrames })
  return { track, clip }
}

const find = (engine: TimelineEngine, trackId: string, id: string) =>
  engine.getProject().clips[trackId]!.find((c) => c.id === id)!

describe('TimelineEngine — still image clips extend freely', () => {
  it('trimClip stretches an image past the length it was inserted with', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const { track, clip } = addImage(engine)
    expect(clip.sourceDurationFrames).toBe(90)
    engine.trimClip(clip.id, track.id, 0, 300)
    expect(find(engine, track.id, clip.id).durationFrames).toBe(300)
  })

  it('an assetFrames stamp does not cap an image either', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const { track, clip } = addImage(engine, { assetFrames: 90 })
    engine.trimClip(clip.id, track.id, 0, 240)
    expect(find(engine, track.id, clip.id).durationFrames).toBe(240)
  })

  it('a left-edge drag grows an image back toward frame 0 and keeps sourceStartFrame', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const { track, clip } = addImage(engine, { startFrame: 60 })
    engine.trimClip(clip.id, track.id, 10, 140)
    const trimmed = find(engine, track.id, clip.id)
    expect(trimmed.startFrame).toBe(10)
    expect(trimmed.durationFrames).toBe(140)
    expect(trimmed.sourceStartFrame).toBe(0)
  })

  it('still refuses to grow into the next clip on the track', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const { track, clip } = addImage(engine)
    engine.addClip({ type: 'image', trackId: track.id, startFrame: 120, durationFrames: 30, src: 'blob:next' })
    engine.trimClip(clip.id, track.id, 0, 200)
    expect(find(engine, track.id, clip.id).durationFrames).toBe(90)
  })

  it('the stretched image is drawn on its last frame', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const { track, clip } = addImage(engine)
    engine.trimClip(clip.id, track.id, 0, 300)
    expect(resolveTimeline(299, engine.getProject()).images.some((i) => i.id === clip.id)).toBe(true)
  })

  it('a ripple trim of the end extends an image past its window too', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const { track, clip } = addImage(engine)
    const result = rippleEdgeTrim(engine, clip.id, 'end', 200)
    expect(result.ok).toBe(true)
    expect(find(engine, track.id, clip.id).durationFrames).toBe(200)
  })

  it('the drag-preview helpers agree with the engine', () => {
    expect(isUnlimitedClipType('image')).toBe(true)
    expect(maxTrimDuration({ type: 'image', sourceDurationFrames: 90, speed: undefined })).toBe(Infinity)
    expect(minLeftTrimStart({ type: 'image', startFrame: 60, sourceStartFrame: 0, speed: undefined })).toBe(0)
  })
})
