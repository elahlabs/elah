import { describe, expect, it } from 'vitest'
import { FORMAT, build, byId, errorsOf, expand, keysOn, square, sys, valueAt } from './testSupport'

const px = (x: number, y: number) => ({ x: x * FORMAT.width, y: y * FORMAT.height })
const CENTER = { x: 0.5, y: 0.5 }
const targets = () => [square('a', 0.8, 0.5), square('b', 0.3, 0.7), square('c', 0.55, 0.2)]
const push = (params: Record<string, number | string | boolean> = {}) =>
  sys('rp', 'radialPush', { at: 2, duration: 0.6, targets: ['a', 'b', 'c'], ...CENTER, params: { distance: 600, ...params } })
const run = (params?: Record<string, number | string | boolean>, seed = 1) => expand([...targets(), push(params)], seed)

describe('radialPush', () => {
  it('is deterministic for a seed', () => {
    expect(run(undefined, 3)).toEqual(run(undefined, 3))
  })

  it('compiles with 0 errors and every emitted id is prefixed', () => {
    const r = build([...targets(), push()])
    expect(errorsOf(r.issues)).toEqual([])
    expect(r.expandedSpec.elements.filter((e) => e.id.startsWith('rp-')).map((e) => e.id)).toEqual(['rp-pulse'])
  })

  it('moves each target farther from the centre ALONG THE SAME RAY, by `distance` px', () => {
    const els = run().spec.elements
    const c = px(CENTER.x, CENTER.y)
    for (const t of targets()) {
      const el = byId(els, t.id)
      const start = px(t.x!, t.y!)
      const end = px(valueAt(el, 'x', 10), valueAt(el, 'y', 10))
      const d0 = Math.hypot(start.x - c.x, start.y - c.y)
      const d1 = Math.hypot(end.x - c.x, end.y - c.y)
      expect(d1).toBeGreaterThan(d0)
      expect(d1 - d0).toBeCloseTo(600, 0)
      // collinear: the cross product of (start - c) and (end - c) is ~0 in PIXEL space
      const cross = (start.x - c.x) * (end.y - c.y) - (start.y - c.y) * (end.x - c.x)
      expect(Math.abs(cross) / (d0 * d1)).toBeLessThan(1e-4)
    }
  })

  it('starts the move at the push time, relative to each target (a target that starts at 1 s keys from 1 s)', () => {
    const late = square('a', 0.8, 0.5, { at: 1, duration: 5 })
    const el = byId(expand([late, sys('rp', 'radialPush', { at: 2, duration: 0.6, targets: ['a'], params: {} })]).spec.elements, 'a')
    expect(keysOn(el, 'x').map((k) => k.at)).toEqual([1, 1.6])
  })

  it('fades targets out when `fade` is on and leaves opacity alone when off', () => {
    const on = byId(run({ fade: true }).spec.elements, 'a')
    expect(keysOn(on, 'opacity').map((k) => k.value)).toEqual([1, 0])
    const off = byId(run({ fade: false }).spec.elements, 'a')
    expect(keysOn(off, 'opacity')).toEqual([])
  })

  it('gives a target sitting on the centre a seeded direction instead of dividing by zero', () => {
    const els = expand([square('a', 0.5, 0.5), sys('rp', 'radialPush', { at: 2, duration: 0.6, targets: ['a'], ...CENTER })], 2).spec.elements
    const el = byId(els, 'a')
    const end = px(valueAt(el, 'x', 10), valueAt(el, 'y', 10))
    expect(Math.hypot(end.x - 540, end.y - 960)).toBeCloseTo(600, 0)
  })

  it('emits one expanding pulse ring at the centre', () => {
    const pulse = byId(run().spec.elements, 'rp-pulse')
    expect(pulse).toMatchObject({ shape: 'circle', x: 0.5, y: 0.5, at: 2 })
    const scale = keysOn(pulse, 'scale')
    expect(scale[1]!.value).toBeGreaterThan(scale[0]!.value * 5)
  })

  it('names an unknown target as an error and emits nothing', () => {
    const r = expand([...targets(), sys('rp', 'radialPush', { at: 2, duration: 0.6, targets: ['a', 'ghost'] })])
    expect(r.spec.elements.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(r.issues).toEqual([expect.objectContaining({ severity: 'error', code: 'unknown-target', path: 'elements[3].targets[1]', message: expect.stringContaining('ghost') })])
    expect(byId(r.spec.elements, 'a').keys).toBeUndefined()
  })

  it('does not drop a hand-keyed x key silently', () => {
    const a = square('a', 0.8, 0.5, { keys: [{ channel: 'x', at: 1.5, value: 0.8 }, { channel: 'x', at: 3, value: 0.7 }] })
    const r = expand([a, sys('rp', 'radialPush', { at: 2, duration: 0.6, targets: ['a'] })])
    expect(r.issues.some((i) => i.code === 'key-conflict')).toBe(true)
  })
})
