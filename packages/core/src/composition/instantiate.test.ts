import { describe, expect, it } from 'vitest'
import { seededIdsActive } from '../utils/id'
import type { Clip, Marker, Project, Track, TrackGroup, Transition } from '../types'
import { instantiate } from './instantiate'
import type { Binding, ProjectComposition } from './types'

function track(id: string, order: number): Track {
  return { id, name: id, kind: 'elements', order, height: 54, locked: false, disabled: false, muted: false, solo: false }
}

function findClip(p: Project, id: string): Clip {
  for (const bucket of Object.values(p.clips)) {
    const found = bucket.find((c) => c.id === id)
    if (found) return found
  }
  throw new Error(`clip "${id}" not found`)
}

function addBinding(p: Project, binding: Binding): Project {
  const comp = p.composition!
  return { ...p, composition: { ...comp, bindings: [...comp.bindings, binding] } }
}

// ---------------------------------------------------------------------------
// Step 1: instantiate without ids
// ---------------------------------------------------------------------------

function makeFixture(): Project {
  const e1 = track('e1', 0)
  const v1 = track('v1', 1)

  const t1: Clip = {
    id: 't1', trackId: 'e1', type: 'text', name: 'Title', content: 'Hello', color: '#ffffff',
    startFrame: 0, durationFrames: 30, sourceStartFrame: 0, sourceDurationFrames: 30,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
    keyframes: {
      channels: { opacity: { source: { kind: 'keyframes' }, keys: [{ id: 'k0', frame: 0, value: 1, easing: 'linear' }] } },
    },
  } as unknown as Clip

  const s1: Clip = {
    id: 's1', trackId: 'e1', type: 'shape', name: 'Swatch', shapeFill: '#3366ff',
    startFrame: 0, durationFrames: 30, sourceStartFrame: 0, sourceDurationFrames: 30,
  } as unknown as Clip

  const i1: Clip = {
    id: 'i1', trackId: 'v1', type: 'image', name: 'Logo', src: 'https://cdn.example/a.png', assetId: 'asset-a',
    startFrame: 0, durationFrames: 30, sourceStartFrame: 0, sourceDurationFrames: 30,
  } as unknown as Clip

  const c1: Clip = {
    id: 'c1', trackId: 'inner-1', type: 'text', name: 'Inner', content: 'Inner',
    startFrame: 0, durationFrames: 30, sourceStartFrame: 0, sourceDurationFrames: 30,
  } as unknown as Clip
  const childProject: Project = {
    id: 'child', fps: 30, stage: { width: 1080, height: 1920 },
    tracks: [track('inner-1', 0)], clips: { 'inner-1': [c1] }, transitions: [], version: 1,
  } as unknown as Project

  const cmp: Clip = {
    id: 'cmp', trackId: 'v1', type: 'compound', name: 'Compound',
    startFrame: 30, durationFrames: 30, sourceStartFrame: 0, sourceDurationFrames: 30,
    compound: { project: childProject },
  } as unknown as Clip

  const composition: ProjectComposition = {
    props: [
      { name: 'title', type: 'text', default: 'Hello', label: 'Title' },
      { name: 'accent', type: 'color', default: '#3366ff', label: 'Accent' },
      { name: 'logo', type: 'image', default: 'https://cdn.example/a.png', label: 'Logo' },
      { name: 'inner', type: 'text', default: 'Inner', label: 'Inner' },
      { name: 'level', type: 'number', default: 1, label: 'Level' },
    ],
    bindings: [
      { clipId: 't1', path: 'text', prop: 'title', template: 'Hi {title}!' },
      { clipId: 's1', path: 'shapeFill', prop: 'accent' },
      { clipId: 'i1', path: 'src', prop: 'logo' },
      { clipId: 'cmp/c1', path: 'text', prop: 'inner' },
      { clipId: 't1', path: 'keyframes.opacity[0].value', prop: 'level' },
    ],
  }

  return {
    id: 'p', fps: 30, stage: { width: 1080, height: 1920 },
    tracks: [e1, v1], clips: { e1: [t1, s1], v1: [i1, cmp] }, transitions: [], version: 1,
    composition,
  } as unknown as Project
}

