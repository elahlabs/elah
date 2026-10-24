import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import type { Clip, Project } from '../types'
import { buildVideo } from '../spec/build'
import { layProject } from '../spec/layProject'
import type { AuthoredSpec } from '../spec/components/types'
import { applyOps } from './apply'
import { describeProject, MAX_DESCRIBED_PARTS } from './describe'
import { opDescriber } from './describeOp'
import { sanitizeOps } from './sanitize'
import type { EditorOp } from './types'

/**
 * EG-P4: the Assistant addresses parts INSIDE a generated graphic.
 *
 * A path `'compoundId/childId'` edits one child through the compound's nested
 * project, in the plan's one undo step; a bad path is a skip with a reason and
 * never rolls back the other ops; `describeProject` lists the children, capped;
 * `setStyle` fills the style hole.
 */

const SPEC: AuthoredSpec = {
  format: { width: 1080, height: 1920, fps: 30 },
  duration: 8,
  elements: [
    { id: 'cloud', kind: 'component', component: 'chip-cloud', at: 0, duration: 4.5, items: ['A', 'B', 'C', 'D'].map((text) => ({ text })) },
    { id: 'title', kind: 'component', component: 'kinetic-title', at: 5, duration: 3, text: 'Hello world' },
  ],
}

function laid() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1080, height: 1920 }, initialTracks: [] })
  layProject(engine, buildVideo(structuredClone(SPEC), { seed: 7 }).project)
  const all = (): Clip[] => Object.values(engine.getProject().clips).flat()
  const cloud = () => all().find((c) => c.partId === 'cloud')!
  const title = () => all().find((c) => c.partId === 'title')!
  const kids = (c: Clip): Clip[] => Object.values(c.compound!.project.clips).flat()
  const part = (c: Clip, partId: string): Clip => kids(c).find((k) => k.partId === partId)!
  const path = (c: Clip, partId: string) => `${c.id}/${part(c, partId).id}`
  return { engine, all, cloud, title, kids, part, path }
}

const snap = (p: Project) => JSON.stringify(p)

function run(engine: TimelineEngine, raw: unknown[]) {
  const { ops, dropped } = sanitizeOps(raw, engine.getProject())
  return { dropped, ops, result: applyOps(engine, ops) }
}

describe('describeProject lists a compound’s parts', () => {
  it('gives each child its path id, partId, type and label, and the component name', () => {
    const { engine, cloud, part } = laid()
    const d = describeProject(engine.getProject())
    const c = d.tracks.flatMap((t) => t.clips).find((x) => x.id === cloud().id)!
    expect(c.component).toBe('chip-cloud')
    expect(c.parts!.length).toBe(5)
    const chip = c.parts!.find((p) => p.partId === 'cloud-chip-0')!
    expect(chip).toMatchObject({ id: `${cloud().id}/${part(cloud(), 'cloud-chip-0').id}`, type: 'text', label: 'A' })
    expect(c.parts!.find((p) => p.partId === 'cloud-glow')).toMatchObject({ type: 'shape', label: 'circle' })
    expect(c.partsOmitted).toBeUndefined()
  })

  it('respects the per-compound cap and says how many it left out', () => {
    const { engine, cloud } = laid()
    const d = describeProject(engine.getProject(), { maxParts: 2 })
    const c = d.tracks.flatMap((t) => t.clips).find((x) => x.id === cloud().id)!
    expect(c.parts!.length).toBe(2)
    expect(c.partsOmitted).toBe(3)
    expect(MAX_DESCRIBED_PARTS).toBe(16)
  })

  it('respects the project-wide budget across compounds', () => {
    const { engine } = laid()
    const d = describeProject(engine.getProject(), { maxPartsTotal: 6 })
    const clips = d.tracks.flatMap((t) => t.clips).filter((x) => x.parts)
    expect(clips.reduce((n, x) => n + x.parts!.length, 0)).toBe(6)
    expect(clips.reduce((n, x) => n + (x.partsOmitted ?? 0), 0)).toBe(1)
  })

  it('flags a selected part by its path', () => {
    const { engine, cloud, path } = laid()
    const id = path(cloud(), 'cloud-chip-1')
    const d = describeProject(engine.getProject(), { selection: [id] })
    const parts = d.tracks.flatMap((t) => t.clips).flatMap((c) => c.parts ?? [])
    expect(parts.filter((p) => p.selected).map((p) => p.id)).toEqual([id])
  })

  it('leaves a project with no compound exactly as before', () => {
    const e = new TimelineEngine({ fps: 30, stage: { width: 1280, height: 720 } })
    e.addClip({ type: 'text', text: { content: 'hi' }, trackId: e.addTrack('elements').id, startFrame: 0, durationFrames: 30 })
    const json = JSON.stringify(describeProject(e.getProject()))
    expect(json).not.toMatch(/parts|component/)
  })

  it('expands a compound inside a compound, to depth 2 and no further', () => {
    const { engine, all } = laid()
    const nested = engine.nestClips(all().map((c) => c.id))
    expect(nested.ok).toBe(true)
    const outer = describeProject(engine.getProject()).tracks.flatMap((t) => t.clips).find((c) => c.type === 'compound')!
    const inner = outer.parts!.find((p) => p.type === 'compound')!
    expect(inner.parts!.length).toBeGreaterThan(0)
    // Three segments: outer / inner compound / leaf.
    expect(inner.parts![0]!.id.split('/').length).toBe(3)
    expect(inner.parts!.every((p) => p.parts === undefined)).toBe(true)
  })
})

