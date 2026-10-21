import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import type { Clip, ClipComponentInstance, Project, Track } from '../types'
import { buildVideo } from './build'
import { COMPONENT_REGISTRY, resolveMotionStyle } from './components'
import { COMPONENT_NAMES, type AuthoredSpec, type ComponentItem, type SpecComponent } from './components/types'
import { canonicalJson, componentFields, expandInstance, reconcileCompound, type InstanceContext } from './instance'
import { layProject } from './layProject'

/**
 * EG-P2: re-expand one component and merge it into the compound it made,
 * keeping what the user edited. Every test here names the line it protects;
 * the mutation proofs are recorded in the ticket's Result.
 */

const FORMAT = { width: 1080, height: 1920, fps: 30 }
const SEED = 7

const WORDS = ['Fast', 'Clean', 'Bold', 'Calm', 'Sharp', 'Loud', 'Warm', 'Cool']
const chips = (n: number, rename: Record<number, string> = {}): ComponentItem[] =>
  Array.from({ length: n }, (_, i) => ({ text: rename[i] ?? WORDS[i]!, ...(i === 2 ? { style: 'filled' } : {}) }))

function cloudSpec(items: ComponentItem[], extra: Partial<AuthoredSpec> = {}): AuthoredSpec {
  return {
    format: FORMAT,
    duration: 9,
    elements: [
      { id: 'cloud', kind: 'component', component: 'chip-cloud', at: 0, duration: 4.5, items },
      { id: 'title', kind: 'component', component: 'kinetic-title', at: 4.5, duration: 4.5, text: 'Big idea here' },
    ],
    ...extra,
  }
}

const topClips = (p: Project): Clip[] => Object.values(p.clips).flat()
const groupOf = (p: Project, id: string): Clip => topClips(p).find((c) => c.partId === id && c.compound)!
const partOf = (p: Project, partId: string): Clip => topClips(p).find((c) => c.partId === partId)!

/** The piece-level facts `planInstanceEdit` derives from the document, derived here the same way. */
function ctxFor(spec: AuthoredSpec, child: Project): InstanceContext {
  return {
    format: { width: child.stage.width, height: child.stage.height, fps: child.fps },
    pieceStyle: resolveMotionStyle(spec.motion),
    pieceDuration: spec.duration,
  }
}

/** A project with generated ids, polished, as the Assistant would lay it. */
function built(spec: AuthoredSpec) {
  return buildVideo(structuredClone(spec), { seed: SEED })
}

/** Normalise a nested project for comparison across runs: ids removed, clips keyed by partId. */
function byPart(p: Project, withLanes = true): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const strip = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => (k === 'id' || k === 'trackId' ? undefined : x)))
  for (const track of p.tracks) {
    for (const c of p.clips[track.id] ?? []) out[c.partId ?? c.id] = { ...(withLanes ? { order: track.order } : {}), clip: strip(c) }
  }
  return out
}

function editChild(child: Project, partId: string, fn: (clip: Clip) => void): Project {
  const next = structuredClone(child)
  const clip = topClips(next).find((c) => c.partId === partId)!
  fn(clip)
  return next
}

// ---------------------------------------------------------------------------
// Step 2: the measured baseline
// ---------------------------------------------------------------------------

