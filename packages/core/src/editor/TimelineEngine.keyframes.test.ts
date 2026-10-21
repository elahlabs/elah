import { beforeEach, describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'
import { sampleChannel } from '../resolver/keyframes'
import type { ClipKeyframes, Keyframe } from '../types'

/**
 * Keyframe frames are clip-relative, so every engine operation that changes
 * where a clip's frame 0 sits, or how long the clip is, has to remap them.
 * These pin the contract: trim shifts (losslessly), speed scales (in the same
 * undo entry), split re-divides (see visitor/split.test.ts), and move / clone
 * leave the numbers alone.
 */

function key(frame: number, value: number): Keyframe {
  return { id: `k${frame}`, frame, value, easing: 'linear' }
}

const KF: ClipKeyframes = {
  channels: { x: { source: { kind: 'keyframes' }, keys: [key(0, 0), key(10, 1), key(20, 2)] } },
}

describe('TimelineEngine — keyframes across timeline edits', () => {
  let engine: TimelineEngine
  let trackId: string

  beforeEach(() => {
    engine = new TimelineEngine({ fps: 30 })
    trackId = engine.addTrack('video').id
  })

  function addKeyedClip(startFrame = 0) {
    const clip = engine.addClip({
      trackId,
      type: 'video',
      name: 'V',
      src: 'fake.mp4',
      startFrame,
      durationFrames: 30,
    })
    engine.updateClip(clip.id, trackId, { sourceDurationFrames: 60, keyframes: KF })
    return clip.id
  }

  function framesOf(clipId: string): number[] {
    return engine.findClip(clipId)!.clip.keyframes!.channels.x!.keys.map((k) => k.frame)
  }

  it('a left-edge trim shifts every key by the negated delta and keeps out-of-range keys', () => {
    const id = addKeyedClip()
    engine.trimClip(id, trackId, 5, 25)
    expect(framesOf(id)).toEqual([-5, 5, 15])
    // The curve on the timeline is unchanged: what was at timeline frame 10 still is.
    const keys = engine.findClip(id)!.clip.keyframes!.channels.x!.keys
    expect(sampleChannel(keys, 10 - 5)).toBe(1)
  })

  it('trim is lossless: trimming back out restores the exact keys', () => {
    const id = addKeyedClip()
    const before = JSON.stringify(engine.findClip(id)!.clip.keyframes)
    engine.trimClip(id, trackId, 5, 25)
    engine.trimClip(id, trackId, 0, 30)
    expect(JSON.stringify(engine.findClip(id)!.clip.keyframes)).toBe(before)
  })

  it('a right-edge trim does not touch keys at all', () => {
    const id = addKeyedClip()
    const before = engine.findClip(id)!.clip.keyframes
    engine.trimClip(id, trackId, 0, 15)
    expect(engine.findClip(id)!.clip.keyframes).toBe(before)
  })

  it('setClipSpeed scales key frames by the new÷old duration inside the SAME undo entry', () => {
    const id = addKeyedClip()
    engine.setClipSpeed(id, trackId, 2) // 30 → 15 frames
    expect(engine.findClip(id)!.clip.durationFrames).toBe(15)
    expect(framesOf(id)).toEqual([0, 5, 10])

    engine.undo()
    const clip = engine.findClip(id)!.clip
    expect(clip.speed).toBeUndefined()
    expect(clip.durationFrames).toBe(30)
    expect(framesOf(id)).toEqual([0, 10, 20])
  })

  it('moveClip leaves keys untouched — relative frames are correct by construction', () => {
    const id = addKeyedClip()
    const before = engine.findClip(id)!.clip.keyframes
    engine.moveClip(id, trackId, trackId, 100)
    expect(engine.findClip(id)!.clip.startFrame).toBe(100)
    expect(engine.findClip(id)!.clip.keyframes).toBe(before)
  })

  it('cloneClip copies keys verbatim', () => {
    const id = addKeyedClip()
    const cloneId = engine.cloneClip(id, trackId, 60)!
    expect(engine.findClip(cloneId)!.clip.keyframes).toEqual(KF)
  })

  it('splitClip hands each half its own re-divided keys (one undo entry)', () => {
    const id = addKeyedClip()
    const [leftId, rightId] = engine.splitClip(id, trackId, 15)!
    expect(framesOf(leftId)).toEqual([0, 10, 15])
    expect(framesOf(rightId)).toEqual([0, 5])
    engine.undo()
    expect(framesOf(id)).toEqual([0, 10, 20])
    expect(engine.findClip(rightId)).toBeNull()
  })
})
