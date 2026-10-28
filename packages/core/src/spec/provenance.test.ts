import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { TimelineEngine } from '../editor/TimelineEngine'
import { documentVersionFor, readProjectDocument } from '../editor/projectDocument'
import { cloneClip } from '../visitor/clone'
import type { Clip, Project, ProjectAuthored } from '../types'
import { buildVideo } from './build'
import type { AuthoredSpec } from './components/types'
import { layProject } from './layProject'

/**
 * EG-P1 provenance: every clip compiled from a spec element knows its element
 * id (`partId`), the compound a component made knows which component it was
 * (`component`), and the authored document survives Keep (`Project.authored`).
 * None of it is read by the renderer, none of it bumps the version.
 */

const FORMAT = { width: 1080, height: 1920, fps: 30 }

const SPEC: AuthoredSpec = {
  format: FORMAT,
  duration: 8,
  elements: [
    { id: 'raw', kind: 'text', text: 'Plain', size: 90, at: 0, duration: 2 },
    { id: 'hero', kind: 'component', component: 'kinetic-title', at: 0, duration: 3, text: 'Big idea', energy: 'bold' },
    {
      id: 'wrap',
      kind: 'group',
      at: 3,
      duration: 4,
      children: [{ id: 'inner', kind: 'component', component: 'big-number', at: 0, duration: 3, text: '42', sub: 'things' }],
    },
  ],
}

/** Every clip in a project, with the compound depth it sits at. */
function walk(project: Project, depth = 0, out: Array<{ clip: Clip; depth: number }> = []): Array<{ clip: Clip; depth: number }> {
  for (const list of Object.values(project.clips)) {
    for (const clip of list) {
      out.push({ clip, depth })
      if (clip.compound) walk(clip.compound.project, depth + 1, out)
    }
  }
  return out
}

function topLevel(project: Project): Clip[] {
  return Object.values(project.clips).flat()
}

describe('provenance stamping (compile)', () => {
  it('stamps component on each component compound: name, resolved input, seed, style', () => {
    const { project } = buildVideo(structuredClone(SPEC), { seed: 7 })
    const hero = topLevel(project).find((c) => c.partId === 'hero')!
    expect(hero.type).toBe('compound')
    expect(hero.component).toMatchObject({
      v: 1,
      name: 'kinetic-title',
      seed: 7,
      style: { energy: 'bold' },
      input: { id: 'hero', component: 'kinetic-title', text: 'Big idea', duration: 3, energy: 'bold' },
    })
    // Two levels deep: the second component lives inside a raw group.
    const inner = walk(project).find((e) => e.clip.partId === 'inner')!
    expect(inner.depth).toBe(1)
    expect(inner.clip.component).toMatchObject({ name: 'big-number', seed: 7, style: { energy: 'standard' } })
  })

  it('stamps partId = the element id on every clip, including children two levels deep', () => {
    const { project } = buildVideo(structuredClone(SPEC), { seed: 7 })
    const all = walk(project)
    expect(all.every((e) => typeof e.clip.partId === 'string' && e.clip.partId.length > 0)).toBe(true)
    const heroParts = all.filter((e) => e.clip.partId?.startsWith('hero-'))
    expect(heroParts.length).toBeGreaterThan(0)
    expect(heroParts.every((e) => e.depth === 1)).toBe(true)
    const innerParts = all.filter((e) => e.clip.partId?.startsWith('inner-'))
    expect(innerParts.length).toBeGreaterThan(0)
    expect(innerParts.every((e) => e.depth === 2)).toBe(true)
    // The partId is the element id the author wrote, not the minted clip id.
    expect(all.some((e) => e.clip.partId === e.clip.id)).toBe(false)
  })

  it('a raw element gets partId and no component; a non-component group gets no component', () => {
    const { project } = buildVideo(structuredClone(SPEC), { seed: 7 })
    const raw = topLevel(project).find((c) => c.partId === 'raw')!
    expect(raw.component).toBeUndefined()
    const wrap = topLevel(project).find((c) => c.partId === 'wrap')!
    expect(wrap.type).toBe('compound')
    expect(wrap.component).toBeUndefined()
  })

  it('polish-added elements get a partId too, and polish never drops a component group id', () => {
    const { project, expandedSpec } = buildVideo(structuredClone(SPEC), { seed: 7 })
    expect(expandedSpec.elements.some((e) => e.id.startsWith('polish-ambient-'))).toBe(true)
    const ambient = topLevel(project).filter((c) => c.partId?.startsWith('polish-ambient-'))
    expect(ambient.length).toBeGreaterThan(0)
    expect(ambient.every((c) => c.component === undefined)).toBe(true)
    // The map is keyed by group element id: polish must leave those ids intact.
    const stamped = walk(project)
      .filter((e) => e.clip.component)
      .map((e) => e.clip.partId)
    expect(stamped.sort()).toEqual(['hero', 'inner'])
  })

  it('a duplicate component id that claimId renames is stamped under the renamed id', () => {
    const spec: AuthoredSpec = {
      format: FORMAT,
      duration: 6,
      elements: [
        { id: 'dup', kind: 'component', component: 'big-number', at: 0, duration: 2, text: '1' },
        { id: 'dup', kind: 'component', component: 'big-number', at: 2, duration: 2, text: '2' },
      ],
    }
    const built = buildVideo(spec, { seed: 3 })
    expect(built.issues.some((i) => i.code === 'duplicate-id')).toBe(true)
    const stamped = topLevel(built.project)
      .filter((c) => c.component)
      .map((c) => ({ part: c.partId, text: (c.component!.input as { text?: string }).text }))
      .sort((a, b) => String(a.part).localeCompare(String(b.part)))
    expect(stamped).toEqual([
      { part: 'dup', text: '1' },
      { part: 'dup-2', text: '2' },
    ])
  })

  it('the stored seed is the seed actually used, including the default 1 when opts.seed is undefined', () => {
    const built = buildVideo(structuredClone(SPEC))
    expect(built.seed).toBe(1)
    const hero = topLevel(built.project).find((c) => c.partId === 'hero')!
    expect(hero.component!.seed).toBe(1)
    expect(buildVideo(structuredClone(SPEC), { seed: 9 }).seed).toBe(9)
  })

  it('two builds with the same seed are equal, component and partId included', () => {
    const a = buildVideo(structuredClone(SPEC), { seed: 5 })
    const b = buildVideo(structuredClone(SPEC), { seed: 5 })
    expect(a.project).toEqual(b.project)
    expect(walk(a.project).some((e) => e.clip.component)).toBe(true)
  })

  it('provenance never changes documentVersionFor or the compiled version', () => {
    const { project } = buildVideo(structuredClone(SPEC), { seed: 5 })
    const stripped = structuredClone(project)
    for (const e of walk(stripped)) {
      delete e.clip.component
      delete e.clip.partId
    }
    expect(walk(project).some((e) => e.clip.component)).toBe(true)
    expect(documentVersionFor(project)).toBe(documentVersionFor(stripped))
    expect(project.version).toBe(stripped.version)
  })
})