describe('a path op edits one part, in one undo step', () => {
  it('changes the child and nothing else', () => {
    const { engine, cloud, path, part, kids } = laid()
    const before = cloud()
    const target = path(before, 'cloud-chip-1')
    const { dropped, result } = run(engine, [{ op: 'setClipProps', clip: target, color: '#ff0000', opacity: 0.5 }])
    expect(dropped).toEqual([])
    expect(result.skipped).toEqual([])
    const after = cloud()
    expect(part(after, 'cloud-chip-1')).toMatchObject({ color: '#ff0000', opacity: 0.5 })
    // Siblings are untouched, deeply.
    for (const k of kids(before)) {
      if (k.partId === 'cloud-chip-1') continue
      expect(part(after, k.partId!)).toEqual(k)
    }
    // The parent's other fields are untouched, including the instance record.
    const { compound: _a, ...parentBefore } = before
    const { compound: _b, ...parentAfter } = after
    expect(parentAfter).toEqual(parentBefore)
    expect(after.component).toEqual(before.component)
    // The diff styling is told about the compound the user can see.
    expect(result.touched.changed).toEqual([before.id])
  })

  it('leaves a sibling on the same lane untouched', () => {
    const { engine, cloud, part, path } = laid()
    const c = cloud()
    const child = structuredClone(c.compound!.project)
    const lanes = Object.entries(child.clips)
    const from = lanes.find(([, l]) => l.some((k) => k.partId === 'cloud-chip-1'))!
    const to = lanes.find(([, l]) => l.some((k) => k.partId === 'cloud-chip-0'))!
    const moved = from[1].splice(from[1].findIndex((k) => k.partId === 'cloud-chip-1'), 1)[0]!
    moved.trackId = to[0]
    to[1].push(moved)
    expect(engine.updateCompoundProject(c.id, child).ok).toBe(true)
    const sibling = part(cloud(), 'cloud-chip-1')

    run(engine, [{ op: 'setClipProps', clip: path(cloud(), 'cloud-chip-0'), color: '#ff0000' }])
    expect(part(cloud(), 'cloud-chip-0').color).toBe('#ff0000')
    expect(part(cloud(), 'cloud-chip-1')).toEqual(sibling)
  })

  it('is ONE undo step with the rest of the plan', () => {
    const { engine, cloud, title, path } = laid()
    const before = snap(engine.getProject())
    const { result } = run(engine, [
      { op: 'setClipProps', clip: path(cloud(), 'cloud-chip-0'), color: '#00ff00' },
      { op: 'setStyle', clip: path(cloud(), 'cloud-chip-2'), fontSize: 99 },
      { op: 'setClipProps', clip: title().id, opacity: 0.4 },
      { op: 'setClipProps', clip: path(cloud(), 'cloud-chip-3'), opacity: 0.3 },
    ])
    expect(result.applied).toEqual([0, 1, 2, 3])
    expect(snap(engine.getProject())).not.toBe(before)
    expect(engine.undo()).toBe(true)
    expect(snap(engine.getProject())).toBe(before)
  })

  it('writes keyframes, a motion preset and an expression into the child', () => {
    const { engine, cloud, path, part } = laid()
    const target = path(cloud(), 'cloud-chip-2')
    const { result } = run(engine, [
      { op: 'setKeyframes', clip: target, channel: 'opacity', keys: [{ at: 0, value: 0 }, { at: 1, value: 1 }] },
      { op: 'applyMotionPreset', clip: target, preset: 'pop-in' },
      { op: 'setExpression', clip: target, channel: 'rotation', source: 'sin(t) * 5' },
    ])
    expect(result.skipped).toEqual([])
    const chip = part(cloud(), 'cloud-chip-2')
    expect(chip.keyframes?.channels?.opacity?.keys?.length).toBeGreaterThan(0)
    expect(chip.keyframes?.channels?.rotation?.source?.kind).toBe('expression')
    // The parent's own keyframes are not the child's.
    expect(cloud().keyframes?.channels?.rotation).toBeUndefined()
  })

  it('reaches a part two compounds down', () => {
    const { engine, all } = laid()
    engine.nestClips(all().map((c) => c.id))
    const outer = all().find((c) => c.type === 'compound' && c.compound!.project.clips && !c.partId)!
    const inner = Object.values(outer.compound!.project.clips).flat().find((c) => c.type === 'compound')!
    const leaf = Object.values(inner.compound!.project.clips).flat().find((k) => k.type === 'text')!
    const before = snap(engine.getProject())
    const { dropped, result } = run(engine, [{ op: 'setClipProps', clip: `${outer.id}/${inner.id}/${leaf.id}`, color: '#123456' }])
    expect(dropped).toEqual([])
    expect(result.skipped).toEqual([])
    const outerAfter = all().find((c) => c.id === outer.id)!
    const innerAfter = Object.values(outerAfter.compound!.project.clips).flat().find((c) => c.id === inner.id)!
    const leafAfter = Object.values(innerAfter.compound!.project.clips).flat().find((c) => c.id === leaf.id)!
    expect(leafAfter.color).toBe('#123456')
    engine.undo()
    expect(snap(engine.getProject())).toBe(before)
  })

  it('describes a part by its name and its graphic', () => {
    const { engine, cloud, path, part } = laid()
    const text = opDescriber(engine.getProject())({ op: 'setClipProps', clip: path(cloud(), 'cloud-chip-0'), color: '#ff0000' })
    expect(text).toContain(part(cloud(), 'cloud-chip-0').name)
    expect(text).toContain(cloud().name)
  })
})

