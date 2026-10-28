/**
 * Gesture routing — how a stage drag writes to a clip that is already keyed.
 *
 * The defect this exists to fix: the preview overlays seeded a drag from the
 * AUTHORED transform and wrote the AUTHORED transform back. That is right for
 * the old `MotionSpec` ramps, which displace the clip by a frame-dependent
 * offset (so rendered == authored + offset, and adding the pointer delta to the
 * authored value moves the painted clip by exactly that delta). It is wrong for
 * keyframes, which are ABSOLUTE: a keyed channel replaces the authored one, so
 * dragging a keyed clip moved nothing on screen and wrote a value the user
 * could not see.
 */

import { describe, it, expect } from 'vitest'
import {
  clampLocalFrame,
  editableTransform,
  gestureBaseTransform,
  routeTransformPatch,
} from './keyframes'
import { DEFAULT_SHAPE_TRANSFORM } from '../resolver/textAnimation'
import type { Clip, ClipKeyframes, KeyframeChannel, Transform } from '../types'

const STAGE = { width: 1920, height: 1080 }
const CTX = { stage: STAGE }

const IDENTITY: Transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }

function keyed(spec: Partial<Record<KeyframeChannel, Array<[number, number]>>>): ClipKeyframes {
  const channels: ClipKeyframes['channels'] = {}
  for (const [channel, pairs] of Object.entries(spec) as [KeyframeChannel, Array<[number, number]>][]) {
    channels[channel] = {
      source: { kind: 'keyframes' },
      keys: pairs.map(([frame, value], i) => ({
        id: `${channel}-${i}`,
        frame,
        value,
        easing: 'linear' as const,
      })),
    }
  }
  return { channels }
}

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    trackId: 't1',
    type: 'shape',
    name: 'Shape',
    startFrame: 100,
    durationFrames: 60,
    sourceStartFrame: 0,
    sourceDurationFrames: 60,
    shapeKind: 'rect',
    ...overrides,
  }
}

describe('editableTransform', () => {
  it('fills every optional channel from the fallback', () => {
    expect(editableTransform(undefined, DEFAULT_SHAPE_TRANSFORM)).toEqual({
      ...DEFAULT_SHAPE_TRANSFORM,
      scaleX: 1,
      scaleY: 1,
    })
  })

  it('prefers the values the transform already carries', () => {
    const t = editableTransform({ ...IDENTITY, x: 0.1, scaleX: 3 }, DEFAULT_SHAPE_TRANSFORM)
    expect(t.x).toBe(0.1)
    expect(t.scaleX).toBe(3)
    expect(t.scaleY).toBe(1)
  })
})

describe('gestureBaseTransform', () => {
  it('returns the authored transform for an unkeyed clip', () => {
    const c = clip({ transform: { ...IDENTITY, x: 0.25 } })
    expect(gestureBaseTransform(c, 10, CTX, DEFAULT_SHAPE_TRANSFORM).x).toBe(0.25)
  })

  it('falls back to the renderer default when the clip was never placed', () => {
    const base = gestureBaseTransform(clip(), 0, CTX, DEFAULT_SHAPE_TRANSFORM)
    expect(base.scale).toBe(DEFAULT_SHAPE_TRANSFORM.scale)
  })

  /** The actual fix: a keyed channel is read at the playhead, not from `transform`. */
  it('reads a keyed channel at the playhead, not from the authored value', () => {
    const c = clip({
      transform: { ...IDENTITY, x: 0.9 },
      keyframes: keyed({ x: [[0, 0.0], [10, 1.0]] }),
    })
    expect(gestureBaseTransform(c, 5, CTX, DEFAULT_SHAPE_TRANSFORM).x).toBeCloseTo(0.5, 9)
    // Unkeyed channels still come from the authored transform.
    expect(gestureBaseTransform(c, 5, CTX, DEFAULT_SHAPE_TRANSFORM).y).toBe(0.5)
  })

  it('holds the last key past the end of the keyed range', () => {
    const c = clip({ keyframes: keyed({ x: [[0, 0.2], [10, 0.8]] }) })
    expect(gestureBaseTransform(c, 50, CTX, DEFAULT_SHAPE_TRANSFORM).x).toBeCloseTo(0.8, 9)
  })
})

