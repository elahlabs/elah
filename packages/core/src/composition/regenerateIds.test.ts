import { describe, expect, it } from 'vitest'
import { withSeededIds } from '../utils/id'
import type { Clip, Marker, Project, Track, TrackGroup, Transition } from '../types'
import { regenerateIds } from './regenerateIds'
import type { ProjectComposition } from './types'

function track(id: string, order: number): Track {
  return { id, name: id, kind: 'elements', order, height: 54, locked: false, disabled: false, muted: false, solo: false }
}

function baseClip(id: string, trackId: string, over: Partial<Clip> = {}): Clip {
  return {
    id,
    trackId,
    type: 'text',
    name: id,
    content: 'x',
    startFrame: 0,
    durationFrames: 30,
    sourceStartFrame: 0,
    sourceDurationFrames: 30,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
    ...over,
  } as Clip
}

/**
 * Two tracks; clips `a`, `b` on track 1 and `c` on track 2. `a`/`c` share a
 * link id. A transition a→b, a marker, a group holding both tracks. `b`
 * mattes off `a` and carries an effect plus a keyed effect param. `c` drives
 * a channel from an expression naming `a`. `d` (PV-P3b) anchors to `a` and
 * fits to `b`. A compound clip `k` on track 1 holds a child project with
 * clip `z`. Two composition bindings, one of them through the compound.
 */
function fixture(): Project {
  const t1 = track('t1', 0)
  const t2 = track('t2', 1)

  const a = baseClip('a', 't1', { linkId: 'L1', assetId: 'asset-a' })
  const b = baseClip('b', 't1', {
    matte: { sourceClipId: 'a', kind: 'alpha' },
    effects: [{ id: 'fx1', kind: 'gaussianBlur', params: { radius: 5 } }],
    keyframes: {
      channels: {
        'fx.fx1.radius': { source: { kind: 'keyframes' }, keys: [{ id: 'kf1', frame: 0, value: 5, easing: 'linear' }] },
      },
    },
  } as unknown as Partial<Clip>)
  const c = baseClip('c', 't2', {
    linkId: 'L1',
    keyframes: { channels: { x: { source: { kind: 'expression', source: 'clip("a").x + 0.1' }, keys: [] } } },
  })
  const d = baseClip('d', 't1', {
    layout: { anchorTo: { clip: 'a', edge: 'bottom' }, fitTo: { clip: 'b', padding: 4 } },
  } as unknown as Partial<Clip>)

  const innerTrack = track('inner-1', 0)
  const z = baseClip('z', 'inner-1')
  const childProject: Project = {
    id: 'child',
    fps: 30,
    stage: { width: 1080, height: 1920 },
    tracks: [innerTrack],
    clips: { 'inner-1': [z] },
    transitions: [],
    version: 1,
  } as unknown as Project

  const k = baseClip('k', 't1', {
    type: 'compound',
    startFrame: 60,
    compound: { project: childProject },
  } as unknown as Partial<Clip>)

  const transition: Transition = { id: 'x1', kind: 'fade', fromClipId: 'a', toClipId: 'b', trackId: 't1', startFrame: 25, durationFrames: 10 }
  const marker: Marker = { id: 'm1', frame: 5, name: 'M' }
  const group: TrackGroup = { id: 'g1', name: 'G', trackIds: ['t1', 't2'], collapsed: false }

  const composition: ProjectComposition = {
    props: [{ name: 'title', type: 'text', default: 'x', label: 'Title' }],
    bindings: [
      { clipId: 'a', path: 'text', prop: 'title' },
      { clipId: 'k/z', path: 'text', prop: 'title' },
    ],
  }

  return {
    id: 'root',
    fps: 30,
    stage: { width: 1080, height: 1920 },
    tracks: [t1, t2],
    clips: { t1: [a, b, k, d], t2: [c] },
    transitions: [transition],
    version: 1,
    markers: [marker],
    trackGroups: [group],
    composition,
  } as unknown as Project
}

/** Regenerate the fixture at a given seed, and hand back both the fresh input
 *  (so a test can compare it to the original by name) and the output, plus
 *  convenient lookups by the STABLE `name` field (unaffected by id rewrite). */
function regen(seed: number) {
  const original = fixture()
  const out = withSeededIds(seed, () => regenerateIds(original))
  const byName = (name: string): Clip => Object.values(out.clips).flat().find((c) => c.name === name)!
  return { original, out, byName }
}

