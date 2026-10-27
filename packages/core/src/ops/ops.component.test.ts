import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import type { Clip, Project } from '../types'
import { buildVideo } from '../spec/build'
import { layProject } from '../spec/layProject'
import type { AuthoredSpec } from '../spec/components/types'
import { applyOps } from './apply'
import { describeProject } from './describe'
import { opDescriber } from './describeOp'
import { patchClipAtPath } from './nested'
import { sanitizeOps } from './sanitize'
import { planInstanceUpdate, validateInstanceOverrides } from './componentEdit'
import type { EditorOp } from './types'

/**
 * EG-P6: the Assistant edits a generated graphic by its instance fields.
 *
 * `setComponentField` / `setComponentItems` re-expand ONE component through the
 * instance method and merge with the user's hand edits, inside the plan's one
 * undo step; an edit that does not fit the component is a skip with a reason;
 * `regenerateElement` is deferred and writes nothing.
 */

const SPEC: AuthoredSpec = {
  format: { width: 1080, height: 1920, fps: 30 },
  duration: 8,
  elements: [
    { id: 'cloud', kind: 'component', component: 'chip-cloud', at: 0, duration: 4.5, items: ['A', 'B', 'C', 'D'].map((text) => ({ text })) },
    { id: 'title', kind: 'component', component: 'kinetic-title', at: 5, duration: 3, text: 'Hello world' },
    { id: 'ring', kind: 'component', component: 'stat-ring', at: 9, duration: 3, text: '72', sub: 'done', variant: 'percent' },
  ],
}

function laid(spec: AuthoredSpec = SPEC) {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1080, height: 1920 }, initialTracks: [] })
  layProject(engine, buildVideo(structuredClone(spec), { seed: 7 }).project)
  const all = (): Clip[] => Object.values(engine.getProject().clips).flat()
  const byPart = (id: string) => all().find((c) => c.partId === id)!
  const kids = (c: Clip): Clip[] => Object.values(c.compound!.project.clips).flat()
  const part = (c: Clip, partId: string): Clip => kids(c).find((k) => k.partId === partId)!
  return { engine, all, byPart, kids, part }
}

const snap = (p: Project) => JSON.stringify(p)

function run(engine: TimelineEngine, ops: EditorOp[]) {
  return applyOps(engine, ops)
}

const items = (...texts: string[]) => texts.map((text) => ({ text }))

describe('setComponentItems keeps a hand edit and re-flows the rest', () => {
  it('a hand-moved chip keeps its transform, the others re-flow, and ONE undo restores the project', () => {
    const { engine, byPart, part } = laid()
    const cloud = byPart('cloud')
    const chip1 = part(cloud, 'cloud-chip-1')
    const hand = { ...chip1.transform!, x: 0.91, y: 0.07 }
    const moved = patchClipAtPath(cloud.compound!.project, [chip1.id], { transform: hand })!
    expect(engine.updateCompoundProject(cloud.id, moved).ok).toBe(true)

    const before = snap(engine.getProject())
    const otherBefore = part(byPart('cloud'), 'cloud-chip-2').transform
    const r = run(engine, [{ op: 'setComponentItems', clip: cloud.id, items: items('A', 'B', 'C', 'D', 'E') }])

    expect(r.skipped).toEqual([])
    expect(r.applied).toEqual([0])
    const after = byPart('cloud')
    expect(part(after, 'cloud-chip-1').transform).toEqual(hand)
    expect(part(after, 'cloud-chip-2').transform).not.toEqual(otherBefore)
    expect(part(after, 'cloud-chip-4')).toBeDefined()
    expect((after.component!.input as { items: unknown[] }).items).toHaveLength(5)
    expect(r.touched.changed).toContain(cloud.id)

    engine.undo()
    expect(snap(engine.getProject())).toBe(before)
  })

  it('is ONE undo step with every other op in the plan', () => {
    const { engine, byPart } = laid()
    const cloud = byPart('cloud')
    const title = byPart('title')
    const before = snap(engine.getProject())
    const r = run(engine, [
      { op: 'setComponentField', clip: title.id, field: 'text', value: 'Goodbye moon' },
      { op: 'setComponentItems', clip: cloud.id, items: items('A', 'B', 'C', 'D', 'E', 'F') },
      { op: 'setClipProps', clip: title.id, opacity: 0.5 },
    ])
    expect(r.skipped).toEqual([])
    expect(r.applied).toEqual([0, 1, 2])
    expect((byPart('title').component!.input as { text: string }).text).toBe('Goodbye moon')
    engine.undo()
    expect(snap(engine.getProject())).toBe(before)
  })
})

