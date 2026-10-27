import { describe, expect, it } from 'vitest'
import { resolveTimeline } from '../resolver/resolveTimeline'
import type { Clip, Effect, Keyframe, Project, Track, Transition } from '../types'
import { defaultEffectParams } from './registry'
import { resolveBlend, resolveCompositing, resolveEffects, resolveMask, resolveMatte } from './resolveEffects'

function key(frame: number, value: number): Keyframe {
  return { id: `k${frame}`, frame, value, easing: 'linear' }
}

const TRACK: Track = {
  id: 't1',
  name: 'V',
  kind: 'video',
  order: 0,
  height: 64,
  locked: false,
  disabled: false,
  muted: false,
  solo: false,
}

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    trackId: 't1',
    type: 'video',
    name: 'C',
    startFrame: 0,
    durationFrames: 30,
    sourceStartFrame: 0,
    sourceDurationFrames: 30,
    src: 'fake.mp4',
    ...overrides,
  }
}

function project(clips: Clip[], transitions: Transition[] = []): Project {
  return {
    id: 'p',
    fps: 30,
    stage: { width: 1080, height: 1920 },
    tracks: [TRACK],
    clips: { t1: clips },
    transitions,
    version: 1,
  }
}

const grain: Effect = { id: 'fx1', kind: 'grain', params: { amount: 0.5 } }

describe('resolveEffects', () => {
  it('fills defaults and clamps stored params', () => {
    const [r] = resolveEffects([{ id: 'a', kind: 'grain', params: { amount: 9 } }])
    expect(r).toEqual({ id: 'a', kind: 'grain', params: { ...defaultEffectParams('grain'), amount: 1 } })
  })

  it('leaves out disabled and unknown effects without touching the input', () => {
    const input: Effect[] = [
      { id: 'a', kind: 'grain', params: {}, enabled: false },
      { id: 'b', kind: 'fromTheFuture', params: {} },
      { id: 'c', kind: 'vignette', params: {} },
    ]
    expect(resolveEffects(input).map((e) => e.id)).toEqual(['c'])
    expect(input).toHaveLength(3)
  })

  it('lets an fx key override a keyframeable number, clamped', () => {
    const [r] = resolveEffects([grain], { 'fx.fx1.amount': 0.2, 'fx.fx1.seed': 55 })
    expect(r.params.amount).toBe(0.2)
    // seed is not keyframeable: the key is ignored.
    expect(r.params.seed).toBe(defaultEffectParams('grain').seed)
    const [over] = resolveEffects([grain], { 'fx.fx1.amount': 4 })
    expect(over.params.amount).toBe(1)
  })

  it('keeps stack order', () => {
    const out = resolveEffects([
      { id: 'b', kind: 'vignette', params: {} },
      { id: 'a', kind: 'grain', params: {} },
    ])
    expect(out.map((e) => e.id)).toEqual(['b', 'a'])
  })
})