describe('a bad path is skipped, never thrown, and never rolls the batch back', () => {
  it('sanitize drops every kind of bad path with a reason', () => {
    const { engine, cloud, path } = laid()
    const p = engine.getProject()
    const real = path(cloud(), 'cloud-chip-0')
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'setClipProps', clip: `${cloud().id}/nope`, opacity: 0.5 },
        { op: 'setClipProps', clip: `nope/${real.split('/')[1]}`, opacity: 0.5 },
        { op: 'setClipProps', clip: `${real}/deeper`, opacity: 0.5 },
        { op: 'setClipProps', clip: '$made/child', opacity: 0.5 },
        { op: 'setClipProps', clip: `${cloud().id}//x`, opacity: 0.5 },
        { op: 'moveClip', clip: real, at: 1 },
        { op: 'splitClip', clip: real, at: 1 },
        { op: 'setClipProps', clip: real, opacity: 0.5 },
      ],
      p,
    )
    expect(ops.map((o) => o.op)).toEqual(['setClipProps'])
    expect(dropped.map((d) => d.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(dropped[0]!.reason).toMatch(/no clip "nope" inside/)
    expect(dropped[1]!.reason).toMatch(/no clip "nope" on the timeline/)
    expect(dropped[2]!.reason).toMatch(/is not a compound/)
    expect(dropped[3]!.reason).toMatch(/created in this plan/)
    expect(dropped[4]!.reason).toMatch(/not a valid part path/)
    expect(dropped[5]!.reason).toMatch(/whole clips only/)
    expect(dropped[6]!.reason).toMatch(/whole clips only/)
  })

  it('apply skips a path that no longer resolves, and still applies the other ops', () => {
    const { engine, cloud, title, path, part } = laid()
    const good = path(cloud(), 'cloud-chip-0')
    const ops: EditorOp[] = [
      { op: 'setClipProps', clip: good, color: '#aa0000' },
      { op: 'setClipProps', clip: `${cloud().id}/ghost`, opacity: 0.2 },
      { op: 'setClipProps', clip: `ghost/${good.split('/')[1]}`, opacity: 0.2 },
      { op: 'moveClip', clip: good, at: 1 },
      { op: 'setClipProps', clip: title().id, opacity: 0.6 },
    ]
    const result = applyOps(engine, ops)
    expect(result.applied).toEqual([0, 4])
    expect(result.skipped.map((s) => s.index)).toEqual([1, 2, 3])
    expect(result.skipped[0]!.reason).toMatch(/no clip "ghost" inside/)
    expect(result.skipped[3 - 1]!.reason).toMatch(/whole clips only/)
    expect(part(cloud(), 'cloud-chip-0').color).toBe('#aa0000')
    expect(title().opacity).toBe(0.6)
  })

  it('a locked lane refuses the write and nothing changes', () => {
    const { engine, cloud, path } = laid()
    const c = cloud()
    engine.updateTrack(c.trackId, { locked: true })
    const locked = engine.getProject().tracks.find((t) => t.id === c.trackId)?.locked
    expect(locked).toBe(true)
    const before = snap(engine.getProject())
    const result = applyOps(engine, [{ op: 'setClipProps', clip: path(c, 'cloud-chip-0'), color: '#ff00ff' }])
    expect(result.applied).toEqual([])
    expect(result.skipped[0]!.reason).toMatch(/locked/)
    expect(snap(engine.getProject())).toBe(before)
  })

  it('beat sync is refused inside a graphic', () => {
    const { engine, cloud, path } = laid()
    const result = applyOps(engine, [{ op: 'applyMotionPreset', clip: path(cloud(), 'cloud-chip-0'), preset: 'pop-in', syncTo: 'beats' }])
    expect(result.skipped[0]!.reason).toMatch(/beat sync/)
  })
})

