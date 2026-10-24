import { describe, it, expect } from 'vitest'
import {
  PROJECT_VERSION,
  ProjectDocumentError,
  documentVersionFor,
  isReadableProjectDocument,
  isRecoverableMediaSrc,
  missingMediaSummary,
  readProjectDocument,
  relinkProjectMedia,
} from './projectDocument'
import { TimelineEngine } from './TimelineEngine'
import type { Project } from '../types'

/**
 * The parser between a stored blob and the engine.
 *
 * Everything here is about one asymmetry: a document that is wrongly *refused*
 * costs the user a dialog and a reload, while a document that is wrongly
 * *accepted* opens an editor that looks empty and autosaves that emptiness over
 * their work. So the tests are written from both sides — what must be repaired
 * and opened, and what must be refused loudly.
 */

const stored = {
  id: 'p1',
  fps: 30,
  stage: { width: 1920, height: 1080 },
  version: 1,
  masterVolume: 0.8,
  tracks: [
    {
      id: 't-video',
      name: 'Video',
      kind: 'video',
      order: 0,
      height: 36,
      locked: false,
      disabled: false,
      muted: false,
      solo: false,
      volume: 1,
      protected: false,
    },
  ],
  clips: {
    't-video': [
      {
        id: 'c1',
        trackId: 't-video',
        type: 'video',
        name: 'Opening shot',
        startFrame: 0,
        durationFrames: 60,
        sourceStartFrame: 0,
        sourceDurationFrames: 60,
        src: 'https://cdn.example/a.mp4',
        assetId: 'gone-with-the-last-session',
      },
    ],
  },
  transitions: [],
}

const doc = (patch: Record<string, unknown> = {}) => ({ ...stored, ...patch })

describe('readProjectDocument — what it opens', () => {
  it('reads back a document written by this build', () => {
    const project = readProjectDocument(doc())
    expect(project.id).toBe('p1')
    expect(project.fps).toBe(30)
    expect(project.stage).toEqual({ width: 1920, height: 1080 })
    expect(project.masterVolume).toBe(0.8)
    expect(project.clips['t-video']).toHaveLength(1)
    expect(project.clips['t-video'][0].src).toBe('https://cdn.example/a.mp4')
  })

  it('carries a bundled fontId through the reader, with no version bump (PV-P4a-2)', () => {
    // `readClip` spreads the raw clip, so an OPTIONAL field needs no reader
    // change — and optional is the whole point: bumping PROJECT_VERSION for a
    // field older documents simply do not have would make every saved project
    // look stale to every older build.
    const project = readProjectDocument(
      doc({
        tracks: [...stored.tracks, { id: 't-text', kind: 'elements' }],
        clips: {
          ...stored.clips,
          't-text': [
            { id: 'c2', type: 'text', name: 'Title', startFrame: 0, durationFrames: 30, content: 'Hi', fontId: 'inter' },
          ],
        },
      }),
    )
    expect(project.clips['t-text'][0].fontId).toBe('inter')
    expect(project.version).toBe(1)
  })

  it('round-trips italic and a numeric weight, with no version bump (PV-P4b)', () => {
    // Both fields are optional additions, so `readClip`'s spread carries them
    // and `documentVersionFor` has nothing to key on — a bump would make every
    // saved project look stale to every older build.
    const project = readProjectDocument(
      doc({
        tracks: [...stored.tracks, { id: 't-text', kind: 'elements' }],
        clips: {
          ...stored.clips,
          't-text': [
            {
              id: 'c2',
              type: 'text',
              name: 'Title',
              startFrame: 0,
              durationFrames: 30,
              content: 'Hi',
              fontStyle: 'italic',
              fontWeight: 900,
            },
          ],
        },
      }),
    )
    expect(project.clips['t-text'][0].fontStyle).toBe('italic')
    // Not stringified, not clamped: a number survives as a number.
    expect(project.clips['t-text'][0].fontWeight).toBe(900)
    expect(project.version).toBe(1)
  })

  it('round-trips a radial glyph fill, with no version bump (PV-P4c-1)', () => {
    // A gradient is a NESTED object, so this is the reader's first real test of
    // something more than a scalar: a reader that rebuilt clips field by field
    // would drop the stops. `toEqual` is right here (unlike the resolver's `toBe`)
    // because the contract is the VALUE that survives, not its identity.
    const textFill = {
      type: 'radial',
      cx: 0.5,
      cy: 0.5,
      r: 1,
      stops: [
        { offset: 0, color: '#fff' },
        { offset: 1, color: '#000' },
      ],
    }
    const project = readProjectDocument(
      doc({
        tracks: [...stored.tracks, { id: 't-text', kind: 'elements' }],
        clips: {
          ...stored.clips,
          't-text': [
            { id: 'c2', type: 'text', name: 'Title', startFrame: 0, durationFrames: 30, content: 'Hi', textFill },
          ],
        },
      }),
    )
    expect(project.clips['t-text'][0].textFill).toEqual(textFill)
    expect(project.version).toBe(1)
  })

  it('round-trips styled spans, with no version bump (PV-P4c-2)', () => {
    // A span is an ARRAY OF OBJECTS inside an array, so this is the reader's
    // deepest nesting yet: a reader that rebuilt clips field by field would drop
    // the whole array.
    const spans = [{ start: 0, end: 5, fontWeight: 700, color: '#ff0000' }]
    const project = readProjectDocument(
      doc({
        tracks: [...stored.tracks, { id: 't-text', kind: 'elements' }],
        clips: {
          ...stored.clips,
          't-text': [
            { id: 'c2', type: 'text', name: 'Title', startFrame: 0, durationFrames: 30, content: 'Hello', spans },
          ],
        },
      }),
    )
    expect(project.clips['t-text'][0].spans).toEqual(spans)
    expect(project.version).toBe(1)
  })

  it('fills in the fields a document predating them never had', () => {
    const { stage, transitions, masterVolume, ...older } = stored
    void stage
    void transitions
    void masterVolume
    const project = readProjectDocument(older)

    // Defaults, not a refusal: an older project opens, which is the point.
    expect(project.stage).toEqual({ width: 1080, height: 1920 })
    expect(project.transitions).toEqual([])
    expect(project.masterVolume).toBeUndefined()
  })

  it('gives every track a clip bucket, so `clips[track.id]` is never undefined', () => {
    const project = readProjectDocument(
      doc({
        tracks: [...stored.tracks, { id: 't-audio', kind: 'audio' }],
      }),
    )
    expect(project.clips['t-audio']).toEqual([])
  })

  it('drops a clip bucket whose track is gone rather than carrying dead length', () => {
    // `getTotalFrames` walks every bucket, so a bucket with no track stretches
    // the timeline to a duration with nothing visible in it.
    const project = readProjectDocument(
      doc({
        clips: { ...stored.clips, 't-deleted': [{ ...stored.clips['t-video'][0], id: 'x', startFrame: 9000 }] },
      }),
    )
    expect(Object.keys(project.clips)).toEqual(['t-video'])
  })

  it('files a clip under the bucket it was stored in, not the trackId it claims', () => {
    // A clip whose own `trackId` disagrees with its bucket is invisible to every
    // lookup that goes clip → track. The bucket is the one the timeline renders.
    const project = readProjectDocument(
      doc({ clips: { 't-video': [{ ...stored.clips['t-video'][0], trackId: 'nonsense' }] } }),
    )
    expect(project.clips['t-video'][0].trackId).toBe('t-video')
  })

  it('sorts each track by timeline position, whatever order it was stored in', () => {
    const first = stored.clips['t-video'][0]
    const project = readProjectDocument(
      doc({
        clips: {
          't-video': [
            { ...first, id: 'late', startFrame: 300 },
            { ...first, id: 'early', startFrame: 0 },
          ],
        },
      }),
    )
    expect(project.clips['t-video'].map((c) => c.id)).toEqual(['early', 'late'])
  })

  it('keeps track defaults identical to a freshly created track, so a round trip is an identity', () => {
    const project = readProjectDocument(
      doc({ tracks: [{ id: 't-video', kind: 'video', name: 'Video' }] }),
    )
    const track = project.tracks[0]
    expect(track.volume).toBe(1)
    expect(track.protected).toBe(false)
    expect(track.locked).toBe(false)
    expect(track.height).toBe(64)
    expect(track.pinned).toBeUndefined()
  })

  it('keeps a pinned-bottom lane pinned across a reload', () => {
    const project = readProjectDocument(
      doc({
        tracks: [
          { id: 't-video', kind: 'video', name: 'Video' },
          { id: 't-audio', kind: 'audio', name: 'Audio', pinned: 'bottom' },
        ],
      }),
    )
    expect(project.tracks.find((t) => t.id === 't-audio')!.pinned).toBe('bottom')
  })

  it('reads an unrecognised pin as unpinned rather than ordering tracks around it', () => {
    const project = readProjectDocument(
      doc({ tracks: [{ id: 't-video', kind: 'video', name: 'Video', pinned: 'top' }] }),
    )
    expect(project.tracks[0].pinned).toBeUndefined()
  })

  it('drops a transition whose clips are gone instead of refusing the whole video', () => {
    const project = readProjectDocument(
      doc({
        transitions: [
          { id: 'x', kind: 'fade', fromClipId: 'c1', toClipId: 'deleted', trackId: 't-video', startFrame: 0, durationFrames: 12 },
        ],
      }),
    )
    // Nothing of the user's is lost — the clips it joined are already not there.
    expect(project.transitions).toEqual([])
  })

  it('drops a transition this build has no renderer for, and keeps the clips', () => {
    const project = readProjectDocument(
      doc({
        transitions: [
          { id: 'x', kind: 'kaleidoscope', fromClipId: 'c1', toClipId: 'c1', trackId: 't-video', startFrame: 0, durationFrames: 12 },
        ],
      }),
    )
    expect(project.transitions).toEqual([])
    expect(project.clips['t-video']).toHaveLength(1)
  })
})

