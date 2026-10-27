import { describe, expect, it } from 'vitest'
import type { Clip, Keyframe } from '@elah/core'
import {
  clampLocalFrame,
  commitScalar,
  commitTransform,
  displayScalar,
  keyState,
  overlayKeyframes,
  toggleKeys,
  type EditableTransform,
} from './keyframeEdit'

const STAGE = { width: 1080, height: 1920 }
const CTX = { stage: STAGE }
const TF: EditableTransform = { x: 0.5, y: 0.5, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }

function key(frame: number, value: number): Keyframe {
  return { id: `k${frame}`, frame, value, easing: 'linear' }
}

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c',
    trackId: 't',
    type: 'image',
    name: 'C',
    startFrame: 100,
    durationFrames: 60,
    sourceStartFrame: 0,
    sourceDurationFrames: 60,
    src: 'a.png',
    transform: TF,
    ...overrides,
  }
}

function keyedX(): Clip {
  return clip({ keyframes: { channels: { x: { source: { kind: 'keyframes' }, keys: [key(0, 0), key(30, 1)] } } } })
}

describe('clampLocalFrame', () => {
  it('is clip-relative and clamped into the clip', () => {
    expect(clampLocalFrame(clip(), 115)).toBe(15)
    expect(clampLocalFrame(clip(), 3)).toBe(0)
    expect(clampLocalFrame(clip(), 10_000)).toBe(59)
  })
})

describe('keyState', () => {
  it('none / keyed / on-key, and on-key wins across grouped channels', () => {
    expect(keyState(clip(), ['x', 'y'], 0)).toBe('none')
    expect(keyState(keyedX(), ['x', 'y'], 15)).toBe('keyed')
    expect(keyState(keyedX(), ['y', 'x'], 30)).toBe('on-key')
  })
})

describe('overlayKeyframes / displayScalar', () => {
  it('replaces only keyed channels with the sampled value', () => {
    const shown = overlayKeyframes(keyedX(), TF, 15)
    expect(shown.x).toBeCloseTo(0.5)
    expect(shown.y).toBe(0.5)
    expect(overlayKeyframes(keyedX(), TF, 30).x).toBe(1)
    expect(overlayKeyframes(clip(), TF, 30)).toBe(TF)
  })

  it('displayScalar samples when keyed, else reads the authored value', () => {
    const c = clip({ opacity: 0.3, keyframes: { channels: { opacity: { source: { kind: 'keyframes' }, keys: [key(0, 1), key(30, 0)] } } } })
    expect(displayScalar(c, 'opacity', 15, 1)).toBeCloseTo(0.5)
    expect(displayScalar(clip({ opacity: 0.3 }), 'opacity', 15, 1)).toBe(0.3)
    expect(displayScalar(clip(), 'opacity', 15, 1)).toBe(1)
  })
})

describe('commitTransform', () => {
  it('with no keyed channels it is a plain transform write', () => {
    const next = { ...TF, x: 0.2 }
    expect(commitTransform(clip(), TF, next, 10, CTX)).toEqual({ transform: next })
  })

  it('a changed keyed channel becomes a key at the playhead and its transform slot keeps the authored value', () => {
    const c = keyedX()
    const current = overlayKeyframes(c, TF, 15) // x displayed = 0.5
    const next = { ...current, x: 0.9, y: 0.7 }
    const patch = commitTransform(c, current, next, 15, CTX)
    expect(patch.transform!.y).toBe(0.7) // unkeyed → static
    expect(patch.transform!.x).toBe(TF.x) // keyed → untouched
    const keys = patch.keyframes!.channels.x!.keys
    expect(keys.map((k) => [k.frame, k.value])).toEqual([
      [0, 0],
      [15, 0.9],
      [30, 1],
    ])
  })

  it('editing an unkeyed channel does not sprinkle keys on keyed ones', () => {
    const c = keyedX()
    const current = overlayKeyframes(c, TF, 15)
    const patch = commitTransform(c, current, { ...current, rotation: 1 }, 15, CTX)
    expect(patch.keyframes).toBeUndefined()
    expect(patch.transform!.rotation).toBe(1)
  })

  it('two keyed channels changed at once both get keys, chained on one patch', () => {
    const c = clip({
      keyframes: {
        channels: {
          x: { source: { kind: 'keyframes' }, keys: [key(0, 0)] },
          y: { source: { kind: 'keyframes' }, keys: [key(0, 0)] },
        },
      },
    })
    const current = overlayKeyframes(c, TF, 20)
    const patch = commitTransform(c, current, { ...current, x: 0.4, y: 0.6 }, 20, CTX)
    expect(patch.keyframes!.channels.x!.keys).toHaveLength(2)
    expect(patch.keyframes!.channels.y!.keys).toHaveLength(2)
  })
})

