import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildVideo } from './build'
import type { AuthoredSpec } from './components/types'
import type { AuthoredSfx } from './components/types'
import { lowerSfx, SFX_CUE_SYNONYMS, SFX_CUE_WORDS } from './sfxLowering'
import { specVocabulary } from './vocabulary'
import type { SpecElement } from './types'

const box = (id: string, extra: Partial<SpecElement> = {}): SpecElement => ({ id, kind: 'shape', shape: 'rect', at: 3, duration: 4, x: 0.5, y: 0.5, w: 100, h: 100, fill: '#111111', ...extra })
const arrives = (id: string, on: Partial<NonNullable<Extract<AuthoredSfx, { on: unknown }>['on']>> = {}, extra: Record<string, unknown> = {}): AuthoredSfx =>
  ({ cue: 'pop', on: { element: id, event: 'arrive', ...on }, ...extra }) as AuthoredSfx

/** at 3, opacity keys at 0.2 and 0.5 s. */
const keyed = box('card', {
  keys: [
    { channel: 'opacity', at: 0.2, value: 0 },
    { channel: 'opacity', at: 0.5, value: 1 },
  ],
})

describe('lowerSfx', () => {
  it('arrive = the EARLIEST motion key + the element at: 3 + 0.2', () => {
    const r = lowerSfx([arrives('card')], [keyed])
    expect(r.issues).toEqual([])
    expect(r.sfx).toEqual([{ at: 3.2, cue: 'pop' }])
  })

  it('exit = the LATEST motion key + the element at: 3 + 0.5', () => {
    expect(lowerSfx([arrives('card', { event: 'exit' })], [keyed]).sfx).toEqual([{ at: 3.5, cue: 'pop' }])
  })

  it('exit with an exit preset reads duration - exitDuration', () => {
    const el = box('bye', { at: 1, duration: 4, exit: 'fade-out', exitDuration: 0.5 })
    expect(lowerSfx([arrives('bye', { event: 'exit' })], [el]).sfx).toEqual([{ at: 4.5, cue: 'pop' }])
  })

  it('key index 1 on scale reads the SECOND scale key, not the second key overall', () => {
    const el = box('k', {
      keys: [
        { channel: 'scale', at: 0.1, value: 0 },
        { channel: 'opacity', at: 0.2, value: 0 },
        { channel: 'scale', at: 0.4, value: 1.2 },
        { channel: 'scale', at: 0.9, value: 1 },
      ],
    })
    expect(lowerSfx([arrives('k', { event: 'key', channel: 'scale', index: 1 })], [el]).sfx).toEqual([{ at: 3.4, cue: 'pop' }])
    // no channel: among all keys, in the element's own order -> index 1 is the opacity key
    expect(lowerSfx([arrives('k', { event: 'key', index: 1 })], [el]).sfx).toEqual([{ at: 3.2, cue: 'pop' }])
  })

  it('an element with only an enter preset arrives at its own at', () => {
    expect(lowerSfx([arrives('p')], [box('p', { enter: 'pop-in' })]).sfx).toEqual([{ at: 3, cue: 'pop' }])
  })

  it('a child inside a group adds the group at chain (group at 2, child at 1, key 0.25 -> 3.25)', () => {
    const child = box('c', { at: 1, keys: [{ channel: 'opacity', at: 0.25, value: 1 }] })
    const inner: SpecElement = { id: 'inner', kind: 'group', at: 0.5, duration: 3, children: [child] }
    const outer: SpecElement = { id: 'outer', kind: 'group', at: 2 - 0.5, duration: 6, children: [inner] }
    // 1.5 + 0.5 + 1 + 0.25
    expect(lowerSfx([arrives('c')], [outer]).sfx).toEqual([{ at: 3.25, cue: 'pop' }])
  })

  it('offset is added after the event and clamped to +-0.5 s with an info', () => {
    expect(lowerSfx([arrives('card', {}, {})], [keyed]).sfx![0]!.at).toBe(3.2)
    const withOffset = lowerSfx([{ cue: 'pop', on: { element: 'card', event: 'arrive', offset: -0.1 } }], [keyed])
    expect(withOffset.sfx).toEqual([{ at: 3.1, cue: 'pop' }])
    const clamped = lowerSfx([{ cue: 'pop', on: { element: 'card', event: 'arrive', offset: 9 } }], [keyed])
    expect(clamped.sfx).toEqual([{ at: 3.7, cue: 'pop' }])
    expect(clamped.issues.map((i) => i.severity)).toEqual(['info'])
  })

  it('never goes before 0', () => {
    const el = box('early', { at: 0, keys: [{ channel: 'opacity', at: 0, value: 1 }] })
    expect(lowerSfx([{ cue: 'pop', on: { element: 'early', event: 'arrive', offset: -0.5 } }], [el]).sfx).toEqual([{ at: 0, cue: 'pop' }])
  })

  it('an unknown element warns sfx-unknown-element and the cue is dropped', () => {
    const r = lowerSfx([arrives('ghost'), { at: 1, cue: 'tick' }], [keyed])
    expect(r.sfx).toEqual([{ at: 1, cue: 'tick' }])
    expect(r.issues).toEqual([expect.objectContaining({ severity: 'warn', code: 'sfx-unknown-element', path: 'sfx[0].on.element' })])
  })

  it('an event that cannot be read warns sfx-no-event and the cue is dropped', () => {
    const bare = box('bare')
    for (const on of [{ event: 'arrive' }, { event: 'exit' }, { event: 'key', index: 4 }, { event: 'sideways' }] as const) {
      const r = lowerSfx([arrives('bare', on as never)], [bare])
      expect(r.sfx).toEqual([])
      expect(r.issues).toEqual([expect.objectContaining({ severity: 'warn', code: 'sfx-no-event' })])
    }
  })

  it('seconds cues pass through untouched: same objects, same order, none added', () => {
    const a = { at: 0.5, cue: 'whoosh', gain: 0.9 }
    const b = { at: 2, cue: 'pop' }
    const r = lowerSfx([a, arrives('card'), b], [keyed])
    expect(r.sfx![0]).toBe(a)
    expect(r.sfx![2]).toBe(b)
    expect(r.sfx).toHaveLength(3)
    expect(lowerSfx([a, b], []).sfx).toEqual([a, b])
  })

  it('keeps gain, and returns undefined when the document has no sfx at all', () => {
    expect(lowerSfx([arrives('card', {}, { gain: 0.3 })], [keyed]).sfx).toEqual([{ at: 3.2, cue: 'pop', gain: 0.3 }])
    expect(lowerSfx(undefined, [keyed])).toEqual({ sfx: undefined, issues: [] })
  })

  it('does not cap: 30 event cues come back as 30', () => {
    const cues = Array.from({ length: 30 }, () => arrives('card'))
    expect(lowerSfx(cues, [keyed]).sfx).toHaveLength(30)
  })
})

