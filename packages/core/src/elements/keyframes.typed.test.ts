import { describe, expect, it } from 'vitest'
import type { AnyKeyframeChannel, Clip } from '../types'
import {
  authoredColor,
  channelValueKind,
  keyFrameSwatches,
  moveKeysAtFrame,
  setColorKeyframe,
  setKeyframe,
  setKeysEasingAtFrame,
  setPathKeyframe,
} from './keyframes'

const CTX = { stage: { width: 1920, height: 1080 } }

function textClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    trackId: 't1',
    type: 'text',
    name: 'Text',
    startFrame: 0,
    durationFrames: 60,
    sourceStartFrame: 0,
    sourceDurationFrames: 60,
    content: 'Hi',
    ...overrides,
  }
}

function shapeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 's1',
    trackId: 't1',
    type: 'shape',
    name: 'Shape',
    startFrame: 0,
    durationFrames: 60,
    sourceStartFrame: 0,
    sourceDurationFrames: 60,
    shapeKind: 'rect',
    ...overrides,
  }
}

function vignetteClip(): Clip {
  return {
    id: 'v1',
    trackId: 't1',
    type: 'adjustment',
    name: 'Adjust',
    startFrame: 0,
    durationFrames: 60,
    sourceStartFrame: 0,
    sourceDurationFrames: 60,
    effects: [{ id: 'v1', kind: 'vignette', params: { amount: 0.4, radius: 0.75, softness: 0.45, color: '#000000' } }],
  }
}

describe('channelValueKind', () => {
  it('classifies colour, path and scalar channels', () => {
    const clip = vignetteClip()
    expect(channelValueKind(textClip(), 'color')).toBe('color')
    expect(channelValueKind(shapeClip(), 'shape.fill')).toBe('color')
    expect(channelValueKind(clip, 'fx.v1.color')).toBe('color')
    expect(channelValueKind(shapeClip(), 'shape.path')).toBe('path')
    expect(channelValueKind(textClip(), 'x')).toBe('scalar')
    expect(channelValueKind(clip, 'fx.v1.amount')).toBe('scalar')
    expect(channelValueKind(clip, 'fx.missing.color' as AnyKeyframeChannel)).toBe('scalar')
  })
})

describe('setColorKeyframe', () => {
  it('defaults to white for an unset text colour', () => {
    const patch = setColorKeyframe(textClip(), 'color', 10)
    const key = patch.keyframes?.channels?.color?.keys[0]
    expect(key?.vec).toEqual([1, 1, 1, 1])
    expect(key?.value).toBe(0)
  })

  it('defaults to transparent for an unset shape fill', () => {
    const patch = setColorKeyframe(shapeClip(), 'shape.fill', 0)
    expect(patch.keyframes?.channels?.['shape.fill']?.keys[0]?.vec).toEqual([0, 0, 0, 0])
  })

  it('parses a string colour', () => {
    const patch = setColorKeyframe(shapeClip(), 'shape.fill', 0, '#00ff00')
    expect(patch.keyframes?.channels?.['shape.fill']?.keys[0]?.vec).toEqual([0, 1, 0, 1])
  })

  it('an unusable colour writes nothing', () => {
    expect(setColorKeyframe(shapeClip(), 'shape.fill', 0, 'bogus')).toEqual({})
  })

  it('a scalar channel writes nothing', () => {
    expect(setColorKeyframe(textClip(), 'x', 0, '#ffffff')).toEqual({})
  })

  it('replacing the key on the same frame keeps its id', () => {
    const first = setColorKeyframe(textClip(), 'color', 10, '#ff0000')
    const clip = textClip({ keyframes: first.keyframes })
    const second = setColorKeyframe(clip, 'color', 10, '#00ff00')
    const id1 = first.keyframes?.channels?.color?.keys[0]?.id
    const id2 = second.keyframes?.channels?.color?.keys[0]?.id
    expect(id2).toBe(id1)
    expect(second.keyframes?.channels?.color?.keys[0]?.vec).toEqual([0, 1, 0, 1])
  })

  it('spring and hold options land on the key', () => {
    const spring = { stiffness: 200, damping: 20 }
    const patch = setColorKeyframe(textClip(), 'color', 10, '#ff0000', { spring, hold: true })
    const key = patch.keyframes?.channels?.color?.keys[0]
    expect(key?.spring).toEqual(spring)
    expect(key?.hold).toBe(true)
  })
})

describe('setPathKeyframe', () => {
  it('defaults to clip.shapePath on a path shape', () => {
    const clip = shapeClip({ shapeKind: 'path', shapePath: 'M0 0 L10 0' })
    const patch = setPathKeyframe(clip, 0)
    expect(patch.keyframes?.channels?.['shape.path']?.keys[0]?.path).toBe('M0 0 L10 0')
    expect(patch.keyframes?.channels?.['shape.path']?.keys[0]?.value).toBe(0)
  })

  it('a non-path shape writes nothing', () => {
    expect(setPathKeyframe(shapeClip({ shapeKind: 'rect' }), 0, 'M0 0 L10 0')).toEqual({})
  })

  it('a blank path writes nothing', () => {
    expect(setPathKeyframe(shapeClip({ shapeKind: 'path' }), 0, '  ')).toEqual({})
  })
})

describe('setKeyframe guard', () => {
  it('refuses a scalar key on a typed channel', () => {
    expect(setKeyframe(shapeClip(), 'shape.fill', 0, CTX, 1)).toEqual({})
    expect(setKeyframe(vignetteClip(), 'fx.v1.color', 0, CTX, 1)).toEqual({})
  })
})

describe('authoredColor', () => {
  it('reads the authored value per channel', () => {
    expect(authoredColor(textClip({ color: '#123456' }), 'color')).toBe('#123456')
    expect(authoredColor(shapeClip(), 'shape.fill')).toBe('transparent')
    expect(authoredColor(vignetteClip(), 'fx.v1.color')).toBe('#000000')
    expect(authoredColor(textClip(), 'x')).toBeUndefined()
  })
})

describe('keyFrameSwatches', () => {
  it('maps frame to CSS colour, ignoring non-colour keys', () => {
    let clip = shapeClip()
    clip = { ...clip, ...setColorKeyframe(clip, 'shape.fill', 0, '#ff0000') }
    clip = { ...clip, ...setColorKeyframe(clip, 'shape.fill', 60, '#0000ff') }
    clip = { ...clip, ...setKeyframe(clip, 'x', 30, CTX, 0.5) }
    expect(keyFrameSwatches(clip)).toEqual(
      new Map([
        [0, '#ff0000'],
        [60, '#0000ff'],
      ]),
    )
  })
})

describe('key edits keep vec/path', () => {
  it('moveKeysAtFrame preserves vec', () => {
    const base = setColorKeyframe(textClip(), 'color', 10, '#ff0000')
    const clip = textClip({ keyframes: base.keyframes })
    const moved = moveKeysAtFrame(clip, 10, 20)
    expect(moved.keyframes?.channels?.color?.keys[0]?.vec).toEqual([1, 0, 0, 1])
    expect(moved.keyframes?.channels?.color?.keys[0]?.frame).toBe(20)
  })

  it('setKeysEasingAtFrame preserves vec', () => {
    const base = setColorKeyframe(textClip(), 'color', 10, '#ff0000')
    const clip = textClip({ keyframes: base.keyframes })
    const eased = setKeysEasingAtFrame(clip, 10, 'quad-in')
    expect(eased.keyframes?.channels?.color?.keys[0]?.vec).toEqual([1, 0, 0, 1])
    expect(eased.keyframes?.channels?.color?.keys[0]?.easing).toBe('quad-in')
  })
})