describe('readProjectDocument — what it refuses', () => {
  const refuses = (document: unknown) => {
    expect(() => readProjectDocument(document)).toThrow(ProjectDocumentError)
    expect(isReadableProjectDocument(document)).toBe(false)
  }

  it('refuses anything that is not an object', () => {
    refuses('{}')
    refuses([])
    refuses(42)
    refuses(null)
  })

  it('refuses a document with no frame rate — every position in it is unreadable', () => {
    refuses(doc({ fps: undefined }))
    refuses(doc({ fps: 0 }))
    refuses(doc({ fps: -30 }))
    refuses(doc({ fps: Number.NaN }))
    refuses(doc({ fps: '30' }))
  })

  it('refuses clips stored as a list — it is indexed by track id', () => {
    // An array satisfies `typeof === 'object'` and then reads as `undefined`
    // for every track: an empty editor, and no error anywhere.
    refuses(doc({ clips: [] }))
    refuses(doc({ tracks: undefined }))
  })

  it('refuses a clip with no position or no length', () => {
    refuses(doc({ clips: { 't-video': [{ ...stored.clips['t-video'][0], startFrame: undefined }] } }))
    refuses(doc({ clips: { 't-video': [{ ...stored.clips['t-video'][0], durationFrames: 0 }] } }))
  })

  it('refuses a clip type it cannot render, rather than showing a gap', () => {
    refuses(doc({ clips: { 't-video': [{ ...stored.clips['t-video'][0], type: 'hologram' }] } }))
  })

  it('refuses two tracks with the same id — one of them would be unreachable', () => {
    refuses(doc({ tracks: [stored.tracks[0], { ...stored.tracks[0], name: 'Copy' }] }))
  })

  it('names the reason, so the editor can say something true about it', () => {
    try {
      readProjectDocument(doc({ tracks: undefined }))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectDocumentError)
      expect((err as ProjectDocumentError).code).toBe('unreadable')
    }
  })
})

describe('readProjectDocument — version guard', () => {
  it('accepts a document with no version stamp as the first one', () => {
    // The field's absence is what "written before the stamp existed" looks
    // like; refusing it would strand the earliest saved projects.
    // Stamped with the lowest version that describes it (EDX-P7): nothing
    // version-2 inside, so it stays 1 and older builds can still open it.
    const project = readProjectDocument(doc({ version: undefined }))
    expect(project.version).toBe(1)
  })

  it('stamps version 2 only when the document holds an adjustment clip', () => {
    expect(readProjectDocument(doc({ version: 1 })).version).toBe(1)
    const withAdjustment = doc({
      version: 1,
      clips: {
        't-video': [
          ...stored.clips['t-video'],
          { id: 'adj', trackId: 't-video', type: 'adjustment', name: 'Adjust', startFrame: 500, durationFrames: 30, sourceStartFrame: 0, sourceDurationFrames: 30 },
        ],
      },
    })
    const read = readProjectDocument(withAdjustment)
    expect(read.version).toBe(2)
    expect(read.clips['t-video']!.some((c) => c.type === 'adjustment')).toBe(true)
  })

  it('accepts and stamps the current version', () => {
    expect(readProjectDocument(doc({ version: PROJECT_VERSION })).version).toBe(PROJECT_VERSION)
  })

  it('refuses a document from a newer build, and says which one', () => {
    // The fields this build doesn't know about are exactly the ones the next
    // autosave would silently drop, so opening it is the destructive option.
    try {
      readProjectDocument(doc({ version: PROJECT_VERSION + 1 }))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectDocumentError)
      expect((err as ProjectDocumentError).code).toBe('unsupported-version')
      expect((err as ProjectDocumentError).documentVersion).toBe(PROJECT_VERSION + 1)
    }
  })

  it('separates a newer document from a broken one — they are different sentences', () => {
    const newer = (() => {
      try {
        readProjectDocument(doc({ version: 99 }))
      } catch (err) {
        return (err as ProjectDocumentError).code
      }
    })()
    const broken = (() => {
      try {
        readProjectDocument(doc({ tracks: 'nope' }))
      } catch (err) {
        return (err as ProjectDocumentError).code
      }
    })()
    expect(newer).toBe('unsupported-version')
    expect(broken).toBe('unreadable')
  })

  it('refuses a version stamp that is not a whole number at all', () => {
    expect(() => readProjectDocument(doc({ version: 'one' }))).toThrow(ProjectDocumentError)
    expect(() => readProjectDocument(doc({ version: 1.5 }))).toThrow(ProjectDocumentError)
    expect(() => readProjectDocument(doc({ version: 0 }))).toThrow(ProjectDocumentError)
  })
})

// ---------------------------------------------------------------------------

