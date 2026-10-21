import { describe, expect, it } from 'vitest'
import { sampleChannel } from '../../resolver/keyframes'
import { build, byId, deepClips, errorsOf, expand, keysOn, square, sys } from './testSupport'

const VB = { x: 0, y: 0, width: 24, height: 24 }
const card = () => square('card', 0.5, 0.5, { at: 0, duration: 4 })
const icon = () => square('icon', 0.5, 0.5, { at: 0, duration: 4 })
const morph = (params: Record<string, string> = { from: 'card', to: 'icon' }) => sys('cm', 'crossMorph', { at: 2, duration: 0.6, params })
const paths = (vb2 = VB) => [
  square('p1', 0.5, 0.5, { shape: 'path', path: 'M 0 0 L 24 0 L 24 24 Z', viewBox: VB, at: 0, duration: 4 }),
  square('p2', 0.5, 0.5, { shape: 'path', path: 'M 0 24 L 24 24 L 12 0 Z', viewBox: vb2, at: 0, duration: 4 }),
]

describe('crossMorph', () => {
  it('is deterministic', () => {
    expect(expand([card(), icon(), morph()])).toEqual(expand([card(), icon(), morph()]))
  })

  it('compiles with 0 errors and emits nothing of its own', () => {
    const r = build([card(), icon(), morph()])
    expect(errorsOf(r.issues)).toEqual([])
    expect(r.expandedSpec.elements.map((e) => e.id)).toEqual(['card', 'icon'])
  })

  it('crosses the two fades at at + duration / 2: both read 0.5 on the COMPILED clips', () => {
    const r = build([card(), icon(), morph()])
    const clips = deepClips(r.project)
    const opacity = (partId: string) => clips.find((c) => c.partId === partId)!.keyframes!.channels.opacity!.keys
    // 2.0 s = frame 60, 2.6 s = frame 78: the midpoint (2.3 s) is frame 69
    expect(sampleChannel(opacity('card'), 69)).toBeCloseTo(0.5, 9)
    expect(sampleChannel(opacity('icon'), 69)).toBeCloseTo(0.5, 9)
    expect(sampleChannel(opacity('card'), 60)).toBe(1)
    expect(sampleChannel(opacity('card'), 78)).toBe(0)
    expect(sampleChannel(opacity('icon'), 60)).toBe(0)
    expect(sampleChannel(opacity('icon'), 78)).toBe(1)
  })

  it('shrinks the outgoing element and grows the incoming one', () => {
    const els = expand([card(), icon(), morph()]).spec.elements
    expect(keysOn(byId(els, 'card'), 'scale').map((k) => k.value)).toEqual([1, 0.85])
    expect(keysOn(byId(els, 'icon'), 'scale').map((k) => k.value)).toEqual([0.85, 1])
  })

  it('keeps only opacity keys on `to` when both ends are path shapes sharing a viewBox, and marks `from` for lowering', () => {
    const els = expand([...paths(), morph({ from: 'p1', to: 'p2' })]).spec.elements
    expect(byId(els, 'p2').keys!.every((k) => k.channel === 'opacity')).toBe(true)
    expect((byId(els, 'p1') as unknown as { pathMorph: unknown }).pathMorph).toEqual({ to: 'p2', at: 2, duration: 0.6 })
  })

  it('is a plain crossfade when the viewBoxes differ or an end is not a path', () => {
    const els = expand([...paths({ x: 0, y: 0, width: 48, height: 48 }), morph({ from: 'p1', to: 'p2' })]).spec.elements
    expect((byId(els, 'p1') as unknown as { pathMorph?: unknown }).pathMorph).toBeUndefined()
    expect(keysOn(byId(els, 'p2'), 'scale')).toHaveLength(2)
    const mixed = expand([paths()[0]!, icon(), morph({ from: 'p1', to: 'icon' })]).spec.elements
    expect((byId(mixed, 'p1') as unknown as { pathMorph?: unknown }).pathMorph).toBeUndefined()
  })

  it('names an unknown element, and a missing or identical pair, as errors that change nothing', () => {
    const ghost = expand([card(), icon(), morph({ from: 'card', to: 'ghost' })])
    expect(ghost.issues).toEqual([expect.objectContaining({ severity: 'error', code: 'unknown-target', message: expect.stringContaining('ghost') })])
    expect(byId(ghost.spec.elements, 'card').keys).toBeUndefined()
    expect(expand([card(), icon(), morph({ from: 'card' })]).issues[0]).toMatchObject({ severity: 'error', code: 'missing-param' })
    expect(expand([card(), icon(), morph({ from: 'card', to: 'card' })]).issues[0]).toMatchObject({ severity: 'error', code: 'bad-param' })
  })
})
