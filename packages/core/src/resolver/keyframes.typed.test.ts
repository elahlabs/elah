import { describe, expect, it } from 'vitest'
import type { ClipKeyframes, Keyframe } from '../types'
import { formatColor, parseColor } from '../utils/color'
import { SPRING_PRESETS } from '../elements/springPresets'
import {
  isKeyframeChannelName,
  normalizeVecKeys,
  sampleColorChannel,
  sampleEffectColors,
  sampleExtendedChannels,
  samplePathChannel,
  sampleTypedChannels,
  splitKeyframes,
} from './keyframes'

function colorKey(frame: number, color: string, extra: Partial<Keyframe> = {}): Keyframe {
  return { id: `k-${frame}`, frame, value: 0, vec: parseColor(color)!, easing: 'linear', ...extra }
}

function pathKey(frame: number, path: string, extra: Partial<Keyframe> = {}): Keyframe {
  return { id: `p-${frame}`, frame, value: 0, path, easing: 'linear', ...extra }
}

describe('isKeyframeChannelName', () => {
  it('accepts the four typed channel names', () => {
    expect(isKeyframeChannelName('color')).toBe(true)
    expect(isKeyframeChannelName('shape.fill')).toBe(true)
    expect(isKeyframeChannelName('shape.stroke')).toBe(true)
    expect(isKeyframeChannelName('shape.path')).toBe(true)
  })
})

describe('normalizeVecKeys', () => {
  it('drops keys without a valid vec and pads a 3-element vec with alpha 1', () => {
    const keys: Keyframe[] = [
      { id: 'a', frame: 0, value: 0, vec: [1, 0, 0], easing: 'linear' },
      { id: 'b', frame: 10, value: 0, easing: 'linear' },
    ]
    const out = normalizeVecKeys(keys)
    expect(out).toHaveLength(1)
    expect(out[0]!.vec).toEqual([1, 0, 0, 1])
  })
})

describe('sampleColorChannel', () => {
  const redToBlue = [colorKey(0, '#ff0000'), colorKey(60, '#0000ff')]

  it('interpolates between keys', () => {
    expect(sampleColorChannel(redToBlue, 15)).toEqual([0.75, 0, 0.25, 1])
  })

  it('holds the first/last key outside the range', () => {
    expect(sampleColorChannel(redToBlue, 0)).toEqual([1, 0, 0, 1])
    expect(sampleColorChannel(redToBlue, 60)).toEqual([0, 0, 1, 1])
    expect(sampleColorChannel(redToBlue, 99)).toEqual([0, 0, 1, 1])
    expect(sampleColorChannel(redToBlue, -10)).toEqual([1, 0, 0, 1])
  })

  it('is premultiplied: transparent -> red at the midpoint is a faded red, not dark red', () => {
    const keys = [colorKey(0, 'transparent'), colorKey(60, '#ff0000')]
    const v = sampleColorChannel(keys, 30)!
    expect(v[0]).toBeCloseTo(1, 6)
    expect(v[1]).toBeCloseTo(0, 6)
    expect(v[2]).toBeCloseTo(0, 6)
    expect(v[3]).toBeCloseTo(0.5, 6)
  })

  it('a hold on the first key holds its value until the next key', () => {
    const keys = [colorKey(0, '#ff0000', { hold: true }), colorKey(60, '#0000ff')]
    expect(sampleColorChannel(keys, 30)).toEqual([1, 0, 0, 1])
    expect(sampleColorChannel(keys, 59)).toEqual([1, 0, 0, 1])
    expect(sampleColorChannel(keys, 60)).toEqual([0, 0, 1, 1])
  })

  it('a spring may overshoot 1 in the raw vec (before formatColor clamps)', () => {
    const bouncy = SPRING_PRESETS.find((p) => p.id === 'bouncy')!.spring
    const keys = [colorKey(0, '#000000'), colorKey(30, '#ffffff', { spring: bouncy })]
    let overshoot = false
    for (let f = 1; f < 30; f++) {
      const v = sampleColorChannel(keys, f)!
      if (v.some((c) => c > 1)) overshoot = true
    }
    expect(overshoot).toBe(true)
  })
})

