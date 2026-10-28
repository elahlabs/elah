import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildVideo } from './build'
import { COMPONENT_SAMPLES } from './components/componentSamples'
import type { AuthoredSpec } from './components/types'

const FORMAT = { width: 1080, height: 1920, fps: 30 }

describe('buildVideo + polish integration', () => {
  it('polish:true adds exits that polish:false leaves absent', () => {
    const spec: AuthoredSpec = {
      format: FORMAT,
      duration: 6,
      elements: [{ id: 'a', kind: 'shape', shape: 'rect', at: 0, duration: 4, w: 100, h: 100 }],
    }
    const off = buildVideo(structuredClone(spec), { seed: 1, polish: false })
    const on = buildVideo(structuredClone(spec), { seed: 1, polish: true })
    expect(off.expandedSpec.elements[0]!.keys ?? []).toEqual([])
    const onA = on.expandedSpec.elements.find((e) => e.id === 'a')!
    expect(onA.keys?.some((k) => k.channel === 'opacity' && k.value === 0)).toBe(true) // an exit landed
  })

  it('polish:true adds idle motion to a held element that already has both enter and exit and nothing else', () => {
    const spec: AuthoredSpec = {
      format: FORMAT,
      duration: 6,
      elements: [{ id: 'a', kind: 'text', text: 'Steady', size: 90, at: 0, duration: 4, enter: 'fade-in', exit: 'fade-out' }],
    }
    const off = buildVideo(structuredClone(spec), { seed: 1, polish: false })
    const on = buildVideo(structuredClone(spec), { seed: 1, polish: true })
    expect(off.expandedSpec.elements[0]!.expressions ?? []).toEqual([])
    const onA = on.expandedSpec.elements.find((e) => e.id === 'a')!
    expect(onA.expressions?.some((e) => e.channel === 'y')).toBe(true)
  })

  it('lintSpec runs on the polished spec and its warn issues surface in buildVideo().issues', () => {
    const spec: AuthoredSpec = {
      format: FORMAT,
      duration: 3,
      elements: [{ id: 'a', kind: 'text', text: 'hi', size: 70, at: 0, duration: 3 }], // 70px is off the hierarchy bands
    }
    const built = buildVideo(spec, { seed: 1 })
    expect(built.issues.some((i) => i.severity === 'warn' && i.code === 'off-scale-type')).toBe(true)
  })

  it('the compiled project is byte-identical across two builds with the same seed (polish included)', () => {
    const spec: AuthoredSpec = {
      format: FORMAT,
      duration: 6,
      elements: [
        { id: 'a', kind: 'text', text: 'Hello', size: 90, at: 0, duration: 2 },
        { id: 'b', kind: 'text', text: 'World', size: 90, at: 2, duration: 2 },
      ],
    }
    const a = buildVideo(structuredClone(spec), { seed: 5 })
    const b = buildVideo(structuredClone(spec), { seed: 5 })
    expect(JSON.stringify(a.project)).toBe(JSON.stringify(b.project))
  })

  it('an already-polished expandedSpec, fed back through buildVideo, does not accumulate more polish', () => {
    const spec: AuthoredSpec = {
      format: FORMAT,
      duration: 6,
      elements: [
        { id: 'a', kind: 'text', text: 'Hello', size: 90, at: 0, duration: 2 },
        { id: 'b', kind: 'text', text: 'World', size: 90, at: 2, duration: 2 },
      ],
    }
    const once = buildVideo(structuredClone(spec), { seed: 5 })
    const twice = buildVideo(structuredClone(once.expandedSpec) as AuthoredSpec, { seed: 5 })
    expect(twice.expandedSpec).toEqual(once.expandedSpec)
  })
})

/**
 * MI-P3 back-compat pin. A document with no `system` element and no `matte`/`fxKeys` must compile to exactly what it
 * did before the systems layer existed. The hashes were captured from the tree at `dev` @ 5fcd7e9 BEFORE any MI-P3
 * edit and cover the project, issues, id map, expanded spec, fonts, style and seed of: the reference fixture (polish on
 * and off) and one instance of every library component (polish on and off). Do not re-capture them to make this pass.
 */
