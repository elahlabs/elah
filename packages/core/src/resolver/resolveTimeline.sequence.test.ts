import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { resolveTimeline } from './resolveTimeline'
import type { ActiveSequenceClip } from './scene'

/**
 * Sequence clips in the resolver (PV-P8a).
 *
 * `sequenceFrameIndex` (resolver/sequence.ts) already has its own exhaustive
 * arithmetic tests; these prove the resolver WIRES it up — the right clip, at
 * the right index, in `scene.sequences`, and only when it belongs there.
 */

function engineWithSequence(overrides: { loop?: boolean } = {}) {
  const engine = new TimelineEngine({ fps: 30 })
  const track = engine.addTrack('video')
  const clip = engine.addClip({
    type: 'sequence',
    trackId: track.id,
    startFrame: 0,
    durationFrames: 90,
    src: 'blob:wave.gif',
    sequence: { kind: 'animated-image', frameCount: 4, fps: 10, ...overrides },
  })
  return { engine, track, clip }
}

describe('resolveTimeline — sequence clips (PV-P8a)', () => {
  it('samples the looping sequence at 0, 3, 6, 9, 12 project frames', () => {
    const { engine, clip } = engineWithSequence({ loop: true })
    const indices = [0, 3, 6, 9, 12].map(
      (frame) => (resolveTimeline(frame, engine.getProject()).sequences!.find((s) => s.id === clip.id)!).frameIndex,
    )
    expect(indices).toEqual([0, 1, 2, 3, 0])
  })

  it('holds at the last frame without loop', () => {
    const { engine, clip } = engineWithSequence()
    const scene = resolveTimeline(13, engine.getProject())
    expect(scene.sequences!.find((s) => s.id === clip.id)!.frameIndex).toBe(3)
  })

  it('the active item carries src, frameCount, loop and the track zIndex, with no transform key', () => {
    const { engine, track, clip } = engineWithSequence({ loop: true })
    const scene = resolveTimeline(0, engine.getProject())
    const item = scene.sequences!.find((s) => s.id === clip.id)!
    expect(item.src).toBe('blob:wave.gif')
    expect(item.frameCount).toBe(4)
    expect(item.loop).toBe(true)
    // A video track's zIndex is `order * 1000` (resolveTimeline.ts); this
    // engine already seeds a default track, so the added one is not
    // necessarily order 0 — the point is that it carries a real track
    // zIndex, not a hardcoded one.
    expect(item.zIndex).toBe(track.order * 1000)
    expect('transform' in item).toBe(false)
  })

  it('a frames sequence carries frameUrlTemplate and no src', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const track = engine.addTrack('video')
    const clip = engine.addClip({
      type: 'sequence',
      trackId: track.id,
      startFrame: 0,
      durationFrames: 90,
      sequence: { kind: 'frames', frameUrlTemplate: 'f/{frame}.png', frameCount: 4, fps: 10 },
    })
    const scene = resolveTimeline(0, engine.getProject())
    const item = scene.sequences!.find((s) => s.id === clip.id)!
    expect(item.frameUrlTemplate).toBe('f/{frame}.png')
    expect('src' in item).toBe(false)
  })

  it('a project with no sequence clip gains no `sequences` key', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const track = engine.addTrack('video')
    engine.addClip({ type: 'image', trackId: track.id, startFrame: 0, durationFrames: 30, src: 'a.png' })
    const scene = resolveTimeline(0, engine.getProject())
    expect('sequences' in scene).toBe(false)
  })

  it('a sequence clip that is not drawable is skipped entirely', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const track = engine.addTrack('video')
    // A 'frames' sequence with no usable placeholder in its template.
    engine.addClip({
      type: 'sequence',
      trackId: track.id,
      startFrame: 0,
      durationFrames: 30,
      sequence: { kind: 'frames', frameUrlTemplate: 'no-placeholder.png', frameCount: 4, fps: 10 },
    })
    const scene = resolveTimeline(0, engine.getProject())
    expect('sequences' in scene).toBe(false)
  })

  it('a fade transition between an image clip and a sequence clip carries the sequence into the window before its own start', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const track = engine.addTrack('video')
    const image = engine.addClip({ type: 'image', trackId: track.id, startFrame: 0, durationFrames: 30, src: 'a.png' })
    const sequence = engine.addClip({
      type: 'sequence',
      trackId: track.id,
      startFrame: 30,
      durationFrames: 60,
      src: 'blob:wave.gif',
      sequence: { kind: 'animated-image', frameCount: 4, fps: 10 },
    })
    engine.addTransition({ fromClipId: image.id, toClipId: sequence.id, trackId: track.id, kind: 'fade', durationFrames: 20 })

    const scene = resolveTimeline(25, engine.getProject())
    const item = scene.sequences!.find((s) => s.id === sequence.id) as ActiveSequenceClip | undefined
    expect(item).toBeDefined()
    expect(item!.frameIndex).toBe(0)
    expect(scene.transitions[0]!.toClipId).toBe(sequence.id)
  })
})