describe('samplePathChannel', () => {
  const square = 'M0 0 L10 0 L10 10 L0 10 Z'
  const biggerSquare = 'M0 0 L20 0 L20 20 L0 20 Z'
  const triangle = 'M0 0 L10 0 L0 10 Z'

  it('returns the exact original string at key frames', () => {
    const keys = [pathKey(0, square), pathKey(60, biggerSquare)]
    expect(samplePathChannel(keys, 0)).toBe(square)
    expect(samplePathChannel(keys, 60)).toBe(biggerSquare)
  })

  it('morphs between two same-structure paths', () => {
    const keys = [pathKey(0, square), pathKey(60, biggerSquare)]
    const mid = samplePathChannel(keys, 30)
    expect(mid).not.toBe(square)
    expect(mid).not.toBe(biggerSquare)
    expect(mid).toContain('M 0 0')
  })

  it('morphs a structure mismatch by reconciling it (AGN-P27), exact on the keys', () => {
    const keys = [pathKey(0, square), pathKey(60, triangle)]
    const mid = samplePathChannel(keys, 30)
    expect(mid).not.toBe(square)
    expect(mid).not.toBe(triangle)
    expect(samplePathChannel(keys, 0)).toBe(square)
    expect(samplePathChannel(keys, 60)).toBe(triangle)
  })

  it('holds the source path on an irreconcilable pair (closed against open with a real gap) until the destination frame', () => {
    const open = 'M0 0 L10 0 L10 10'
    const keys = [pathKey(0, square), pathKey(60, open)]
    expect(samplePathChannel(keys, 30)).toBe(square)
    expect(samplePathChannel(keys, 59)).toBe(square)
    expect(samplePathChannel(keys, 60)).toBe(open)
  })

  it('holds on an unparseable (arc) path', () => {
    const arc = 'M0 0 A5 5 0 0 1 10 0'
    const keys = [pathKey(0, arc), pathKey(60, square)]
    expect(samplePathChannel(keys, 30)).toBe(arc)
  })
})

describe('sampleTypedChannels', () => {
  it('returns only the keyed typed names', () => {
    const keyframes: ClipKeyframes = {
      channels: { 'shape.fill': { source: { kind: 'keyframes' }, keys: [colorKey(0, '#ff0000')] } },
    }
    expect(sampleTypedChannels(keyframes, 0)).toEqual({ fill: '#ff0000' })
    expect(sampleTypedChannels(undefined, 0)).toEqual({})
  })
})

describe('sampleEffectColors', () => {
  it('samples a vignette colour channel to hex', () => {
    const keyframes: ClipKeyframes = {
      channels: {
        'fx.v1.color': {
          source: { kind: 'keyframes' },
          keys: [colorKey(0, '#000000'), colorKey(10, '#ffffff')],
        },
      },
    }
    const out = sampleEffectColors(keyframes, 5)
    expect(out['fx.v1.color']).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('sampleExtendedChannels skips typed channels', () => {
  it('a clip keyed on shape.fill and x has no shape.fill entry', () => {
    const keyframes: ClipKeyframes = {
      channels: {
        'shape.fill': { source: { kind: 'keyframes' }, keys: [colorKey(0, '#ff0000')] },
        x: { source: { kind: 'keyframes' }, keys: [{ id: 'x0', frame: 0, value: 0.5, easing: 'linear' }] },
      },
    }
    const extended = sampleExtendedChannels(keyframes, 0)
    expect('shape.fill' in extended).toBe(false)
  })
})

describe('splitKeyframes carries typed values', () => {
  it('a colour channel split reproduces the original colours on both halves', () => {
    const keyframes: ClipKeyframes = {
      channels: { color: { source: { kind: 'keyframes' }, keys: [colorKey(0, '#ff0000'), colorKey(60, '#0000ff')] } },
    }
    const { left, right } = splitKeyframes(keyframes, 30)
    const leftBoundary = left!.channels.color!.keys[left!.channels.color!.keys.length - 1]!
    const rightFirst = right!.channels.color!.keys[0]!
    expect(formatColor(leftBoundary.vec!)).toBe(formatColor(rightFirst.vec!))
    // Compare component-wise with a tolerance, not the formatted hex string:
    // the split's boundary key and a direct sample take different floating
    // paths to the mathematically same value (a different division/subtract
    // order), so they can differ by a couple of ULPs — usually invisible, but
    // occasionally enough to flip `Math.round` at a hex boundary. The VALUE
    // reproduces exactly; only the last-bit path differs.
    const close = (a: number[] | undefined, b: number[] | undefined) => {
      expect(a).toBeDefined()
      expect(b).toBeDefined()
      for (let i = 0; i < 4; i++) expect(a![i]).toBeCloseTo(b![i]!, 9)
    }
    for (let f = 0; f <= 30; f++) {
      close(sampleColorChannel(left!.channels.color!.keys, f), sampleColorChannel(keyframes.channels.color!.keys, f))
    }
    for (let f = 0; f <= 30; f++) {
      close(
        sampleColorChannel(right!.channels.color!.keys, f),
        sampleColorChannel(keyframes.channels.color!.keys, f + 30),
      )
    }
  })

  it('a path channel split reproduces the original paths on both halves', () => {
    const square = 'M0 0 L10 0 L10 10 L0 10 Z'
    const biggerSquare = 'M0 0 L20 0 L20 20 L0 20 Z'
    const keyframes: ClipKeyframes = {
      channels: { 'shape.path': { source: { kind: 'keyframes' }, keys: [pathKey(0, square), pathKey(60, biggerSquare)] } },
    }
    const { left, right } = splitKeyframes(keyframes, 30)
    for (let f = 0; f <= 30; f++) {
      expect(samplePathChannel(left!.channels['shape.path']!.keys, f)).toBe(
        samplePathChannel(keyframes.channels['shape.path']!.keys, f),
      )
    }
    for (let f = 0; f <= 30; f++) {
      expect(samplePathChannel(right!.channels['shape.path']!.keys, f)).toBe(
        samplePathChannel(keyframes.channels['shape.path']!.keys, f + 30),
      )
    }
  })
})
