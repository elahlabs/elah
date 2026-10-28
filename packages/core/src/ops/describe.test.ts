import { describe, expect, it } from 'vitest'
import { readProjectDocument } from '../editor/projectDocument'
import type { Clip, Project, Track } from '../types'
import type { ProjectComposition } from '../composition/types'
import { describeProject } from './describe'
import { describeStructure } from './sanitize'
import { parsePathToCubics } from '../resolver/pathMorph'

function track(id: string, order: number, kind: Track['kind'] = 'video', extra: Partial<Track> = {}): Track {
  return { id, name: id.toUpperCase(), kind, order, height: 64, locked: false, disabled: false, muted: false, solo: false, ...extra }
}

function clip(id: string, trackId: string, startFrame: number, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    trackId,
    type: 'video',
    name: id,
    startFrame,
    durationFrames: 30,
    sourceStartFrame: 0,
    sourceDurationFrames: 30,
    src: `${id}.mp4`,
    assetId: `asset-${id}`,
    ...extra,
  }
}

function project(): Project {
  return {
    id: 'p',
    fps: 30,
    stage: { width: 1920, height: 1080 },
    tracks: [track('v2', 1, 'elements', { locked: true }), track('v1', 0)],
    clips: {
      v1: [
        clip('b', 'v1', 30, { speed: 2, effects: [{ id: 'fx1', kind: 'grain', params: {}, preset: undefined }] }),
        clip('a', 'v1', 0, {
          blend: 'screen',
          keyframes: { channels: { opacity: { source: { kind: 'keyframes' }, keys: [{ id: 'k', frame: 0, value: 1, easing: 'linear' }] } } },
        }),
      ],
      v2: [
        clip('t', 'v2', 15, { type: 'text', content: '  Hello\n   world  ', src: undefined, assetId: undefined, matte: { sourceClipId: 'a', kind: 'alpha' } }),
      ],
    },
    transitions: [],
    version: 1,
    markers: [
      { id: 'm2', frame: 45, name: 'Drop', kind: 'beat' },
      { id: 'm1', frame: 15, name: 'Hook' },
    ],
  }
}

describe('describeProject', () => {
  it('orders tracks by UI order and clips by start, in frames and seconds', () => {
    const d = describeProject(project())
    expect(d.tracks.map((t) => t.id)).toEqual(['v1', 'v2'])
    expect(d.tracks[0].clips.map((c) => c.id)).toEqual(['a', 'b'])
    expect(d.tracks[0].clips[1]).toMatchObject({ startFrame: 30, endFrame: 59, startSec: 1, durationSec: 1, speed: 2 })
    expect(d).toMatchObject({ fps: 30, durationFrames: 60, durationSec: 2 })
  })

  it('summarises content, keys, effects, blend and matte, and flags state', () => {
    const d = describeProject(project(), { selection: ['t'] })
    const [a, b] = d.tracks[0].clips
    const [t] = d.tracks[1].clips
    expect(a).toMatchObject({ content: 'asset-a', keyed: ['opacity'], blend: 'screen' })
    expect(b.effects).toEqual([{ id: 'fx1', kind: 'grain', enabled: true, params: { amount: 0.25, size: 1.5 } }])
    expect(t).toMatchObject({ content: 'Hello world', matteOf: 'a', selected: true })
    expect(d.tracks[1].locked).toBe(true)
  })

  it('names the channels an expression drives (PV-P5b-2)', () => {
    // An expression channel may hold NO keys, so it never appears in `keyed`.
    // Without this a model reading the description would conclude the clip has
    // no animation at all.
    const withExpr = project()
    // Clip 'a' already has a keyed opacity; give it an expression too, so the
    // two lists have to be independent.
    const channels = withExpr.clips['v1']![1]!.keyframes!.channels
    channels.x = { source: { kind: 'expression', source: 'value + 1' }, keys: [] }
    const a = describeProject(withExpr, {}).tracks[0].clips[0]!
    expect(a.expressions).toEqual(['x'])
    expect(a.keyed).toEqual(['opacity'])
    // A clip with no expression gets no key at all, not an empty array.
    const b = describeProject(project(), {}).tracks[0].clips[1]!
    expect('expressions' in b).toBe(false)
  })

  it('lists markers by frame', () => {    expect(describeProject(project()).markers).toEqual([
      { id: 'm1', frame: 15, sec: 0.5, name: 'Hook' },
      { id: 'm2', frame: 45, sec: 1.5, name: 'Drop', kind: 'beat' },
    ])
  })

  it('is JSON-safe and deterministic', () => {
    const d = describeProject(project())
    expect(JSON.parse(JSON.stringify(d))).toEqual(d)
    expect(describeProject(project())).toEqual(d)
  })

  it('cuts long text', () => {
    const p = project()
    p.clips.v2[0] = { ...p.clips.v2[0], content: 'x'.repeat(200) }
    expect(describeProject(p, { maxContentChars: 10 }).tracks[1].clips[0].content).toHaveLength(10)
  })

  it('an analysed audio clip carries beats; other clips carry none (PV-P10b-3)', () => {
    const p = project()
    const audioTrack = track('au', 2, 'audio')
    const song = clip('song', 'au', 0, { type: 'audio', src: 'song', assetId: undefined })
    p.tracks.push(audioTrack)
    p.clips.au = [song]
    p.audioMarkers = [{ src: 'song', fps: 30, version: 1, bpm: 120, beats: [0, 15, 30], silences: [[10, 20]] }]

    const described = describeProject(p)
    const audioOut = described.tracks.find((t) => t.id === 'au')!.clips[0]!
    expect(audioOut.beats).toEqual({ bpm: 120, count: 2, silences: 1 })

    // Every video/text clip carries no `beats` key at all.
    for (const t of described.tracks) {
      if (t.id === 'au') continue
      for (const c of t.clips) expect('beats' in c).toBe(false)
    }
  })

  it('describes a composition’s props and bindings (PV-P7c)', () => {
    const composition: ProjectComposition = {
      props: [
        { name: 'title', type: 'text', label: 'title', default: 'Hi' },
        { name: 'size', type: 'number', label: 'size', default: 3, min: 1, max: 9 },
      ],
      bindings: [{ clipId: 'a', path: 'text', prop: 'title' }],
      values: { title: 'Now' },
    }
    const p: Project = { ...project(), composition }
    const d = describeProject(p)
    expect(d.composition).toEqual({
      props: [
        { name: 'title', type: 'text', label: 'title', value: 'Now' },
        { name: 'size', type: 'number', label: 'size', value: 3, min: 1, max: 9 },
      ],
      bindings: [{ clip: 'a', path: 'text', prop: 'title' }],
    })
  })

  it('leaves out composition entirely when the project has none', () => {
    const d = describeProject(project())
    expect('composition' in d).toBe(false)
  })
})

