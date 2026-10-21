import { describe, expect, it } from 'vitest'
import { expandComponents, resolveMotionStyle, seededRandom } from './index'
import { AUTHORED_KINDS } from './types'
import { SPEC_KINDS } from '../types'
import { buildVideo } from '../build'
import { compileVideoSpec } from '../compile'
import type { AuthoredSpec } from './types'

const base = (elements: AuthoredSpec['elements'], extra: Partial<AuthoredSpec> = {}): AuthoredSpec => ({
  format: { width: 1080, height: 1920, fps: 30 },
  duration: 4,
  elements,
  ...extra,
})

const text = (id: string, at = 0) => ({ id, kind: 'text' as const, at, duration: 2, text: id, size: 60 })

describe('expandComponents', () => {
  it('passes raw elements through unchanged, including nested group children', () => {
    const spec = base([text('a'), { id: 'g', kind: 'group', at: 1, duration: 2, children: [text('b')] }])
    const { spec: out, issues } = expandComponents(spec)
    expect(issues).toEqual([])
    expect(out.elements.map((e) => e.id)).toEqual(['a', 'g'])
    expect(out.elements[1].children?.map((e) => e.id)).toEqual(['b'])
    expect('motion' in out).toBe(false)
  })

  it('reports an unknown component as an error and keeps the rest of the piece', () => {
    const spec = base([text('a'), { id: 'x', kind: 'component', component: 'not-a-thing', at: 0, duration: 2 }])
    const { spec: out, issues } = expandComponents(spec)
    expect(out.elements.map((e) => e.id)).toEqual(['a'])
    expect(issues).toEqual([expect.objectContaining({ severity: 'error', code: 'unknown-component', path: 'elements[1].component' })])
  })

  it('reports a named but unbuilt component as unavailable, not unknown', () => {
    const { issues } = expandComponents(base([{ id: 'c', kind: 'component', component: 'chip-cloud', at: 0, duration: 3 }]))
    // Once AV-8 registers chip-cloud this becomes a successful expansion; either way it must not be "unknown".
    expect(issues.some((i) => i.code === 'unknown-component')).toBe(false)
  })

  it('renames a duplicate id instead of producing two clips that fight over references', () => {
    const { spec: out, issues } = expandComponents(base([text('a'), text('a', 2)]))
    expect(out.elements.map((e) => e.id)).toEqual(['a', 'a-2'])
    expect(issues).toEqual([expect.objectContaining({ severity: 'warn', code: 'duplicate-id' })])
  })

  it('walks components nested inside a raw group', () => {
    const spec = base([{ id: 'g', kind: 'group', at: 0, duration: 3, children: [{ id: 'z', kind: 'component', component: 'nope', at: 0, duration: 1 }] }])
    const { issues } = expandComponents(spec)
    expect(issues[0]?.path).toBe('elements[0].children[0].component')
  })
})

describe('resolveMotionStyle', () => {
  it('fills from defaults and rejects names it does not know', () => {
    const issues: never[] = []
    const s = resolveMotionStyle({ energy: 'bold', ambient: 'lava' as never }, issues)
    expect(s.energy).toBe('bold')
    expect(s.ambient).toBe('orbs')
    expect(issues).toEqual([expect.objectContaining({ path: 'motion.ambient', code: 'unknown-style' })])
  })
})

describe('seededRandom', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = seededRandom(7)
    const b = seededRandom(7)
    const c = seededRandom(8)
    const seqA = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(seqA)
    expect([c(), c(), c()]).not.toEqual(seqA)
    for (const v of seqA) expect(v >= 0 && v < 1).toBe(true)
  })
})

describe('buildVideo', () => {
  it('on a raw spec with polish off, compiles exactly what compileVideoSpec compiles', () => {
    const spec = base([text('a'), text('b', 1)])
    const built = buildVideo(spec, { seed: 3, polish: false })
    const direct = compileVideoSpec({ format: spec.format, duration: spec.duration, elements: spec.elements as never }, { seed: 3 })
    expect(JSON.stringify(built.project)).toBe(JSON.stringify(direct.project))
    expect(built.style.energy).toBe('standard')
  })
})

