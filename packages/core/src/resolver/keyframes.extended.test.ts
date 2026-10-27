import { describe, expect, it } from 'vitest'
import type { Clip, ClipKeyframes, Keyframe } from '../types'
import {
  hasKeyframes,
  isKeyframeChannelName,
  parseEffectChannel,
  presentKeyframeChannels,
  remapKeyframes,
  sampleExtendedChannels,
  sampleKeyframes,
  splitKeyframes,
} from './keyframes'
import {
  allKeyedChannels,
  keyedChannels,
  keyFrameUnion,
  moveKeysAtFrame,
  removeKeysAtFrame,
  setKeyframe,
} from '../elements/keyframes'

/**
 * Extended channels — `time`, `fx.<id>.<param>`, `mask.<field>` — ride the
 * same lane, remap, split and frame helpers as the nine builtins.
 */

const BASE = { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }
const CTX = { stage: { width: 1080, height: 1920 } }

function key(frame: number, value: number, id = `k${frame}`): Keyframe {
  return { id, frame, value, easing: 'linear' }
}
function track(keys: Keyframe[]) {
  return { source: { kind: 'keyframes' as const }, keys }
}
function clip(keyframes?: ClipKeyframes, extra: Partial<Clip> = {}): Clip {
  return {
    id: 'c',
    trackId: 't',
    type: 'video',
    name: 'C',
    startFrame: 0,
    durationFrames: 60,
    sourceStartFrame: 0,
    sourceDurationFrames: 60,
    src: 'x.mp4',
    transform: BASE,
    ...(keyframes ? { keyframes } : {}),
    ...extra,
  }
}

describe('channel names', () => {
  it('accepts builtins, time, fx and mask names and rejects anything else', () => {
    for (const ok of ['x', 'opacity', 'time', 'fx.a1.amount', 'mask.feather']) {
      expect(isKeyframeChannelName(ok), ok).toBe(true)
    }
    for (const bad of ['fx.a1', 'fx..amount', 'fx.a.b.c', 'mask.colour', 'blur', '']) {
      expect(isKeyframeChannelName(bad), bad).toBe(false)
    }
    expect(parseEffectChannel('fx.a1.amount')).toEqual({ effectId: 'a1', param: 'amount' })
    expect(parseEffectChannel('opacity')).toBeUndefined()
  })

  it('lists present channels builtins-first, extended sorted, junk ignored', () => {
    const channels = {
      'mask.x': track([key(0, 0)]),
      'fx.b.amount': track([key(0, 0)]),
      opacity: track([key(0, 1)]),
      bogus: track([key(0, 1)]),
      x: track([key(0, 0.5)]),
    } as unknown as ClipKeyframes['channels']
    expect(presentKeyframeChannels(channels)).toEqual(['x', 'opacity', 'fx.b.amount', 'mask.x'])
  })
})

describe('sampling', () => {
  it('samples extended channels by name and leaves builtins to sampleKeyframes', () => {
    const kf: ClipKeyframes = {
      channels: {
        x: track([key(0, 0), key(10, 1)]),
        'fx.a.amount': track([key(0, 0), key(10, 1)]),
        time: track([key(0, 100), key(10, 110)]),
      },
    }
    expect(sampleExtendedChannels(kf, 5)).toEqual({ 'fx.a.amount': 0.5, time: 105 })
    const s = sampleKeyframes(kf, 5, BASE)
    expect(s.transform?.x).toBeCloseTo(0.5)
    expect(Object.keys(s)).toEqual(['transform'])
  })

  it('samples a track-sourced channel from its keys until tracks exist', () => {
    const kf = {
      channels: { x: { source: { kind: 'track', assetId: 'roto1', channel: 'cx' }, keys: [key(0, 0.25)] } },
    } as ClipKeyframes
    expect(sampleKeyframes(kf, 3, BASE).transform?.x).toBe(0.25)
  })

  it('reports keys on extended-only clips', () => {
    expect(hasKeyframes({ channels: { 'fx.a.amount': track([key(0, 1)]) } })).toBe(true)
    expect(hasKeyframes({ channels: { 'fx.a.amount': track([]) } })).toBe(false)
  })
})

describe('remap and split cover extended channels', () => {
  const kf: ClipKeyframes = {
    channels: {
      x: track([key(0, 0), key(20, 1)]),
      'fx.a.amount': track([key(0, 0), key(20, 1)]),
    },
  }

  it('shifts fx keys exactly like x keys on trim', () => {
    const out = remapKeyframes(kf, { shift: -5 })!
    expect(out.channels['fx.a.amount']!.keys.map((k) => k.frame)).toEqual(
      out.channels.x!.keys.map((k) => k.frame),
    )
  })

  it('splits fx keys with a boundary key, like x', () => {
    const { left, right } = splitKeyframes(kf, 10)
    expect(left!.channels['fx.a.amount']!.keys.map((k) => [k.frame, k.value])).toEqual([
      [0, 0],
      [10, 0.5],
    ])
    expect(right!.channels['fx.a.amount']!.keys.map((k) => [k.frame, k.value])).toEqual([
      [0, 0.5],
      [10, 1],
    ])
  })

  it('drops junk channel names on remap instead of carrying them', () => {
    const junk = { channels: { ...kf.channels, bogus: track([key(0, 1)]) } } as unknown as ClipKeyframes
    expect(Object.keys(remapKeyframes(junk, { shift: 1 })!.channels)).toEqual(['x', 'fx.a.amount'])
  })
})

describe('writers on extended channels', () => {
  it('keys an effect param from its stored value, without baking a transform', () => {
    const c = clip(undefined, {
      transform: undefined,
      effects: [{ id: 'a', kind: 'grain', params: { amount: 0.4 } }],
    })
    const patch = setKeyframe(c, 'fx.a.amount', 3, CTX)
    expect(patch.keyframes?.channels['fx.a.amount']?.keys[0]).toMatchObject({ frame: 3, value: 0.4 })
    expect(patch.transform).toBeUndefined()
  })

  it('falls back to the registry default when the param is not stored', () => {
    const c = clip(undefined, { effects: [{ id: 'a', kind: 'grain', params: {} }] })
    expect(setKeyframe(c, 'fx.a.amount', 0, CTX).keyframes?.channels['fx.a.amount']?.keys[0].value).toBe(0.25)
  })

  it('keys a mask field from the mask', () => {
    const c = clip(undefined, { mask: { kind: 'rect', x: 0.2, y: 0, width: 1, height: 1 } })
    expect(setKeyframe(c, 'mask.x', 0, CTX).keyframes?.channels['mask.x']?.keys[0].value).toBe(0.2)
  })

  it('frame helpers see extended keys; keyedChannels stays builtin-only', () => {
    const c = clip({
      channels: { x: track([key(0, 0.5)]), 'fx.a.amount': track([key(0, 1), key(12, 0)]) },
    })
    expect(keyFrameUnion(c)).toEqual([0, 12])
    expect(keyedChannels(c)).toEqual(['x'])
    expect(allKeyedChannels(c)).toEqual(['x', 'fx.a.amount'])

    const moved = { ...c, ...moveKeysAtFrame(c, 12, 20) }
    expect(moved.keyframes!.channels['fx.a.amount']!.keys.map((k) => k.frame)).toEqual([0, 20])

    const removed = { ...c, ...removeKeysAtFrame(c, 0) }
    expect(removed.keyframes!.channels.x).toBeUndefined()
    expect(removed.keyframes!.channels['fx.a.amount']!.keys.map((k) => k.frame)).toEqual([12])
  })
})
