import { describe, expect, it } from 'vitest'
import {
  setKeyframe,
  setKeysBezierAtFrame,
  setKeysEasingAtFrame,
  setKeysSpringAtFrame,
} from './keyframes'
import { findSpringPreset } from './springPresets'
import { DEFAULT_TEXT_TRANSFORM } from '../resolver/textAnimation'
import type { Clip, Keyframe } from '../types'

const bouncy = findSpringPreset('bouncy')!.spring
const STAGE = { width: 1080, height: 1920 }
const CTX = { stage: STAGE }

/** A text clip with an `x` key at 0 and one at 20. */
function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    trackId: 't1',
    type: 'text',
    name: 'C',
    startFrame: 0,
    durationFrames: 60,
    sourceStartFrame: 0,
    sourceDurationFrames: 60,
    content: 'hello',
    transform: DEFAULT_TEXT_TRANSFORM,
    keyframes: {
      channels: {
        x: {
          source: { kind: 'keyframes' },
          keys: [
            { id: 'a', frame: 0, value: 0.1, easing: 'linear' },
            { id: 'b', frame: 20, value: 0.9, easing: 'quad-in' },
          ],
        },
        y: {
          source: { kind: 'keyframes' },
          keys: [
            { id: 'c', frame: 0, value: 0.2, easing: 'linear' },
            { id: 'd', frame: 20, value: 0.4, easing: 'linear' },
          ],
        },
      },
    },
    ...overrides,
  }
}

/** Apply a writer's patch, the way `engine.updateClip` would. */
function apply(clip: Clip, patch: Partial<Clip>): Clip {
  return { ...clip, ...patch }
}

const keyAt = (clip: Clip, channel: 'x' | 'y', frame: number): Keyframe =>
  clip.keyframes!.channels[channel]!.keys.find((k) => k.frame === frame)!

describe('setKeyframe with a spring', () => {
  it('writes a copy of the spring, not the object it was handed', () => {
    const patch = setKeyframe(makeClip(), 'x', 10, CTX, 0.4, { spring: bouncy })
    const clip = apply(makeClip(), patch)
    const key = keyAt(clip, 'x', 10)
    expect(key.spring).toEqual(bouncy)
    // Aliasing the caller's object would let a later mutation of the preset
    // rewrite history on every key that used it.
    expect(key.spring).not.toBe(bouncy)
  })

  it('writes no spring when the option is invalid', () => {
    const patch = setKeyframe(makeClip(), 'x', 10, CTX, 0.4, { spring: { stiffness: 0, damping: 1 } as never })
    expect(keyAt(apply(makeClip(), patch), 'x', 10).spring).toBeUndefined()
  })

  it('keeps a spring and an easingBezier both present, spring winning at sample time', () => {
    const patch = setKeyframe(makeClip(), 'x', 10, CTX, 0.4, { spring: bouncy, easingBezier: [0, 0, 1, 1] })
    const key = keyAt(apply(makeClip(), patch), 'x', 10)
    expect(key.spring).toEqual(bouncy)
    expect(key.easingBezier).toEqual([0, 0, 1, 1])
  })
})