describe('setComponentField', () => {
  it('re-expands the text through the instance method: the stored input and the parts both change', () => {
    const { engine, byPart, kids } = laid()
    const title = byPart('title')
    const r = run(engine, [{ op: 'setComponentField', clip: title.id, field: 'text', value: 'Totally new words' }])
    expect(r.skipped).toEqual([])
    const after = byPart('title')
    expect((after.component!.input as { text: string }).text).toBe('Totally new words')
    const spoken = kids(after)
      .map((k) => k.name)
      .join(' ')
    expect(spoken).toContain('Totally')
    expect(spoken).not.toContain('Hello')
  })

  it('sets a variant, an energy and emphasis words on a component that offers them', () => {
    const { engine, byPart } = laid()
    const ring = byPart('ring')
    const r = run(engine, [
      { op: 'setComponentField', clip: ring.id, field: 'variant', value: 'full' },
      { op: 'setComponentField', clip: ring.id, field: 'energy', value: 'bold' },
      { op: 'setComponentField', clip: ring.id, field: 'emphasis', value: ['72'] },
    ])
    expect(r.skipped).toEqual([])
    expect(byPart('ring').component!.input).toMatchObject({ variant: 'full', energy: 'bold', emphasis: ['72'] })
  })

  it('duration resizes the compound when there is room and is refused when the next clip is in the way', () => {
    const { engine, byPart } = laid()
    const cloud = byPart('cloud')
    // The title starts at 5 s on the same lane: 5 s fits exactly, 5.5 s does not.
    const ok = run(engine, [{ op: 'setComponentField', clip: cloud.id, field: 'duration', value: 5 }])
    expect(ok.skipped).toEqual([])
    expect(byPart('cloud').durationFrames).toBe(150)
    expect((byPart('cloud').component!.input as { duration: number }).duration).toBe(5)

    const before = snap(engine.getProject())
    const blocked = run(engine, [{ op: 'setComponentField', clip: cloud.id, field: 'duration', value: 5.5 }])
    expect(blocked.applied).toEqual([])
    expect(blocked.skipped[0]!.reason).toMatch(/in the way/)
    expect(snap(engine.getProject())).toBe(before)
  })

  it('works on a component nested in a raw group, addressed by a path', () => {
    const spec: AuthoredSpec = {
      format: { width: 1080, height: 1920, fps: 30 },
      duration: 6,
      elements: [
        {
          id: 'g',
          kind: 'group',
          at: 0,
          duration: 5,
          children: [{ id: 'inner', kind: 'component', component: 'chip-cloud', at: 0, duration: 4, items: items('A', 'B', 'C') }],
        },
      ],
    }
    const { engine, byPart } = laid(spec)
    const g = byPart('g')
    const inner = Object.values(g.compound!.project.clips).flat().find((c) => c.partId === 'inner')!
    expect(inner.component?.name).toBe('chip-cloud')
    const before = snap(engine.getProject())
    const r = run(engine, [{ op: 'setComponentItems', clip: `${g.id}/${inner.id}`, items: items('A', 'B', 'C', 'D') }])
    expect(r.skipped).toEqual([])
    const after = Object.values(byPart('g').compound!.project.clips).flat().find((c) => c.partId === 'inner')!
    expect((after.component!.input as { items: unknown[] }).items).toHaveLength(4)
    expect(r.touched.changed).toContain(g.id)
    engine.undo()
    expect(snap(engine.getProject())).toBe(before)
  })
})