describe('expandInstance baseline (the measured polish scope)', () => {
  it('reproduces the stored nested project of each component, modulo generated ids', () => {
    const spec = cloudSpec(chips(5))
    const { project } = built(spec)
    for (const id of ['cloud', 'title']) {
      const stored = groupOf(project, id)
      const out = expandInstance(stored.component!, ctxFor(spec, stored.compound!.project))
      expect(out.ok).toBe(true)
      if (!out.ok) continue
      expect(byPart(out.child)).toEqual(byPart(stored.compound!.project))
      expect(out.component).toEqual(stored.component)
    }
  })

  it('holds for all 17 components, including a per-component energy that differs from the piece', () => {
    let at = 0
    const els: SpecComponent[] = COMPONENT_NAMES.map((name, i) => {
      const def = COMPONENT_REGISTRY.get(name)!
      const el: SpecComponent = {
        id: `c${i}`,
        kind: 'component',
        component: name,
        at,
        duration: def.duration.default,
        text: 'Hello world today',
        sub: 'sub',
        energy: i % 2 === 0 ? 'bold' : undefined,
        ...(def.items ? { items: Array.from({ length: Math.max(def.items.min, 3) }, (_, k) => ({ text: `Item ${k}`, value: 10 + k, icon: 'star' })) } : {}),
      }
      at += def.duration.default
      return el
    })
    const spec: AuthoredSpec = { format: FORMAT, duration: at, motion: { energy: 'calm' }, elements: els }
    const { project } = built(spec)
    const stored = topClips(project).filter((c) => c.component)
    expect(stored).toHaveLength(17)
    for (const clip of stored) {
      const out = expandInstance(clip.component!, ctxFor(spec, clip.compound!.project))
      expect(out.ok, clip.component!.name).toBe(true)
      // Lane order of simultaneous parts on ONE layer is tie-broken by generated clip ids (layers.ts), so it
      // legitimately differs between two runs; everything else must match.
      if (out.ok) expect(byPart(out.child, false), clip.component!.name).toEqual(byPart(clip.compound!.project, false))
    }
  })
})

describe('expandInstance determinism', () => {
  const spec = cloudSpec(chips(5))
  const stored = groupOf(built(spec).project, 'cloud')
  const ctx = ctxFor(spec, stored.compound!.project)

  it('the same arguments give canonicalJson-identical projects, ids included', () => {
    const a = expandInstance(stored.component!, ctx)
    const b = expandInstance(stored.component!, ctx)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.child).toEqual(b.child)
      expect(canonicalJson(a.child)).toBe(canonicalJson(b.child))
    }
  })

  it('a different stored seed gives a different expansion', () => {
    const a = expandInstance(stored.component!, ctx)
    const b = expandInstance({ ...stored.component!, seed: 99 }, ctx)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(canonicalJson(byPart(a.child))).not.toBe(canonicalJson(byPart(b.child)))
  })

  it('two components with different ids and one seed differ', () => {
    const a = expandInstance(stored.component!, ctx)
    const renamed = { ...stored.component!, input: { ...stored.component!.input, id: 'other' } }
    const b = expandInstance(renamed, ctx)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      const pos = (p: Project) => topClips(p).map((c) => `${c.transform!.x.toFixed(5)},${c.transform!.y.toFixed(5)}`).join('|')
      expect(pos(a.child)).not.toBe(pos(b.child))
    }
  })

  it('an unknown component name from a newer build refuses instead of throwing', () => {
    const out = expandInstance({ ...stored.component!, name: 'from-the-future' }, ctx)
    expect(out).toMatchObject({ ok: false, reason: 'unknown-component' })
  })

  it('bad overrides (an unknown energy) come back as expansion-failed', () => {
    const out = expandInstance(stored.component!, ctx, { energy: 'turbo' })
    expect(out).toMatchObject({ ok: false, reason: 'expansion-failed' })
  })
})

// ---------------------------------------------------------------------------
// componentFields
// ---------------------------------------------------------------------------

