import { describe, expect, it } from 'vitest'
import { FORMAT, build, byId, errorsOf, expand, keysOn, square, sys, valueAt } from './testSupport'

const ids = Array.from({ length: 10 }, (_, i) => `t${i}`)
const items = () => ids.map((id, i) => square(id, 0.1 + (i % 5) * 0.2, 0.1 + Math.floor(i / 5) * 0.1))
const arrange = (params: Record<string, number | string | boolean> = {}, extra: Record<string, unknown> = {}) =>
  sys('ar', 'arrange', { at: 1, duration: 0.8, targets: ids, params: { layout: 'grid', cols: 2, gap: 40, ...params }, ...extra })
const run = (params?: Record<string, number | string | boolean>, seed = 1, extra?: Record<string, unknown>) => expand([...items(), arrange(params, extra)], seed)
const slot = (el: ReturnType<typeof byId>) => ({ x: valueAt(el, 'x', 10), y: valueAt(el, 'y', 10) })

describe('arrange', () => {
  it('is deterministic, including the scatter start', () => {
    expect(run({ from: 'scatter' }, 6)).toEqual(run({ from: 'scatter' }, 6))
    expect(run({ from: 'scatter' }, 6).spec.elements).not.toEqual(run({ from: 'scatter' }, 7).spec.elements)
  })

  it('compiles with 0 errors', () => {
    expect(errorsOf(build([...items(), arrange()]).issues)).toEqual([])
  })

  it('lays 10 targets into a 2-column grid of 5 rows with exact slot positions', () => {
    const els = run().spec.elements
    const rows = new Set<number>()
    ids.forEach((id, i) => {
      const p = slot(byId(els, id))
      const col = i % 2
      const row = Math.floor(i / 2)
      // cell = 100 px box (default cell 120 wins: max(120, 100)) + 40 gap = 160 px pitch, centred on the stage
      expect(p.x).toBeCloseTo(0.5 + ((col - 0.5) * 160) / FORMAT.width, 5)
      expect(p.y).toBeCloseTo(0.5 + ((row - 2) * 160) / FORMAT.height, 5)
      rows.add(Math.round(p.y * 1e5))
    })
    expect(rows.size).toBe(5)
  })

  it('uses a bigger target box for the pitch', () => {
    const els = expand([square('a', 0.2, 0.2, { w: 300, h: 100 }), square('b', 0.4, 0.2), sys('ar', 'arrange', { at: 1, duration: 0.8, targets: ['a', 'b'], params: { layout: 'row', gap: 20 } })]).spec.elements
    expect(slot(byId(els, 'b')).x - slot(byId(els, 'a')).x).toBeCloseTo(320 / FORMAT.width, 5)
  })

  it('arrives on a spring, not a linear ramp', () => {
    const el = byId(run().spec.elements, 't0')
    for (const channel of ['x', 'y']) {
      const k = keysOn(el, channel)
      expect(k[k.length - 1]!.curve).toBe('spring:snappy')
    }
    const gentle = byId(run({ spring: 'gentle' }).spec.elements, 't0')
    expect(keysOn(gentle, 'x')[1]!.curve).toBe('spring:gentle')
  })

  it('staggers the arrivals in target order', () => {
    const els = run({ stagger: 0.07 }).spec.elements
    const starts = ids.map((id) => keysOn(byId(els, id), 'x')[0]!.at)
    expect(starts[0]).toBeCloseTo(1, 5)
    starts.forEach((s, i) => expect(s).toBeCloseTo(1 + i * 0.07, 5))
  })

  it('starts from the authored position by default and from a seeded scatter on request', () => {
    const authored = byId(run().spec.elements, 't3')
    expect(keysOn(authored, 'x')[0]!.value).toBeCloseTo(items()[3]!.x!, 5)
    const scattered = byId(run({ from: 'scatter' }).spec.elements, 't3')
    expect(keysOn(scattered, 'x')[0]!.value).not.toBeCloseTo(items()[3]!.x!, 3)
    expect(keysOn(scattered, 'x')[0]!.value).toBeGreaterThanOrEqual(0.1)
    expect(keysOn(scattered, 'x')[0]!.value).toBeLessThanOrEqual(0.9)
  })

  it('settles scale 0.9 -> 1 unless told not to', () => {
    expect(keysOn(byId(run().spec.elements, 't0'), 'scale').map((k) => k.value)).toEqual([0.9, 1])
    expect(keysOn(byId(run({ settle: false }).spec.elements, 't0'), 'scale')).toEqual([])
  })

  it('ring puts every slot `radius` px from the origin, the first straight up', () => {
    const els = run({ layout: 'ring', radius: 300 }, 1, { x: 0.5, y: 0.5 }).spec.elements
    ids.forEach((id) => {
      const p = slot(byId(els, id))
      expect(Math.hypot((p.x - 0.5) * FORMAT.width, (p.y - 0.5) * FORMAT.height)).toBeCloseTo(300, 1)
    })
    expect(slot(byId(els, 't0')).x).toBeCloseTo(0.5, 5)
    expect(slot(byId(els, 't0')).y).toBeLessThan(0.5)
  })

  it('names an unknown target and moves nothing', () => {
    const r = expand([...items(), sys('ar', 'arrange', { at: 1, duration: 0.8, targets: ['t0', 'zzz'] })])
    expect(byId(r.spec.elements, 't0').keys).toBeUndefined()
    expect(r.issues).toEqual([expect.objectContaining({ severity: 'error', code: 'unknown-target', message: expect.stringContaining('zzz') })])
  })

  it('rejects a spring that is not a preset with a warn and uses the default', () => {
    const r = run({ spring: 'sproing' })
    expect(r.issues.some((i) => i.code === 'bad-param')).toBe(true)
    expect(keysOn(byId(r.spec.elements, 't0'), 'x')[1]!.curve).toBe('spring:snappy')
  })
})
