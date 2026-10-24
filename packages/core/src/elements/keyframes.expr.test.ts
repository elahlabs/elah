import { describe, expect, it } from 'vitest'
import {
  isExpressionChannel,
  sampleExtendedChannels,
  sampleKeyframes,
  splitKeyframes,
} from '../resolver/keyframes'
import {
  baselineTransform,
  channelExpression,
  clearKeyframeChannel,
  expressionChannels,
  removeKeyframe,
  setChannelExpression,
  setKeyframe,
} from './keyframes'
import { MAX_EXPRESSION_LENGTH } from '../resolver/expr/scope'
import { DEFAULT_TEXT_TRANSFORM } from '../resolver/textAnimation'
import type { Clip, ClipKeyframes, Keyframe, Transform } from '../types'

const BASE: Transform = { x: 0.5, y: 0.5, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }

const k = (frame: number, value: number): Keyframe => ({ id: `k${frame}`, frame, value, easing: 'linear' })

const kf = (channels: ClipKeyframes['channels']): ClipKeyframes => ({ channels })

describe('samplers', () => {
  describe('isExpressionChannel', () => {
    it('accepts the scalar and extended channels', () => {
      for (const c of ['x', 'volume', 'fx.e1.radius', 'mask.feather', 'gen.speed']) {
        expect(isExpressionChannel(c), c).toBe(true)
      }
    })

    it('rejects time, draw, junk and a mask field that does not exist', () => {
      // `time` is a source-frame remap and `draw` is consumed by the animator;
      // neither is a scalar an expression may drive. `mask.path` is not a field.
      for (const c of ['time', 'draw', 'bogus', 'mask.path']) {
        expect(isExpressionChannel(c), c).toBe(false)
      }
    })
  })

  describe('sampleKeyframes', () => {
    it('lets the hook override one channel and leaves the others alone', () => {
      const kfs = kf({ x: { source: { kind: 'keyframes' }, keys: [k(0, 0.2), k(10, 0.4)] } })
      const out = sampleKeyframes(kfs, 5, BASE, (ch) => (ch === 'x' ? 0.9 : undefined))
      expect(out.transform?.x).toBe(0.9)
      // The hook said nothing about y, so y keeps the base — an expression on
      // one channel must not disturb another.
      expect(out.transform?.y).toBe(BASE.y)
    })

    it('clamps AFTER the hook, so an expression cannot escape the range', () => {
      const opacity = sampleKeyframes(kf({}), 0, BASE, (ch) => (ch === 'opacity' ? 2 : undefined))
      expect(opacity.opacity).toBe(1)
      const scale = sampleKeyframes(kf({}), 0, BASE, (ch) => (ch === 'scale' ? 0 : undefined))
      expect(scale.transform?.scale).toBe(0.001)
    })

    it('hands the hook the RAW keyed value, not the clamped one', () => {
      // The ordering is observable, not just decorative: this expression
      // branches on `value`, so clamping before the hook would feed it 1 and
      // take the other branch. `value` is the author's number; the clamp exists
      // to bound the RESULT.
      const seen: number[] = []
      sampleKeyframes(
        kf({ opacity: { source: { kind: 'keyframes' }, keys: [k(0, 1.5)] } }),
        0,
        BASE,
        (ch, keyed) => {
          if (ch === 'opacity') seen.push(keyed!)
          return keyed! > 1 ? 10 : 0
        },
      )
      expect(seen).toEqual([1.5])
      const out = sampleKeyframes(
        kf({ opacity: { source: { kind: 'keyframes' }, keys: [k(0, 1.5)] } }),
        0,
        BASE,
        (ch, keyed) => (ch === 'opacity' ? (keyed! > 1 ? 10 : 0) : undefined),
      )
      expect(out.opacity).toBe(1)
    })

    it('is byte-identical with no hook', () => {
      // The parity guarantee for every existing document: pass no hook and the
      // result must be exactly what the three-argument call produced.
      const kfs = kf({
        x: { source: { kind: 'keyframes' }, keys: [k(0, 0.2), k(10, 0.4)] },
        opacity: { source: { kind: 'keyframes' }, keys: [k(0, 0), k(10, 1)] },
        cornerRadius: { source: { kind: 'keyframes' }, keys: [k(0, 0.1)] },
      })
      for (let f = 0; f <= 10; f++) {
        expect(sampleKeyframes(kfs, f, BASE, undefined)).toEqual(sampleKeyframes(kfs, f, BASE))
      }
    })

    it('calls the hook for a channel that has no keys at all', () => {
      // An expression-only channel has no keys, so a hook gated on `keyed`
      // would never run and the expression would never be evaluated.
      const seen: Array<[string, number | undefined]> = []
      sampleKeyframes(kf({}), 3, BASE, (ch, keyed) => {
        seen.push([ch, keyed])
        return undefined
      })
      expect(seen.some(([ch, keyed]) => ch === 'x' && keyed === undefined)).toBe(true)
    })
  })

  describe('sampleExtendedChannels', () => {
    it('lets the hook override an effect param', () => {
      const kfs = kf({ 'fx.e1.radius': { source: { kind: 'keyframes' }, keys: [k(0, 5), k(10, 15)] } })
      const out = sampleExtendedChannels(kfs, 5, (ch) => (ch === 'fx.e1.radius' ? 42 : undefined))
      expect(out['fx.e1.radius']).toBe(42)
    })

    it('keeps the keyed value when the hook declines', () => {
      const kfs = kf({ 'fx.e1.radius': { source: { kind: 'keyframes' }, keys: [k(0, 5), k(10, 15)] } })
      expect(sampleExtendedChannels(kfs, 5, () => undefined)['fx.e1.radius']).toBe(10)
      expect(sampleExtendedChannels(kfs, 5)['fx.e1.radius']).toBe(10)
    })
  })

  describe('splitKeyframes keeps a keyless expression channel', () => {
    it('carries the track onto both halves', () => {
      const kfs = kf({ x: { source: { kind: 'expression', source: 'value + 1' }, keys: [] } })
      const { left, right } = splitKeyframes(kfs, 10)
      expect(left?.channels?.x?.source).toEqual({ kind: 'expression', source: 'value + 1' })
      expect(right?.channels?.x?.source).toEqual({ kind: 'expression', source: 'value + 1' })
      expect(left?.channels?.x?.keys).toEqual([])
      expect(right?.channels?.x?.keys).toEqual([])
    })

    it('does not disturb a channel that really has no keys and no expression', () => {
      const { left } = splitKeyframes(kf({ x: { source: { kind: 'keyframes' }, keys: [] } }), 10)
      expect(left?.channels?.x).toBeUndefined()
    })
  })
})

