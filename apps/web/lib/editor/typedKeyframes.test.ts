import { describe, expect, it } from 'vitest'
import { formatColor, moveKeyframe, setColorKeyframe, setPathKeyframe, type Clip } from '@elah/core'
import {
  commitColor,
  displayColor,
  displayPath,
  isTypedKeyed,
  moveTypedKey,
  togglePathKey,
  toggleColorKey,
  typedKeyState,
  typedKind,
} from './typedKeyframes'

const ctx = { stage: { width: 1920, height: 1080 } }

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
  } as Clip
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
  } as Clip
}

function pathClip(overrides: Partial<Clip> = {}): Clip {
  return shapeClip({ shapeKind: 'path', shapePath: 'M0 0 L10 0', ...overrides })
}

function vignetteClip(overrides: Partial<Clip> = {}): Clip {
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
    ...overrides,
  } as Clip
}

const apply = (c: Clip, patch: Partial<Clip>): Clip => ({ ...c, ...patch })

describe('typedKind / isTypedKeyed / typedKeyState', () => {
  it('classifies channels and states with no keys yet', () => {
    expect(typedKind(textClip(), 'color')).toBe('color')
    expect(typedKind(shapeClip(), 'x')).toBe('scalar')
    expect(isTypedKeyed(textClip(), 'color')).toBe(false)
    expect(typedKeyState(textClip(), 'color', 0)).toBe('none')
  })

  it('is keyed / on-key once a colour key exists', () => {
    let c = apply(textClip(), setColorKeyframe(textClip(), 'color', 10, '#ff0000'))
    expect(isTypedKeyed(c, 'color')).toBe(true)
    expect(typedKeyState(c, 'color', 10)).toBe('on-key')
    expect(typedKeyState(c, 'color', 20)).toBe('keyed')
    c = apply(c, setColorKeyframe(c, 'color', 40, '#0000ff'))
    expect(typedKeyState(c, 'color', 25)).toBe('keyed')
  })

  it('a scalar key on `x` never counts as typed-keyed', () => {
    // `setKeyframe` refuses to write a scalar key on a typed channel (P5c-1),
    // so this proves the READ side agrees rather than merely trusting that.
    const c = textClip()
    expect(isTypedKeyed(c, 'x' as never)).toBe(false)
  })
})

