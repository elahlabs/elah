import { describe, expect, it } from 'vitest'
import { build, byId, deepClips, errorsOf, expand, keysOn, square, sys } from './testSupport'

const a = () => square('a', 0.3, 0.4, { at: 1, duration: 3 })
const b = () => square('b', 0.7, 0.6, { at: 2, duration: 4 })
const cam = (move: string, params: Record<string, number | string | boolean> = {}, extra: Record<string, unknown> = {}) =>
  sys('cm', 'camera', { at: 3, duration: 1, targets: ['a', 'b'], params: { move, ...params }, ...extra })

describe('camera', () => {
  it('is deterministic', () => {
    expect(expand([a(), b(), cam('whip')])).toEqual(expand([a(), b(), cam('whip')]))
  })

  it('compiles with 0 errors for every move', () => {
    for (const move of ['push', 'pan', 'zoomOut', 'whip']) expect(errorsOf(build([a(), b(), cam(move)]).issues), move).toEqual([])
  })

  it('moves the targets into ONE group that spans their union, children re-timed relative to it', () => {
    const els = expand([a(), b(), cam('push')]).spec.elements
    expect(els.map((e) => e.id)).toEqual(['cm-cam'])
    const rig = els[0]!
    expect(rig).toMatchObject({ kind: 'group', at: 1, duration: 5 })
    expect(rig.children!.map((c) => [c.id, c.at])).toEqual([['a', 0], ['b', 1]])
  })

  it('push is a smooth scale up; zoomOut starts tight and settles at 1', () => {
    const push = keysOn(byId(expand([a(), b(), cam('push', { amount: 0.1 })]).spec.elements, 'cm-cam'), 'scale')
    expect(push.map((k) => [k.at, k.value])).toEqual([[2, 1], [3, 1.1]])
    const out = keysOn(byId(expand([a(), b(), cam('zoomOut', { amount: 0.25 })]).spec.elements, 'cm-cam'), 'scale')
    expect(out.map((k) => [k.at, k.value])).toEqual([[2, 1.25], [3, 1]])
  })

  it('whip: x keys on the group plus a gaussianBlur effect keyed by fxKeys, peaking mid-move', () => {
    const rig = byId(expand([a(), b(), cam('whip', { amount: 0.6, blur: 50 })]).spec.elements, 'cm-cam') as ReturnType<typeof byId> & {
      fxKeys: Array<{ effect: string; param: string; at: number; value: number }>
    }
    expect(keysOn(rig, 'x').map((k) => [k.at, k.value])).toEqual([[2, 0.5], [3, -0.1]])
    expect(rig.effects).toEqual([{ kind: 'gaussianBlur', params: [{ name: 'radius', value: 0 }] }])
    expect(rig.fxKeys.map((k) => [k.effect, k.param, k.at, k.value])).toEqual([
      ['gaussianBlur', 'radius', 2, 0],
      ['gaussianBlur', 'radius', 2.5, 50],
      ['gaussianBlur', 'radius', 3, 0],
    ])
  })

  it('whip lands real keys on the compiled blur radius, and pan has no blur at all', () => {
    const r = build([a(), b(), cam('whip', { blur: 50 })])
    const rig = deepClips(r.project).find((c) => c.partId === 'cm-cam')!
    const blur = rig.effects!.find((e) => e.kind === 'gaussianBlur')!
    const keys = rig.keyframes!.channels[`fx.${blur.id}.radius` as never]!.keys
    expect(keys.map((k) => [k.frame, k.value])).toEqual([[60, 0], [75, 50], [90, 0]])
    expect(expand([a(), b(), cam('pan')]).spec.elements[0]!.effects).toBeUndefined()
  })

  it('the camera group takes the highest target layer unless told one', () => {
    expect(expand([a(), square('b', 0.7, 0.6, { at: 2, duration: 4, layer: 3 }), cam('push')]).spec.elements[0]!.layer).toBe(3)
    expect(expand([a(), b(), cam('push', {}, { layer: 9 })]).spec.elements[0]!.layer).toBe(9)
  })

  it('names an unknown target and leaves every element where it was', () => {
    const r = expand([a(), b(), sys('cm', 'camera', { at: 3, duration: 1, targets: ['a', 'nope'] })])
    expect(r.spec.elements.map((e) => e.id)).toEqual(['a', 'b'])
    expect(r.issues).toEqual([expect.objectContaining({ severity: 'error', code: 'unknown-target', message: expect.stringContaining('nope') })])
  })

  it('can target an earlier system by id (a swarm under a camera)', () => {
    const swarm = sys('sw', 'swarm', { at: 0, duration: 3, template: square('t', 0.5, 0.5), params: { count: 3 } })
    const r = expand([swarm, sys('cm', 'camera', { at: 1, duration: 1, targets: ['sw'], params: { move: 'push' } })])
    expect(r.spec.elements.map((e) => e.id)).toEqual(['cm-cam'])
    expect(r.spec.elements[0]!.children).toHaveLength(3)
  })
})
