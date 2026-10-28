import { describe, expect, it } from 'vitest'
import { baselineTransform, clearKeyframeChannel, removeKeyframe, setKeyframe } from './keyframes'
import { moveKeysAtFrames } from './keyframes'
import { DEFAULT_SHAPE_TRANSFORM, DEFAULT_TEXT_TRANSFORM } from '../resolver/textAnimation'
import { resolveDrawRect, transformFromContainRect } from '../renderer/gpu/layers/drawRect'
import type { Clip, Transform } from '../types'

const STAGE = { width: 1080, height: 1920 }

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    trackId: 't1',
    type: 'image',
    name: 'C',
    startFrame: 0,
    durationFrames: 60,
    sourceStartFrame: 0,
    sourceDurationFrames: 60,
    src: 'a.png',
    ...overrides,
  }
}

describe('baselineTransform', () => {
  it('returns an authored transform untouched', () => {
    const tf: Transform = { x: 0.2, y: 0.3, scale: 2, rotation: 1, anchor: { x: 0.5, y: 0.5 } }
    expect(baselineTransform(makeClip({ transform: tf }), { stage: STAGE })).toBe(tf)
  })

  it('uses the exact renderer defaults for text and shape', () => {
    expect(baselineTransform(makeClip({ type: 'text' }), { stage: STAGE })).toBe(DEFAULT_TEXT_TRANSFORM)
    expect(baselineTransform(makeClip({ type: 'shape' }), { stage: STAGE })).toBe(DEFAULT_SHAPE_TRANSFORM)
  })

  it('media with known content size: the bake is the contain placement of the CROPPED content', () => {
    const clip = makeClip({ type: 'video', crop: { x: 0, y: 0, width: 0.5, height: 1 } })
    const content = { width: 1920, height: 1080 }
    const tf = baselineTransform(clip, { stage: STAGE, content })!
    expect(tf).toEqual(transformFromContainRect(960, 1080, STAGE.width, STAGE.height))
    // Visual no-op: the baked transform draws the same rect as no transform.
    const explicit = resolveDrawRect(tf, STAGE.width, STAGE.height, content.width, content.height, clip.crop)
    const implicit = resolveDrawRect(undefined, STAGE.width, STAGE.height, content.width, content.height, clip.crop)
    expect(explicit.x).toBeCloseTo(implicit.x)
    expect(explicit.y).toBeCloseTo(implicit.y)
    expect(explicit.width).toBeCloseTo(implicit.width)
    expect(explicit.height).toBeCloseTo(implicit.height)
  })

  it('media with UNKNOWN content size: falls back to the stage, matching the renderer’s own fallback', () => {
    const tf = baselineTransform(makeClip({ type: 'image' }), { stage: STAGE })!
    const explicit = resolveDrawRect(tf, STAGE.width, STAGE.height)
    const implicit = resolveDrawRect(undefined, STAGE.width, STAGE.height)
    expect(explicit).toEqual({ ...implicit, rotation: 0 })
  })

  it('audio and freehand have no baseline', () => {
    expect(baselineTransform(makeClip({ type: 'audio' }), { stage: STAGE })).toBeUndefined()
    expect(baselineTransform(makeClip({ type: 'freehand' }), { stage: STAGE })).toBeUndefined()
  })
})

describe('setKeyframe', () => {
  it('the first TRANSFORM key on a transform-less clip bakes the baseline into the same patch', () => {
    const clip = makeClip({ type: 'image' })
    const patch = setKeyframe(clip, 'scale', 10, { stage: STAGE, content: { width: 500, height: 500 } })
    expect(patch.transform).toEqual(transformFromContainRect(500, 500, STAGE.width, STAGE.height))
    expect(patch.keyframes!.channels.scale!.keys).toHaveLength(1)
    // Default value is the channel's current value = the baked scale.
    expect(patch.keyframes!.channels.scale!.keys[0].value).toBe(patch.transform!.scale)
    expect(patch.keyframes!.channels.scale!.keys[0].frame).toBe(10)
    expect(patch.keyframes!.channels.scale!.source).toEqual({ kind: 'keyframes' })
  })

  it('a non-transform key never bakes a transform', () => {
    const patch = setKeyframe(makeClip(), 'opacity', 0, { stage: STAGE }, 0.5)
    expect(patch.transform).toBeUndefined()
    expect(patch.keyframes!.channels.opacity!.keys[0].value).toBe(0.5)
  })

  it('does not re-bake when the clip already has a transform', () => {
    const tf: Transform = { x: 0.1, y: 0.1, scale: 3, rotation: 0, anchor: { x: 0.5, y: 0.5 } }
    const patch = setKeyframe(makeClip({ transform: tf }), 'x', 0, { stage: STAGE })
    expect(patch.transform).toBeUndefined()
    expect(patch.keyframes!.channels.x!.keys[0].value).toBe(0.1)
  })

  it('replaces the key on the same frame, keeping its id, and keeps keys sorted', () => {
    let clip = makeClip({ transform: DEFAULT_TEXT_TRANSFORM })
    clip = { ...clip, ...setKeyframe(clip, 'x', 20, { stage: STAGE }, 0.8) }
    clip = { ...clip, ...setKeyframe(clip, 'x', 5, { stage: STAGE }, 0.2) }
    const firstId = clip.keyframes!.channels.x!.keys.find((k) => k.frame === 20)!.id
    clip = { ...clip, ...setKeyframe(clip, 'x', 20, { stage: STAGE }, 0.9, { easing: 'back-out' }) }
    const keys = clip.keyframes!.channels.x!.keys
    expect(keys.map((k) => k.frame)).toEqual([5, 20])
    expect(keys[1].id).toBe(firstId)
    expect(keys[1].value).toBe(0.9)
    expect(keys[1].easing).toBe('back-out')
  })

  it('clamps a negative / non-finite frame to 0 and falls back to the current value for a bad value', () => {
    const patch = setKeyframe(makeClip({ opacity: 0.3 }), 'opacity', NaN, { stage: STAGE }, Infinity)
    const k = patch.keyframes!.channels.opacity!.keys[0]
    expect(k.frame).toBe(0)
    expect(k.value).toBe(0.3)
  })

  it('leaves other channels alone', () => {
    let clip = makeClip({ transform: DEFAULT_TEXT_TRANSFORM })
    clip = { ...clip, ...setKeyframe(clip, 'x', 0, { stage: STAGE }, 0.1) }
    clip = { ...clip, ...setKeyframe(clip, 'y', 0, { stage: STAGE }, 0.9) }
    expect(clip.keyframes!.channels.x!.keys[0].value).toBe(0.1)
    expect(clip.keyframes!.channels.y!.keys[0].value).toBe(0.9)
  })
})