describe('isRecoverableMediaSrc', () => {
  it('accepts a URL that will still resolve tomorrow', () => {
    expect(isRecoverableMediaSrc('https://cdn.example/a.mp4')).toBe(true)
    expect(isRecoverableMediaSrc('/api/assets/a.mp4')).toBe(true)
  })

  it('rejects the URLs that die with the session that made them', () => {
    // `URL.createObjectURL` output, baked into a clip when a user drags a file
    // in from their device. It comes back tomorrow pointing at nothing.
    expect(isRecoverableMediaSrc('blob:https://app.example/9f2c')).toBe(false)
    expect(isRecoverableMediaSrc('data:video/mp4;base64,AAAA')).toBe(false)
    expect(isRecoverableMediaSrc(undefined)).toBe(false)
    expect(isRecoverableMediaSrc('')).toBe(false)
  })
})

describe('relinkProjectMedia', () => {
  const project = () => readProjectDocument(doc()) as Project

  it('points a restored clip back at the library asset with the same source', () => {
    // The library is rebuilt on every page load with fresh ids, so the stored
    // `assetId` names nothing. Without this the clip still plays and still has
    // no filmstrip.
    const result = relinkProjectMedia(project(), [
      { id: 'fresh-id', src: 'https://cdn.example/a.mp4' },
    ])
    expect(result.relinked).toBe(1)
    expect(result.project.clips['t-video'][0].assetId).toBe('fresh-id')
    expect(result.missing).toEqual([])
  })

  it('changes nothing else about the clip', () => {
    const before = project()
    const after = relinkProjectMedia(before, [{ id: 'fresh-id', src: 'https://cdn.example/a.mp4' }])
    expect(after.project.clips['t-video'][0]).toEqual({
      ...before.clips['t-video'][0],
      assetId: 'fresh-id',
    })
  })

  it('returns the same object when nothing needed repairing', () => {
    // Identity is the signal the editor uses to skip a second `loadProject`
    // and a pointless autosave.
    const before = project()
    expect(relinkProjectMedia(before, []).project).toBe(before)
  })

  it('leaves a clip already pointing at a live asset alone', () => {
    const before = project()
    const result = relinkProjectMedia(before, [
      { id: 'gone-with-the-last-session', src: 'https://cdn.example/somewhere-else.mp4' },
    ])
    expect(result.relinked).toBe(0)
    expect(result.project).toBe(before)
  })

  it('keeps a clip whose file cannot come back, and names it', () => {
    // Dropping it would be the one outcome the user can neither see nor undo:
    // the clip is still their work, with a name, a place and a length.
    const orphan = readProjectDocument(
      doc({
        clips: {
          't-video': [
            { ...stored.clips['t-video'][0], src: 'blob:https://app.example/9f2c', name: 'Beach.mp4' },
          ],
        },
      }),
    )
    const result = relinkProjectMedia(orphan, [{ id: 'x', src: 'https://cdn.example/a.mp4' }])

    expect(result.project.clips['t-video']).toHaveLength(1)
    expect(result.project.clips['t-video'][0].name).toBe('Beach.mp4')
    expect(result.missing).toEqual([{ clipId: 'c1', clipName: 'Beach.mp4', kind: 'video', reason: 'gone' }])
  })

  it('ignores clips that never had a source file', () => {
    const withText = readProjectDocument(
      doc({
        tracks: [...stored.tracks, { id: 't-text', kind: 'elements' }],
        clips: {
          ...stored.clips,
          't-text': [
            { id: 'c2', type: 'text', name: 'Title', startFrame: 0, durationFrames: 30, content: 'Hi' },
          ],
        },
      }),
    )
    const result = relinkProjectMedia(withText, [])
    expect(result.missing).toEqual([])
  })
})

describe('missingMediaSummary', () => {
  const missing = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      clipId: `c${i}`,
      clipName: `Clip ${i + 1}`,
      kind: 'video' as const,
      reason: 'gone' as const,
    }))

  it('says nothing when nothing is missing', () => {
    expect(missingMediaSummary([])).toBeNull()
  })

  it('names one or two outright', () => {
    expect(missingMediaSummary(missing(1))).toBe('Clip 1')
    expect(missingMediaSummary(missing(2))).toBe('Clip 1 and Clip 2')
  })

  it('stays readable on a project where a lot went missing', () => {
    expect(missingMediaSummary(missing(3))).toBe('Clip 1, Clip 2 and 1 more')
    expect(missingMediaSummary(missing(30))).toBe('Clip 1, Clip 2 and 28 more')
  })
})

describe('readProjectDocument — timeline fields (PV-T1)', () => {
  const track = (id: string, kind: string, order: number, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    kind,
    order,
    height: 54,
    locked: false,
    disabled: false,
    muted: false,
    solo: false,
    volume: 1,
    ...extra,
  })
  const doc = (extra: Record<string, unknown> = {}, tracks = [track('v1', 'video', 0), track('v2', 'video', 1), track('a1', 'audio', 2)]) => ({
    id: 'p',
    fps: 30,
    version: 3,
    tracks,
    clips: {
      v1: [
        {
          id: 'c1',
          trackId: 'v1',
          type: 'video',
          name: 'c',
          startFrame: 0,
          durationFrames: 30,
          sourceStartFrame: 0,
          sourceDurationFrames: 30,
          linkId: 'g1',
          labelColor: 'label-2',
        },
      ],
    },
    transitions: [],
    ...extra,
  })

  it('round-trips the mode, the main track, track colours, links, labels and groups', () => {
    const project = readProjectDocument(
      doc(
        {
          timelineMode: 'magnetic',
          trackGroups: [{ id: 'g', name: 'Pair', trackIds: ['v1', 'a1'], collapsed: true }],
        },
        [track('v1', 'video', 0, { role: 'main', color: 'label-4' }), track('v2', 'video', 1), track('a1', 'audio', 2)],
      ),
    )
    expect(project.timelineMode).toBe('magnetic')
    expect(project.tracks[0]).toMatchObject({ role: 'main', color: 'label-4' })
    expect(project.tracks[1]).not.toHaveProperty('role')
    expect(project.tracks[1]).not.toHaveProperty('color')
    expect(project.clips.v1![0]).toMatchObject({ linkId: 'g1', labelColor: 'label-2' })
    expect(project.trackGroups).toEqual([{ id: 'g', name: 'Pair', trackIds: ['v1', 'a1'], collapsed: true }])
    expect(project.version).toBe(3)
  })

  it('reads a document without them to an object without them', () => {
    const project = readProjectDocument(doc())
    expect(project).not.toHaveProperty('timelineMode')
    expect(project).not.toHaveProperty('trackGroups')
    for (const t of project.tracks) {
      expect(t).not.toHaveProperty('role')
      expect(t).not.toHaveProperty('color')
    }
  })

  it('treats "free" as absence and drops a role on a non-video track', () => {
    const project = readProjectDocument(
      doc({ timelineMode: 'free' }, [track('v1', 'video', 0), track('a1', 'audio', 1, { role: 'main' })]),
    )
    expect(project).not.toHaveProperty('timelineMode')
    expect(project.tracks[1]).not.toHaveProperty('role')
  })

  it('keeps one main track: the lowest order', () => {
    const project = readProjectDocument(
      doc({}, [track('v1', 'video', 1, { role: 'main' }), track('v2', 'video', 0, { role: 'main' })]),
    )
    expect(project.tracks.filter((t) => t.role === 'main').map((t) => t.id)).toEqual(['v2'])
  })

  it('keeps only groups that name real tracks, each track in one group', () => {
    const project = readProjectDocument(
      doc({
        trackGroups: [
          { id: 'a', name: 'A', trackIds: ['v1', 'ghost'], collapsed: false },
          { id: 'b', name: 'B', trackIds: ['v1', 'v2'], collapsed: 'yes' },
          { id: 'c', name: 'C', trackIds: ['ghost'], collapsed: false },
          'junk',
        ],
      }),
    )
    expect(project.trackGroups).toEqual([
      { id: 'a', name: 'A', trackIds: ['v1'], collapsed: false },
      { id: 'b', name: 'B', trackIds: ['v2'], collapsed: false },
    ])
  })
})