describe('setKeysSpringAtFrame', () => {
  it('sets the spring on the key on that frame and drops its bezier', () => {
    const clip = makeClip()
    const withBezier = apply(clip, setKeysBezierAtFrame(clip, 20, [0.2, 0.9, 0.1, 1]))
    const out = apply(withBezier, setKeysSpringAtFrame(withBezier, 20, bouncy))
    const key = keyAt(out, 'x', 20)
    expect(key.spring).toEqual(bouncy)
    expect(key.easingBezier).toBeUndefined()
    // The named easing survives, so clearing the spring returns to it.
    expect(key.easing).toBe('quad-in')
  })

  it('leaves the other key on the channel alone', () => {
    const clip = makeClip()
    const out = apply(clip, setKeysSpringAtFrame(clip, 20, bouncy))
    expect(keyAt(out, 'x', 0).spring).toBeUndefined()
  })

  it('clears the spring with null and keeps the named easing', () => {
    const clip = apply(makeClip(), setKeysSpringAtFrame(makeClip(), 20, bouncy))
    const out = apply(clip, setKeysSpringAtFrame(clip, 20, null))
    const key = keyAt(out, 'x', 20)
    expect(key.spring).toBeUndefined()
    expect(key.easing).toBe('quad-in')
  })

  it('refuses an invalid spring with an empty patch', () => {
    // An invalid spring must not half-apply: returning {} leaves the document
    // untouched rather than dropping the bezier and storing nothing.
    const clip = makeClip()
    expect(setKeysSpringAtFrame(clip, 20, { stiffness: -1, damping: 1 } as never)).toEqual({})
    expect(setKeysSpringAtFrame(clip, 20, null as never)).toBeTruthy()
  })

  it('writes every key on the frame across channels, and `only` limits it', () => {
    const clip = makeClip()
    const all = apply(clip, setKeysSpringAtFrame(clip, 20, bouncy))
    expect(keyAt(all, 'x', 20).spring).toEqual(bouncy)
    expect(keyAt(all, 'y', 20).spring).toEqual(bouncy)

    const limited = apply(clip, setKeysSpringAtFrame(clip, 20, bouncy, 'x'))
    expect(keyAt(limited, 'x', 20).spring).toEqual(bouncy)
    expect(keyAt(limited, 'y', 20).spring).toBeUndefined()
  })

  it('is a no-op patch when no key is on that frame', () => {
    expect(setKeysSpringAtFrame(makeClip(), 33, bouncy)).toEqual({})
  })
})

describe('picking a different curve removes the spring', () => {
  it('setKeysEasingAtFrame drops it', () => {
    // Without this the picker would look broken: choose "Ease" after "Bouncy"
    // and the spring would keep winning.
    const clip = apply(makeClip(), setKeysSpringAtFrame(makeClip(), 20, bouncy))
    const out = apply(clip, setKeysEasingAtFrame(clip, 20, 'quad-out'))
    const key = keyAt(out, 'x', 20)
    expect(key.spring).toBeUndefined()
    expect(key.easing).toBe('quad-out')
  })

  it('setKeysBezierAtFrame drops it', () => {
    const clip = apply(makeClip(), setKeysSpringAtFrame(makeClip(), 20, bouncy))
    const out = apply(clip, setKeysBezierAtFrame(clip, 20, [0.2, 0.9, 0.1, 1]))
    const key = keyAt(out, 'x', 20)
    expect(key.spring).toBeUndefined()
    expect(key.easingBezier).toEqual([0.2, 0.9, 0.1, 1])
  })

  it('clearing the bezier also drops the spring', () => {
    const clip = apply(makeClip(), setKeysSpringAtFrame(makeClip(), 20, bouncy))
    const out = apply(clip, setKeysBezierAtFrame(clip, 20, null))
    expect(keyAt(out, 'x', 20).spring).toBeUndefined()
  })
})

describe('a key that never had a spring comes out byte-identical', () => {
  it('through every writer', () => {
    // The regression guard: dropping `spring` in the destructuring must not
    // reorder or add a field to a key that has none, or every existing
    // document would get a spurious diff on its first write.
    const plain = makeClip()
    const before = keyAt(plain, 'x', 20)
    const afterEasing = keyAt(apply(plain, setKeysEasingAtFrame(plain, 20, 'quad-out')), 'x', 20)
    expect(Object.keys(afterEasing)).toEqual(Object.keys(before))
    const afterBezier = keyAt(apply(plain, setKeysBezierAtFrame(plain, 20, null)), 'x', 20)
    expect(afterBezier).toEqual(before)
    expect(Object.keys(afterBezier)).toEqual(Object.keys(before))
    const afterSpring = keyAt(apply(plain, setKeysSpringAtFrame(plain, 20, null)), 'x', 20)
    expect(afterSpring).toEqual(before)
    expect(Object.keys(afterSpring)).toEqual(Object.keys(before))
  })
})