describe('componentFields', () => {
  const SPEC_COMPONENT_KEYS = new Set([
    'id', 'kind', 'component', 'at', 'duration', 'layer', 'x', 'y', 'w', 'h', 'variant', 'text', 'sub', 'emphasis', 'items', 'energy', 'params',
  ])

  it('covers all 17 components with keys that are valid SpecComponent keys', () => {
    expect(COMPONENT_NAMES).toHaveLength(17)
    for (const name of COMPONENT_NAMES) {
      const fields = componentFields(COMPONENT_REGISTRY.get(name)!)
      expect(fields.length, name).toBeGreaterThan(0)
      for (const f of fields) expect(SPEC_COMPONENT_KEYS.has(f.key), `${name}.${f.key}`).toBe(true)
      expect(new Set(fields.map((f) => f.key)).size, name).toBe(fields.length)
    }
  })

  it('derives the items bounds and hint from def.items', () => {
    const def = COMPONENT_REGISTRY.get('chip-cloud')!
    const items = componentFields(def).find((f) => f.key === 'items')!
    expect(items).toMatchObject({ kind: 'list', min: def.items!.min, max: def.items!.max, hint: def.items!.hint })
    expect(componentFields(COMPONENT_REGISTRY.get('kinetic-title')!).some((f) => f.key === 'items')).toBe(false)
  })

  it('offers a select of def.variants wherever a component has variants', () => {
    const withVariants = COMPONENT_NAMES.filter((n) => COMPONENT_REGISTRY.get(n)!.variants?.length)
    expect(withVariants.length).toBeGreaterThan(0)
    for (const name of withVariants) {
      const def = COMPONENT_REGISTRY.get(name)!
      const f = componentFields(def).find((x) => x.key === 'variant')!
      expect(f, name).toBeDefined()
      expect(f.options).toEqual([...def.variants!])
    }
  })

  it('shows duration read-only with the def bounds, and a def can override the whole schema', () => {
    const def = COMPONENT_REGISTRY.get('chip-cloud')!
    expect(componentFields(def).find((f) => f.key === 'duration')).toMatchObject({ readOnly: true, min: def.duration.min, max: def.duration.max })
    const custom = [{ key: 'text' as const, label: 'Only', kind: 'text' as const }]
    expect(componentFields({ ...def, fields: custom })).toEqual(custom)
  })
})

// ---------------------------------------------------------------------------
// reconcileCompound on a real chip-cloud
// ---------------------------------------------------------------------------

interface CloudRun {
  spec: AuthoredSpec
  stored: Clip
  current: Project
  baseline: Project
  next: Project
}

/** A chip-cloud laid from `before`, optionally hand-edited, then re-expanded for `after`. */
function cloudRun(before: ComponentItem[], after: ComponentItem[], edit?: (child: Project) => Project): CloudRun {
  const spec = cloudSpec(before)
  const stored = groupOf(built(spec).project, 'cloud')
  const ctx = ctxFor(spec, stored.compound!.project)
  const baseline = expandInstance(stored.component!, ctx)
  const next = expandInstance(stored.component!, ctx, { items: after })
  if (!baseline.ok || !next.ok) throw new Error('expansion failed')
  const current = edit ? edit(stored.compound!.project) : stored.compound!.project
  return { spec, stored, current, baseline: baseline.child, next: next.child }
}

const setT = (c: Clip, patch: Record<string, number>) => {
  c.transform = { ...(c.transform as object), ...patch } as unknown as Clip['transform']
}
const xy = (c: Clip) => ({ x: c.transform!.x, y: c.transform!.y })

