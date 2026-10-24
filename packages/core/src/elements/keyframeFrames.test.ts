/**
 * Frame-level keyframe helpers — the ones the timeline lane and the Animate
 * panel share.
 *
 * The unit here is a FRAME, not a key. A user who keys "Position" creates two
 * keys (x and y) but sees one diamond, so navigation, dragging, deletion and
 * the easing picker all operate on every channel keyed at a frame together.
 */

import { describe, it, expect } from 'vitest'
import {
  channelKeys,
  clearAllKeyframes,
  hasKeyAtFrame,
  keyDragRange,
  keyFrameUnion,
  keySnapFrames,
  keyedChannels,
  moveKeysAtFrame,
  nextKeyFrame,
  prevKeyFrame,
  removeKeysAtFrame,
  setKeysEasingAtFrame,
} from './keyframes'
import type { Clip, ClipKeyframes, KeyframeChannel } from '../types'

function keys(spec: Partial<Record<KeyframeChannel, number[]>>): ClipKeyframes {
  const channels: ClipKeyframes['channels'] = {}
  for (const [channel, frames] of Object.entries(spec) as [KeyframeChannel, number[]][]) {
    channels[channel] = {
      source: { kind: 'keyframes' },
      keys: frames.map((frame, i) => ({
        id: `${channel}-${i}`,
        frame,
        value: frame / 100,
        easing: 'linear' as const,
      })),
    }
  }
  return { channels }
}

function clip(spec: Partial<Record<KeyframeChannel, number[]>> = {}, durationFrames = 60): Clip {
  return {
    id: 'c1',
    trackId: 't1',
    type: 'shape',
    name: 'Shape',
    startFrame: 100,
    durationFrames,
    sourceStartFrame: 0,
    sourceDurationFrames: durationFrames,
    shapeKind: 'rect',
    ...(Object.keys(spec).length ? { keyframes: keys(spec) } : {}),
  }
}

describe('queries', () => {
  it('reports the keyed channels in catalogue order', () => {
    expect(keyedChannels(clip({ opacity: [0], x: [0], scale: [5] }))).toEqual(['x', 'scale', 'opacity'])
  })

  it('unions frames across channels and de-duplicates', () => {
    expect(keyFrameUnion(clip({ x: [0, 10], y: [0, 10], opacity: [5] }))).toEqual([0, 5, 10])
  })

  it('an unkeyed clip has no frames and no channels', () => {
    expect(keyFrameUnion(clip())).toEqual([])
    expect(keyedChannels(clip())).toEqual([])
    expect(channelKeys(clip(), 'x')).toEqual([])
  })

  it('hasKeyAtFrame matches only exact frames', () => {
    const c = clip({ x: [0, 12] })
    expect(hasKeyAtFrame(c, 12)).toBe(true)
    expect(hasKeyAtFrame(c, 11)).toBe(false)
  })
})

describe('navigation', () => {
  const c = clip({ x: [0, 10], opacity: [4, 30] })

  it('steps strictly before and after, never landing on the current frame', () => {
    expect(prevKeyFrame(c, 10)).toBe(4)
    expect(nextKeyFrame(c, 10)).toBe(30)
    expect(prevKeyFrame(c, 11)).toBe(10)
    expect(nextKeyFrame(c, 9)).toBe(10)
  })

  it('returns undefined at the ends so the caller can disable its button', () => {
    expect(prevKeyFrame(c, 0)).toBeUndefined()
    expect(nextKeyFrame(c, 30)).toBeUndefined()
    expect(prevKeyFrame(clip(), 5)).toBeUndefined()
  })
})

describe('keyDragRange', () => {
  it('stops one frame short of the neighbours on every channel keyed there', () => {
    // x is keyed at 0/10/20 and opacity at 5/10/12. Dragging frame 10 must
    // respect BOTH neighbour sets, so the tighter opacity bounds win.
    expect(keyDragRange(clip({ x: [0, 10, 20], opacity: [5, 10, 12] }), 10)).toEqual({ min: 6, max: 11 })
  })

  it('is bounded by the clip when there is no neighbour', () => {
    expect(keyDragRange(clip({ x: [10] }), 10)).toEqual({ min: 0, max: 59 })
  })

  it('ignores channels that have no key on that frame', () => {
    expect(keyDragRange(clip({ x: [10], opacity: [11] }), 10)).toEqual({ min: 0, max: 59 })
  })

  it('never returns an inverted range', () => {
    const r = keyDragRange(clip({ x: [4, 5, 6] }), 5)
    expect(r.max).toBeGreaterThanOrEqual(r.min)
  })
})