describe('commitScalar', () => {
  it('static when unkeyed, key at playhead when keyed', () => {
    expect(commitScalar(clip(), 'opacity', 0.4, 5, CTX)).toEqual({ opacity: 0.4 })
    const c = clip({ keyframes: { channels: { opacity: { source: { kind: 'keyframes' }, keys: [key(0, 1)] } } } })
    const patch = commitScalar(c, 'opacity', 0.4, 5, CTX)
    expect(patch.opacity).toBeUndefined()
    expect(patch.keyframes!.channels.opacity!.keys.map((k) => [k.frame, k.value])).toEqual([
      [0, 1],
      [5, 0.4],
    ])
  })
})

describe('toggleKeys', () => {
  it('first click on an unkeyed clip writes a key holding the shown value (and bakes the baseline)', () => {
    const c = clip({ transform: undefined })
    const patch = toggleKeys(c, ['x', 'y'], 10, CTX, { x: 0.25, y: 0.75 })
    expect(patch.transform).toBeDefined()
    expect(patch.keyframes!.channels.x!.keys[0]).toMatchObject({ frame: 10, value: 0.25 })
    expect(patch.keyframes!.channels.y!.keys[0]).toMatchObject({ frame: 10, value: 0.75 })
  })

  it('click on an existing key removes it; removing the last key un-keys the channel', () => {
    const c = clip({ keyframes: { channels: { x: { source: { kind: 'keyframes' }, keys: [key(0, 0), key(30, 1)] } } } })
    const one = toggleKeys(c, ['x'], 30, CTX, { x: 1 })
    expect(one.keyframes!.channels.x!.keys.map((k) => k.frame)).toEqual([0])
    const none = toggleKeys({ ...c, ...one }, ['x'], 0, CTX, { x: 0 })
    expect(none).toEqual({ keyframes: undefined })
  })

  it('click between keys on a keyed channel adds a key there', () => {
    const patch = toggleKeys(keyedX(), ['x'], 15, CTX, { x: 0.5 })
    expect(patch.keyframes!.channels.x!.keys.map((k) => k.frame)).toEqual([0, 15, 30])
  })
})

describe('Stretch (scaleX / scaleY) — MG-P4', () => {
  it('first diamond click keys scaleX alone at the shown value and bakes the transform', () => {
    const c = clip({ transform: undefined })
    const patch = toggleKeys(c, ['scaleX'], 10, CTX, { scaleX: 1.5 })
    expect(patch.transform).toBeDefined()
    expect(patch.keyframes!.channels.scaleX!.keys[0]).toMatchObject({ frame: 10, value: 1.5 })
    expect(patch.keyframes!.channels.scaleY).toBeUndefined()
  })

  it('a keyed scaleX is displayed sampled, an unkeyed scaleY keeps its authored value', () => {
    const c = clip({
      transform: { ...TF, scaleY: 2 },
      keyframes: { channels: { scaleX: { source: { kind: 'keyframes' }, keys: [key(0, 1), key(30, 3)] } } },
    })
    const shown = overlayKeyframes(c, c.transform as EditableTransform, 15)
    expect(shown.scaleX).toBeCloseTo(2)
    expect(shown.scaleY).toBe(2)
    expect(keyState(c, ['scaleX'], 15)).toBe('keyed')
    expect(keyState(c, ['scaleX'], 30)).toBe('on-key')
    expect(keyState(c, ['scaleY'], 15)).toBe('none')
  })

  it('editing a keyed scaleX writes a key at the playhead and leaves scaleY and the authored slot alone', () => {
    const c = clip({
      keyframes: { channels: { scaleX: { source: { kind: 'keyframes' }, keys: [key(0, 1), key(30, 3)] } } },
    })
    const current = overlayKeyframes(c, TF, 15)
    const patch = commitTransform(c, current, { ...current, scaleX: 2.5 }, 15, CTX)
    expect(patch.keyframes!.channels.scaleX!.keys.map((k) => [k.frame, k.value])).toEqual([
      [0, 1],
      [15, 2.5],
      [30, 3],
    ])
    expect(patch.keyframes!.channels.scaleY).toBeUndefined()
    expect(patch.transform!.scaleX).toBe(TF.scaleX)
    expect(patch.transform!.scaleY).toBe(TF.scaleY)
  })

  it('editing an unkeyed scaleY is a plain static transform write', () => {
    const c = clip()
    expect(commitTransform(c, TF, { ...TF, scaleY: 0.4 }, 10, CTX)).toEqual({ transform: { ...TF, scaleY: 0.4 } })
  })

  it('removing the only scaleX key un-keys it', () => {
    const c = clip({ keyframes: { channels: { scaleX: { source: { kind: 'keyframes' }, keys: [key(5, 2)] } } } })
    expect(toggleKeys(c, ['scaleX'], 5, CTX, { scaleX: 2 })).toEqual({ keyframes: undefined })
  })
})