describe('instantiate — writing bindings', () => {
  it('writes every binding with validated values', () => {
    const p = makeFixture()
    const result = instantiate(
      p,
      { title: 'Ann', accent: '#FF0000', logo: 'https://cdn.example/b.png', inner: 'Deep', level: '0.5' },
      { seed: 1 },
    )

    const t1 = findClip(result.project, 't1')
    const s1 = findClip(result.project, 's1')
    const i1 = findClip(result.project, 'i1')
    const cmp = findClip(result.project, 'cmp')
    const c1 = Object.values(cmp.compound!.project.clips).flat()[0]!

    expect(t1.content).toBe('Hi Ann!')
    expect(s1.shapeFill).toBe('#ff0000')
    expect(i1.src).toBe('https://cdn.example/b.png')
    expect('assetId' in i1).toBe(false)
    expect(c1.content).toBe('Deep')
    expect(t1.keyframes!.channels!.opacity!.keys[0]!.value).toBe(0.5)
    expect(result.project.composition!.values).toEqual(result.values)
    expect(result.issues).toEqual([])
  })

  it('does not mutate the input, and freezes the output', () => {
    const p = makeFixture()
    const before = JSON.stringify(p)
    const result = instantiate(p, { title: 'Ann' }, { seed: 1 })
    expect(JSON.stringify(p)).toBe(before)
    expect(Object.isFrozen(result.project)).toBe(true)
  })

  it('keeps a binding-free clip identical; a bucket array is only new when something in it changed', () => {
    const p = makeFixture()
    const u1: Clip = {
      id: 'u1', trackId: 'e1', type: 'text', name: 'Untouched', content: 'same',
      startFrame: 0, durationFrames: 10, sourceStartFrame: 0, sourceDurationFrames: 10,
    } as unknown as Clip
    p.clips.e1 = [...p.clips.e1!, u1]

    const result = instantiate(p, { logo: 'https://cdn.example/b.png' }, { seed: 1 })

    const outU1 = result.project.clips.e1!.find((c) => c.id === 'u1')!
    expect(outU1).toBe(u1)

    // v1 held i1 (changed by the logo binding) and cmp (untouched): the bucket
    // array is a new reference (immer never reuses an array with a changed
    // element), but cmp itself keeps its own identity.
    expect(result.project.clips.v1).not.toBe(p.clips.v1)
    const outCmp = result.project.clips.v1!.find((c) => c.id === 'cmp')!
    expect(outCmp).toBe(p.clips.v1!.find((c) => c.id === 'cmp'))
  })

  it('is a true no-op when nothing would change', () => {
    const e1 = track('e1', 0)
    const t1: Clip = {
      id: 't1', trackId: 'e1', type: 'text', name: 'Title', content: 'Hello',
      startFrame: 0, durationFrames: 30, sourceStartFrame: 0, sourceDurationFrames: 30,
    } as unknown as Clip
    const composition: ProjectComposition = {
      props: [{ name: 'title', type: 'text', default: 'Hello', label: 'Title' }],
      bindings: [{ clipId: 't1', path: 'text', prop: 'title' }],
      values: { title: 'Hello' },
    }
    const p: Project = {
      id: 'p2', fps: 30, stage: { width: 1080, height: 1920 },
      tracks: [e1], clips: { e1: [t1] }, transitions: [], version: 1, composition,
    } as unknown as Project

    const result = instantiate(p, {}, { seed: 1 })
    expect(result.project).toBe(p)
  })

  describe('binding issues, one at a time; the other bindings still apply', () => {
    it('missing-clip for an unknown clip id', () => {
      const p = addBinding(makeFixture(), { clipId: 'zz', path: 'text', prop: 'title' })
      const result = instantiate(p, { title: 'Ann' }, { seed: 1 })
      expect(result.issues).toContainEqual(expect.objectContaining({ kind: 'binding', code: 'missing-clip' }))
      expect(findClip(result.project, 't1').content).toBe('Hi Ann!')
    })

    it('not-compound for a path through a non-compound clip', () => {
      const p = addBinding(makeFixture(), { clipId: 't1/x', path: 'text', prop: 'title' })
      const result = instantiate(p, { title: 'Ann' }, { seed: 1 })
      expect(result.issues).toContainEqual(expect.objectContaining({ kind: 'binding', code: 'not-compound' }))
      expect(findClip(result.project, 't1').content).toBe('Hi Ann!')
    })

    it('bad-path for a structural field', () => {
      const p = addBinding(makeFixture(), { clipId: 't1', path: 'startFrame', prop: 'title' })
      const result = instantiate(p, { title: 'Ann' }, { seed: 1 })
      expect(result.issues).toContainEqual(expect.objectContaining({ kind: 'binding', code: 'bad-path' }))
      expect(findClip(result.project, 't1').content).toBe('Hi Ann!')
    })

    it('missing-target for a field the clip does not have', () => {
      const p = addBinding(makeFixture(), { clipId: 'i1', path: 'crop.x', prop: 'title' })
      const result = instantiate(p, { title: 'Ann' }, { seed: 1 })
      expect(result.issues).toContainEqual(expect.objectContaining({ kind: 'binding', code: 'missing-target' }))
      expect(findClip(result.project, 't1').content).toBe('Hi Ann!')
    })

    it('type-mismatch when a text prop targets a numeric field', () => {
      const p = addBinding(makeFixture(), { clipId: 't1', path: 'transform.x', prop: 'title' })
      const result = instantiate(p, { title: 'Ann' }, { seed: 1 })
      expect(result.issues).toContainEqual(expect.objectContaining({ kind: 'binding', code: 'type-mismatch' }))
      expect(findClip(result.project, 't1').transform!.x).toBe(0.5)
    })

    it('unknown-prop for a binding naming an undeclared prop', () => {
      const p = addBinding(makeFixture(), { clipId: 't1', path: 'text', prop: 'nope' })
      const result = instantiate(p, { title: 'Ann' }, { seed: 1 })
      expect(result.issues).toContainEqual(expect.objectContaining({ kind: 'binding', code: 'unknown-prop' }))
      expect(findClip(result.project, 't1').content).toBe('Hi Ann!')
    })
  })

  it('gives an error issue for an invalid value and writes the stored value or default', () => {
    const p = makeFixture()
    const result = instantiate(p, { accent: 'red' }, { seed: 1 })
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: 'prop', code: 'bad-color', severity: 'error' }))
    expect(findClip(result.project, 's1').shapeFill).toBe('#3366ff')
  })

  it('returns the same project and one unknown-prop warning without a composition', () => {
    const p = makeFixture()
    delete (p as { composition?: ProjectComposition }).composition
    const result = instantiate(p, { a: 1 }, { seed: 1 })
    expect(result.project).toBe(p)
    expect(result.values).toEqual({})
    expect(result.issues).toEqual([{ kind: 'prop', prop: 'a', code: 'unknown-prop', severity: 'warning', message: 'No prop named "a"' }])
  })
})