describe('assetFrames round-trips through the reader (PV-T5-1)', () => {
  // A length the build trusts to bound trims, so a bad one must not survive:
  // the clip falls back to the legacy window limits instead of trimming
  // against nonsense.
  const baseClip = {
    id: 'c1',
    trackId: 'v1',
    type: 'video',
    name: 'c',
    startFrame: 0,
    durationFrames: 30,
    sourceStartFrame: 0,
    sourceDurationFrames: 30,
    src: 'https://cdn.example/a.mp4',
  }
  const withAssetFrames = (assetFrames: unknown) => ({
    id: 'p',
    fps: 30,
    version: 3,
    stage: { width: 1920, height: 1080 },
    tracks: [{ id: 'v1', name: 'V1', kind: 'video', order: 0, height: 54, locked: false, disabled: false, muted: false, solo: false }],
    clips: { v1: [{ ...baseClip, ...(assetFrames === undefined ? {} : { assetFrames }) }] },
    transitions: [],
  })

  it('keeps a real media length, rounded', () => {
    expect(readProjectDocument(withAssetFrames(120) as never).clips.v1![0]!.assetFrames).toBe(120)
    expect(readProjectDocument(withAssetFrames(119.6) as never).clips.v1![0]!.assetFrames).toBe(120)
  })

  it('drops anything that is not a usable length', () => {
    for (const bad of [-5, 0, 'x', Number.POSITIVE_INFINITY, Number.NaN, null]) {
      const clip = readProjectDocument(withAssetFrames(bad) as never).clips.v1![0]!
      expect(clip.assetFrames, `assetFrames ${String(bad)}`).toBeUndefined()
    }
  })

  it('is absent on a document that never had it', () => {
    expect('assetFrames' in readProjectDocument(withAssetFrames(undefined) as never).clips.v1![0]!).toBe(false)
  })
})