describe('setStyle', () => {
  it('clamps every number the model can send', () => {
    const { engine, cloud, path } = laid()
    const { ops, dropped } = sanitizeOps(
      [
        {
          op: 'setStyle',
          clip: path(cloud(), 'cloud-chip-0'),
          fontSize: 99999,
          strokeWidth: -5,
          cornerRadius: 3,
          fontWeight: 640,
          letterSpacing: 1000,
        },
      ],
      engine.getProject(),
    )
    expect(dropped).toEqual([])
    expect(ops[0]).toMatchObject({ fontSize: 600, strokeWidth: 0, cornerRadius: 0.5, fontWeight: 600, letterSpacing: 100 })
  })

  it('rejects an unknown font, a bad colour and an empty op, each with a reason', () => {
    const { engine, cloud, path } = laid()
    const clip = path(cloud(), 'cloud-chip-0')
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'setStyle', clip, fontId: 'comic-sans' },
        { op: 'setStyle', clip, fill: 'red' },
        { op: 'setStyle', clip },
        { op: 'setStyle', clip, fontId: 'inter', fill: '#ABCDEF' },
      ],
      engine.getProject(),
    )
    expect(dropped.map((d) => d.index)).toEqual([0, 1, 2])
    expect(dropped[0]!.reason).toMatch(/unknown font "comic-sans"/)
    expect(dropped[1]!.reason).toMatch(/fill must be/)
    expect(dropped[2]!.reason).toMatch(/nothing to change/)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ fontId: 'inter', fill: '#abcdef' })
  })

  it('writing fill clears a gradient paint instead of hiding behind it', () => {
    const { engine, cloud, part, path } = laid()
    const c = cloud()
    const glow = part(c, 'cloud-glow')
    const gradient = { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] }
    const child = structuredClone(c.compound!.project)
    for (const list of Object.values(child.clips)) for (const k of list) if (k.id === glow.id) (k as { shapeFillPaint?: unknown }).shapeFillPaint = gradient
    expect(engine.updateCompoundProject(c.id, child).ok).toBe(true)
    expect(part(cloud(), 'cloud-glow').shapeFillPaint).toBeDefined()

    const { result } = run(engine, [{ op: 'setStyle', clip: path(cloud(), 'cloud-glow'), fill: '#336699' }])
    expect(result.skipped).toEqual([])
    const after = part(cloud(), 'cloud-glow')
    expect(after.shapeFill).toBe('#336699')
    expect('shapeFillPaint' in after).toBe(false)
  })

  it('styles text: font snapped to a weight it ships, outline, alignment, spacing kept beside the rest of the box', () => {
    const { engine, cloud, path, part } = laid()
    const target = path(cloud(), 'cloud-chip-0')
    const { result, dropped } = run(engine, [
      { op: 'setStyle', clip: target, fontId: 'inter', fontWeight: 600, stroke: '#112233', strokeWidth: 6, textAlign: 'left', letterSpacing: 4, fontSize: 48, fill: '#fafafa' },
    ])
    expect(dropped).toEqual([])
    expect(result.skipped).toEqual([])
    const chip = part(cloud(), 'cloud-chip-0')
    // Inter ships 400, 700, 900: 600 is nearest 700.
    expect(chip).toMatchObject({ fontId: 'inter', fontWeight: 700, textAlign: 'left', fontSize: 48, color: '#fafafa' })
    expect(chip.textOutline).toEqual({ color: '#112233', width: 6 })
    expect(chip.textBox?.letterSpacing).toBe(4)
  })

  it('a field that does not fit the part skips the whole op, naming it', () => {
    const { engine, cloud, path, part } = laid()
    const glow = path(cloud(), 'cloud-glow')
    const chipBefore = part(cloud(), 'cloud-chip-0')
    const ops: EditorOp[] = [
      { op: 'setStyle', clip: glow, fontSize: 30 },
      { op: 'setStyle', clip: path(cloud(), 'cloud-chip-0'), cornerRadius: 0.2 },
      { op: 'setStyle', clip: cloud().id, fill: '#ffffff' },
      { op: 'setStyle', clip: path(cloud(), 'cloud-chip-0'), fill: '#010203' },
    ]
    const result = applyOps(engine, ops)
    expect(result.applied).toEqual([3])
    expect(result.skipped[0]!.reason).toMatch(/fontSize does not apply to a circle shape/)
    expect(result.skipped[1]!.reason).toMatch(/cornerRadius does not apply to a text clip/)
    expect(result.skipped[2]!.reason).toMatch(/address one of its parts/)
    expect(part(cloud(), 'cloud-chip-0')).toEqual({ ...chipBefore, color: '#010203' })
  })

  it('works on a top-level clip exactly as on a part', () => {
    const e = new TimelineEngine({ fps: 30, stage: { width: 1280, height: 720 } })
    const t = e.addClip({ type: 'text', text: { content: 'hi' }, trackId: e.addTrack('elements').id, startFrame: 0, durationFrames: 30 })
    const { result } = run(e, [{ op: 'setStyle', clip: t.id, fontId: 'anton', fontSize: 120, textAlign: 'right' }])
    expect(result.skipped).toEqual([])
    expect(e.findClip(t.id)!.clip).toMatchObject({ fontId: 'anton', fontSize: 120, textAlign: 'right' })
  })
})
