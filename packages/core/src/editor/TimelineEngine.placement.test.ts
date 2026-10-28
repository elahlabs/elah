import { describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'

/**
 * `placeClips` (PV-T1): the one edit behind a timeline drag, paste and
 * duplicate. Every case checks the whole layout, and every failure checks
 * that the project object is untouched — a placement is one step or nothing.
 */

function setup() {
  const engine = new TimelineEngine({
    fps: 30,
    initialTracks: [
      { kind: 'video', name: 'V1' },
      { kind: 'video', name: 'V2' },
      { kind: 'audio', name: 'A1' },
    ],
  })
  const [v1, v2, a1] = engine.getProject().tracks.map((t) => t.id) as [string, string, string]
  const clip = (trackId: string, name: string, start: number, duration: number, sourceDuration = duration) => {
    const c = engine.addClip({ trackId, type: 'video', src: `${name}.mp4`, name, startFrame: start, durationFrames: duration })
    if (sourceDuration !== duration) engine.updateClip(c.id, trackId, { sourceDurationFrames: sourceDuration })
    return c.id
  }
  const layout = (trackId: string) =>
    engine.getClipsOnTrack(trackId).map((c) => [c.name, c.startFrame, c.durationFrames] as const)
  return { engine, v1, v2, a1, clip, layout }
}

describe('placeClips — reject (the default)', () => {
  it('moves a set across tracks with offsets preserved, as one undo step', () => {
    const { engine, v1, v2, clip, layout } = setup()
    const a = clip(v1, 'a', 0, 30)
    const b = clip(v1, 'b', 40, 20)
    const before = engine.getProject()

    const r = engine.placeClips([
      { clipId: a, toTrackId: v2, startFrame: 100 },
      { clipId: b, toTrackId: v2, startFrame: 140 },
    ])

    expect(r).toEqual({ ok: true, clipIds: [a, b] })
    expect(layout(v1)).toEqual([])
    expect(layout(v2)).toEqual([['a', 100, 30], ['b', 140, 20]])
    expect(engine.getClipsOnTrack(v2).every((c) => c.trackId === v2)).toBe(true)
    expect(engine.lastHistoryDescription()).toBe('Move clips')

    engine.undo()
    expect(engine.getProject()).toBe(before)
  })

  it('refuses a landing that overlaps a clip that stays, changing nothing', () => {
    const { engine, v1, v2, clip } = setup()
    const a = clip(v1, 'a', 0, 30)
    clip(v2, 'x', 10, 30)
    const before = engine.getProject()

    const r = engine.placeClips([{ clipId: a, toTrackId: v2, startFrame: 0 }])

    expect(r).toEqual({ ok: false, reason: 'overlap', clipIds: [] })
    expect(engine.getProject()).toBe(before)
    expect(engine.lastHistoryDescription()).toBe('Add video clip') // no entry was pushed
  })

  it('lets a clip land over the space it is leaving', () => {
    const { engine, v1, clip, layout } = setup()
    const a = clip(v1, 'a', 0, 30)
    expect(engine.placeClips([{ clipId: a, toTrackId: v1, startFrame: 10 }]).ok).toBe(true)
    expect(layout(v1)).toEqual([['a', 10, 30]])
  })

  it('refuses placements that overlap one another', () => {
    const { engine, v1, v2, clip } = setup()
    const a = clip(v1, 'a', 0, 30)
    const b = clip(v1, 'b', 30, 30)
    const r = engine.placeClips([
      { clipId: a, toTrackId: v2, startFrame: 0 },
      { clipId: b, toTrackId: v2, startFrame: 20 },
    ])
    expect(r.reason).toBe('overlap')
  })

  it('names what is wrong with a malformed request', () => {
    const { engine, v1, v2, clip } = setup()
    const a = clip(v1, 'a', 0, 30)
    expect(engine.placeClips([]).reason).toBe('no-moves')
    expect(engine.placeClips([{ clipId: 'nope', toTrackId: v2, startFrame: 0 }]).reason).toBe('clip-not-found')
    expect(engine.placeClips([{ clipId: a, toTrackId: 'nope', startFrame: 0 }]).reason).toBe('track-not-found')
    expect(
      engine.placeClips([
        { clipId: a, toTrackId: v2, startFrame: 0 },
        { clipId: a, toTrackId: v2, startFrame: 50 },
      ]).reason,
    ).toBe('duplicate-clip')
  })

  it('respects locked tracks, but lets a copy be taken from one', () => {
    const { engine, v1, v2, clip, layout } = setup()
    const a = clip(v1, 'a', 0, 30)
    engine.updateTrack(v2, { locked: true })
    expect(engine.placeClips([{ clipId: a, toTrackId: v2, startFrame: 0 }]).reason).toBe('track-locked')

    engine.updateTrack(v2, { locked: false })
    engine.updateTrack(v1, { locked: true })
    expect(engine.placeClips([{ clipId: a, toTrackId: v2, startFrame: 0 }]).reason).toBe('track-locked')
    expect(engine.placeClips([{ clipId: a, toTrackId: v2, startFrame: 0 }], { copy: true }).ok).toBe(true)
    expect(layout(v1)).toEqual([['a', 0, 30]])
    expect(layout(v2)).toEqual([['a', 0, 30]])
  })

  it('clamps a negative start to frame 0', () => {
    const { engine, v1, v2, clip, layout } = setup()
    const a = clip(v1, 'a', 10, 30)
    engine.placeClips([{ clipId: a, toTrackId: v2, startFrame: -12 }])
    expect(layout(v2)).toEqual([['a', 0, 30]])
  })
})

describe('placeClips — overwrite', () => {
  it('splits a clip spanning the landing range, keeping its head and tail', () => {
    const { engine, v1, v2, clip, layout } = setup()
    const a = clip(v1, 'a', 0, 30)
    const x = clip(v2, 'x', 0, 90)

    const r = engine.placeClips([{ clipId: a, toTrackId: v2, startFrame: 30 }], { mode: 'overwrite' })

    expect(r.ok).toBe(true)
    expect(layout(v2)).toEqual([['x', 0, 30], ['a', 30, 30], ['x', 60, 30]])
    const [head, , tail] = engine.getClipsOnTrack(v2)
    expect(head!.id).toBe(x)
    expect(tail!.id).not.toBe(x)
    expect(tail!.sourceStartFrame).toBe(60)
    expect(engine.lastHistoryDescription()).toBe('Overwrite with clip')
  })

  it('trims a clip overlapping the start of the range from its head, keeping its id and content', () => {
    const { engine, v1, v2, clip, layout } = setup()
    const a = clip(v1, 'a', 0, 30)
    const y = clip(v2, 'y', 40, 60)

    engine.placeClips([{ clipId: a, toTrackId: v2, startFrame: 20 }], { mode: 'overwrite' })

    expect(layout(v2)).toEqual([['a', 20, 30], ['y', 50, 50]])
    const trimmed = engine.findClip(y)!.clip
    expect(trimmed.sourceStartFrame).toBe(10)
  })

  it('shortens a clip overlapping the end of the range and removes clips it covers', () => {
    const { engine, v1, v2, clip, layout } = setup()
    const a = clip(v1, 'a', 0, 40)
    clip(v2, 'p', 0, 20)
    clip(v2, 'q', 25, 10)

    engine.placeClips([{ clipId: a, toTrackId: v2, startFrame: 10 }], { mode: 'overwrite' })

    expect(layout(v2)).toEqual([['p', 0, 10], ['a', 10, 40]])
  })

  it('moves a head-trimmed clip’s keyframes back with its content', () => {
    const { engine, v1, v2, clip } = setup()
    const a = clip(v1, 'a', 0, 30)
    const y = clip(v2, 'y', 40, 60)
    engine.updateClip(y, v2, {
      keyframes: {
        channels: {
          opacity: {
            source: { kind: 'keyframes' },
            keys: [
              { id: 'k0', frame: 0, value: 0, easing: 'linear' },
              { id: 'k1', frame: 30, value: 1, easing: 'linear' },
            ],
          },
        },
      },
    })

    engine.placeClips([{ clipId: a, toTrackId: v2, startFrame: 20 }], { mode: 'overwrite' })

    const keys = engine.findClip(y)!.clip.keyframes!.channels.opacity!.keys.map((k) => k.frame)
    expect(keys).toEqual([-10, 20])
  })
})

describe('placeClips — insert', () => {
  it('splits a clip straddling the insertion point and pushes the rest right', () => {
    const { engine, v1, v2, clip, layout } = setup()
    const a = clip(v1, 'a', 0, 30)
    clip(v2, 'y', 0, 60)
    clip(v2, 'z', 60, 30)

    const r = engine.placeClips([{ clipId: a, toTrackId: v2, startFrame: 30 }], { mode: 'insert' })

    expect(r.ok).toBe(true)
    expect(layout(v2)).toEqual([['y', 0, 30], ['a', 30, 30], ['y', 60, 30], ['z', 90, 30]])
    expect(engine.lastHistoryDescription()).toBe('Insert clip')
  })

  it('inserting at a cut splits nothing', () => {
    const { engine, v1, v2, clip, layout } = setup()
    const a = clip(v1, 'a', 0, 30)
    clip(v2, 'y', 0, 60)
    clip(v2, 'z', 60, 30)

    engine.placeClips([{ clipId: a, toTrackId: v2, startFrame: 60 }], { mode: 'insert' })

    expect(layout(v2)).toEqual([['y', 0, 60], ['a', 60, 30], ['z', 90, 30]])
  })

  it('opens room for a whole group, gaps included', () => {
    const { engine, v1, v2, clip, layout } = setup()
    const a = clip(v1, 'a', 0, 10)
    const b = clip(v1, 'b', 20, 10)
    clip(v2, 'z', 50, 30)

    engine.placeClips(
      [
        { clipId: a, toTrackId: v2, startFrame: 50 },
        { clipId: b, toTrackId: v2, startFrame: 70 },
      ],
      { mode: 'insert' },
    )

    expect(layout(v2)).toEqual([['a', 50, 10], ['b', 70, 10], ['z', 80, 30]])
  })
})

describe('placeClips — copy', () => {
  it('places copies with new ids and leaves the originals', () => {
    const { engine, v1, v2, clip, layout } = setup()
    const a = clip(v1, 'a', 0, 30)

    const r = engine.placeClips([{ clipId: a, toTrackId: v2, startFrame: 5 }], { copy: true })

    expect(r.ok).toBe(true)
    expect(r.clipIds[0]).not.toBe(a)
    expect(layout(v1)).toEqual([['a', 0, 30]])
    expect(layout(v2)).toEqual([['a', 5, 30]])
    expect(engine.lastHistoryDescription()).toBe('Duplicate clip')
  })

  it('keeps copied link partners linked to each other under a new id, and unlinks a lone copy', () => {
    const { engine, v1, a1, clip } = setup()
    const video = clip(v1, 'video', 0, 30)
    const audio = engine.addClip({ trackId: a1, type: 'audio', src: 'a.wav', name: 'audio', startFrame: 0, durationFrames: 30 }).id
    const link = engine.linkClips([video, audio])!

    const pair = engine.placeClips(
      [
        { clipId: video, toTrackId: v1, startFrame: 100 },
        { clipId: audio, toTrackId: a1, startFrame: 100 },
      ],
      { copy: true },
    )
    const copies = pair.clipIds.map((id) => engine.findClip(id)!.clip.linkId)
    expect(copies[0]).toBeDefined()
    expect(copies[0]).toBe(copies[1])
    expect(copies[0]).not.toBe(link)

    const lone = engine.placeClips([{ clipId: video, toTrackId: v1, startFrame: 200 }], { copy: true })
    expect(engine.findClip(lone.clipIds[0]!)!.clip.linkId).toBeUndefined()
    expect(engine.findClip(video)!.clip.linkId).toBe(link)
  })
})

describe('placeClips — transitions', () => {
  it('carries a transition whose two clips move together', () => {
    const { engine, v1, clip } = setup()
    const a = clip(v1, 'a', 0, 30)
    const b = clip(v1, 'b', 30, 30)
    const t = engine.addTransition({ fromClipId: a, toClipId: b, trackId: v1, kind: 'fade', durationFrames: 10 })!

    engine.placeClips([
      { clipId: a, toTrackId: v1, startFrame: 100 },
      { clipId: b, toTrackId: v1, startFrame: 130 },
    ])

    const moved = engine.getProject().transitions.find((x) => x.id === t.id)
    expect(moved?.startFrame).toBe(t.startFrame + 100)
  })

  it('drops a transition whose clips are pulled apart or onto different tracks', () => {
    const { engine, v1, v2, clip } = setup()
    const a = clip(v1, 'a', 0, 30)
    const b = clip(v1, 'b', 30, 30)
    engine.addTransition({ fromClipId: a, toClipId: b, trackId: v1, kind: 'fade', durationFrames: 10 })
    engine.placeClips([{ clipId: b, toTrackId: v2, startFrame: 30 }])
    expect(engine.getProject().transitions).toEqual([])
  })
})