describe('readProjectDocument — compound clips (PV-P1)', () => {
  interface NestedClip {
    id: string
    type: 'compound'
    startFrame: number
    durationFrames: number
    compound: { project: { fps?: number; stage: { width: number; height: number }; tracks: unknown[]; clips: Record<string, unknown[]>; transitions: unknown[] } }
  }

  /** A stored compound clip holding a project `depth` levels of nesting. */
  const nested = (depth: number): NestedClip => ({
    id: `c${depth}`,
    type: 'compound',
    startFrame: 0,
    durationFrames: 30,
    compound: {
      project: {
        fps: 30,
        stage: { width: 640, height: 360 },
        tracks: [{ id: 'nv', kind: 'video', name: `NV${depth}` }],
        clips: { nv: depth > 1 ? [nested(depth - 1)] : [] },
        transitions: [],
      },
    },
  })

  /** A document whose first video track holds `clip`. */
  const withClip = (clip: unknown, extra: Record<string, unknown> = {}) =>
    doc({
      version: 4,
      tracks: [{ id: 'v', kind: 'video', name: 'V1' }],
      clips: { v: [clip] },
      ...extra,
    })

  it('reads a compound and keeps its nested project', () => {
    const project = readProjectDocument(withClip(nested(1)))
    expect(project.version).toBe(4)
    const clip = project.clips.v![0]!
    expect(clip.type).toBe('compound')
    expect(clip.compound!.project.stage).toEqual({ width: 640, height: 360 })
    expect(clip.compound!.project.fps).toBe(30)
  })

  it('accepts four levels and refuses five', () => {
    expect(readProjectDocument(withClip(nested(4))).clips.v![0]!.compound).toBeDefined()
    let error: unknown
    try {
      readProjectDocument(withClip(nested(5)))
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(ProjectDocumentError)
    expect((error as ProjectDocumentError).code).toBe('unreadable')
    expect((error as Error).message).toContain('nested deeper than 4')
  })

  it('forces the nested frame rate to the parent\'s', () => {
    const sixty = nested(1)
    sixty.compound.project.fps = 60
    expect(readProjectDocument(withClip(sixty)).clips.v![0]!.compound!.project.fps).toBe(30)

    const none = nested(1)
    delete (none.compound.project as { fps?: number }).fps
    expect(readProjectDocument(withClip(none)).clips.v![0]!.compound!.project.fps).toBe(30)
  })

  it('refuses a compound with no nested timeline', () => {
    expect(() => readProjectDocument(withClip({ id: 'x', type: 'compound', startFrame: 0, durationFrames: 30 }))).toThrow(
      /has no nested timeline/,
    )
  })

  it('recurses the validation into the nested project', () => {
    const bad = nested(1)
    bad.compound.project.clips.nv = [{ id: 'n', type: 'hologram', startFrame: 0, durationFrames: 5 }]
    expect(() => readProjectDocument(withClip(bad))).toThrow(ProjectDocumentError)
  })

  it('stamps version 4, and 4 wins over an earlier generator', () => {
    expect(documentVersionFor({ clips: { t: [{ type: 'compound' } as never] } })).toBe(4)
    expect(
      documentVersionFor({ clips: { t: [{ type: 'generator' } as never, { type: 'compound' } as never] } }),
    ).toBe(4)
    // A generator on its own is unchanged at 3.
    expect(documentVersionFor({ clips: { t: [{ type: 'generator' } as never] } })).toBe(3)
  })
})

describe('readProjectDocument — composition (PV-P7)', () => {
  it('round-trips props, bindings and values', () => {
    const composition = {
      props: [
        { name: 'title', type: 'text', label: 'Title', default: 'Hello' },
        { name: 'accent', type: 'color', label: 'Accent', default: '#ffcc00' },
        { name: 'style', type: 'enum', label: 'Style', default: 'bold', options: ['bold', 'light'] },
      ],
      bindings: [
        { clipId: 'c1', path: 'text', prop: 'title' },
        { clipId: 'cmp/c9', path: 'shapeFill', prop: 'accent', template: undefined },
      ],
      values: { title: 'Hi' },
    }
    const project = readProjectDocument(doc({ composition }))
    expect(project.composition).toEqual({
      props: [
        { name: 'title', type: 'text', label: 'Title', default: 'Hello' },
        { name: 'accent', type: 'color', label: 'Accent', default: '#ffcc00' },
        { name: 'style', type: 'enum', label: 'Style', default: 'bold', options: ['bold', 'light'] },
      ],
      bindings: [
        { clipId: 'c1', path: 'text', prop: 'title' },
        { clipId: 'cmp/c9', path: 'shapeFill', prop: 'accent' },
      ],
      values: { title: 'Hi' },
    })
  })

  it('a document without composition reads to an object without it', () => {
    const project = readProjectDocument(doc())
    expect('composition' in project).toBe(false)
  })

  it('drops malformed props, bindings and values while keeping the rest', () => {
    const composition = {
      props: [
        { name: '1x', type: 'text', label: 'Bad name', default: 'x' },
        { name: 'weird', type: 'vector', label: 'Bad type', default: 'x' },
        { name: 'dup', type: 'text', label: 'First', default: 'first' },
        { name: 'dup', type: 'text', label: 'Second (dropped)', default: 'second' },
        { name: 'mode', type: 'enum', label: 'No options', default: 'x' },
        { name: 'size', type: 'number', label: 'Size', default: 5, min: 0, max: 10, evil: 1 },
      ],
      bindings: [
        { clipId: 'c1', path: 'text', prop: 'mode' }, // prop was dropped
        { clipId: 'c1', path: 'startFrame', prop: 'size' }, // structural field
        { clipId: '', path: 'text', prop: 'size' }, // bad clip path
        { clipId: 'c1', path: 'text', prop: 'size' }, // the one survivor
      ],
      values: { size: 'big', ghost: 5 },
    }
    const project = readProjectDocument(doc({ composition }))
    expect(project.composition!.props).toEqual([
      { name: 'dup', type: 'text', label: 'First', default: 'first' },
      { name: 'size', type: 'number', label: 'Size', default: 5, min: 0, max: 10 },
    ])
    expect(project.composition!.bindings).toEqual([{ clipId: 'c1', path: 'text', prop: 'size' }])
    expect(project.composition).not.toHaveProperty('values')
  })

  it('drops the whole composition when every prop is invalid', () => {
    const composition = { props: [{ name: '1x', type: 'text', label: 'Bad', default: 'x' }], bindings: [] }
    const project = readProjectDocument(doc({ composition }))
    expect('composition' in project).toBe(false)
  })

  it('does not change the document version', () => {
    const composition = { props: [{ name: 'title', type: 'text', label: 'Title', default: 'Hi' }], bindings: [] }
    expect(readProjectDocument(doc({ version: 3, composition })).version).toBe(
      readProjectDocument(doc({ version: 3 })).version,
    )
  })

  it('keeps a composition inside a nested compound project (PV-P1a)', () => {
    const nestedComposition = {
      props: [{ name: 'label', type: 'text', label: 'Label', default: 'Hi' }],
      bindings: [{ clipId: 'inner', path: 'text', prop: 'label' }],
    }
    const compoundClip = {
      id: 'cmp1',
      type: 'compound',
      startFrame: 0,
      durationFrames: 30,
      compound: {
        project: {
          fps: 30,
          stage: { width: 640, height: 360 },
          tracks: [{ id: 'nv', kind: 'video', name: 'NV' }],
          clips: {
            nv: [{ id: 'inner', type: 'text', name: 'inner', startFrame: 0, durationFrames: 10, content: 'x' }],
          },
          transitions: [],
          composition: nestedComposition,
        },
      },
    }
    const project = readProjectDocument(
      doc({ version: 4, tracks: [{ id: 'v', kind: 'video', name: 'V1' }], clips: { v: [compoundClip] } }),
    )
    expect(project.clips.v![0]!.compound!.project.composition).toEqual(nestedComposition)
  })

  it('survives an engine edit that does not touch it', () => {
    const composition = {
      props: [{ name: 'title', type: 'text', label: 'Title', default: 'Hi' }],
      bindings: [{ clipId: 'c1', path: 'text', prop: 'title' }],
    }
    const project = readProjectDocument(doc({ composition }))
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
    engine.loadProject(project)
    engine.addTrack('video')
    expect(engine.getProject().composition).toEqual(project.composition)
  })
})

describe('readProjectDocument — audio markers (PV-P10b)', () => {
  it('a valid set round-trips deep-equal', () => {
    const set = {
      src: 'song.mp3',
      fps: 30,
      version: 1,
      bpm: 120,
      beats: [0, 30, 60],
      silences: [[10, 20]],
      envelopes: { level: 'AAAA', low: 'AAAA', mid: 'AAAA', high: 'AAAA' },
    }
    const project = readProjectDocument(doc({ audioMarkers: [set] }))
    expect(project.audioMarkers).toEqual([set])
  })

  it('absent or empty audioMarkers leaves no key on the project', () => {
    expect('audioMarkers' in readProjectDocument(doc())).toBe(false)
    expect('audioMarkers' in readProjectDocument(doc({ audioMarkers: [] }))).toBe(false)
  })

  it('drops an entry with no src, a non-positive fps, or a non-positive version', () => {
    const project = readProjectDocument(
      doc({
        audioMarkers: [
          { fps: 30, version: 1, beats: [], silences: [] },
          { src: 'a', fps: 0, version: 1, beats: [], silences: [] },
          { src: 'b', fps: 30, version: 0, beats: [], silences: [] },
        ],
      }),
    )
    expect('audioMarkers' in project).toBe(false)
  })

  it('sanitizes a beats list: drops non-numbers and negatives, rounds, dedupes', () => {
    const project = readProjectDocument(
      doc({ audioMarkers: [{ src: 'a', fps: 30, version: 1, beats: [3, 'x', -1, 2.6, 3], silences: [] }] }),
    )
    expect(project.audioMarkers![0].beats).toEqual([3])
  })

  it('sanitizes a silences list: drops empty/inverted ranges, sorts by start', () => {
    const project = readProjectDocument(
      doc({
        audioMarkers: [
          {
            src: 'a',
            fps: 30,
            version: 1,
            beats: [],
            silences: [
              [5, 5],
              [10, 4],
              [1, 3],
            ],
          },
        ],
      }),
    )
    expect(project.audioMarkers![0].silences).toEqual([[1, 3]])
  })

  it('drops an invalid envelopes object but keeps the rest of the set', () => {
    const project = readProjectDocument(
      doc({
        audioMarkers: [{ src: 'a', fps: 30, version: 1, beats: [1], silences: [], envelopes: { level: '???' } }],
      }),
    )
    expect(project.audioMarkers![0]).toEqual({ src: 'a', fps: 30, version: 1, beats: [1], silences: [] })
  })

  it('keeps only the later set when two entries share a src', () => {
    const project = readProjectDocument(
      doc({
        audioMarkers: [
          { src: 'a', fps: 30, version: 1, beats: [1], silences: [] },
          { src: 'a', fps: 30, version: 1, beats: [2], silences: [] },
        ],
      }),
    )
    expect(project.audioMarkers).toEqual([{ src: 'a', fps: 30, version: 1, beats: [2], silences: [] }])
  })
})

describe('readProjectDocument — sequence clips (PV-P8)', () => {
  const sequenceClip = {
    id: 'seq1',
    type: 'sequence',
    name: 'Sticker',
    startFrame: 0,
    durationFrames: 30,
    sourceStartFrame: 0,
    sourceDurationFrames: 30,
    src: 'https://cdn.example/wave.gif',
    sequence: { kind: 'animated-image', frameCount: 8, fps: 12, loop: true },
  }

  const withSequence = (clip: unknown = sequenceClip, extra: Record<string, unknown> = {}) =>
    doc({
      version: 5,
      tracks: [{ id: 'v', kind: 'video', name: 'V1' }],
      clips: { v: [clip] },
      ...extra,
    })

  it('round-trips through JSON.stringify with version 5', () => {
    const project = readProjectDocument(JSON.parse(JSON.stringify(withSequence())))
    expect(project.version).toBe(5)
    expect(project.clips.v![0]!.sequence).toEqual(sequenceClip.sequence)
  })

  it('reads a document already stamped 5', () => {
    expect(readProjectDocument(withSequence()).version).toBe(5)
  })

  it('refuses a document from a newer build than 5', () => {
    expect(() => readProjectDocument(doc({ version: PROJECT_VERSION + 1 }))).toThrow(ProjectDocumentError)
  })

  it('stamps version 5 as soon as any clip is a sequence, winning over compound', () => {
    expect(documentVersionFor({ clips: { t: [{ type: 'sequence' } as never] } })).toBe(5)
    expect(
      documentVersionFor({ clips: { t: [{ type: 'compound' } as never, { type: 'sequence' } as never] } }),
    ).toBe(5)
    // A compound alone is unchanged at 4 — sequence does not affect it.
    expect(documentVersionFor({ clips: { t: [{ type: 'compound' } as never] } })).toBe(4)
  })

  it('documentVersionFor of a project with no sequence clip is unchanged', () => {
    expect(documentVersionFor(doc() as unknown as Project)).toBe(1)
  })

  it('reads a malformed sequence kind without throwing', () => {
    const project = readProjectDocument(
      withSequence({ ...sequenceClip, sequence: { kind: 'weird', frameCount: 1, fps: 1 } }),
    )
    expect(project.clips.v![0]!.sequence).toEqual({ kind: 'weird', frameCount: 1, fps: 1 })
  })

  it('relinkProjectMedia reports an animated sequence with a blob src as missing', () => {
    const project = readProjectDocument(
      withSequence({ ...sequenceClip, src: 'blob:https://app.example/9f2c' }),
    ) as Project
    const result = relinkProjectMedia(project, [])
    expect(result.missing).toEqual([{ clipId: 'seq1', clipName: 'Sticker', kind: 'sequence', reason: 'gone' }])
  })

  it('relinkProjectMedia leaves a frames sequence (no src) out of missing', () => {
    const framesClip = {
      ...sequenceClip,
      src: undefined,
      sequence: { kind: 'frames', frameUrlTemplate: 'https://cdn.example/f/{frame}.png', frameCount: 8, fps: 12 },
    }
    const project = readProjectDocument(withSequence(framesClip)) as Project
    const result = relinkProjectMedia(project, [])
    expect(result.missing).toEqual([])
  })
})

describe('readProjectDocument — generated-component provenance (EG-P1)', () => {
  const component = {
    v: 1,
    name: 'kinetic-title',
    input: { id: 'hero', kind: 'component', component: 'kinetic-title', at: 0, duration: 3 },
    seed: 7,
    style: { energy: 'bold', camera: true, ambient: 'orbs', transition: 'wipe' },
    design: { colors: [{ name: 'accent', value: '#22c55e' }] },
  }
  const authored = {
    v: 1,
    spec: { format: { width: 1080, height: 1920, fps: 30 }, duration: 3, elements: [{ id: 'hero' }] },
    treatment: { idea: 'x', beats: ['a', 'b'] },
    seed: 7,
    model: 'm',
    createdAt: '2026-10-07T00:00:00.000Z',
  }

  /** A one-track document holding one compound clip whose nested project holds one child clip. */
  const withProvenance = (patch: { component?: unknown; partId?: unknown; authored?: unknown; childPartId?: unknown } = {}) => ({
    ...stored,
    tracks: [...stored.tracks, { id: 't-el', kind: 'elements' }],
    clips: {
      ...stored.clips,
      't-el': [
        {
          id: 'k1',
          type: 'compound',
          name: 'Kinetic title',
          startFrame: 0,
          durationFrames: 90,
          partId: 'partId' in patch ? patch.partId : 'hero',
          component: 'component' in patch ? patch.component : component,
          compound: {
            project: {
              id: 'nested',
              fps: 30,
              stage: { width: 1080, height: 1920 },
              version: 1,
              tracks: [{ id: 'n-t', kind: 'elements' }],
              clips: {
                'n-t': [
                  {
                    id: 'z1',
                    type: 'text',
                    name: 'word',
                    startFrame: 0,
                    durationFrames: 30,
                    content: 'Hi',
                    partId: 'childPartId' in patch ? patch.childPartId : 'hero-word-0',
                  },
                ],
              },
              transitions: [],
            },
          },
        },
      ],
    },
    authored: 'authored' in patch ? patch.authored : authored,
  })

  const readK = (d: unknown) => {
    const project = readProjectDocument(d)
    return { project, clip: project.clips['t-el'][0] }
  }

  it('valid component, partId and authored survive a JSON round trip, nested children keep partId', () => {
    const { project, clip } = readK(JSON.parse(JSON.stringify(withProvenance())))
    expect(clip.component).toEqual(component)
    expect(clip.partId).toBe('hero')
    expect(clip.compound!.project.clips['n-t'][0].partId).toBe('hero-word-0')
    expect(project.authored).toEqual(authored)
  })

  it('component with a wrong v is dropped silently; the clip and project still read', () => {
    const { project, clip } = readK(withProvenance({ component: { ...component, v: 2 } }))
    expect(clip.component).toBeUndefined()
    expect(clip.partId).toBe('hero')
    expect(project.authored).toEqual(authored)
  })

  it('component with a non-object input is dropped silently', () => {
    expect(readK(withProvenance({ component: { ...component, input: 'nope' } })).clip.component).toBeUndefined()
    expect(readK(withProvenance({ component: { ...component, input: [] } })).clip.component).toBeUndefined()
  })

  it('component with a non-finite seed is dropped silently', () => {
    expect(readK(withProvenance({ component: { ...component, seed: Number.NaN } })).clip.component).toBeUndefined()
    expect(readK(withProvenance({ component: { ...component, seed: Number.POSITIVE_INFINITY } })).clip.component).toBeUndefined()
    expect(readK(withProvenance({ component: { ...component, seed: '7' } })).clip.component).toBeUndefined()
  })

  it('component with an empty name, a bad style or a bad design is dropped silently', () => {
    expect(readK(withProvenance({ component: { ...component, name: '' } })).clip.component).toBeUndefined()
    expect(readK(withProvenance({ component: { ...component, style: { camera: true } } })).clip.component).toBeUndefined()
    expect(readK(withProvenance({ component: { ...component, design: 'x' } })).clip.component).toBeUndefined()
  })

  it('a partId that is a number, empty, or over 200 characters is dropped; the clip still reads', () => {
    for (const partId of [12, '', 'x'.repeat(201)]) {
      const { clip } = readK(withProvenance({ partId }))
      expect(clip.partId).toBeUndefined()
      expect(clip.id).toBe('k1')
    }
    expect(readK(withProvenance({ partId: 'x'.repeat(200) })).clip.partId).toHaveLength(200)
  })

  it('a nested child with a malformed partId is dropped too', () => {
    const { clip } = readK(withProvenance({ childPartId: 5 }))
    expect(clip.compound!.project.clips['n-t'][0].partId).toBeUndefined()
  })

  it('authored with a wrong v, a non-object spec, a bad seed or a bad createdAt is dropped; the project still reads', () => {
    for (const bad of [
      { ...authored, v: 2 },
      { ...authored, spec: 'nope' },
      { ...authored, seed: Number.NaN },
      { ...authored, createdAt: 5 },
      'nope',
    ]) {
      const { project } = readK(withProvenance({ authored: bad }))
      expect(project.authored).toBeUndefined()
      expect(project.clips['t-el']).toHaveLength(1)
    }
  })

  describe('authored.assets (SVG-2)', () => {
    const asset = (n: number, over: Record<string, unknown> = {}) => ({
      name: `mark-${n}`,
      url: `https://cdn.example.com/u/mark-${n}.svg`,
      source: 'drawn',
      model: 'm',
      ...over,
    })

    it('keeps well-formed assets, with their credit', () => {
      const credit = { provider: 'iconify', set: 'mdi', name: 'home', licence: 'Apache-2.0', pageUrl: 'https://icon-sets.iconify.design/mdi/home/', author: 'x' }
      const given = [asset(1), asset(2, { source: 'found', credit })]
      const { project } = readK(withProvenance({ authored: { ...authored, assets: given } }))
      expect(project.authored!.assets).toEqual(given)
    })

    it('drops an http:// entry and keeps the record', () => {
      const { project } = readK(
        withProvenance({ authored: { ...authored, assets: [asset(1, { url: 'http://cdn.example.com/a.svg' }), asset(2)] } }),
      )
      expect(project.authored).toBeDefined()
      expect(project.authored!.assets!.map((a) => a.name)).toEqual(['mark-2'])
    })

    it('drops the 13th entry', () => {
      const many = Array.from({ length: 13 }, (_, i) => asset(i))
      const { project } = readK(withProvenance({ authored: { ...authored, assets: many } }))
      expect(project.authored!.assets).toHaveLength(12)
      expect(project.authored!.assets!.some((a) => a.name === 'mark-12')).toBe(false)
    })

    it('drops a long name, a long url and an unknown source; the record survives', () => {
      const bad = [
        asset(1, { name: 'n'.repeat(41) }),
        asset(2, { url: `https://x.test/${'a'.repeat(2000)}` }),
        asset(3, { source: 'uploaded' }),
        'nope',
      ]
      const { project } = readK(withProvenance({ authored: { ...authored, assets: bad } }))
      expect(project.authored).toBeDefined()
      expect(project.authored!.assets).toBeUndefined()
      expect(project.authored!.spec).toEqual(authored.spec)
    })

    it('a record without assets reads without the key', () => {
      expect('assets' in readK(withProvenance()).project.authored!).toBe(false)
    })
  })

  it('authored over 512 KB of JSON is dropped silently; just under it is kept', () => {
    const fat = { ...authored, spec: { ...authored.spec, blob: 'x'.repeat(512 * 1024) } }
    const { project, clip } = readK(withProvenance({ authored: fat }))
    expect(project.authored).toBeUndefined()
    expect(clip.component).toEqual(component)
    const lean = { ...authored, spec: { ...authored.spec, blob: 'x'.repeat(400 * 1024) } }
    expect(readK(withProvenance({ authored: lean })).project.authored).toBeDefined()
  })

  it('authored keeps treatment only when JSON-serialisable', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    // A cycle makes the whole record unserialisable, so it is dropped rather than half-kept.
    expect(readK(withProvenance({ authored: { ...authored, treatment: cyclic } })).project.authored).toBeUndefined()
    const { treatment: _t, ...noTreatment } = authored
    expect(readK(withProvenance({ authored: noTreatment })).project.authored).toEqual(noTreatment)
  })

  it('a project WITHOUT these fields reads exactly as it did before EG-P1', () => {
    // Literal captured from the pre-change reader (also compared against the
    // HEAD copy of projectDocument.ts with toStrictEqual before the edit landed).
    expect(readProjectDocument(doc())).toStrictEqual({
      id: 'p1',
      fps: 30,
      stage: { width: 1920, height: 1080 },
      tracks: [
        {
          id: 't-video',
          name: 'Video',
          kind: 'video',
          order: 0,
          height: 36,
          locked: false,
          disabled: false,
          muted: false,
          solo: false,
          volume: 1,
          protected: false,
          pinned: undefined,
        },
      ],
      clips: {
        't-video': [
          {
            id: 'c1',
            trackId: 't-video',
            type: 'video',
            name: 'Opening shot',
            startFrame: 0,
            durationFrames: 60,
            sourceStartFrame: 0,
            sourceDurationFrames: 60,
            src: 'https://cdn.example/a.mp4',
            assetId: 'gone-with-the-last-session',
          },
        ],
      },
      transitions: [],
      version: 1,
      masterVolume: 0.8,
    })
  })

  it('documentVersionFor and the read version are unchanged by component / partId / authored', () => {
    const withIt = readProjectDocument(withProvenance())
    const without = readProjectDocument(
      withProvenance({ component: undefined, partId: undefined, authored: undefined, childPartId: undefined }),
    )
    expect(withIt.authored).toBeDefined()
    expect(without.authored).toBeUndefined()
    expect(documentVersionFor(withIt)).toBe(documentVersionFor(without))
    expect(withIt.version).toBe(without.version)
    expect(withIt.version).toBe(documentVersionFor(withIt))
    expect(withIt.version).toBeLessThanOrEqual(PROJECT_VERSION)
  })

  it('plain clips carrying component / partId / authored read at the same version as without them', () => {
    // A compound clip raises the document version on its own, which would mask a
    // bump caused by provenance; plain clips keep the comparison honest.
    const plainWith = doc({
      clips: { 't-video': [{ ...stored.clips['t-video'][0], partId: 'a', component }] },
      authored,
    })
    const plainWithout = doc()
    const withIt = readProjectDocument(plainWith)
    const without = readProjectDocument(plainWithout)
    expect(withIt.authored).toEqual(authored)
    expect(withIt.clips['t-video'][0].component).toEqual(component)
    expect(withIt.version).toBe(without.version)
    expect(documentVersionFor(withIt)).toBe(documentVersionFor(without))
    expect(withIt.version).toBe(1)
  })
})