// ---------------------------------------------------------------------------
// Step 3: instantiate with regenerateIds, at scale
// ---------------------------------------------------------------------------

function bigProject(): Project {
  const tracks: Track[] = [track('bt0', 0), track('bt1', 1), track('bt2', 2)]
  const clips: Record<string, Clip[]> = {}

  for (const t of tracks) {
    const bucket: Clip[] = []
    for (let i = 0; i < 700; i++) {
      const c: Clip = {
        id: `${t.id}-c${i}`, trackId: t.id, type: 'text', name: `${t.id}-c${i}`, content: 'x',
        startFrame: i * 10, durationFrames: 10, sourceStartFrame: 0, sourceDurationFrames: 10,
      } as unknown as Clip
      // Every 50th pair linked: clips at i % 50 === 0 and the next one.
      if (i % 50 === 0) c.linkId = `link-${t.id}-${i}`
      if (i % 50 === 1) c.linkId = `link-${t.id}-${i - 1}`
      // One PV-P3b layout reference on the first track, anchoring clip 2 to clip 0.
      if (t.id === 'bt0' && i === 2) {
        c.layout = { anchorTo: { clip: 'bt0-c0', edge: 'top' } }
      }
      bucket.push(c)
    }
    clips[t.id] = bucket
  }

  const transitions: Transition[] = []
  for (let i = 0; i < 20; i++) {
    const t = tracks[i % 3]!
    const bucket = clips[t.id]!
    const from = bucket[i * 2]!
    const to = bucket[i * 2 + 1]!
    transitions.push({
      id: `tr${i}`, kind: 'fade', fromClipId: from.id, toClipId: to.id, trackId: t.id,
      startFrame: to.startFrame - 5, durationFrames: 10,
    })
  }

  const markers: Marker[] = Array.from({ length: 5 }, (_, i) => ({ id: `marker${i}`, frame: i * 100, name: `M${i}` }))
  const group: TrackGroup = { id: 'grp1', name: 'Group', trackIds: tracks.map((t) => t.id), collapsed: false }

  const childTracks: Track[] = [track('ct0', 0), track('ct1', 1)]
  const childClips: Record<string, Clip[]> = {}
  for (const t of childTracks) {
    const bucket: Clip[] = []
    for (let i = 0; i < 25; i++) {
      bucket.push({
        id: `${t.id}-c${i}`, trackId: t.id, type: 'text', name: `${t.id}-c${i}`, content: 'child',
        startFrame: i * 10, durationFrames: 10, sourceStartFrame: 0, sourceDurationFrames: 10,
      } as unknown as Clip)
    }
    childClips[t.id] = bucket
  }
  const childTextId = 'ct0-c0'
  const childComposition: ProjectComposition = {
    props: [{ name: 'childTitle', type: 'text', default: 'child', label: 'Child title' }],
    bindings: [{ clipId: childTextId, path: 'text', prop: 'childTitle' }],
  }
  const childProject: Project = {
    id: 'child-big', fps: 30, stage: { width: 1080, height: 1920 },
    tracks: childTracks, clips: childClips, transitions: [], version: 1, composition: childComposition,
  } as unknown as Project

  const compoundId = 'compound-big'
  const compoundClip: Clip = {
    id: compoundId, trackId: 'bt0', type: 'compound', name: 'Compound',
    startFrame: 6990, durationFrames: 10, sourceStartFrame: 0, sourceDurationFrames: 10,
    compound: { project: childProject },
  } as unknown as Clip
  clips.bt0 = [...clips.bt0!, compoundClip]

  const rootComposition: ProjectComposition = {
    props: [{ name: 'title', type: 'text', default: 'x', label: 'Title' }],
    bindings: [{ clipId: `${compoundId}/${childTextId}`, path: 'text', prop: 'title' }],
  }

  return {
    id: 'big', fps: 30, stage: { width: 1080, height: 1920 },
    tracks, clips, transitions, version: 1, markers, trackGroups: [group], composition: rootComposition,
  } as unknown as Project
}