describe('reconcileCompound: the chip-cloud fixture', () => {
  const before = chips(5)
  const after = chips(6, { 0: 'A much longer first phrase', 1: 'Crisp' })

  it('keeps a hand-moved chip, re-flows the rest, adds the new chip', () => {
    const run = cloudRun(before, after, (child) =>
      editChild(child, 'cloud-chip-2', (c) => {
        setT(c, { x: 0.11, y: 0.93 })
      }),
    )
    const { project, report } = reconcileCompound(run.current, run.baseline, run.next)

    // The hand-moved chip keeps its transform exactly, and the current clip's id.
    const moved = partOf(project, 'cloud-chip-2')
    expect(xy(moved)).toEqual({ x: 0.11, y: 0.93 })
    expect(moved.id).toBe(partOf(run.current, 'cloud-chip-2').id)

    // Every other chip equals a fresh expansion of the new items.
    const others = ['cloud-chip-0', 'cloud-chip-1', 'cloud-chip-3', 'cloud-chip-4', 'cloud-chip-5']
    for (const id of others) expect(xy(partOf(project, id)), id).toEqual(xy(partOf(run.next, id)))

    // They really did move (otherwise the assertion above proves nothing).
    const reflowedAny = ['cloud-chip-0', 'cloud-chip-1', 'cloud-chip-3', 'cloud-chip-4'].some(
      (id) => JSON.stringify(xy(partOf(run.current, id))) !== JSON.stringify(xy(partOf(run.next, id))),
    )
    expect(reflowedAny).toBe(true)

    // The new chip exists, and the report says so.
    expect(partOf(project, 'cloud-chip-5')).toBeDefined()
    expect(report.added).toContain('cloud-chip-5')
    expect(report.kept.find((k) => k.partId === 'cloud-chip-2')?.fields).toContain('transform.x')
    expect(report.reflowed.length).toBeGreaterThan(0)
    // A renamed chip takes the new text.
    expect(partOf(project, 'cloud-chip-1').content).toBe('Crisp')
  })

  it('removes an untouched chip the new items no longer have, and reports it', () => {
    const run = cloudRun(before, chips(4))
    const { project, report } = reconcileCompound(run.current, run.baseline, run.next)
    expect(topClips(project).some((c) => c.partId === 'cloud-chip-4')).toBe(false)
    expect(report.removed).toEqual([{ partId: 'cloud-chip-4', edited: false }])
  })

  it('removes a dropped chip even when the user had edited it, and the report names it', () => {
    const run = cloudRun(before, chips(4), (child) =>
      editChild(child, 'cloud-chip-4', (c) => {
        setT(c, { x: 0.2 })
      }),
    )
    const { project, report } = reconcileCompound(run.current, run.baseline, run.next)
    expect(topClips(project).some((c) => c.partId === 'cloud-chip-4')).toBe(false)
    expect(report.removed).toEqual([{ partId: 'cloud-chip-4', edited: true }])
  })

  it('a clip with no partId (user-added) is never touched, and neither is a part the user deleted', () => {
    let userClipId = ''
    const run = cloudRun(before, chips(4), (child) => {
      const c = structuredClone(child)
      const lane = c.tracks[0]!
      const added: Clip = { ...structuredClone(c.clips[lane.id]![0]!), id: 'user-added', name: 'Mine' }
      delete added.partId
      userClipId = added.id
      c.clips[lane.id] = [...c.clips[lane.id]!, added]
      // and delete chip 0 by hand
      for (const t of c.tracks) c.clips[t.id] = c.clips[t.id]!.filter((x) => x.partId !== 'cloud-chip-0')
      return c
    })
    const { project, report } = reconcileCompound(run.current, run.baseline, run.next)
    const mine = topClips(project).find((c) => c.id === userClipId)!
    expect(mine).toEqual(topClips(run.current).find((c) => c.id === userClipId))
    expect(topClips(project).some((c) => c.partId === 'cloud-chip-0')).toBe(false)
    expect(report.leftDeleted).toContain('cloud-chip-0')
  })

  it('is idempotent: an empty patch changes nothing, even with hand-edited parts', () => {
    const run = cloudRun(before, before, (child) => {
      let c = editChild(child, 'cloud-chip-2', (x) => {
        setT(x, { x: 0.4 })
      })
      c = editChild(c, 'cloud-chip-0', (x) => {
        x.content = 'Edited'
      })
      return c
    })
    const { project, report } = reconcileCompound(run.current, run.baseline, run.next)
    expect(project).toEqual(run.current)
    expect(report.reflowed).toEqual([])
    expect(report.added).toEqual([])
    expect(report.removed).toEqual([])
    expect(report.kept.map((k) => k.partId).sort()).toEqual(['cloud-chip-0', 'cloud-chip-2'])
  })

  it('does not mutate any of its three inputs', () => {
    const run = cloudRun(before, after, (child) =>
      editChild(child, 'cloud-chip-2', (c) => {
        setT(c, { x: 0.3 })
      }),
    )
    const snap = [run.current, run.baseline, run.next].map((p) => JSON.stringify(p))
    reconcileCompound(run.current, run.baseline, run.next)
    expect([run.current, run.baseline, run.next].map((p) => JSON.stringify(p))).toEqual(snap)
  })
})