describe('clip.media local-file reference (LM-P1)', () => {
  const ID = 'local:' + 'ab'.repeat(32)
  const media = (extra: Record<string, unknown> = {}) => ({
    v: 1,
    id: ID,
    name: 'Beach.mp4',
    byteSize: 1234,
    lastModified: 1700000000000,
    kind: 'video',
    ...extra,
  })
  const withMedia = (m: unknown, clipExtra: Record<string, unknown> = {}) =>
    doc({
      clips: { 't-video': [{ ...stored.clips['t-video'][0], src: 'blob:https://app.example/9f2c', media: m, ...clipExtra }] },
    })
  const read = (m: unknown, clipExtra: Record<string, unknown> = {}) =>
    readProjectDocument(withMedia(m, clipExtra)).clips['t-video'][0]

  it('keeps a valid reference, folder included', () => {
    const m = media({ mime: 'video/mp4', folder: { name: 'Footage', path: ['day1', 'Beach.mp4'] } })
    expect(read(m).media).toEqual(m)
  })

  it('does not bump the document version', () => {
    expect(documentVersionFor(readProjectDocument(withMedia(media())))).toBe(documentVersionFor(readProjectDocument(doc())))
  })

  it.each([
    ['wrong v', { v: 2 }],
    ['id not a fingerprint', { id: 'local:abc' }],
    ['id uppercase hex', { id: 'local:' + 'AB'.repeat(32) }],
    ['name too long', { name: 'x'.repeat(513) }],
    ['negative byteSize', { byteSize: -1 }],
    ['NaN lastModified', { lastModified: Number.NaN }],
    ['unknown kind', { kind: 'sequence' }],
    ['mime too long', { mime: 'x'.repeat(129) }],
    ['mime not a string', { mime: 5 }],
    ['folder path empty', { folder: { name: 'F', path: [] } }],
    ['folder path has ..', { folder: { name: 'F', path: ['a', '..', 'b'] } }],
    ['folder path has .', { folder: { name: 'F', path: ['.'] } }],
    ['folder path has empty segment', { folder: { name: 'F', path: ['a', ''] } }],
    ['folder path too deep', { folder: { name: 'F', path: Array.from({ length: 65 }, (_, i) => 'd' + i) } }],
    ['folder name not a string', { folder: { name: 1, path: ['a'] } }],
  ])('drops a reference with %s, and keeps the clip', (_label, bad) => {
    const clip = read(media(bad))
    expect(clip.id).toBe('c1')
    expect('media' in clip).toBe(false)
  })

  it('drops a reference that is not an object', () => {
    expect('media' in read('local:whatever')).toBe(false)
  })

  it('drops a reference on a clip that is not a media clip', () => {
    const project = readProjectDocument(
      doc({
        tracks: [...stored.tracks, { id: 't-text', kind: 'elements' }],
        clips: {
          ...stored.clips,
          't-text': [{ id: 'c2', type: 'text', name: 'T', startFrame: 0, durationFrames: 30, content: 'Hi', media: media() }],
        },
      }),
    )
    expect('media' in project.clips['t-text'][0]).toBe(false)
  })
})

