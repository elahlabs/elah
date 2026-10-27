import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../../editor/TimelineEngine'
import type { Clip } from '../../types'
import { layProject } from '../layProject'
import type { AuthoredElement } from '../components/types'
import { build, byId, deepClips, errorsOf, square, sys } from './testSupport'

const withBlur = (extra: Record<string, unknown> = {}) =>
  square('card', 0.5, 0.5, { at: 0, duration: 4, effects: [{ kind: 'gaussianBlur', params: [{ name: 'radius', value: 8 }] }], ...extra })
const clipOf = (r: ReturnType<typeof build>, partId: string): Clip => deepClips(r.project).find((c) => c.partId === partId)!
const element = (el: unknown) => el as AuthoredElement

describe('lowerAuthoredFields — matte', () => {
  const doc = (matte: unknown) => [element({ ...square('photo', 0.5, 0.5, { at: 0, duration: 4 }), matte }), square('mask', 0.5, 0.5, { at: 0, duration: 4, shape: 'circle' })]

  it('resolves to the COMPILED clip id of the matte element, not its element id', () => {
    const r = build(doc({ element: 'mask', kind: 'luma', invert: true }))
    expect(errorsOf(r.issues)).toEqual([])
    const photo = clipOf(r, 'photo')
    const mask = clipOf(r, 'mask')
    expect(photo.matte).toEqual({ sourceClipId: mask.id, kind: 'luma', invert: true })
    expect(photo.matte!.sourceClipId).not.toBe('mask')
    expect(r.elementClipIds.mask).toBe(mask.id)
  })

  it('omits invert when false and accepts alpha', () => {
    expect(clipOf(build(doc({ element: 'mask', kind: 'alpha' })), 'photo').matte).toEqual({ sourceClipId: clipOf(build(doc({ element: 'mask', kind: 'alpha' })), 'mask').id, kind: 'alpha' })
  })

  it('is an error when the matte element lives at another nesting level, and the matte is dropped', () => {
    const r = build([
      element({ ...square('photo', 0.5, 0.5, { at: 0, duration: 4 }), matte: { element: 'mask', kind: 'alpha' } }),
      { id: 'g', kind: 'group', at: 0, duration: 4, children: [square('mask', 0.5, 0.5, { at: 0, duration: 4 })] } as never,
    ])
    expect(r.issues).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error', code: 'matte-cross-level', path: 'elements[0].matte.element' })]))
    expect(clipOf(r, 'photo').matte).toBeUndefined()
  })

  it('works between siblings inside a group', () => {
    const r = build([
      {
        id: 'g',
        kind: 'group',
        at: 0,
        duration: 4,
        children: [element({ ...square('photo', 0.5, 0.5, { at: 0, duration: 4 }), matte: { element: 'mask', kind: 'alpha' } }), square('mask', 0.5, 0.5, { at: 0, duration: 4 })],
      } as never,
    ])
    expect(errorsOf(r.issues)).toEqual([])
    expect(clipOf(r, 'photo').matte!.sourceClipId).toBe(clipOf(r, 'mask').id)
  })

  it('rejects an unknown element, itself, and a bad kind', () => {
    expect(build(doc({ element: 'ghost', kind: 'alpha' })).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'bad-reference', severity: 'error' })]))
    expect(build(doc({ element: 'photo', kind: 'alpha' })).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'bad-matte' })]))
    expect(build(doc({ element: 'mask', kind: 'sparkle' })).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unknown-matte-kind' })]))
    expect(clipOf(build(doc({ element: 'ghost', kind: 'alpha' })), 'photo').matte).toBeUndefined()
  })
})