describe('routeTransformPatch', () => {
  const next = editableTransform({ ...IDENTITY, x: 0.3, y: 0.4 }, IDENTITY)

  it('writes the plain transform when nothing is keyed — byte-identical to before', () => {
    expect(routeTransformPatch(clip(), next, ['x', 'y'], 10, CTX)).toEqual({ transform: next })
  })

  it('writes a key at the playhead for a keyed channel the gesture drives', () => {
    const c = clip({
      transform: { ...IDENTITY, x: 0.9 },
      keyframes: keyed({ x: [[0, 0.1]] }),
    })
    const patch = routeTransformPatch(c, next, ['x', 'y'], 20, CTX)

    const keys = patch.keyframes!.channels.x!.keys
    expect(keys.map((k) => [k.frame, k.value])).toEqual([[0, 0.1], [20, 0.3]])
    // The authored x is left alone: the keys decide what renders, so moving the
    // static value would change nothing now and everything later.
    expect(patch.transform!.x).toBe(0.9)
    // An unkeyed channel the gesture drives lands on the transform as always.
    expect(patch.transform!.y).toBe(0.4)
  })

  it('does not key a channel the gesture did not declare', () => {
    // Rotation is keyed, but a MOVE drives only x and y. The patch must leave
    // `keyframes` out entirely — `updateClip` assigns the patch's own keys, so
    // an omitted field is what "leave the existing keys alone" looks like.
    const c = clip({ keyframes: keyed({ rotation: [[0, 0]] }) })
    const patch = routeTransformPatch(c, next, ['x', 'y'], 20, CTX)
    expect('keyframes' in patch).toBe(false)
    expect({ ...c, ...patch }.keyframes!.channels.rotation!.keys).toHaveLength(1)
  })

  it('does not key an unkeyed channel the gesture does drive', () => {
    const c = clip({ keyframes: keyed({ x: [[0, 0.1]] }) })
    const patch = routeTransformPatch(c, next, ['x', 'y'], 20, CTX)
    expect(patch.keyframes!.channels.y).toBeUndefined()
  })

  /**
   * A drag calls this once per pointermove. The key must be REPLACED each time,
   * not appended, or a single gesture would leave a pile of keys on one frame.
   */
  it('replaces the key in place across a whole gesture, keeping its id', () => {
    let c = clip({ keyframes: keyed({ x: [[0, 0.1]] }) })
    let lastId = ''
    for (const x of [0.2, 0.3, 0.4]) {
      const patch = routeTransformPatch(
        c,
        editableTransform({ ...IDENTITY, x }, IDENTITY),
        ['x'],
        20,
        CTX,
      )
      c = { ...c, ...patch }
      const at20 = patch.keyframes!.channels.x!.keys.filter((k) => k.frame === 20)
      expect(at20).toHaveLength(1)
      if (lastId) expect(at20[0].id).toBe(lastId)
      lastId = at20[0].id
    }
    expect(c.keyframes!.channels.x!.keys.map((k) => k.value)).toEqual([0.1, 0.4])
  })

  it('bakes a baseline transform when keying a clip that had none', () => {
    const c = clip({ keyframes: keyed({ x: [[0, 0.1]] }) })
    const patch = routeTransformPatch(c, next, ['x'], 20, CTX)
    // `next` carried the gesture's own values for the unkeyed channels, and the
    // keyed one kept the default because the clip had no authored transform.
    expect(patch.transform).toBeDefined()
    expect(patch.transform!.y).toBe(0.4)
  })
})

describe('clampLocalFrame', () => {
  const c = clip()

  it('converts an absolute playhead into a clip-relative frame', () => {
    expect(clampLocalFrame(c, 110)).toBe(10)
  })

  it('clamps outside the clip to its first and last visible frames', () => {
    expect(clampLocalFrame(c, 0)).toBe(0)
    expect(clampLocalFrame(c, 9999)).toBe(59)
  })

  it('never returns a negative frame for a zero-length clip', () => {
    expect(clampLocalFrame({ startFrame: 0, durationFrames: 0 }, 5)).toBe(0)
  })
})