describe('provenance through layProject (real TimelineEngine)', () => {
  const authored: ProjectAuthored = {
    v: 1,
    spec: SPEC as unknown as ProjectAuthored['spec'],
    treatment: { idea: 'x' },
    seed: 7,
    model: 'test-model',
    createdAt: '2026-10-07T00:00:00.000Z',
  }

  function lay() {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1080, height: 1920 }, initialTracks: [] })
    const { project } = buildVideo(structuredClone(SPEC), { seed: 7 })
    layProject(engine, project, { authored })
    return engine
  }

  it('top-level component and partId survive lay; nested children keep partId; authored is set', () => {
    const engine = lay()
    const live = engine.getProject()
    const tops = topLevel(live)
    const hero = tops.find((c) => c.partId === 'hero')!
    expect(hero.component).toMatchObject({ name: 'kinetic-title', seed: 7 })
    expect(tops.find((c) => c.partId === 'raw')!.component).toBeUndefined()
    const nested = walk(live).filter((e) => e.depth > 0)
    expect(nested.length).toBeGreaterThan(0)
    expect(nested.every((e) => typeof e.clip.partId === 'string')).toBe(true)
    expect(walk(live).find((e) => e.clip.partId === 'inner')!.clip.component).toMatchObject({ name: 'big-number' })
    expect(live.authored).toEqual(authored)
  })

  it('ONE engine.undo() removes the clips and authored together', () => {
    const engine = lay()
    expect(engine.getProject().authored).toBeDefined()
    engine.undo()
    const after = engine.getProject()
    expect(after.authored).toBeUndefined()
    expect(Object.values(after.clips).flat()).toHaveLength(0)
  })

  it('laying without authored stores nothing', () => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1080, height: 1920 }, initialTracks: [] })
    layProject(engine, buildVideo(structuredClone(SPEC), { seed: 7 }).project)
    expect(engine.getProject().authored).toBeUndefined()
  })

  it('a laid, serialised and re-read project keeps component, partId and authored, at the same version', () => {
    const engine = lay()
    const live = engine.getProject()
    const read = readProjectDocument(JSON.parse(JSON.stringify(live)))
    expect(read.authored).toEqual(authored)
    expect(read.version).toBe(live.version)
    expect(
      walk(read)
        .filter((e) => e.clip.component)
        .map((e) => e.clip.partId)
        .sort(),
    ).toEqual(['hero', 'inner'])
  })
})

describe('provenance through clone', () => {
  it('cloneClip keeps partId and component on the copy', () => {
    const { project } = buildVideo(structuredClone(SPEC), { seed: 7 })
    const trackId = Object.keys(project.clips).find((id) => project.clips[id]!.some((c) => c.partId === 'hero'))!
    const hero = project.clips[trackId]!.find((c) => c.partId === 'hero')!
    const next = produce(project, (draft) => {
      cloneClip(draft, hero.id, trackId, 1000)
    })
    const copies = next.clips[trackId]!.filter((c) => c.partId === 'hero')
    expect(copies).toHaveLength(2)
    expect(copies.every((c) => c.component?.name === 'kinetic-title')).toBe(true)
  })
})