describe('relinkProjectMedia — local media (LM-P1)', () => {
  const ID = 'local:' + 'cd'.repeat(32)
  const ref = { v: 1 as const, id: ID, name: 'Beach.mp4', byteSize: 9, lastModified: 1, kind: 'video' as const }
  const OLD = 'blob:https://app.example/old'
  const FRESH = 'blob:https://app.example/fresh'
  const withRef = (media: unknown = ref, audioMarkers?: unknown[]) =>
    readProjectDocument(
      doc({
        clips: { 't-video': [{ ...stored.clips['t-video'][0], src: OLD, assetId: undefined, media }] },
        ...(audioMarkers ? { audioMarkers } : {}),
      }),
    ) as Project
  const set = (src: string) => ({ src, fps: 30, version: 1, beats: [0, 15], silences: [] })

  it('re-mints a clip by media id', () => {
    const result = relinkProjectMedia(withRef(), [], { remint: new Map([[ID, FRESH]]) })
    expect(result.project.clips['t-video'][0].src).toBe(FRESH)
    expect(result.project.clips['t-video'][0].media).toEqual(ref)
    expect(result.missing).toEqual([])
  })

  it('points a re-minted clip at the library asset holding the new src', () => {
    const result = relinkProjectMedia(withRef(), [{ id: 'a1', src: FRESH }], { remint: new Map([[ID, FRESH]]) })
    expect(result.project.clips['t-video'][0].assetId).toBe('a1')
    expect(result.relinked).toBe(1)
  })

  it('keeps beat markers after re-mint', () => {
    const before = withRef(ref, [set(OLD), set('https://cdn.example/other.mp3')])
    const result = relinkProjectMedia(before, [], { remint: new Map([[ID, FRESH]]) })
    expect(result.project.audioMarkers!.map((s) => s.src)).toEqual([FRESH, 'https://cdn.example/other.mp3'])
    expect(result.project.audioMarkers![0].beats).toEqual([0, 15])
  })

  it('reports a blob clip with a reference as reconnectable, carrying the media id', () => {
    const result = relinkProjectMedia(withRef(), [])
    expect(result.missing).toEqual([
      { clipId: 'c1', clipName: 'Opening shot', kind: 'video', reason: 'reconnectable', mediaId: ID },
    ])
  })

  it('reports a blob clip without a reference as gone', () => {
    const result = relinkProjectMedia(withRef(null), [])
    expect(result.missing).toEqual([{ clipId: 'c1', clipName: 'Opening shot', kind: 'video', reason: 'gone' }])
  })

  it('stays reconnectable when the remint map has no entry for it', () => {
    const result = relinkProjectMedia(withRef(), [], { remint: new Map([['local:' + 'ee'.repeat(32), FRESH]]) })
    expect(result.missing).toHaveLength(1)
    expect(result.missing[0].reason).toBe('reconnectable')
  })

  it('returns the same object when nothing was re-minted or repaired', () => {
    const before = withRef()
    expect(relinkProjectMedia(before, [], { remint: new Map() }).project).toBe(before)
  })

  it('returns the same object when the fresh src is already the clip src', () => {
    const before = withRef()
    const result = relinkProjectMedia(before, [], { remint: new Map([[ID, OLD]]) })
    expect(result.project).toBe(before)
    expect(result.missing).toEqual([])
  })
  describe('inside a compound clip (LM-P3)', () => {
    const wrap = (inner: Project, extra: Partial<Project> = {}): Project => {
      const base = withRef(null)
      return {
        ...base,
        ...extra,
        clips: {
          't-video': [
            {
              ...base.clips['t-video'][0],
              id: 'comp',
              type: 'compound',
              src: undefined,
              assetId: undefined,
              compound: { project: inner },
            } as unknown as Project['clips'][string][number],
          ],
        },
      }
    }
    const nestedOf = (p: Project) => p.clips['t-video'][0].compound!.project

    it('re-mints a nested clip by media id', () => {
      const outer = wrap(withRef())
      const result = relinkProjectMedia(outer, [], { remint: new Map([[ID, FRESH]]) })
      expect(nestedOf(result.project).clips['t-video'][0].src).toBe(FRESH)
      expect(result.missing).toEqual([])
    })

    it('re-mints through two levels and shares the untouched parts', () => {
      const inner = withRef()
      const outer = wrap(wrap(inner))
      const result = relinkProjectMedia(outer, [], { remint: new Map([[ID, FRESH]]) })
      expect(nestedOf(nestedOf(result.project)).clips['t-video'][0].src).toBe(FRESH)
      expect(result.project).not.toBe(outer)
    })

    it('reports a nested clip as reconnectable when nothing was re-minted', () => {
      const result = relinkProjectMedia(wrap(withRef()), [])
      expect(result.missing).toEqual([
        { clipId: 'c1', clipName: 'Opening shot', kind: 'video', reason: 'reconnectable', mediaId: ID },
      ])
    })

    it('keeps the nested project\'s beat markers after re-mint', () => {
      const outer = wrap(withRef(ref, [set(OLD)]))
      const result = relinkProjectMedia(outer, [], { remint: new Map([[ID, FRESH]]) })
      expect(nestedOf(result.project).audioMarkers![0].src).toBe(FRESH)
    })

    it('returns the same object when nothing inside changed', () => {
      const outer = wrap(withRef(null))
      const result = relinkProjectMedia(outer, [], { remint: new Map([[ID, FRESH]]) })
      expect(result.project).toBe(outer)
      expect(nestedOf(result.project)).toBe(nestedOf(outer))
    })
  })
})