function findClipDeep(p: Project, predicate: (c: Clip) => boolean): Clip | undefined {
  for (const bucket of Object.values(p.clips)) {
    for (const c of bucket) {
      if (predicate(c)) return c
      if (c.compound?.project) {
        const found = findClipDeep(c.compound.project, predicate)
        if (found) return found
      }
    }
  }
  return undefined
}

function collectAllIds(p: Project, out: string[] = []): string[] {
  out.push(p.id)
  for (const t of p.tracks) out.push(t.id)
  for (const bucket of Object.values(p.clips)) {
    for (const c of bucket) {
      out.push(c.id)
      if (c.compound?.project) collectAllIds(c.compound.project, out)
    }
  }
  for (const x of p.transitions) out.push(x.id)
  for (const m of p.markers ?? []) out.push(m.id)
  for (const g of p.trackGroups ?? []) out.push(g.id)
  return out
}

describe('instantiate with regenerateIds, at scale (2,100+ clips)', () => {
  it('produces zero duplicate ids across the whole tree', () => {
    const result = instantiate(bigProject(), { title: 'Z' }, { seed: 7, regenerateIds: true })
    const ids = collectAllIds(result.project)
    const unique = new Set(ids)
    expect(ids.length).toBeGreaterThan(2150)
    expect(unique.size).toBe(ids.length)
  })

  it('leaves no dangling binding reference after regenerateIds', () => {
    const out = instantiate(bigProject(), { title: 'Z' }, { seed: 7, regenerateIds: true }).project
    const check = instantiate(out, {}, { seed: 1 })
    expect(check.issues.filter((i) => i.kind === 'binding' && i.code === 'missing-clip')).toEqual([])
  })

  it('rewires a PV-P3b layout.anchorTo reference at scale, leaving no dangling old id', () => {
    const out = instantiate(bigProject(), { title: 'Z' }, { seed: 7, regenerateIds: true }).project
    const anchored = findClipDeep(out, (c) => c.name === 'bt0-c2')!
    const target = findClipDeep(out, (c) => c.name === 'bt0-c0')!
    expect(anchored.layout!.anchorTo!.clip).toBe(target.id)
    expect(anchored.layout!.anchorTo!.clip).not.toBe('bt0-c0')
  })

  it('is deterministic for the same seed', () => {
    const a = instantiate(bigProject(), { title: 'Z' }, { seed: 7, regenerateIds: true })
    const b = instantiate(bigProject(), { title: 'Z' }, { seed: 7, regenerateIds: true })
    expect(a).toEqual(b)
  })

  it('leaves seededIdsActive false afterward', () => {
    instantiate(bigProject(), { title: 'Z' }, { seed: 7, regenerateIds: true })
    expect(seededIdsActive()).toBe(false)
  })
})