describe('displayColor', () => {
  it('falls back to the authored colour when unkeyed', () => {
    expect(displayColor(textClip(), 'color', 0)).toBe('#ffffff')
    expect(displayColor(textClip({ color: '#112233' }), 'color', 0)).toBe('#112233')
    expect(displayColor(shapeClip(), 'shape.fill', 0)).toBe('transparent')
    expect(displayColor(shapeClip(), 'shape.stroke', 0)).toBe('#ffffff')
  })

  it('samples the keyed colour at the playhead, premultiplied by the core sampler', () => {
    let c = apply(textClip(), setColorKeyframe(textClip(), 'color', 0, '#ff0000'))
    c = apply(c, setColorKeyframe(c, 'color', 60, '#0000ff'))
    expect(displayColor(c, 'color', 0)).toBe('#ff0000')
    expect(displayColor(c, 'color', 60)).toBe('#0000ff')
    expect(displayColor(c, 'color', 30)).toBe(formatColor([0.5, 0, 0.5, 1]))
  })

  it('formats an effect colour param as #rrggbb (vecToHex, never formatColor)', () => {
    let c = vignetteClip()
    c = apply(c, setColorKeyframe(c, 'fx.v1.color', 0, '#000000'))
    c = apply(c, setColorKeyframe(c, 'fx.v1.color', 10, '#ffffff'))
    expect(displayColor(c, 'fx.v1.color', 5)).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('displayPath', () => {
  it('falls back to the stored shapePath when unkeyed', () => {
    expect(displayPath(pathClip(), 0)).toBe('M0 0 L10 0')
  })

  it('shows the exact authored string at key frames and a morph between', () => {
    let c = apply(pathClip(), setPathKeyframe(pathClip(), 0, 'M0 0 L10 0'))
    c = apply(c, setPathKeyframe(c, 60, 'M0 0 L20 0'))
    expect(displayPath(c, 0)).toBe('M0 0 L10 0')
    expect(displayPath(c, 60)).toBe('M0 0 L20 0')
    expect(displayPath(c, 30)).not.toBe('M0 0 L10 0')
  })
})

describe('toggleColorKey', () => {
  it('adds a key holding the AUTHORED colour, not a sampled preview', () => {
    let c = apply(textClip({ color: '#abcdef' }), setColorKeyframe(textClip(), 'color', 0, '#ff0000'))
    c = apply(c, setColorKeyframe(c, 'color', 60, '#0000ff'))
    // Not on a key at frame 30 (mid-fade) — toggling adds one holding the
    // clip's AUTHORED colour (#abcdef), never the interpolated purple.
    const patch = toggleColorKey(c, 'color', 30, ctx)
    const applied = apply(c, patch)
    expect(displayColor(applied, 'color', 30)).toBe('#abcdef')
  })

  it('removes an exact key at the playhead and leaves neighbours', () => {
    let c = apply(textClip(), setColorKeyframe(textClip(), 'color', 0, '#ff0000'))
    c = apply(c, setColorKeyframe(c, 'color', 10, '#00ff00'))
    c = apply(c, toggleColorKey(c, 'color', 10, ctx))
    expect(typedKeyState(c, 'color', 10)).toBe('keyed')
    expect(typedKeyState(c, 'color', 0)).toBe('on-key')
  })

  it('the first click keys the unkeyed channel at its authored colour', () => {
    const c = textClip({ color: '#334455' })
    const applied = apply(c, toggleColorKey(c, 'color', 5, ctx))
    expect(typedKeyState(applied, 'color', 5)).toBe('on-key')
    expect(displayColor(applied, 'color', 5)).toBe('#334455')
  })
})

describe('togglePathKey', () => {
  it('adds and removes a shape.path key the same way', () => {
    const c = pathClip()
    const keyed = apply(c, togglePathKey(c, 0, ctx))
    expect(typedKeyState(keyed, 'shape.path', 0)).toBe('on-key')
    const unkeyed = apply(keyed, togglePathKey(keyed, 0, ctx))
    expect(typedKeyState(unkeyed, 'shape.path', 0)).toBe('none')
  })

  it('refuses on a non-path shape', () => {
    expect(togglePathKey(shapeClip(), 0, ctx)).toEqual({})
  })
})

describe('commitColor', () => {
  it('unkeyed: writes the static clip field', () => {
    expect(commitColor(textClip(), 'color', '#ff0000', 0, ctx)).toEqual({ color: '#ff0000' })
    expect(commitColor(shapeClip(), 'shape.fill', '#00ff00', 0, ctx)).toEqual({ shapeFill: '#00ff00' })
    expect(commitColor(shapeClip(), 'shape.stroke', '#0000ff', 0, ctx)).toEqual({ shapeStroke: '#0000ff' })
  })

  it('keyed: writes a key at the playhead instead, in one patch', () => {
    let c = apply(textClip(), setColorKeyframe(textClip(), 'color', 0, '#ff0000'))
    const patch = commitColor(c, 'color', '#00ff00', 30, ctx)
    expect(patch.keyframes).toBeDefined()
    const applied = apply(c, patch)
    expect(typedKeyState(applied, 'color', 30)).toBe('on-key')
    expect(displayColor(applied, 'color', 30)).toBe('#00ff00')
    // The clip's static `color` is untouched — nothing static moves under the curve.
    expect(applied.color).toBeUndefined()
  })

  it('an effect colour param has no base clip field — an unkeyed commit is a no-op here', () => {
    expect(commitColor(vignetteClip(), 'fx.v1.color', '#ff0000', 0, ctx)).toEqual({})
  })
})

describe('moveTypedKey — vec/path survive a temporal-only move', () => {
  it('keeps a colour key\'s vec byte-identical when moved 10 -> 15', () => {
    let c = apply(textClip(), setColorKeyframe(textClip(), 'color', 10, '#ff8040'))
    const keyId = c.keyframes!.channels.color!.keys[0]!.id
    const before = c.keyframes!.channels.color!.keys[0]!.vec
    const patch = moveTypedKey(c, 'color', keyId, 15)
    const moved = patch.keyframes!.channels.color!.keys.find((k) => k.id === keyId)!
    expect(moved.frame).toBe(15)
    expect(moved.vec).toEqual(before)
  })

  it('keeps a path key\'s path string byte-identical when moved', () => {
    let c = apply(pathClip(), setPathKeyframe(pathClip(), 10, 'M0 0 L10 0'))
    const keyId = c.keyframes!.channels['shape.path']!.keys[0]!.id
    const patch = moveTypedKey(c, 'shape.path', keyId, 15)
    const moved = patch.keyframes!.channels['shape.path']!.keys.find((k) => k.id === keyId)!
    expect(moved.frame).toBe(15)
    expect(moved.path).toBe('M0 0 L10 0')
  })

  it('is the same core writer a plain moveKeyframe call would use — value stays 0', () => {
    let c = apply(textClip(), setColorKeyframe(textClip(), 'color', 10, '#ff8040'))
    const keyId = c.keyframes!.channels.color!.keys[0]!.id
    const viaHelper = moveTypedKey(c, 'color', keyId, 20)
    const viaCore = moveKeyframe(c, 'color', keyId, 20, 0)
    expect(viaHelper).toEqual(viaCore)
  })
})

describe('shape.path diamond state — MG-P4', () => {
  it('none → on-key → keyed (off the key) → none, driven only by togglePathKey', () => {
    const c0 = pathClip()
    expect(typedKeyState(c0, 'shape.path', 0)).toBe('none')

    const c1 = apply(c0, togglePathKey(c0, 10, ctx))
    expect(typedKeyState(c1, 'shape.path', 10)).toBe('on-key')
    expect(typedKeyState(c1, 'shape.path', 20)).toBe('keyed')

    // A second key between/after: the playhead frame decides, not the channel.
    const c2 = apply(c1, togglePathKey(c1, 40, ctx))
    expect(typedKeyState(c2, 'shape.path', 40)).toBe('on-key')
    expect(typedKeyState(c2, 'shape.path', 10)).toBe('on-key')

    // Removing one key leaves the channel keyed; removing the last un-keys it.
    const c3 = apply(c2, togglePathKey(c2, 40, ctx))
    expect(typedKeyState(c3, 'shape.path', 40)).toBe('keyed')
    const c4 = apply(c3, togglePathKey(c3, 10, ctx))
    expect(typedKeyState(c4, 'shape.path', 10)).toBe('none')
    expect(isTypedKeyed(c4, 'shape.path')).toBe(false)
  })

  it('keys the CURRENT shapePath, and the key survives a later edit of the stored path', () => {
    const c1 = apply(pathClip(), togglePathKey(pathClip(), 0, ctx))
    expect(displayPath(c1, 0)).toBe('M0 0 L10 0')
    const edited = apply(c1, { shapePath: 'M0 0 L99 0' })
    expect(displayPath(edited, 0)).toBe('M0 0 L10 0')
  })

  it('a click on an off-key frame of a keyed path adds a key holding the stored path', () => {
    let c = apply(pathClip(), setPathKeyframe(pathClip(), 0, 'M0 0 L10 0'))
    c = apply(c, setPathKeyframe(c, 60, 'M0 0 L20 0'))
    const added = apply(c, togglePathKey(c, 30, ctx))
    expect(typedKeyState(added, 'shape.path', 30)).toBe('on-key')
    expect(displayPath(added, 30)).toBe('M0 0 L10 0')
  })
})