describe('readProjectDocument: Clip.scene (CMP-EDIT-3)', () => {
  const withScene = (scene: unknown) =>
    doc({ clips: { 't-video': [{ ...stored.clips['t-video'][0], scene }] } })
  const good = { v: 1, html: '<h1>hi</h1>', css: 'h1{color:red}', name: 'stat', duration: 4 }

  it('keeps a valid record and does not bump the version', () => {
    const project = readProjectDocument(withScene(good))
    expect(project.clips['t-video']![0]!.scene).toEqual(good)
    expect(documentVersionFor(project)).toBe(documentVersionFor(readProjectDocument(doc())))
  })

  it('drops a malformed or oversized record and keeps the clip', () => {
    const big = 'x'.repeat(64 * 1024 + 1)
    for (const bad of [{ ...good, v: 2 }, { ...good, html: 5 }, { ...good, css: big }, { ...good, html: big }, { ...good, duration: 0 }, 'nope', { ...good, name: null }]) {
      const clip = readProjectDocument(withScene(bad)).clips['t-video']![0]!
      expect(clip.id).toBe('c1')
      expect('scene' in clip).toBe(false)
    }
  })

  it('a clip with no scene reads exactly as before', () => {
    const clip = readProjectDocument(doc()).clips['t-video']![0]!
    expect('scene' in clip).toBe(false)
  })
})
