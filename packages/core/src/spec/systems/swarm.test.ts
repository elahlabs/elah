import { describe, expect, it } from 'vitest'
import { FORMAT, build, byId, errorsOf, expand, keysOn, square, sys } from './testSupport'

const note = { id: 'note', kind: 'group', at: 0, duration: 1, children: [{ id: 'bg', kind: 'shape', shape: 'rect', at: 0, duration: 1, w: 200, h: 80, fill: '#fff' }, { id: 'label', kind: 'text', at: 0, duration: 1, text: 'hi', size: 40, layout: { anchorTo: { element: 'bg', edge: 'top' } } }] }
const REGION = { x: 0.5, y: 0.4, w: 800, h: 1000 }
const swarm = (params: Record<string, number | string | boolean> = {}, extra: Record<string, unknown> = {}) =>
  sys('sw', 'swarm', { at: 1, duration: 4, template: note, ...REGION, params: { count: 12, ...params }, ...extra })

const copies = (seed = 1, params: Record<string, number | string | boolean> = {}) =>
  expand([swarm(params)], seed).spec.elements

describe('swarm', () => {
  it('is deterministic for a seed, and different for another', () => {
    expect(expand([swarm()], 4)).toEqual(expand([swarm()], 4))
    expect(expand([swarm()], 4).spec.elements).not.toEqual(expand([swarm()], 5).spec.elements)
  })

  it('compiles with 0 errors through buildVideo and leaves no system element behind', () => {
    const r = build([swarm()])
    expect(errorsOf(r.issues)).toEqual([])
    expect(r.expandedSpec.elements.some((e) => (e as { kind: string }).kind === 'system')).toBe(false)
  })

  it('emits exactly `count` copies, every id prefixed with the system id', () => {
    for (const count of [3, 12, 60]) {
      const els = copies(1, { count })
      expect(els).toHaveLength(count)
      for (const e of els) expect(e.id.startsWith('sw-')).toBe(true)
    }
  })

  it('keeps every copy inside the region', () => {
    for (const e of copies(9, { count: 40, jitter: 1 })) {
      const px = e.x! * FORMAT.width
      const py = e.y! * FORMAT.height
      expect(px).toBeGreaterThanOrEqual(REGION.x * FORMAT.width - REGION.w / 2)
      expect(px).toBeLessThanOrEqual(REGION.x * FORMAT.width + REGION.w / 2)
      expect(py).toBeGreaterThanOrEqual(REGION.y * FORMAT.height - REGION.h / 2)
      expect(py).toBeLessThanOrEqual(REGION.y * FORMAT.height + REGION.h / 2)
    }
  })

  it('defaults the region to the whole stage', () => {
    const els = expand([sys('sw', 'swarm', { at: 0, duration: 3, template: note })]).spec.elements
    expect(els.every((e) => e.x! >= 0 && e.x! <= 1 && e.y! >= 0 && e.y! <= 1)).toBe(true)
    expect(Math.max(...els.map((e) => e.y!))).toBeGreaterThan(0.7)
  })

  it('bounce adds wiggle expressions on x and y; bounce:false adds none', () => {
    for (const e of copies(1, { bounce: true })) {
      expect(e.expressions?.map((x) => x.channel).sort()).toEqual(['x', 'y'])
      expect(e.expressions!.every((x) => x.source.startsWith('wiggle('))).toBe(true)
    }
    for (const e of copies(1, { bounce: false })) expect(e.expressions ?? []).toEqual([])
  })

  it('pops each copy in on a bouncy spring and exits it in its last 0.3 s', () => {
    const e = copies()[0]!
    const scale = keysOn(e, 'scale')
    expect(scale[1]!.curve).toBe('spring:bouncy')
    const opacity = keysOn(e, 'opacity')
    const last = opacity[opacity.length - 1]!
    expect(last).toMatchObject({ value: 0, at: e.duration })
    expect(opacity.find((k) => k.value === 1 && k.at > scale[0]!.at && k.at >= e.duration - 0.31)).toBeTruthy()
  })

  it('staggers the copies and squeezes the stagger so the last one still lives >= 0.8 s', () => {
    const els = copies(1, { count: 60, stagger: 0.5 })
    const ats = els.map((e) => e.at)
    expect(ats).toEqual([...ats].sort((a, b) => a - b))
    expect(new Set(ats).size).toBe(60)
    for (const e of els) expect(e.at + e.duration).toBeLessThanOrEqual(1 + 4 + 1e-6)
    expect(Math.min(...els.map((e) => e.duration))).toBeGreaterThanOrEqual(0.8)
  })

  it('gives a template group renamed children, with references inside it repointed', () => {
    const [first, second] = copies()
    const ids = [first!.children![0]!.id, first!.children![1]!.id, second!.children![0]!.id]
    expect(new Set(ids).size).toBe(3)
    expect(first!.children![1]!.layout!.anchorTo!.element).toBe(first!.children![0]!.id)
    expect(first!.children![0]!.id.startsWith('sw-1-')).toBe(true)
  })

  it('keeps the template scale and opacity as the arrival target', () => {
    const els = expand([sys('sw', 'swarm', { at: 0, duration: 3, template: square('t', 0.5, 0.5, { scale: 0.8, opacity: 0.5 }), params: { count: 3 } })]).spec.elements
    expect(keysOn(els[0]!, 'scale')[1]!.value).toBeCloseTo(0.8, 5)
    expect(keysOn(els[0]!, 'opacity')[1]!.value).toBeCloseTo(0.5, 5)
  })

  it('clamps count into 3..60 with a warn', () => {
    const r = expand([swarm({ count: 500 })])
    expect(r.spec.elements).toHaveLength(60)
    expect(r.issues).toEqual([expect.objectContaining({ severity: 'warn', code: 'clamped' })])
  })

  it('needs a raw template: a missing one or a component is an error and nothing is emitted', () => {
    for (const template of [undefined, { id: 'c', kind: 'component', component: 'kinetic-title', at: 0, duration: 2 }]) {
      const r = expand([sys('sw', 'swarm', { at: 0, duration: 3, ...(template ? { template } : {}) })])
      expect(r.spec.elements).toEqual([])
      expect(r.issues).toEqual([expect.objectContaining({ severity: 'error', code: 'missing-template' })])
    }
  })
})
