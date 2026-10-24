import { describe, expect, it } from 'vitest'
import { nestProject, unnestProject, type CompoundEditResult } from './compound'
import type { Clip, Project, Track, TrackKind, Transition } from '../types'

/**
 * Nest and unnest (PV-P1a-3).
 *
 * Both are pure and both refuse rather than approximate, and that is the whole
 * point of these tests. A nest that quietly dropped a matte, a link partner or a
 * lane's z position would produce a document that renders correctly and *is*
 * wrong; the only moment a user could notice is when they opened the compound,
 * which is too late to be a useful error. So each rule has a test that shows the
 * refusal, and the round trip has a test that shows the timeline coming back
 * whole.
 */

const STAGE = { width: 1280, height: 720 }

const track = (id: string, kind: TrackKind, order: number, over: Partial<Track> = {}): Track =>
  ({
    id,
    kind,
    name: id,
    order,
    height: 54,
    locked: false,
    disabled: false,
    muted: false,
    solo: false,
    volume: 1,
    protected: false,
    ...over,
  }) as Track

const clip = (
  id: string,
  trackId: string,
  type: Clip['type'],
  startFrame: number,
  durationFrames: number,
  over: Partial<Clip> = {},
): Clip =>
  ({
    id,
    trackId,
    type,
    name: id,
    startFrame,
    durationFrames,
    sourceStartFrame: 0,
    sourceDurationFrames: durationFrames,
    volume: 1,
    opacity: 1,
    locked: false,
    disabled: false,
    ...over,
  }) as Clip

function projectOf(tracks: Track[], clips: Clip[], over: Partial<Project> = {}): Project {
  const byTrack: Record<string, Clip[]> = {}
  for (const t of tracks) byTrack[t.id] = []
  for (const c of clips) (byTrack[c.trackId] ??= []).push(c)
  return {
    id: 'p',
    version: 1,
    fps: 30,
    stage: { ...STAGE },
    tracks,
    clips: byTrack,
    transitions: [],
    ...over,
  } as Project
}

/** The two-lane project the ticket's own example describes. */
function basic(): Project {
  return projectOf(
    [track('v1', 'video', 0), track('v2', 'video', 1)],
    [
      clip('a', 'v1', 'video', 10, 20),
      clip('b', 'v2', 'video', 20, 30),
      clip('keep', 'v1', 'video', 60, 10),
    ],
  )
}

/** Narrow a result to its data, failing the test with the refusal message. */
function expectOk<T>(result: CompoundEditResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.data
}

function expectRefused<T>(result: CompoundEditResult<T>, code?: string): string {
  if (result.ok) throw new Error('expected a refusal, got ok')
  if (code) expect(result.error.code).toBe(code)
  return result.error.message
}

const find = (p: Project, id: string): Clip | undefined =>
  Object.values(p.clips)
    .flat()
    .find((c) => c.id === id)