describe('buildVideo lowers event cues (MI-P6)', () => {
  const FORMAT = { width: 1080, height: 1920, fps: 30 }
  const doc = (at: number, sfx?: AuthoredSfx[]): AuthoredSpec => ({
    format: FORMAT,
    duration: 12,
    elements: [{ ...keyed, at } as SpecElement],
    ...(sfx ? { sfx } : {}),
  })

  it('the cue follows the element when the scene is retimed (the claim of the whole ticket)', () => {
    const sfx = [arrives('card')]
    const at = (t: number) => buildVideo(structuredClone(doc(t, sfx)), { polish: false }).expandedSpec.sfx![0]!.at
    expect(at(3)).toBe(3.2)
    expect(at(5)).toBe(5.2)
  })

  it('reads the keys of a system-made element (swarm copies exist by the time cues are lowered)', () => {
    const spec: AuthoredSpec = {
      format: FORMAT,
      duration: 12,
      elements: [
        {
          id: 'sw',
          kind: 'system',
          system: 'swarm',
          at: 1,
          duration: 4,
          template: box('t', { at: 0, duration: 1 }),
          params: [{ name: 'count', value: 4 }],
        } as never,
      ],
      sfx: [arrives('sw-2', { event: 'arrive' })],
    }
    const r = buildVideo(spec, { polish: false, seed: 5 })
    const copy = r.expandedSpec.elements.find((e) => e.id === 'sw-2')!
    const first = Math.min(...(copy.keys ?? []).filter((k) => ['opacity', 'scale', 'x', 'y'].includes(k.channel)).map((k) => k.at))
    expect(r.issues.filter((i) => i.code.startsWith('sfx-'))).toEqual([])
    expect(r.expandedSpec.sfx).toEqual([{ at: Math.round((copy.at + first) * 1e4) / 1e4, cue: 'pop' }])
  })

  it('lowering issues join the build issues; the dropped cue is not in the expanded spec', () => {
    const r = buildVideo(doc(3, [arrives('ghost')]), { polish: false })
    expect(r.issues.some((i) => i.code === 'sfx-unknown-element')).toBe(true)
    expect(r.expandedSpec.sfx).toEqual([])
  })

  it('polish does not move a lowered cue', () => {
    const a = buildVideo(structuredClone(doc(3, [arrives('card')])), { polish: false }).expandedSpec.sfx
    const b = buildVideo(structuredClone(doc(3, [arrives('card')])), { polish: true, seed: 2 }).expandedSpec.sfx
    expect(b).toEqual(a)
  })

  it('a document without sfx gets no sfx key; one with seconds cues keeps them exactly (back-compat)', () => {
    expect('sfx' in buildVideo(doc(3), { polish: false }).expandedSpec).toBe(false)
    const clarity = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'clarity.spec.json'), 'utf8')) as AuthoredSpec
    expect(clarity.sfx?.length).toBeGreaterThan(0)
    const r = buildVideo(structuredClone(clarity), { seed: 7 })
    expect(r.expandedSpec.sfx).toEqual(clarity.sfx)
    expect(r.issues.filter((i) => i.code.startsWith('sfx-'))).toEqual([])
  })
})

describe('specVocabulary SFX line (MI-P6)', () => {
  it('names the three events and every pack cue word, and the synonyms', () => {
    const line = specVocabulary().split('\n').find((l) => l.startsWith('SFX (sfx[])'))!
    expect(line).toBeTruthy()
    for (const e of ['arrive', 'exit', 'key']) expect(line).toContain(e)
    for (const w of SFX_CUE_WORDS) expect(line).toContain(w)
    for (const [from, to] of Object.entries(SFX_CUE_SYNONYMS)) expect(line).toContain(`${from} = ${to}`)
  })
})