describe('mask, blend, matte', () => {
  it('clamps a mask and applies mask.* keys', () => {
    const mask = resolveMask(
      { kind: 'ellipse', x: 0.1, y: 0.2, width: -1, height: 0.5, feather: 3 },
      { 'mask.x': 0.4 },
    )
    expect(mask).toEqual({ kind: 'ellipse', x: 0.4, y: 0.2, width: 0, height: 0.5, feather: 1 })
  })

  it('rejects an unknown mask kind and omits zero rotation and feather', () => {
    expect(resolveMask({ kind: 'star' as never, x: 0, y: 0, width: 1, height: 1 })).toBeUndefined()
    expect(resolveMask({ kind: 'rect', x: 0, y: 0, width: 1, height: 1, rotation: 0, feather: 0 })).toEqual({
      kind: 'rect',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })

  it('treats normal and unknown blend modes as absent', () => {
    expect(resolveBlend('normal')).toBeUndefined()
    expect(resolveBlend('glow' as never)).toBeUndefined()
    expect(resolveBlend('screen')).toBe('screen')
  })

  it('refuses a self-matte or a bad kind', () => {
    expect(resolveMatte({ sourceClipId: 'c1', kind: 'alpha' }, 'c1')).toBeUndefined()
    expect(resolveMatte({ sourceClipId: 'm', kind: 'depth' as never }, 'c1')).toBeUndefined()
    expect(resolveMatte({ sourceClipId: 'm', kind: 'luma' }, 'c1')).toEqual({
      sourceClipId: 'm',
      kind: 'luma',
      invert: false,
    })
  })

  it('resolves to an empty object for a clip that uses none of it', () => {
    expect(resolveCompositing(clip())).toEqual({})
    expect(resolveCompositing(clip({ blend: 'normal', effects: [] }))).toEqual({})
  })
})

describe('resolver integration', () => {
  it('leaves an unaffected clip exactly as before (no new keys)', () => {
    const scene = resolveTimeline(5, project([clip()]))
    expect(Object.keys(scene.videos[0]).sort()).toEqual(
      ['id', 'name', 'opacity', 'sourceFrame', 'src', 'trackId', 'type', 'volume', 'zIndex'].sort(),
    )
  })

  it('carries effects, blend, mask and matte on the active clip', () => {
    const scene = resolveTimeline(
      5,
      project([
        clip({
          effects: [grain],
          blend: 'multiply',
          mask: { kind: 'rect', x: 0, y: 0, width: 0.5, height: 1 },
          matte: { sourceClipId: 'other', kind: 'alpha' },
        }),
      ]),
    )
    const v = scene.videos[0]
    expect(v.effects?.map((e) => e.kind)).toEqual(['grain'])
    expect(v.blend).toBe('multiply')
    expect(v.mask?.width).toBe(0.5)
    expect(v.matte).toEqual({ sourceClipId: 'other', kind: 'alpha', invert: false })
  })

  it('samples fx keys per frame', () => {
    const c = clip({
      effects: [grain],
      keyframes: {
        channels: { 'fx.fx1.amount': { source: { kind: 'keyframes' }, keys: [key(0, 0), key(10, 1)] } },
      },
    })
    const at = (f: number) => resolveTimeline(f, project([c])).videos[0].effects?.[0].params.amount
    expect(at(0)).toBe(0)
    expect(at(5)).toBeCloseTo(0.5)
    expect(at(20)).toBe(1)
  })

  it('does not disturb builtin keys on the same clip', () => {
    const c = clip({
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      effects: [grain],
      keyframes: {
        channels: {
          opacity: { source: { kind: 'keyframes' }, keys: [key(0, 0), key(10, 1)] },
          'fx.fx1.amount': { source: { kind: 'keyframes' }, keys: [key(0, 1)] },
        },
      },
    })
    const v = resolveTimeline(5, project([c])).videos[0]
    expect(v.opacity).toBeCloseTo(0.5)
    expect(v.effects?.[0].params.amount).toBe(1)
  })

  it('reaches text, shape, image and freehand clips too', () => {
    const effects = [grain]
    const elements = (c: Clip): Project => ({ ...project([c]), tracks: [{ ...TRACK, kind: 'elements' }] })
    const text = resolveTimeline(0, elements(clip({ type: 'text', content: 'hi', src: undefined, effects })))
    expect(text.texts[0].effects).toHaveLength(1)
    const shape = resolveTimeline(0, elements(clip({ type: 'shape', shapeKind: 'rect', src: undefined, effects })))
    expect(shape.shapes[0].effects).toHaveLength(1)
    const image = resolveTimeline(0, project([clip({ type: 'image', src: 'a.png', effects })]))
    expect(image.images[0].effects).toHaveLength(1)
    const free = resolveTimeline(0, project([clip({ type: 'freehand', src: undefined, pathData: 'M0 0', effects })]))
    expect(free.freehand[0].effects).toHaveLength(1)
  })

  it('carries effects onto both sides of a transition', () => {
    const a = clip({ id: 'a', effects: [grain] })
    const b = clip({ id: 'b', startFrame: 30, effects: [{ id: 'fx2', kind: 'vignette', params: {} }] })
    const transition: Transition = {
      id: 'tr',
      trackId: 't1',
      kind: 'fade',
      fromClipId: 'a',
      toClipId: 'b',
      startFrame: 25,
      durationFrames: 10,
    } as Transition
    const scene = resolveTimeline(29, project([a, b], [transition]))
    const byId = Object.fromEntries(scene.videos.map((v) => [v.id, v]))
    expect(byId.a.effects?.[0].kind).toBe('grain')
    expect(byId.b.effects?.[0].kind).toBe('vignette')
  })
})