describe('keySnapFrames', () => {
  it('offers the other keys and both clip ends, never the dragged frame', () => {
    expect(keySnapFrames(clip({ x: [0, 10, 20] }), 10)).toEqual([0, 20, 59])
  })

  it('includes the playhead when one is given', () => {
    expect(keySnapFrames(clip({ x: [10] }), 10, 33)).toContain(33)
  })
})

describe('moveKeysAtFrame', () => {
  it('moves every channel keyed at that frame, and only those', () => {
    const c = clip({ x: [0, 10], y: [10], opacity: [5] })
    const patch = moveKeysAtFrame(c, 10, 20)
    const ch = patch.keyframes!.channels
    expect(ch.x!.keys.map((k) => k.frame)).toEqual([0, 20])
    expect(ch.y!.keys.map((k) => k.frame)).toEqual([20])
    expect(ch.opacity!.keys.map((k) => k.frame)).toEqual([5])
  })

  it('preserves each key id and value, so a drag is a move not a re-create', () => {
    const patch = moveKeysAtFrame(clip({ x: [0, 10] }), 10, 25)
    const moved = patch.keyframes!.channels.x!.keys.find((k) => k.frame === 25)!
    expect(moved.id).toBe('x-1')
    expect(moved.value).toBe(0.1)
  })

  it('clamps into the clip', () => {
    const patch = moveKeysAtFrame(clip({ x: [10] }), 10, 999)
    expect(patch.keyframes!.channels.x!.keys[0].frame).toBe(59)
  })

  it('returns an empty patch when nothing would change', () => {
    expect(moveKeysAtFrame(clip({ x: [10] }), 10, 10)).toEqual({})
    expect(moveKeysAtFrame(clip({ x: [10] }), 3, 8)).toEqual({})
  })

  /**
   * A drag is many calls with the SAME gesture-start clip, so repeatedly
   * moving the same source frame must keep landing on the pointer's frame
   * rather than chasing a key that already moved.
   */
  it('is idempotent against the gesture-start clip', () => {
    const start = clip({ x: [0, 10] })
    const a = moveKeysAtFrame(start, 10, 20)
    const b = moveKeysAtFrame(start, 10, 20)
    expect(a).toEqual(b)
  })
})

describe('removeKeysAtFrame', () => {
  it('removes every channel keyed at the frame', () => {
    const patch = removeKeysAtFrame(clip({ x: [0, 10], y: [10] }), 10)
    expect(patch.keyframes!.channels.x!.keys.map((k) => k.frame)).toEqual([0])
    expect(patch.keyframes!.channels.y).toBeUndefined()
  })

  it('clears the whole field when the last key goes', () => {
    expect(removeKeysAtFrame(clip({ x: [10] }), 10)).toEqual({ keyframes: undefined })
  })

  it('is a no-op on an empty frame', () => {
    expect(removeKeysAtFrame(clip({ x: [10] }), 11)).toEqual({})
  })
})

describe('setKeysEasingAtFrame', () => {
  it('re-curves every channel at the frame and leaves the rest alone', () => {
    const patch = setKeysEasingAtFrame(clip({ x: [0, 10], y: [10] }), 10, 'back-out')
    const ch = patch.keyframes!.channels
    expect(ch.x!.keys.map((k) => k.easing)).toEqual(['linear', 'back-out'])
    expect(ch.y!.keys[0].easing).toBe('back-out')
  })

  it('is a no-op on an empty frame', () => {
    expect(setKeysEasingAtFrame(clip({ x: [10] }), 3, 'back-out')).toEqual({})
  })
})

describe('clearAllKeyframes', () => {
  it('clears the field, and is a no-op when there is nothing to clear', () => {
    expect(clearAllKeyframes(clip({ x: [0] }))).toEqual({ keyframes: undefined })
    expect(clearAllKeyframes(clip())).toEqual({})
  })
})