describe('reconcileCompound: keyframe granularity', () => {
  // Measured on this fixture: re-flowing the cloud changes the `x` keyframe channel of chips 2..4
  // (and their transform), while opacity/scale are untouched.
  const before = chips(5)
  const after = chips(6, { 0: 'A much longer first phrase', 1: 'Crisp' })
  const strip = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'id' ? undefined : x))
  const channel = (c: Clip, name: string) => strip((c.keyframes?.channels as Record<string, unknown> | undefined)?.[name])
  const retime = (c: Clip, name: string) => {
    const ch = (c.keyframes!.channels as Record<string, { keys: Array<{ frame: number }> }>)[name]!
    ch.keys = ch.keys.map((k) => ({ ...k, frame: k.frame + 3 }))
  }

  it('keeps the one retimed channel and re-flows the part\'s other channels', () => {
    const run = cloudRun(before, after, (child) => editChild(child, 'cloud-chip-3', (c) => retime(c, 'scale')))
    // The fixture must actually re-flow the x channel of that chip, or this proves nothing.
    expect(channel(partOf(run.baseline, 'cloud-chip-3'), 'x')).not.toBe(channel(partOf(run.next, 'cloud-chip-3'), 'x'))

    const { project, report } = reconcileCompound(run.current, run.baseline, run.next)
    const merged = partOf(project, 'cloud-chip-3')
    expect(channel(merged, 'scale')).toBe(channel(partOf(run.current, 'cloud-chip-3'), 'scale')) // the user's channel is kept
    expect(channel(merged, 'scale')).not.toBe(channel(partOf(run.next, 'cloud-chip-3'), 'scale'))
    expect(channel(merged, 'x')).toBe(channel(partOf(run.next, 'cloud-chip-3'), 'x')) // the other channel re-flowed
    expect(report.kept.find((k) => k.partId === 'cloud-chip-3')?.fields).toEqual(['keyframes.channels.scale'])
    expect(report.reflowed).toContain('cloud-chip-3')
  })

  it('a retimed channel that the new input would also change stays the user\'s', () => {
    const run = cloudRun(before, after, (child) => editChild(child, 'cloud-chip-4', (c) => retime(c, 'x')))
    const { project } = reconcileCompound(run.current, run.baseline, run.next)
    const merged = partOf(project, 'cloud-chip-4')
    expect(channel(merged, 'x')).toBe(channel(partOf(run.current, 'cloud-chip-4'), 'x'))
    expect(channel(merged, 'x')).not.toBe(channel(partOf(run.next, 'cloud-chip-4'), 'x'))
  })
})

// ---------------------------------------------------------------------------
// Tracks, lanes and clip references: synthetic projects
// ---------------------------------------------------------------------------

function track(id: string, order: number): Track {
  return { id, kind: 'elements', order, name: `Layer ${order}`, locked: false, disabled: false } as unknown as Track
}
function clip(id: string, partId: string | undefined, trackId: string, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    trackId,
    type: 'shape',
    name: partId ?? id,
    startFrame: 0,
    durationFrames: 30,
    sourceStartFrame: 0,
    sourceDurationFrames: 30,
    volume: 1,
    opacity: 1,
    locked: false,
    disabled: false,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
    ...(partId ? { partId } : {}),
    ...extra,
  } as Clip
}
function proj(tracks: Track[], clips: Clip[]): Project {
  const byTrack: Record<string, Clip[]> = {}
  for (const t of tracks) byTrack[t.id] = clips.filter((c) => c.trackId === t.id)
  return { id: 'p', fps: 30, stage: { width: 100, height: 100 }, tracks, clips: byTrack, transitions: [], version: 1 }
}