describe('document round-trip of effects and markers', () => {
  function doc(extra: Record<string, unknown> = {}, clipExtra: Record<string, unknown> = {}) {
    return {
      id: 'p',
      fps: 30,
      version: 1,
      tracks: [{ id: 't', name: 'T', kind: 'video', order: 0 }],
      clips: { t: [{ id: 'c', type: 'video', name: 'c', startFrame: 0, durationFrames: 30, src: 'c.mp4', ...clipExtra }] },
      ...extra,
    }
  }

  it('keeps unknown effect kinds and drops only unusable entries', () => {
    const p = readProjectDocument(
      doc({}, {
        effects: [
          { id: 'a', kind: 'grain', params: { amount: 0.3 } },
          { id: 'b', kind: 'fromTheFuture', params: {} },
          { id: '', kind: 'grain', params: {} },
          { id: 'd', kind: 'grain' },
          'junk',
        ],
        blend: 'multiply',
        mask: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
      }),
    )
    const c = p.clips.t[0]
    expect(c.effects?.map((e) => e.id)).toEqual(['a', 'b'])
    expect(c.blend).toBe('multiply')
    expect(c.mask?.kind).toBe('rect')
  })

  it('drops a non-list effects field', () => {
    expect('effects' in readProjectDocument(doc({}, { effects: 'x' })).clips.t[0]).toBe(false)
  })

  it('reads markers, sorted, dropping unplaceable ones', () => {
    const p = readProjectDocument(
      doc({ markers: [{ id: 'b', frame: 20, name: 'B', kind: 'chapter' }, { id: 'a', frame: 5.6 }, { frame: 1 }, null] }),
    )
    expect(p.markers).toEqual([
      { id: 'a', frame: 6, name: '' },
      { id: 'b', frame: 20, name: 'B', kind: 'chapter' },
    ])
  })

  it('adds no markers field to a document without one', () => {
    expect('markers' in readProjectDocument(doc())).toBe(false)
  })
})