describe('removeKeyframe / clearKeyframeChannel', () => {
  function keyed(): Clip {
    let clip = makeClip({ transform: DEFAULT_TEXT_TRANSFORM })
    clip = { ...clip, ...setKeyframe(clip, 'x', 0, { stage: STAGE }, 0.1, { id: 'a' }) }
    clip = { ...clip, ...setKeyframe(clip, 'x', 10, { stage: STAGE }, 0.9, { id: 'b' }) }
    clip = { ...clip, ...setKeyframe(clip, 'opacity', 0, { stage: STAGE }, 0.5, { id: 'o' }) }
    return clip
  }

  it('removes one key by id', () => {
    const patch = removeKeyframe(keyed(), 'x', 'a')
    expect(patch.keyframes!.channels.x!.keys.map((k) => k.id)).toEqual(['b'])
    expect(patch.keyframes!.channels.opacity).toBeDefined()
  })

  it('drops a channel that is left empty, and drops keyframes entirely when no channel remains', () => {
    let clip = keyed()
    clip = { ...clip, ...removeKeyframe(clip, 'x', 'a') }
    clip = { ...clip, ...removeKeyframe(clip, 'x', 'b') }
    expect(clip.keyframes!.channels.x).toBeUndefined()
    clip = { ...clip, ...removeKeyframe(clip, 'opacity', 'o') }
    expect(clip.keyframes).toBeUndefined()
  })

  it('is a no-op for an unknown channel or id', () => {
    expect(removeKeyframe(keyed(), 'volume', 'zzz')).toEqual({})
    const same = removeKeyframe(keyed(), 'x', 'zzz')
    expect(same.keyframes!.channels.x!.keys).toHaveLength(2)
  })

  it('clearKeyframeChannel drops the whole channel and keeps the baked transform', () => {
    const clip = keyed()
    const patch = clearKeyframeChannel(clip, 'x')
    expect(patch.keyframes!.channels.x).toBeUndefined()
    expect(patch.keyframes!.channels.opacity).toBeDefined()
    expect(patch.transform).toBeUndefined() // untouched → clip keeps its own
    expect(clearKeyframeChannel(clip, 'volume')).toEqual({})
  })
})

describe('moveKeysAtFrames (PV-T1)', () => {
  const keyed = () =>
    makeClip({
      durationFrames: 60,
      keyframes: {
        channels: {
          opacity: {
            source: { kind: 'keyframes' },
            keys: [
              { id: 'o0', frame: 0, value: 0, easing: 'linear' },
              { id: 'o1', frame: 10, value: 1, easing: 'linear' },
              { id: 'o2', frame: 20, value: 0.5, easing: 'linear' },
              { id: 'o3', frame: 40, value: 1, easing: 'linear' },
            ],
          },
          x: {
            source: { kind: 'keyframes' },
            keys: [
              { id: 'x0', frame: 10, value: 0.2, easing: 'linear' },
              { id: 'x1', frame: 50, value: 0.8, easing: 'linear' },
            ],
          },
        },
      },
    })
  const frames = (clip: Clip, patch: Partial<Clip>, channel: 'opacity' | 'x') =>
    (patch.keyframes ?? clip.keyframes)!.channels[channel]!.keys.map((k) => k.frame)

  it('moves every key on the selected frames, on every channel', () => {
    const clip = keyed()
    const patch = moveKeysAtFrames(clip, [10, 20], 5)
    expect(frames(clip, patch, 'opacity')).toEqual([0, 15, 25, 40])
    expect(frames(clip, patch, 'x')).toEqual([15, 50])
  })

  it('clamps the move to the clip', () => {
    const clip = keyed()
    expect(frames(clip, moveKeysAtFrames(clip, [40, 50], 30), 'x')).toEqual([10, 59])
    expect(frames(clip, moveKeysAtFrames(clip, [0, 10], -5), 'opacity')).toEqual([0, 10, 20, 40])
  })

  it('refuses a move that would land on a key that is not moving', () => {
    const clip = keyed()
    expect(moveKeysAtFrames(clip, [10], 10)).toEqual({})
  })

  it('does nothing for no frames, no delta, or frames outside the clip', () => {
    const clip = keyed()
    expect(moveKeysAtFrames(clip, [], 5)).toEqual({})
    expect(moveKeysAtFrames(clip, [10], 0)).toEqual({})
    expect(moveKeysAtFrames(clip, [90], -5)).toEqual({})
  })
})