describe('an edit that does not fit is skipped with a reason and never throws', () => {
  type Ids = { cloud: string; title: string; ring: string }
  const cases: Array<[string, (id: Ids) => EditorOp, RegExp]> = [
    ['too few items', (id) => ({ op: 'setComponentItems', clip: id.cloud, items: items('A', 'B') }), /3 to 8 items/],
    ['too many items', (id) => ({ op: 'setComponentItems', clip: id.cloud, items: items('1', '2', '3', '4', '5', '6', '7', '8', '9') }), /3 to 8 items/],
    ['an icon that does not exist', (id) => ({ op: 'setComponentItems', clip: id.cloud, items: [{ text: 'A', icon: 'not-an-icon' }, { text: 'B' }, { text: 'C' }] }), /not an icon/],
    ['an item style that does not exist', (id) => ({ op: 'setComponentItems', clip: id.cloud, items: [{ text: 'A', style: 'sparkly' }, { text: 'B' }, { text: 'C' }] }), /style "sparkly"/],
    ['a variant on a component that has none', (id) => ({ op: 'setComponentField', clip: id.cloud, field: 'variant', value: 'full' }), /has no variants/],
    ['a variant the component does not offer', (id) => ({ op: 'setComponentField', clip: id.ring, field: 'variant', value: 'sideways' }), /no variant "sideways"/],
    ['an energy that is not one', (id) => ({ op: 'setComponentField', clip: id.cloud, field: 'energy', value: 'frantic' }), /energy/],
    ['a duration outside the component’s range', (id) => ({ op: 'setComponentField', clip: id.cloud, field: 'duration', value: 60 }), /runs 3 to 6 seconds/],
    ['items on a component that takes none', (id) => ({ op: 'setComponentItems', clip: id.title, items: items('A', 'B', 'C') }), /takes no items/],
  ]
  for (const [label, make, reason] of cases) {
    it(`${label}`, () => {
      const { engine, byPart } = laid()
      const op = make({ cloud: byPart('cloud').id, title: byPart('title').id, ring: byPart('ring').id })
      const before = snap(engine.getProject())
      const rev = engine.getRevision()
      let r!: ReturnType<typeof run>
      expect(() => (r = run(engine, [op]))).not.toThrow()
      expect(r.applied).toEqual([])
      expect(r.skipped).toHaveLength(1)
      expect(r.skipped[0]!.reason).toMatch(reason)
      expect(snap(engine.getProject())).toBe(before)
      expect(engine.getRevision()).toBe(rev)
    })
  }

  it('a compound that is not a component instance is skipped, and so is a clip that is not a graphic', () => {
    const { engine, byPart } = laid()
    const cloud = byPart('cloud')
    expect(engine.detachComponent(cloud.id).ok).toBe(true)
    const before = snap(engine.getProject())
    const r = run(engine, [
      { op: 'setComponentItems', clip: cloud.id, items: items('A', 'B', 'C') },
      { op: 'setComponentField', clip: `${cloud.id}/${Object.values(byPart('cloud').compound!.project.clips).flat()[0]!.id}`, field: 'text', value: 'x' },
    ])
    expect(r.applied).toEqual([])
    expect(r.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/not a generated component/), expect.stringMatching(/not a graphic/)])
    expect(snap(engine.getProject())).toBe(before)
  })

  it('a stale or unknown target is a skip, not a throw', () => {
    const { engine } = laid()
    const before = snap(engine.getProject())
    const r = run(engine, [
      { op: 'setComponentField', clip: 'nope', field: 'text', value: 'x' },
      { op: 'setComponentField', clip: 'nope/also-nope', field: 'text', value: 'x' },
    ])
    expect(r.applied).toEqual([])
    expect(r.skipped).toHaveLength(2)
    expect(snap(engine.getProject())).toBe(before)
  })

  it('one bad op does not stop the good ones', () => {
    const { engine, byPart } = laid()
    const r = run(engine, [
      { op: 'setComponentItems', clip: byPart('cloud').id, items: items('A') },
      { op: 'setComponentField', clip: byPart('title').id, field: 'text', value: 'Still applied' },
    ])
    expect(r.applied).toEqual([1])
    expect(r.skipped.map((s) => s.index)).toEqual([0])
    expect((byPart('title').component!.input as { text: string }).text).toBe('Still applied')
  })
})