describe('reconcileCompound: tracks', () => {
  it('a part next puts on a lane current lacks creates that lane from next, in order', () => {
    const cur = proj([track('t1', 1), track('t3', 3)], [clip('a', 'p-a', 't1'), clip('c', 'p-c', 't3')])
    const base = proj([track('b1', 1), track('b3', 3)], [clip('ba', 'p-a', 'b1'), clip('bc', 'p-c', 'b3')])
    const next = proj([track('n1', 1), track('n2', 2), track('n3', 3)], [clip('na', 'p-a', 'n1'), clip('nb', 'p-b', 'n2'), clip('nc', 'p-c', 'n3')])
    const { project } = reconcileCompound(cur, base, next)
    expect(project.tracks.map((t) => [t.id, t.order])).toEqual([['t1', 1], ['n2', 2], ['t3', 3]])
    expect(project.clips['n2']!.map((c) => c.partId)).toEqual(['p-b'])
  })

  it('a created lane whose id collides with an existing id is suffixed', () => {
    const cur = proj([track('n2', 1)], [clip('a', 'p-a', 'n2')])
    const base = proj([track('b1', 1)], [clip('ba', 'p-a', 'b1')])
    const next = proj([track('n1', 1), track('n2', 2)], [clip('na', 'p-a', 'n1'), clip('nb', 'p-b', 'n2')])
    const { project } = reconcileCompound(cur, base, next)
    expect(project.tracks.map((t) => t.order)).toEqual([1, 2])
    const ids = project.tracks.map((t) => t.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids).toContain('n2-r1')
  })

  it('an unedited part follows next to another lane; a part the user moved to another lane stays', () => {
    const late = { startFrame: 40 }
    const base = proj([track('b1', 1), track('b2', 2)], [clip('b-a', 'p-a', 'b1'), clip('b-b', 'p-b', 'b1', late)])
    const next = proj([track('n1', 1), track('n2', 2), track('n3', 3)], [clip('n-a', 'p-a', 'n2'), clip('n-b', 'p-b', 'n3', late)])
    // The user moved p-b to lane 2 by hand and left p-a alone.
    const cur = proj([track('t1', 1), track('t2', 2)], [clip('a', 'p-a', 't1'), clip('b', 'p-b', 't2', late)])
    const { project } = reconcileCompound(cur, base, next)
    expect(project.clips['t2']!.map((c) => c.id)).toEqual(['a', 'b']) // p-a followed next, p-b stayed where the user put it; ids are the current ones
    expect(project.tracks.map((t) => t.id)).toEqual(['t2']) // lane 1 was emptied by the merge

    // Had the user left both on lane 1, both follow next (p-b onto a lane created from next's).
    const cur2 = proj([track('t1', 1), track('t2', 2)], [clip('a', 'p-a', 't1'), clip('b', 'p-b', 't1', late)])
    const both = reconcileCompound(cur2, base, next).project
    expect(both.tracks.map((t) => t.order)).toEqual([2, 3])
    expect(both.clips['t2']!.map((c) => c.id)).toEqual(['a'])
    expect(both.tracks.find((t) => t.order === 3)!.id).toBe('n3')
  })

  it('a part this merge places never lands on top of a user clip in time: it moves to a free lane', () => {
    const base = proj([track('b1', 1)], [clip('b-a', 'p-a', 'b1')])
    const next = proj([track('n1', 1), track('n2', 2)], [clip('n-a', 'p-a', 'n2')])
    const cur = proj([track('t1', 1), track('t2', 2)], [clip('a', 'p-a', 't1'), clip('mine', undefined, 't2')])
    const { project } = reconcileCompound(cur, base, next)
    expect(project.clips['t2']!.map((c) => c.id)).toEqual(['mine'])
    const moved = Object.values(project.clips).flat().find((c) => c.id === 'a')!
    expect(project.tracks.find((t) => t.id === moved.trackId)!.order).toBe(3)
    expect(moved.trackId).not.toBe('t2')
  })

  it('removes a lane the merge emptied but never an already-empty one', () => {
    const cur = proj([track('t1', 1), track('t2', 2), track('t9', 9)], [clip('a', 'p-a', 't1'), clip('b', 'p-b', 't2')])
    const base = proj([track('b1', 1), track('b2', 2)], [clip('ba', 'p-a', 'b1'), clip('bb', 'p-b', 'b2')])
    const next = proj([track('n1', 1)], [clip('na', 'p-a', 'n1')])
    const { project } = reconcileCompound(cur, base, next)
    expect(project.tracks.map((t) => t.id)).toEqual(['t1', 't9'])
  })
})