describe('buildVideo is unchanged for documents without systems (MI-P3)', () => {
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const fingerprint = (spec: AuthoredSpec, opts: { seed: number; polish: boolean }) => {
    const r = buildVideo(structuredClone(spec), opts)
    return digest({ project: r.project, issues: r.issues, ids: r.elementClipIds, expanded: r.expandedSpec, fonts: r.fontIds, style: r.style, seed: r.seed })
  }
  const clarity = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'clarity.spec.json'), 'utf8')) as AuthoredSpec
  const samples = (): AuthoredSpec => ({
    format: FORMAT,
    duration: 60,
    design: { colors: [{ name: 'accent', value: '#22c55e' }], fonts: [{ role: 'serif', font: 'playfair-display' }] },
    elements: Object.values(COMPONENT_SAMPLES).map((s, i) => ({ ...s, id: `c${i}`, kind: 'component' as const, at: i * 2 })) as AuthoredSpec['elements'],
  })

  it('the reference fixture, polished', () => {
    expect(fingerprint(clarity, { seed: 7, polish: true })).toBe('dab0511afa884ef4e21132318fe809b1b44464fc25fadeac9904746e1fc52621')
  })
  it('the reference fixture, unpolished', () => {
    expect(fingerprint(clarity, { seed: 7, polish: false })).toBe('953da9be42b022cd3359cc1eaa84b11c5617e4df595237ec5ced1c89fdd10c1b')
  })
  it('every library component, polished', () => {
    expect(fingerprint(samples(), { seed: 3, polish: true })).toBe('07365b7e43cebf8d71293272197945d350c3dd238bf3ba8aa42295cf829bca82')
  })
  it('every library component, unpolished', () => {
    expect(fingerprint(samples(), { seed: 3, polish: false })).toBe('eeb224a6faf0a259789ccb0a7d3d971eeceea0dbd66caf04551185688df66641')
  })
})

describe('buildVideo with every system at once (MI-P3)', () => {
  const sq = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({ id, kind: 'shape' as const, shape: 'rect' as const, at: 0, duration: 12, x, y, w: 100, h: 100, fill: '#111111', ...extra })
  const doc = (): AuthoredSpec => ({
    format: FORMAT,
    duration: 12,
    design: { colors: [{ name: 'accent', value: '#22c55e' }] },
    elements: [
      { id: 'note', kind: 'system', system: 'swarm', at: 0.5, duration: 3, x: 0.5, y: 0.5, w: 800, h: 1000, template: { id: 'tpl', kind: 'text', text: 'ping', size: 60, at: 0, duration: 1 }, params: [{ name: 'count', value: 8 }] },
      sq('a', 0.3, 0.3),
      sq('b', 0.7, 0.3),
      sq('c', 0.3, 0.7),
      sq('d', 0.7, 0.7),
      { id: 'push', kind: 'system', system: 'radialPush', at: 4, duration: 0.6, targets: ['a', 'b', 'c', 'd'] },
      { id: 'snap', kind: 'system', system: 'arrange', at: 6, duration: 0.8, targets: ['a', 'b', 'c', 'd'], params: [{ name: 'cols', value: 2 }] },
      { id: 'hold', kind: 'system', system: 'freeze', at: 9, duration: 1, targets: ['a'] },
      { ...sq('card', 0.5, 0.5, { at: 7, duration: 3 }), matte: { element: 'mask', kind: 'luma' }, effects: [{ kind: 'gaussianBlur', params: [{ name: 'radius', value: 4 }] }], fxKeys: [{ effect: 'gaussianBlur', param: 'radius', at: 1, value: 20 }] },
      sq('mask', 0.5, 0.5, { at: 7, duration: 3, shape: 'circle' }),
      sq('icon', 0.5, 0.5, { at: 7, duration: 3 }),
      { id: 'morph', kind: 'system', system: 'crossMorph', at: 8, duration: 0.6, params: [{ name: 'from', value: 'card' }, { name: 'to', value: 'icon' }] },
      { id: 'cam', kind: 'system', system: 'camera', at: 10, duration: 1, targets: ['icon'], params: [{ name: 'move', value: 'whip' }] },
    ] as AuthoredSpec['elements'],
  })

  it('compiles with no errors, polish on or off, and no system element reaches the compiler', () => {
    for (const polish of [false, true]) {
      const r = buildVideo(doc(), { seed: 2, polish })
      expect(r.issues.filter((i) => i.severity === 'error'), 'polish ' + polish).toEqual([])
      expect(JSON.stringify(r.expandedSpec)).not.toContain('"kind":"system"')
    }
  })

  it('is byte-identical across two builds with the same seed', () => {
    const a = buildVideo(doc(), { seed: 2 })
    const b = buildVideo(doc(), { seed: 2 })
    expect(JSON.stringify(a.project)).toBe(JSON.stringify(b.project))
  })
})