describe('validateInstanceOverrides / planInstanceUpdate', () => {
  it('knows each component’s own bounds', () => {
    expect(validateInstanceOverrides('chip-cloud', { items: items('a', 'b', 'c') })).toBeNull()
    expect(validateInstanceOverrides('chip-cloud', { items: items('a') })).toMatch(/3 to 8/)
    expect(validateInstanceOverrides('stat-ring', { variant: 'full' })).toBeNull()
    expect(validateInstanceOverrides('nonsense', { text: 'x' })).toMatch(/newer version/)
  })

  it('an empty update changes nothing', () => {
    const { byPart, engine } = laid()
    const cloud = byPart('cloud')
    const plan = planInstanceUpdate(cloud, engine.getProject().authored, { overrides: {} })
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(JSON.stringify(plan.child)).toBe(JSON.stringify(cloud.compound!.project))
  })

  it('becoming a different component replaces the parts and keeps no hand edit', () => {
    const { byPart, engine } = laid()
    const title = byPart('title')
    const plan = planInstanceUpdate(title, engine.getProject().authored, { name: 'big-number', overrides: { text: '42', sub: 'answers' } })
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.replaced).toBe(true)
      expect(plan.component.name).toBe('big-number')
      expect(plan.report.kept).toEqual([])
    }
  })
})

describe('regenerateElement is deferred', () => {
  it('writes nothing at all and reports the regeneration for the web layer', () => {
    const { engine, byPart, kids } = laid()
    const cloud = byPart('cloud')
    const before = snap(engine.getProject())
    const rev = engine.getRevision()
    const undoable = engine.canUndo()
    const chip = kids(cloud)[1]!
    const r = run(engine, [
      { op: 'regenerateElement', clip: cloud.id, brief: 'make it a customer list' },
      { op: 'regenerateElement', clip: `${cloud.id}/${chip.id}`, brief: 'a bolder chip' },
    ])
    expect(r.applied).toEqual([0, 1])
    expect(r.skipped).toEqual([])
    expect(r.regenerations).toEqual([
      { index: 0, clip: cloud.id, brief: 'make it a customer list' },
      { index: 1, clip: `${cloud.id}/${chip.id}`, brief: 'a bolder chip' },
    ])
    expect(r.touched).toEqual({ added: [], changed: [], removed: [] })
    expect(r.deferred).toEqual([])
    expect(snap(engine.getProject())).toBe(before)
    expect(engine.getRevision()).toBe(rev)
    expect(engine.canUndo()).toBe(undoable)
  })

  it('a target that does not exist is a skip with a reason, and there is no regeneration', () => {
    const { engine } = laid()
    const r = run(engine, [{ op: 'regenerateElement', clip: 'nope', brief: 'x' }])
    expect(r.applied).toEqual([])
    expect(r.skipped).toHaveLength(1)
    expect(r.regenerations).toBeUndefined()
  })
})