// --- writers (step 4) -------------------------------------------------------

const CTX = { stage: { width: 1920, height: 1080 } }
const VIDEO_CTX = { stage: { width: 1920, height: 1080 }, content: { width: 1280, height: 720 } }

/** A text clip with no keyframes at all. */
function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: 'c1', trackId: 'el-1', type: 'text', name: 'T', content: 'x',
    startFrame: 0, durationFrames: 30, sourceStartFrame: 0, sourceDurationFrames: 30,
    transform: { ...DEFAULT_TEXT_TRANSFORM },
    ...over,
  } as unknown as Clip
}

const withPatch = (c: Clip, p: Partial<Clip>): Clip => ({ ...c, ...p })

describe('writers', () => {
  it('creates a trimmed expression on a keyless channel', () => {
    const c = clip()
    const out = withPatch(c, setChannelExpression(c, 'x', '  value + 1  ', CTX))
    expect(out.keyframes!.channels.x).toEqual({ source: { kind: 'expression', source: 'value + 1' }, keys: [] })
  })

  it('bakes the baseline on the first transform expression of a transform-less clip', () => {
    // The resolver cannot invent a base rect for media, so the expression would
    // have nothing to be relative to.
    const c = clip({ type: 'video', src: 'a.mp4', transform: undefined })
    const p = setChannelExpression(c, 'x', 'value + 1', VIDEO_CTX)
    expect(p.transform).toEqual(baselineTransform(c, VIDEO_CTX))
  })

  it('bakes nothing for a non-transform channel', () => {
    const c = clip({ transform: undefined })
    expect(setChannelExpression(c, 'opacity', 'value', CTX).transform).toBeUndefined()
  })

  it('removes with null and with an empty string', () => {
    for (const empty of [null, '']) {
      const c = clip()
      const set = withPatch(c, setChannelExpression(c, 'x', 'value + 1', CTX))
      const out = withPatch(set, setChannelExpression(set, 'x', empty, CTX))
      // A keyless channel is dropped, and `keyframes` goes with it when it was
      // the only channel.
      expect(out.keyframes).toBeUndefined()
    }
  })

  it('keeps the keys and restores source kind when removing from a keyed channel', () => {
    const c = clip()
    const keyed = withPatch(c, setKeyframe(c, 'x', 0, CTX, 0.2))
    const withExpr = withPatch(keyed, setChannelExpression(keyed, 'x', 'value + 1', CTX))
    const out = withPatch(withExpr, setChannelExpression(withExpr, 'x', null, CTX))
    const track = out.keyframes!.channels.x!
    expect(track.source).toEqual({ kind: 'keyframes' })
    expect(track.keys).toHaveLength(1)
    expect(track.keys[0]!.value).toBe(0.2)
  })

  it('refuses a channel that cannot take an expression', () => {
    const c = clip()
    for (const ch of ['time', 'draw', 'bogus']) {
      expect(setChannelExpression(c, ch as never, 'value', CTX), ch).toEqual({})
    }
  })

  it('refuses a source over the length limit', () => {
    const c = clip()
    const long = 'x'.repeat(MAX_EXPRESSION_LENGTH + 1)
    expect(setChannelExpression(c, 'x', long, CTX)).toEqual({})
    // Exactly at the limit is fine.
    expect(setChannelExpression(c, 'x', 'x'.repeat(MAX_EXPRESSION_LENGTH), CTX).keyframes).toBeTruthy()
  })

  it('is a no-op when the same source is written twice', () => {
    const c = clip()
    const set = withPatch(c, setChannelExpression(c, 'x', 'value + 1', CTX))
    expect(setChannelExpression(set, 'x', 'value + 1', CTX)).toEqual({})
  })

  it('does not validate the syntax, so a half-typed expression is never lost', () => {
    const c = clip()
    const out = withPatch(c, setChannelExpression(c, 'x', 'value +', CTX))
    expect(out.keyframes!.channels.x!.source).toEqual({ kind: 'expression', source: 'value +' })
  })

  it('keeps the expression when a key is added', () => {
    const c = clip()
    const set = withPatch(c, setChannelExpression(c, 'x', 'value + 1', CTX))
    const out = withPatch(set, setKeyframe(set, 'x', 5, CTX, 0.7))
    expect(out.keyframes!.channels.x!.source).toEqual({ kind: 'expression', source: 'value + 1' })
    expect(out.keyframes!.channels.x!.keys).toHaveLength(1)
  })

  it('keeps an expression-only channel when its last key is removed', () => {
    // The regression this fixes: removing the only diamond used to delete the
    // channel, taking the expression with it.
    const c = clip()
    const keyed = withPatch(c, setKeyframe(c, 'x', 0, CTX, 0.2))
    const withExpr = withPatch(keyed, setChannelExpression(keyed, 'x', 'value + 1', CTX))
    const out = withPatch(withExpr, removeKeyframe(withExpr, 'x', withExpr.keyframes!.channels.x!.keys[0]!.id))
    expect(out.keyframes!.channels.x).toEqual({ source: { kind: 'expression', source: 'value + 1' }, keys: [] })
  })

  it('still drops a keyless channel that has no expression', () => {
    const c = clip()
    const keyed = withPatch(c, setKeyframe(c, 'x', 0, CTX, 0.2))
    const out = withPatch(keyed, removeKeyframe(keyed, 'x', keyed.keyframes!.channels.x!.keys[0]!.id))
    expect(out.keyframes).toBeUndefined()
  })

  it('clearKeyframeChannel removes the expression with the channel', () => {
    const c = clip()
    const set = withPatch(c, setChannelExpression(c, 'x', 'value + 1', CTX))
    expect(withPatch(set, clearKeyframeChannel(set, 'x')).keyframes).toBeUndefined()
  })

  describe('channelExpression', () => {
    it('reads a stored expression and nothing else', () => {
      const c = clip()
      const keyed = withPatch(c, setKeyframe(c, 'x', 0, CTX, 0.2))
      expect(channelExpression(keyed, 'x')).toBeUndefined()
      const set = withPatch(c, setChannelExpression(c, 'x', 'value + 1', CTX))
      expect(channelExpression(set, 'x')).toBe('value + 1')
    })
  })

  describe('expressionChannels', () => {
    it('lists builtins before extended channels', () => {
      const c = clip()
      let out = withPatch(c, setChannelExpression(c, 'fx.e1.radius', 'value', CTX))
      out = withPatch(out, setChannelExpression(out, 'x', 'value', CTX))
      expect(expressionChannels(out)).toEqual(['x', 'fx.e1.radius'])
    })

    it('is empty for a clip with no expression', () => {
      expect(expressionChannels(clip())).toEqual([])
      const keyed = withPatch(clip(), setKeyframe(clip(), 'x', 0, CTX, 0.2))
      expect(expressionChannels(keyed)).toEqual([])
    })
  })
})