describe('lowerAuthoredFields — fxKeys', () => {
  const keyed = (fxKeys: unknown) => build([element({ ...withBlur(), fxKeys })])
  const keys = [
    { effect: 'gaussianBlur', param: 'radius', at: 0, value: 0 },
    { effect: 'gaussianBlur', param: 'radius', at: 1, value: 40, curve: 'cubic-out' },
    { effect: 'gaussianBlur', param: 'radius', at: 2, value: 0, hold: true },
  ]

  it('lands keys on fx.<the effect\'s REAL id>.<param>, at round(at x fps) frames', () => {
    const r = keyed(keys)
    expect(errorsOf(r.issues)).toEqual([])
    const clip = clipOf(r, 'card')
    const effect = clip.effects![0]!
    const channel = clip.keyframes!.channels[`fx.${effect.id}.radius` as never]!
    expect(effect.id).not.toBe('gaussianBlur')
    expect(Object.keys(clip.keyframes!.channels)).toEqual([`fx.${effect.id}.radius`])
    expect(channel.keys.map((k) => [k.frame, k.value])).toEqual([[0, 0], [30, 40], [60, 0]])
    expect(channel.keys[1]).toMatchObject({ easing: 'cubic-out' })
    expect(channel.keys[2]).toMatchObject({ hold: true })
  })

  it('resolves spring and bezier curves like any key', () => {
    const clip = clipOf(keyed([{ effect: 'gaussianBlur', param: 'radius', at: 1, value: 5, curve: 'spring:bouncy' }]), 'card')
    const k = clip.keyframes!.channels[`fx.${clip.effects![0]!.id}.radius` as never]!.keys[0]!
    expect(k.spring).toBeTruthy()
  })

  it('clamps an out-of-range value with a warn', () => {
    const r = keyed([{ effect: 'gaussianBlur', param: 'radius', at: 1, value: 999 }])
    const clip = clipOf(r, 'card')
    expect(clip.keyframes!.channels[`fx.${clip.effects![0]!.id}.radius` as never]!.keys[0]!.value).toBe(100)
    expect(r.issues).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'warn', code: 'clamped' })]))
  })

  it('drops an entry with an unknown effect, param or an effect the element does not carry, each as an error', () => {
    for (const [fk, code] of [
      [{ effect: 'sparkle', param: 'radius', at: 0, value: 1 }, 'unknown-effect'],
      [{ effect: 'gaussianBlur', param: 'wobble', at: 0, value: 1 }, 'unknown-param'],
      [{ effect: 'vignette', param: 'amount', at: 0, value: 0.5 }, 'effect-missing'],
    ] as const) {
      const r = keyed([fk])
      expect(r.issues, code).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error', code, path: 'elements[0].fxKeys[0].' + (code === 'unknown-param' ? 'param' : 'effect') })]))
      expect(clipOf(r, 'card').keyframes).toBeUndefined()
    }
  })

  it('keys a group\'s own effect', () => {
    const r = build([element({ id: 'g', kind: 'group', at: 0, duration: 4, effects: [{ kind: 'gaussianBlur' }], fxKeys: keys, children: [square('c', 0.5, 0.5, { at: 0, duration: 4 })] })])
    expect(errorsOf(r.issues)).toEqual([])
    const g = clipOf(r, 'g')
    expect(Object.keys(g.keyframes!.channels)).toEqual([`fx.${g.effects![0]!.id}.radius`])
  })
})

describe('lowerAuthoredFields — crossMorph path keys', () => {
  const VB = { x: 0, y: 0, width: 24, height: 24 }
  const doc = () => [
    square('p1', 0.5, 0.5, { shape: 'path', path: 'M 0 0 L 24 0 L 24 24 Z', viewBox: VB, at: 0, duration: 4 }),
    square('p2', 0.5, 0.5, { shape: 'path', path: 'M 0 24 L 24 24 L 12 0 Z', viewBox: VB, at: 0, duration: 4 }),
    sys('cm', 'crossMorph', { at: 2, duration: 0.6, params: { from: 'p1', to: 'p2' } }),
  ]

  it('writes two shape.path keys on `from` (its path, then `to`\'s) and none on `to`', () => {
    const r = build(doc())
    expect(errorsOf(r.issues)).toEqual([])
    const from = clipOf(r, 'p1')
    const to = clipOf(r, 'p2')
    const keys = from.keyframes!.channels['shape.path' as never]!.keys
    expect(keys.map((k) => [k.frame, k.path])).toEqual([
      [60, 'M 0 0 L 24 0 L 24 24 Z'],
      [78, 'M 0 24 L 24 24 L 12 0 Z'],
    ])
    expect(keys[1]).toMatchObject({ easing: 'quad-in-out' })
    expect(to.keyframes!.channels['shape.path' as never]).toBeUndefined()
    // `to` still fades in itself, so a pair that does not tween degrades to a crossfade
    expect(to.keyframes!.channels.opacity).toBeTruthy()
  })
})

describe('lowerAuthoredFields — nothing to lower', () => {
  it('adds no issue and does not touch the project', () => {
    const plain = build([square('a', 0.5, 0.5)])
    expect(plain.issues.filter((i) => i.path.includes('matte') || i.path.includes('fxKeys'))).toEqual([])
    expect(byId(plain.expandedSpec.elements, 'a')).not.toHaveProperty('matte')
  })
})

describe('matte survives layProject?', () => {
  const lay = (elements: unknown[]) => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 640, height: 360 }, initialTracks: [] })
    layProject(engine, build(elements as AuthoredElement[]).project)
    return engine.getProject()
  }
  const flat = (clips: Clip[]): Clip[] => clips.flatMap((c) => [c, ...(c.compound?.project ? flat(Object.values(c.compound.project.clips).flat()) : [])])
  const photoAndMask = () => [
    { ...square('photo', 0.5, 0.5, { at: 0, duration: 4 }), matte: { element: 'mask', kind: 'alpha' } },
    square('mask', 0.5, 0.5, { at: 0, duration: 4 }),
  ]

  it('inside a group: yes, nested clips keep their compiled ids through layProject', () => {
    const project = lay([{ id: 'g', kind: 'group', at: 0, duration: 4, children: photoAndMask() }])
    const clips = flat(Object.values(project.clips).flat())
    expect(clips.find((c) => c.partId === 'photo')!.matte!.sourceClipId).toBe(clips.find((c) => c.partId === 'mask')!.id)
  })

  // `layProject.remapClip` remaps `matte.sourceClipId` with the clip ids (MI-P3 follow-up), so a TOP-LEVEL matte survives too.
  it('at the top level: layProject remaps matte.sourceClipId to the live mask clip', () => {
    const clips = Object.values(lay(photoAndMask()).clips).flat()
    expect(clips.find((c) => c.partId === 'photo')!.matte!.sourceClipId).toBe(clips.find((c) => c.partId === 'mask')!.id)
  })
})