describe('reconcileCompound: clip references', () => {
  const ref = (to: string): Partial<Clip> => ({ layout: { anchorTo: { clip: to, edge: 'bottom' } } } as Partial<Clip>)

  it('a field taken from next references the CURRENT id of the part it points at, not next\'s', () => {
    const cur = proj([track('t1', 1), track('t2', 2)], [clip('cur-a', 'p-a', 't1'), clip('cur-b', 'p-b', 't2', ref('cur-a'))])
    const base = proj([track('b1', 1), track('b2', 2)], [clip('base-a', 'p-a', 'b1'), clip('base-b', 'p-b', 'b2', ref('base-a'))])
    const next = proj(
      [track('n1', 1), track('n2', 2)],
      [clip('next-a', 'p-a', 'n1'), clip('next-b', 'p-b', 'n2', { ...ref('next-a'), opacity: 0.4 })],
    )
    const { project, report } = reconcileCompound(cur, base, next)
    const b = project.clips['t2']!.find((c) => c.partId === 'p-b')!
    // The reference field looked unedited (baseline points at its own p-a), so it was NOT reported as edited...
    expect(report.kept).toEqual([])
    // ...and it still points at the id that exists in the merged project.
    expect((b.layout as { anchorTo: { clip: string } }).anchorTo.clip).toBe('cur-a')
    expect(b.opacity).toBe(0.4)
  })

  it('rewrites clip("id") inside an expression into the current id space', () => {
    const expr = (to: string) =>
      ({ keyframes: { channels: { x: { source: { kind: 'expression', source: `clip("${to}").x + 0.1` }, keys: [] } } } }) as unknown as Partial<Clip>
    const cur = proj([track('t1', 1), track('t2', 2)], [clip('cur-a', 'p-a', 't1'), clip('cur-b', 'p-b', 't2', expr('cur-a'))])
    const base = proj([track('b1', 1), track('b2', 2)], [clip('base-a', 'p-a', 'b1'), clip('base-b', 'p-b', 'b2', expr('base-a'))])
    const next = proj([track('n1', 1), track('n2', 2)], [clip('next-a', 'p-a', 'n1'), clip('next-b', 'p-b', 'n2', { ...expr('next-a'), opacity: 0.5 })])
    const { project, report } = reconcileCompound(cur, base, next)
    expect(report.kept).toEqual([])
    expect(project.clips['t2']!.find((c) => c.partId === 'p-b')!.opacity).toBe(0.5)
    expect(JSON.stringify(project)).not.toContain('next-a')
  })
})

// ---------------------------------------------------------------------------
// Through a real engine
// ---------------------------------------------------------------------------

describe('instance edit through TimelineEngine (reconcile + atomic commit)', () => {
  it('commits the merged child and the new component record in one undo step', () => {
    const spec = cloudSpec(chips(5))
    const { project } = built(spec)
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1080, height: 1920 }, initialTracks: [] })
    layProject(engine, project)
    const clip = groupOf(engine.getProject(), 'cloud')
    const ctx = ctxFor(spec, clip.compound!.project)
    const items = chips(6, { 0: 'A much longer first phrase', 1: 'Crisp' })
    const handMoved = structuredClone(clip.compound!.project)
    setT(topClips(handMoved).find((c) => c.partId === 'cloud-chip-2')!, { x: 0.12 })
    expect(engine.updateCompoundProject(clip.id, handMoved).ok).toBe(true)

    const live = groupOf(engine.getProject(), 'cloud')
    const baseline = expandInstance(live.component!, ctx)
    const next = expandInstance(live.component!, ctx, { items })
    if (!baseline.ok || !next.ok) throw new Error('expansion failed')
    const { project: merged } = reconcileCompound(live.compound!.project, baseline.child, next.child)
    const before = engine.getProject()
    const res = engine.updateCompoundInstance(live.id, merged, next.component, { expectedChild: live.compound!.project })
    expect(res.ok).toBe(true)

    const after = groupOf(engine.getProject(), 'cloud')
    expect((after.component!.input as { items: ComponentItem[] }).items).toHaveLength(6)
    expect(partOf(after.compound!.project, 'cloud-chip-2').transform!.x).toBe(0.12)
    expect(partOf(after.compound!.project, 'cloud-chip-5')).toBeDefined()

    engine.undo()
    const undone = groupOf(engine.getProject(), 'cloud')
    expect(undone.component).toEqual(before.clips[undone.trackId]!.find((c) => c.id === undone.id)!.component)
    expect((undone.component!.input as { items: ComponentItem[] }).items).toHaveLength(5)
    expect(undone.compound!.project).toEqual(live.compound!.project)
  })
})