describe('expandComponents — systems (MI-P3)', () => {
  const sq = (id: string, x = 0.5, y = 0.5) => ({ id, kind: 'shape' as const, shape: 'rect' as const, at: 0, duration: 6, x, y, w: 100, h: 100 })
  const freezeSys = (targets: string[], extra: Record<string, unknown> = {}) =>
    ({ id: 'fr', kind: 'system' as const, system: 'freeze', at: 2, duration: 1, targets, ...extra }) as AuthoredSpec['elements'][number]

  it('lists system (and vector, MI-P5) among the authored kinds, beside every compiler kind and component', () => {
    expect([...AUTHORED_KINDS].sort()).toEqual([...SPEC_KINDS, 'component', 'system', 'vector'].sort())
  })

  it('removes the system element itself and lets it name targets that come LATER in the list', () => {
    const moving = { ...sq('m'), keys: [{ channel: 'x', at: 0, value: 0.2 }, { channel: 'x', at: 4, value: 0.8 }] }
    const { spec: out, issues } = expandComponents(base([freezeSys(['m']), moving]))
    expect(issues).toEqual([])
    expect(out.elements.map((e) => e.id)).toEqual(['m'])
    expect(out.elements[0]!.keys!.some((k) => k.hold)).toBe(true)
  })

  it('reports an unknown system as an error and keeps the rest of the piece', () => {
    const { spec: out, issues } = expandComponents(base([text('a'), { id: 'x', kind: 'system', system: 'teleport', at: 0, duration: 1 }]))
    expect(out.elements.map((e) => e.id)).toEqual(['a'])
    expect(issues).toEqual([expect.objectContaining({ severity: 'error', code: 'unknown-system', path: 'elements[1].system' })])
  })

  it('resolves targets at the SAME level only: a system inside a group cannot reach outside it', () => {
    const spec = base([sq('outside'), { id: 'g', kind: 'group', at: 0, duration: 4, children: [sq('inside'), freezeSys(['outside'])] }])
    const { issues } = expandComponents(spec)
    expect(issues).toEqual([expect.objectContaining({ severity: 'error', code: 'unknown-target', path: 'elements[1].children[1].targets[0]' })])
  })

  it('runs systems in document order, so a later one sees the keys of an earlier one', () => {
    const arrange = { id: 'ar', kind: 'system' as const, system: 'arrange', at: 0, duration: 1, targets: ['a'], x: 0.7, y: 0.7, params: [{ name: 'layout', value: 'row' }, { name: 'settle', value: false }] }
    const { spec: out } = expandComponents(base([sq('a'), arrange as never, freezeSys(['a'], { at: 0.5 })]))
    const x = out.elements[0]!.keys!.filter((k) => k.channel === 'x')
    expect(x.map((k) => k.at)).toEqual([0, 0.5])
    expect(x[1]!.hold).toBe(true)
  })

  it('claims the ids a system emits, renaming a collision instead of overwriting', () => {
    const swarm = { id: 'sw', kind: 'system' as const, system: 'swarm', at: 0, duration: 3, template: sq('t'), params: [{ name: 'count', value: 3 }] }
    const { spec: out, issues } = expandComponents(base([sq('sw-1'), swarm as never]))
    expect(out.elements.map((e) => e.id)).toEqual(['sw-1', 'sw-1-2', 'sw-2', 'sw-3'])
    expect(issues).toEqual([expect.objectContaining({ severity: 'warn', code: 'duplicate-id' })])
  })

  it('does not reserve the id of the template, and expands a component nested in a template group', () => {
    const template = { id: 'note', kind: 'group' as const, at: 0, duration: 1, children: [{ id: 'title', kind: 'component' as const, component: 'kinetic-title', at: 0, duration: 2, text: 'Hi' }] }
    const swarm = { id: 'sw', kind: 'system' as const, system: 'swarm', at: 0, duration: 3, template, params: [{ name: 'count', value: 3 }] }
    const { spec: out, issues } = expandComponents(base([swarm as never, text('note'), text('title')]))
    expect(issues.filter((i) => i.code === 'duplicate-id')).toEqual([])
    expect(out.elements.map((e) => e.id)).toEqual(['sw-1', 'sw-2', 'sw-3', 'note', 'title'])
    expect(out.elements[0]!.children![0]!.kind).toBe('group') // the kinetic-title component, expanded
    expect(JSON.stringify(out)).not.toContain('"kind":"component"')
  })

  it('warns about an unknown param and a duration outside the range of the system, and carries on', () => {
    const { issues } = expandComponents(base([sq('a'), freezeSys(['a'], { duration: 9999, params: [{ name: 'speed', value: 3 }] })]))
    expect(issues.map((i) => i.code).sort()).toEqual(['clamped', 'unknown-param'])
  })

  it('lets matte and fxKeys ride through expand untouched, for lowering after compile', () => {
    const el = { ...sq('a'), matte: { element: 'b', kind: 'alpha' }, fxKeys: [{ effect: 'gaussianBlur', param: 'radius', at: 0, value: 1 }] }
    const { spec: out } = expandComponents(base([el as never, sq('b')]))
    expect(out.elements[0]).toMatchObject({ matte: { element: 'b', kind: 'alpha' }, fxKeys: [{ effect: 'gaussianBlur' }] })
  })
})