describe('nestProject', () => {
  it('replaces the selection with one compound spanning its own extent', () => {
    const before = basic()
    const { project, compoundId } = expectOk(nestProject(before, ['a', 'b']))

    const compound = find(project, compoundId)!
    expect(compound.type).toBe('compound')
    // [10,30) and [20,50) -> the compound shows [10,50).
    expect(compound.startFrame).toBe(10)
    expect(compound.durationFrames).toBe(40)
    // The topmost selected lane is where the selection composited.
    expect(compound.trackId).toBe('v2')
    // The clips are gone from the parent, and nothing else moved.
    expect(find(project, 'a')).toBeUndefined()
    expect(find(project, 'b')).toBeUndefined()
    expect(find(project, 'keep')!.startFrame).toBe(60)
    // A document holding a compound is version 4.
    expect(project.version).toBe(4)
  })

  it('starts the nested timeline at zero and leaves clip-local time alone', () => {
    const before = projectOf(
      [track('v1', 'video', 0), track('v2', 'video', 1)],
      [
        clip('a', 'v1', 'video', 10, 20, { sourceStartFrame: 7, sourceDurationFrames: 400 }),
        clip('b', 'v2', 'video', 20, 30, { sourceStartFrame: 0, sourceDurationFrames: 90 }),
      ],
    )
    const { project, compoundId } = expectOk(nestProject(before, ['a', 'b']))
    const child = find(project, compoundId)!.compound!.project

    expect(child.stage).toEqual(STAGE)
    expect(child.fps).toBe(30)
    const a = find(child, 'a')!
    const b = find(child, 'b')!
    // Shifted onto the nested timeline's own frames...
    expect(a.startFrame).toBe(0)
    expect(b.startFrame).toBe(10)
    // ...and the media's own window is exactly as authored.
    expect(a.sourceStartFrame).toBe(7)
    expect(a.sourceDurationFrames).toBe(400)
    expect(b.sourceStartFrame).toBe(0)
  })

  it('keeps the nested ids, track order and internal transitions', () => {
    const before = projectOf(
      [track('v1', 'video', 0), track('v2', 'video', 1)],
      [
        clip('a', 'v1', 'video', 10, 20),
        clip('b', 'v1', 'video', 30, 20),
        clip('c', 'v2', 'video', 12, 40),
      ],
      {
        transitions: [
          { id: 'tr', kind: 'fade', fromClipId: 'a', toClipId: 'b', trackId: 'v1', startFrame: 25, durationFrames: 10 },
        ] as Transition[],
      },
    )
    const { project, compoundId } = expectOk(nestProject(before, ['a', 'b', 'c']))
    const child = find(project, compoundId)!.compound!.project

    // The child's lanes are the parent's lanes, in the parent's order.
    expect(child.tracks.map((t) => t.id)).toEqual(['v1', 'v2'])
    expect(child.tracks.map((t) => t.order)).toEqual([0, 1])
    expect(find(child, 'a')!.trackId).toBe('v1')
    // The transition moved inside with them, shifted onto the nested timeline.
    expect(child.transitions).toHaveLength(1)
    expect(child.transitions[0]!.id).toBe('tr')
    expect(child.transitions[0]!.startFrame).toBe(15)
    // …and is not in the parent any more.
    expect(project.transitions).toHaveLength(0)
  })

  it('carries a wholly internal track group and leaves a mixed one alone', () => {
    const tracks = [track('v1', 'video', 0), track('v2', 'video', 1), track('v3', 'video', 2)]
    const before = projectOf(
      tracks,
      [clip('a', 'v1', 'video', 0, 30), clip('b', 'v2', 'video', 0, 30), clip('c', 'v3', 'video', 0, 30)],
      {
        trackGroups: [
          { id: 'g-inner', name: 'inner', trackIds: ['v1', 'v2'], collapsed: false },
          { id: 'g-outer', name: 'outer', trackIds: ['v2', 'v3'], collapsed: true },
        ],
      },
    )
    const { project, compoundId } = expectOk(nestProject(before, ['a', 'b']))
    const child = find(project, compoundId)!.compound!.project

    expect(child.trackGroups!.map((g) => g.id)).toEqual(['g-inner'])
    expect(project.trackGroups!.map((g) => g.id)).toEqual(['g-outer'])
  })

  it('refuses a selection that reaches outside itself', () => {
    // A transition with one end outside.
    const withTransition = projectOf(
      [track('v1', 'video', 0)],
      [clip('a', 'v1', 'video', 0, 30), clip('b', 'v1', 'video', 30, 30)],
      {
        transitions: [
          { id: 'tr', kind: 'fade', fromClipId: 'a', toClipId: 'b', trackId: 'v1', startFrame: 25, durationFrames: 10 },
        ] as Transition[],
      },
    )
    expectRefused(nestProject(withTransition, ['a']), 'crossing-transition')
    // Both ends inside is fine.
    expect(expectOk(nestProject(withTransition, ['a', 'b'])).compoundId).toBeTruthy()

    // A matte whose source is selected but whose consumer is not.
    const withMatte = projectOf(
      [track('v1', 'video', 0)],
      [
        clip('matte', 'v1', 'video', 0, 30),
        clip('subject', 'v1', 'video', 0, 30, { matte: { sourceClipId: 'matte', kind: 'alpha' } }),
      ],
    )
    expectRefused(nestProject(withMatte, ['matte']), 'crossing-matte')
    expect(expectOk(nestProject(withMatte, ['matte', 'subject'])).compoundId).toBeTruthy()

    // A link with a partner outside.
    const withLink = projectOf(
      [track('v1', 'video', 0), track('v2', 'video', 1)],
      [
        clip('a', 'v1', 'video', 0, 30, { linkId: 'L' }),
        clip('b', 'v2', 'video', 0, 30, { linkId: 'L' }),
      ],
    )
    expectRefused(nestProject(withLink, ['a']), 'crossing-link')
  })

  it('leaves the input project untouched when it refuses', () => {
    const before = basic()
    const snapshot = JSON.stringify(before)
    expectRefused(nestProject(before, ['a', 'nope']), 'clip-not-found')
    expectRefused(nestProject(before, []), 'empty-selection')
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('refuses a locked, hidden or adjustment clip', () => {
    const locked = projectOf(
      [track('v1', 'video', 0, { locked: true })],
      [clip('a', 'v1', 'video', 0, 30)],
    )
    expectRefused(nestProject(locked, ['a']), 'track-locked')

    const hidden = projectOf(
      [track('v1', 'video', 0, { disabled: true })],
      [clip('a', 'v1', 'video', 0, 30)],
    )
    expectRefused(nestProject(hidden, ['a']), 'track-disabled')

    const adjustment = projectOf(
      [track('v1', 'video', 0)],
      [clip('a', 'v1', 'adjustment', 0, 30)],
    )
    expectRefused(nestProject(adjustment, ['a']), 'adjustment-clip')
  })

  it('refuses when a lane between the selected ones holds something else', () => {
    const before = projectOf(
      [track('v1', 'video', 0), track('v2', 'video', 1), track('v3', 'video', 2)],
      [
        clip('a', 'v1', 'video', 0, 30),
        clip('stray', 'v2', 'video', 0, 30),
        clip('c', 'v3', 'video', 0, 30),
      ],
    )
    expectRefused(nestProject(before, ['a', 'c']), 'non-contiguous')
    // A lane between them holding only selected clips is not a problem.
    const clean = projectOf(
      [track('v1', 'video', 0), track('v2', 'video', 1), track('v3', 'video', 2)],
      [
        clip('a', 'v1', 'video', 0, 30),
        clip('b', 'v2', 'video', 0, 30),
        clip('c', 'v3', 'video', 0, 30),
      ],
    )
    expect(expectOk(nestProject(clean, ['a', 'b', 'c'])).compoundId).toBeTruthy()
  })

  it('refuses a compound that would nest past the depth limit', () => {
    // A compound already holding the maximum depth cannot go inside another.
    let nested = projectOf([track('n', 'video', 0)], [clip('leaf', 'n', 'video', 0, 30)])
    for (let i = 0; i < 4; i++) {
      nested = projectOf([track('n', 'video', 0)], [
        clip('c', 'n', 'compound', 0, 30, {
          compound: { project: nested },
          sourceDurationFrames: 30,
          assetFrames: 30,
        } as Partial<Clip>),
      ])
    }
    const before = projectOf([track('v', 'video', 0)], [
      clip('a', 'v', 'video', 0, 30),
      clip('deep', 'v', 'compound', 0, 30, {
        compound: { project: nested },
        sourceDurationFrames: 30,
        assetFrames: 30,
      } as Partial<Clip>),
    ])
    expectRefused(nestProject(before, ['a', 'deep']), 'too-deep')
  })

  it('refuses when the compound would overlap what is already there', () => {
    const before = projectOf(
      [track('v1', 'video', 0)],
      [clip('a', 'v1', 'video', 0, 30), clip('b', 'v1', 'video', 20, 30)],
    )
    expectRefused(nestProject(before, ['a']), 'overlap')
  })

  it('puts an audio-only selection on a new video lane at the same stack position', () => {
    const before = projectOf(
      [track('a1', 'audio', 0), track('a2', 'audio', 1)],
      [clip('a', 'a1', 'audio', 0, 30), clip('b', 'a2', 'audio', 10, 30)],
    )
    const { project, compoundId } = expectOk(nestProject(before, ['a', 'b']))
    const compound = find(project, compoundId)!

    expect(compound.trackId).not.toBe('a1')
    expect(compound.trackId).not.toBe('a2')
    const lane = project.tracks.find((t) => t.id === compound.trackId)!
    expect(lane.kind).toBe('video')
    // The topmost selected audio lane's own order, and the lanes below it moved.
    expect(lane.order).toBe(1)
    expect(project.tracks.map((t) => t.order)).toEqual([0, 1, 2])
    expect(find(project, compoundId)!.durationFrames).toBe(40)
  })
})

describe('unnestProject', () => {
  /** A compound made by nesting, so the round trip is nest's output. */
  function nested(): { project: Project; compoundId: string } {
    return expectOk(
      nestProject(
        projectOf(
          [track('v1', 'video', 0), track('v2', 'video', 1), track('other', 'video', 2)],
          [
            clip('a', 'v1', 'video', 10, 20),
            clip('b', 'v2', 'video', 20, 30),
            clip('c', 'other', 'video', 0, 10),
          ],
        ),
        ['a', 'b'],
      ),
    )
  }

  it('puts the timeline back exactly as it was', () => {
    const { project: withCompound, compoundId } = nested()
    const { project, clipIds } = expectOk(unnestProject(withCompound, compoundId))

    // Frame occupancy: the same frames are covered by the same media.
    const a = find(project, clipIds[0]!)!
    const b = find(project, clipIds[1]!)!
    expect(a.startFrame).toBe(10)
    expect(a.durationFrames).toBe(20)
    expect(b.startFrame).toBe(20)
    expect(b.durationFrames).toBe(30)
    // The unselected lane never moved.
    expect(find(project, 'c')!.startFrame).toBe(0)
    // The compound is gone.
    expect(find(project, compoundId)).toBeUndefined()
  })

  it('restores the relative z order of the nested lanes', () => {
    const { project: withCompound, compoundId } = nested()
    const { project, clipIds } = expectOk(unnestProject(withCompound, compoundId))

    const lanes = clipIds.map((id) => project.tracks.find((t) => t.id === find(project, id)!.trackId)!)
    // v1 was above v2 in the child, so it is above it again - and both sit
    // above the lane the compound was drawn on.
    expect(lanes[0]!.order).toBeLessThan(lanes[1]!.order)
    const compoundLane = project.tracks.find((t) => t.id === 'v2')!
    expect(lanes[1]!.order).toBeLessThan(compoundLane.order)
    expect(project.tracks.map((t) => t.order)).toEqual([...project.tracks.map((t) => t.order)].sort((x, y) => x - y))
  })

  it('never collides, however many times it is un-nested', () => {
    // nest -> unnest, three times over. Each round's clips get fresh ids, so a
    // collision would show up as a lost clip rather than as a wrong picture.
    let project = projectOf(
      [track('v1', 'video', 0)],
      [clip('a', 'v1', 'video', 0, 30), clip('b', 'v1', 'video', 30, 30)],
    )
    const seen = new Set<string>()
    for (let round = 0; round < 3; round++) {
      const ids = Object.values(project.clips).flat().map((c) => c.id)
      const nestedRound = expectOk(nestProject(project, ids))
      const result = expectOk(unnestProject(nestedRound.project, nestedRound.compoundId))
      expect(result.clipIds).toHaveLength(2)
      for (const id of result.clipIds) {
        expect(seen.has(id)).toBe(false)
        seen.add(id)
      }
      project = result.project
    }
    expect(seen.size).toBe(6)
    // Both clips are still there, and the lane the compound was drawn on is
    // left in place rather than deleted.
    expect(Object.values(project.clips).flat()).toHaveLength(2)
    expect(project.clips.v1).toEqual([])
    expect(project.tracks.some((t) => t.id === 'v1')).toBe(true)
  })

  it('carries keyframe times across untouched, and remaps ids everywhere', () => {
    const keyed = clip('a', 'v1', 'video', 0, 30, {
      keyframes: { channels: { x: { source: { kind: 'keyframes' }, keys: [{ frame: 5, value: 0.2 }] } } },
      linkId: 'L',
    } as Partial<Clip>)
    const withCompound = expectOk(
      nestProject(projectOf([track('v1', 'video', 0)], [keyed, clip('b', 'v1', 'video', 30, 30, { linkId: 'L' })]), ['a', 'b']),
    )
    const { project, clipIds } = expectOk(unnestProject(withCompound.project, withCompound.compoundId))
    const a = find(project, clipIds[0]!)!

    expect(a.keyframes!.channels.x!.keys[0]!.frame).toBe(5)
    // The link group survives as a group, under an id of its own.
    const b = find(project, clipIds[1]!)!
    expect(a.linkId).toBeTruthy()
    expect(a.linkId).toBe(b.linkId)
    expect(a.linkId).not.toBe('L')
  })

  it('refuses anything it could not put back exactly', () => {
    const { project: withCompound, compoundId } = nested()
    const mutate = (patch: Partial<Clip>): Project => ({
      ...withCompound,
      clips: {
        ...withCompound.clips,
        v2: withCompound.clips.v2!.map((c) => (c.id === compoundId ? { ...c, ...patch } : c)),
      },
    })

    const moved = expectRefused(
      unnestProject(mutate({ transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } } }), compoundId),
      'not-lossless',
    )
    expect(moved).toContain('Reset compound transforms and trim before unnesting')
    expectRefused(unnestProject(mutate({ durationFrames: 20 }), compoundId), 'not-lossless')
    expectRefused(unnestProject(mutate({ sourceStartFrame: 5 }), compoundId), 'not-lossless')
    expectRefused(unnestProject(mutate({ opacity: 0.5 }), compoundId), 'not-lossless')
    expectRefused(unnestProject(mutate({ speed: 2, durationFrames: 20 }), compoundId), 'not-lossless')
    expectRefused(unnestProject(mutate({ effects: [{ id: 'e', kind: 'vignette', params: {} }] }), compoundId), 'not-lossless')
    expectRefused(unnestProject(mutate({ crop: { x: 0, y: 0, width: 0.5, height: 1 } }), compoundId), 'not-lossless')
    expectRefused(unnestProject(mutate({ cornerRadius: 0.2 }), compoundId), 'not-lossless')
  })

  it('refuses a clip that is not a compound, and an unknown id', () => {
    const before = projectOf([track('v1', 'video', 0)], [clip('a', 'v1', 'video', 0, 30)])
    expectRefused(unnestProject(before, 'a'), 'not-a-compound')
    expectRefused(unnestProject(before, 'nope'), 'clip-not-found')
  })

  it('drops the version stamp back when the last compound goes', () => {
    const { project: withCompound, compoundId } = nested()
    expect(withCompound.version).toBe(4)
    const { project } = expectOk(unnestProject(withCompound, compoundId))
    expect(project.version).toBe(1)
  })
})