describe('sanitizeOps for the three ops', () => {
  const project = () => laid().engine.getProject()
  const bag = (o: Record<string, unknown>) => ({ op: null, clip: null, field: null, value: null, items: null, brief: null, text: null, ...o })

  it('reads a strict-schema bag: emphasis arrives as comma-separated words, nulls are ignored', () => {
    const { engine, byPart } = laid()
    const cloud = byPart('cloud').id
    const title = byPart('title').id
    const { ops, dropped } = sanitizeOps(
      [
        bag({ op: 'setComponentField', clip: title, field: 'emphasis', value: 'Hello, world ,' }),
        bag({ op: 'setComponentField', clip: title, field: 'energy', value: ' Bold ' }),
        bag({ op: 'setComponentItems', clip: cloud, items: [{ text: 'A', sub: null, icon: null, value: null, style: 'filled' }, { text: null, sub: null, icon: null, value: null, style: null }, { text: 'B', sub: null, icon: 'star', value: 3, style: null }] }),
        bag({ op: 'regenerateElement', clip: cloud, brief: '  a customer list  ' }),
      ],
      engine.getProject(),
    )
    expect(dropped).toEqual([])
    expect(ops).toEqual([
      { op: 'setComponentField', clip: title, field: 'emphasis', value: ['Hello', 'world'] },
      { op: 'setComponentField', clip: title, field: 'energy', value: 'bold' },
      { op: 'setComponentItems', clip: cloud, items: [{ text: 'A', style: 'filled' }, { text: 'B', icon: 'star', value: 3 }] },
      { op: 'regenerateElement', clip: cloud, brief: 'a customer list' },
    ])
  })

  it('drops the unreadable with a reason: unknown field, bad energy, empty items, empty brief, a $ref, a missing clip', () => {
    const { engine, byPart } = laid()
    const cloud = byPart('cloud').id
    const { ops, dropped } = sanitizeOps(
      [
        bag({ op: 'setComponentField', clip: cloud, field: 'color', value: 'red' }),
        bag({ op: 'setComponentField', clip: cloud, field: 'energy', value: 'frantic' }),
        bag({ op: 'setComponentItems', clip: cloud, items: [] }),
        bag({ op: 'setComponentItems', clip: cloud, items: [{ text: null }] }),
        bag({ op: 'regenerateElement', clip: cloud, brief: '  ' }),
        bag({ op: 'setComponentField', clip: '$later', field: 'text', value: 'x' }),
        bag({ op: 'setComponentField', clip: 'ghost', field: 'text', value: 'x' }),
      ],
      engine.getProject(),
    )
    expect(ops).toEqual([])
    expect(dropped.map((d) => d.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(dropped.every((d) => d.reason.length > 0)).toBe(true)
    void project
  })
})

describe('a graphic created earlier in the same plan has no fields to edit yet', () => {
  it('a $ref to it is dropped with that reason, not left to resolve', () => {
    const { engine } = laid()
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'addTitleCard', ref: 'made', title: 'Pets', at: 0, duration: 2 },
        { op: 'setComponentField', clip: '$made', field: 'text', value: 'x' },
        { op: 'regenerateElement', clip: '$made', brief: 'x' },
      ],
      engine.getProject(),
    )
    expect(ops.map((o) => o.op)).toEqual(['addTitleCard'])
    expect(dropped.map((d) => d.index)).toEqual([1, 2])
    expect(dropped.every((d) => /same plan/.test(d.reason))).toBe(true)
  })
})

describe('describeProject and describeOp', () => {
  it('lists the current text, items and the bounds an edit must respect on a component compound', () => {
    const { engine, byPart } = laid()
    const d = describeProject(engine.getProject())
    const clips = d.tracks.flatMap((t) => t.clips)
    const cloud = clips.find((c) => c.id === byPart('cloud').id)!
    expect(cloud.instance).toMatchObject({ items: [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }], itemRange: [3, 8] })
    const ring = clips.find((c) => c.id === byPart('ring').id)!
    expect(ring.instance).toMatchObject({ text: '72', sub: 'done', variant: 'percent', variants: ['percent', 'full'] })
    // A plain compound or text clip carries no instance block.
    expect(clips.filter((c) => c.component).length).toBe(3)
  })

  it('says each op in one sentence that names the graphic', () => {
    const { engine, byPart } = laid()
    const say = opDescriber(engine.getProject())
    const cloud = byPart('cloud')
    expect(say({ op: 'setComponentField', clip: cloud.id, field: 'text', value: 'Hi' })).toBe(`Set “${cloud.name}” text to “Hi”`)
    expect(say({ op: 'setComponentField', clip: cloud.id, field: 'duration', value: 5 })).toContain('duration to 5s')
    expect(say({ op: 'setComponentField', clip: cloud.id, field: 'emphasis', value: ['a', 'b'] })).toContain('emphasis words to a, b')
    expect(say({ op: 'setComponentItems', clip: cloud.id, items: items('A', 'B', 'C', 'D', 'E', 'F') })).toBe(`Set “${cloud.name}” to 6 items: A, B, C, D, +2`)
    expect(say({ op: 'regenerateElement', clip: cloud.id, brief: 'a customer list' })).toBe(`Regenerate “${cloud.name}”: “a customer list”`)
  })
})