describe('AGN-P28: describeProject shows the path a shape.path morph starts from', () => {
  const TRI = 'M0 0 L100 0 L100 100 Z'
  /** A path of exactly `n` characters: `M0 0` then `L1 1` pairs, padded with a final number's digits. */
  const pathOfLength = (n: number): string => {
    let d = 'M0 0'
    while (d.length + 4 <= n) d += ' L1 1'
    while (d.length < n) d += '1'
    return d
  }
  function shapes(paths: Array<{ id: string; kind?: string; d?: string; viewBox?: { x: number; y: number; width: number; height: number } }>): Project {
    return {
      id: 'p',
      fps: 30,
      stage: { width: 1080, height: 1920 },
      tracks: [track('v1', 0)],
      clips: {
        v1: paths.map((s, i) => {
          const c = clip(s.id, 'v1', i * 30, { type: 'shape' } as Partial<Clip>) as unknown as Record<string, unknown>
          delete c.src
          delete c.assetId
          c.shapeKind = s.kind ?? 'path'
          if (s.d !== undefined) c.shapePath = s.d
          if (s.viewBox) c.shapeViewBox = s.viewBox
          return c as unknown as Clip
        }),
      },
    } as unknown as Project
  }
  const all = (p: Project, opts = {}) => describeProject(p, opts).tracks.flatMap((t) => t.clips)
  const only = (p: Project, id: string) => all(p).find((c) => c.id === id)!

  it('the fixture triangle is described verbatim, with its default user space and the morph structure', () => {
    const c = only(shapes([{ id: 'logo', d: TRI }]), 'logo')
    expect(c.path).toEqual({ d: TRI, viewBox: '0 0 100 100', structure: '1 subpath: 2 cubic segments, closed' })
  })

  it('structure is the very string the sanitiser prints, and its wording is pinned', () => {
    const d = 'M0 0 L10 0 M20 20 C 30 20 40 30 50 50 L60 60'
    expect(only(shapes([{ id: 'a', d }]), 'a').path!.structure).toBe(describeStructure(parsePathToCubics(d)!))
    expect(only(shapes([{ id: 'a', d }]), 'a').path!.structure).toBe('2 subpaths: 1 + 2 cubic segments, open + open')
    expect(only(shapes([{ id: 'b', d: TRI }]), 'b').path!.structure).toBe('1 subpath: 2 cubic segments, closed')
  })

  it('a custom viewBox is reported as x y width height', () => {
    const c = only(shapes([{ id: 'a', d: TRI, viewBox: { x: 0, y: 0, width: 1, height: 1 } }]), 'a')
    expect(c.path!.viewBox).toBe('0 0 1 1')
  })

  it('a non-path shape and a text clip carry no path at all', () => {
    const p = shapes([{ id: 'r', kind: 'rect' }])
    const t = clip('t', 'v1', 90, { type: 'text', text: { content: 'hi' } } as Partial<Clip>)
    p.clips.v1!.push(t)
    expect('path' in only(p, 'r')).toBe(false)
    expect('path' in only(p, 't')).toBe(false)
  })

  it('a 401-character path omits d (never truncates it) but keeps viewBox and structure; 400 still rides along', () => {
    const long = pathOfLength(401)
    expect(long).toHaveLength(401)
    const c = only(shapes([{ id: 'a', d: long }]), 'a')
    expect(c.path!.d).toBeUndefined()
    expect(c.path!.dOmitted).toBe('too-long')
    expect(c.path!.viewBox).toBe('0 0 100 100')
    expect(c.path!.structure).toBe(describeStructure(parsePathToCubics(long)!))
    expect(JSON.stringify(c)).not.toContain(long.slice(0, 40))
    const edge = pathOfLength(400)
    expect(only(shapes([{ id: 'b', d: edge }]), 'b').path!.d).toBe(edge)
  })

  it('the project-wide total omits d on the LATER clips; the earlier ones keep theirs', () => {
    const d = pathOfLength(300)
    const clips = all(shapes(Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, d }))))
    const kept = Math.floor(4000 / 300)
    expect(kept).toBe(13)
    expect(clips.slice(0, kept).every((c) => c.path!.d === d && c.path!.dOmitted === undefined)).toBe(true)
    expect(clips.slice(kept).every((c) => c.path!.d === undefined && c.path!.dOmitted === 'budget')).toBe(true)
    // An omitted path still says what kind of path it is.
    expect(clips.at(-1)!.path!.structure).toBe(describeStructure(parsePathToCubics(d)!))
  })

  it('the budgets are overridable', () => {
    const p = shapes([{ id: 'a', d: TRI }, { id: 'b', d: TRI }])
    const tight = all(p, { maxPathTotal: TRI.length })
    expect(tight[0]!.path!.d).toBe(TRI)
    expect(tight[1]!.path!.dOmitted).toBe('budget')
    expect(all(p, { maxPathLength: 5 }).map((c) => c.path!.dOmitted)).toEqual(['too-long', 'too-long'])
  })

  it('a 40-path project stays far under the route limit of 200,000 characters', () => {
    const d = pathOfLength(400)
    const p = shapes(Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, d })))
    const withPaths = JSON.stringify(describeProject(p)).length
    const without = JSON.stringify(describeProject(p, { maxPathLength: 0 })).length
    console.log(`AGN-P28 40-path describe: ${withPaths} chars (${without} with every d omitted); route limit 200000`)
    expect(withPaths).toBeLessThan(20000)
    // The total budget, not luck, bounds the path text: 10 x 400 = 4000 characters of d.
    expect(withPaths - without).toBeLessThanOrEqual(4000 + 40 * 40)
  })
})