describe('regenerateIds', () => {
  it('leaves the input untouched', () => {
    const original = fixture()
    const before = JSON.stringify(original)
    withSeededIds(7, () => regenerateIds(original))
    expect(JSON.stringify(original)).toBe(before)
  })

  it('gives every project, track, clip, transition, marker and group a fresh id', () => {
    const { original, out } = regen(7)
    expect(out.id).not.toBe(original.id)
    const oldTrackIds = new Set(original.tracks.map((t) => t.id))
    for (const t of out.tracks) expect(oldTrackIds.has(t.id)).toBe(false)
    const oldClipIds = new Set(Object.values(original.clips).flat().map((c) => c.id))
    for (const c of Object.values(out.clips).flat()) expect(oldClipIds.has(c.id)).toBe(false)
    expect(out.transitions[0]!.id).not.toBe('x1')
    expect(out.markers![0]!.id).not.toBe('m1')
    expect(out.trackGroups![0]!.id).not.toBe('g1')
  })

  it('reindexes project.clips by the new track ids, and every clip.trackId matches its bucket', () => {
    const { out } = regen(7)
    const newTrackIds = new Set(out.tracks.map((t) => t.id))
    expect(new Set(Object.keys(out.clips))).toEqual(newTrackIds)
    for (const [trackId, bucket] of Object.entries(out.clips)) {
      for (const c of bucket) expect(c.trackId).toBe(trackId)
    }
  })

  it('rewires the transition to the new a/b and the new track id', () => {
    const { out, byName } = regen(7)
    const t1 = out.tracks.find((t) => t.name === 't1')!
    const tr = out.transitions[0]!
    expect(tr.fromClipId).toBe(byName('a').id)
    expect(tr.toClipId).toBe(byName('b').id)
    expect(tr.trackId).toBe(t1.id)
  })

  it('rewires the matte to the new a, and a/c keep sharing a (new) link id', () => {
    const { out, byName } = regen(7)
    expect(byName('b').matte!.sourceClipId).toBe(byName('a').id)
    expect(byName('a').linkId).toBeTruthy()
    expect(byName('a').linkId).not.toBe('L1')
    expect(byName('a').linkId).toBe(byName('c').linkId)
  })

  it('rewires the group to both new track ids, and the expression source to the new a', () => {
    const { out, byName } = regen(7)
    const newTrackIds = out.tracks.map((t) => t.id).sort()
    expect(out.trackGroups![0]!.trackIds.slice().sort()).toEqual(newTrackIds)
    const source = (byName('c').keyframes!.channels as unknown as Record<string, { source: { source: string } }>).x!.source.source
    expect(source).toBe(`clip("${byName('a').id}").x + 0.1`)
  })

  it('rewires layout.anchorTo.clip and layout.fitTo.clip (PV-P3b)', () => {
    const { out, byName } = regen(7)
    const d = byName('d')
    expect(d.layout!.anchorTo!.clip).toBe(byName('a').id)
    expect(d.layout!.anchorTo!.edge).toBe('bottom')
    expect(d.layout!.fitTo!.clip).toBe(byName('b').id)
    expect(d.layout!.fitTo!.padding).toBe(4)
  })

  it('keeps fx1, its keyframe channel, keyframe ids and assetId unchanged', () => {
    const { out, byName } = regen(7)
    const b = byName('b')
    expect(b.effects![0]!.id).toBe('fx1')
    const radiusTrack = (b.keyframes!.channels as unknown as Record<string, { keys: Array<{ id: string }> }>)['fx.fx1.radius']!
    expect(radiusTrack.keys[0]!.id).toBe('kf1')
    expect(byName('a').assetId).toBe('asset-a')
  })

  it('rewires composition bindings, including through the compound', () => {
    const { out, byName } = regen(7)
    const k = byName('k')
    const child = k.compound!.project
    const z = Object.values(child.clips).flat()[0]!
    expect(z.id).not.toBe('z')
    expect(out.composition!.bindings[0]!.clipId).toBe(byName('a').id)
    expect(out.composition!.bindings[1]!.clipId).toBe(`${k.id}/${z.id}`)
  })

  it('is deterministic for the same seed, and different for a different one', () => {
    const first = regen(7).out
    const second = regen(7).out
    expect(second).toEqual(first)
    const third = regen(8).out
    expect(third.id).not.toBe(first.id)
  })
})

describe('regenerateIds — EG-P1 provenance', () => {
  it('partId and component are unchanged while ids change', () => {
    const component = { v: 1 as const, name: 'kinetic-title', input: { id: 'hero' }, seed: 3, style: { energy: 'standard', camera: true, ambient: 'orbs', transition: 'wipe' } }
    const child = baseClip('z', 'inner-1', { partId: 'hero-word-0' })
    const k = baseClip('k', 't1', {
      type: 'compound',
      partId: 'hero',
      component,
      compound: {
        project: {
          id: 'child',
          fps: 30,
          stage: { width: 1080, height: 1920 },
          tracks: [track('inner-1', 0)],
          clips: { 'inner-1': [child] },
          transitions: [],
          version: 1,
        },
      },
    } as unknown as Partial<Clip>)
    const project = {
      id: 'root',
      fps: 30,
      stage: { width: 1080, height: 1920 },
      tracks: [track('t1', 0)],
      clips: { t1: [k] },
      transitions: [],
      version: 1,
    } as unknown as Project
    const out = withSeededIds(11, () => regenerateIds(project))
    const outK = out.clips[out.tracks[0]!.id]![0]!
    expect(outK.id).not.toBe('k')
    expect(outK.partId).toBe('hero')
    expect(outK.component).toEqual(component)
    const outChild = Object.values(outK.compound!.project.clips)[0]![0]!
    expect(outChild.id).not.toBe('z')
    expect(outChild.partId).toBe('hero-word-0')
  })
})
