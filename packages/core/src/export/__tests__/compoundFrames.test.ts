import { describe, expect, it } from 'vitest'
import { collectClips, compoundSourceFrames, occurrenceKey } from '../compoundFrames'
import type { Clip, Project, Track } from '../../types'

/**
 * Compound occurrences and their source frames (PV-P1b-1).
 *
 * The whole export keys on "which occurrence needs which source frame", so these
 * two pure functions are where a compound export is won or lost. The cases that
 * matter are the ones a single-level export never had to think about: a nested
 * clip's frame is its PARENT's source frame, not the output frame; and the same
 * nested clip id in two compounds is two different occurrences that may want two
 * different frames from one decode cache.
 */

const track = (id: string, order: number, over: Partial<Track> = {}): Track =>
  ({ id, kind: 'video', name: id, order, height: 54, locked: false, disabled: false, muted: false, solo: false, volume: 1, protected: false, ...over }) as Track

const clip = (id: string, trackId: string, over: Partial<Clip> = {}): Clip =>
  ({
    id,
    trackId,
    type: 'video',
    name: id,
    startFrame: 0,
    durationFrames: 60,
    sourceStartFrame: 0,
    sourceDurationFrames: 60,
    volume: 1,
    opacity: 1,
    src: `${id}.mp4`,
    ...over,
  }) as Clip

function projectOf(tracks: Track[], clips: Clip[], over: Partial<Project> = {}): Project {
  const byTrack: Record<string, Clip[]> = {}
  for (const t of tracks) byTrack[t.id] = []
  for (const c of clips) (byTrack[c.trackId] ??= []).push(c)
  return { id: 'p', version: 4, fps: 30, stage: { width: 1280, height: 720 }, tracks, clips: byTrack, transitions: [], ...over } as Project
}

/** A project whose root holds one compound wrapping `nested`. */
function withCompound(nested: Project, over: Partial<Clip> = {}): Project {
  const compound = clip('c1', 'v', {
    type: 'compound',
    src: undefined,
    compound: { project: nested },
    ...over,
  } as Partial<Clip>)
  return projectOf([track('v', 0)], [compound])
}

describe('collectClips', () => {
  it('lists a flat document exactly as it is', () => {
    const project = projectOf([track('v1', 0), track('v2', 1)], [clip('a', 'v1'), clip('b', 'v2')])
    expect(collectClips(project).map((o) => o.key)).toEqual([occurrenceKey(['a']), occurrenceKey(['b'])])
  })

  it('expands a compound, one level, with the parent in the path', () => {
    const nested = projectOf([track('nv', 0)], [clip('v', 'nv')])
    const found = collectClips(withCompound(nested))
    expect(found.map((o) => o.key)).toEqual([occurrenceKey(['c1']), occurrenceKey(['c1', 'v'])])
  })

  it('gives the same nested clip id in two compounds two different keys', () => {
    // The case a clip-id-keyed cache gets wrong: both occurrences want clip 'v'.
    const nested = projectOf([track('nv', 0)], [clip('v', 'nv')])
    const project = projectOf(
      [track('v1', 0), track('v2', 1)],
      [
        clip('a', 'v1', { type: 'compound', src: undefined, compound: { project: nested } } as Partial<Clip>),
        clip('b', 'v2', { type: 'compound', src: undefined, compound: { project: nested } } as Partial<Clip>),
      ],
    )
    const keys = collectClips(project).map((o) => o.key)
    expect(keys).toEqual([
      occurrenceKey(['a']),
      occurrenceKey(['a', 'v']),
      occurrenceKey(['b']),
      occurrenceKey(['b', 'v']),
    ])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('skips clips on a disabled track and disabled clips', () => {
    const project = projectOf(
      [track('v1', 0), track('v2', 1, { disabled: true })],
      [clip('a', 'v1'), clip('b', 'v2'), clip('c', 'v1', { disabled: true })],
    )
    expect(collectClips(project).map((o) => o.clip.id)).toEqual(['a'])
  })

  it('stops walking at the depth limit, as the resolver stops drawing', () => {
    // Four compound levels, then a distinct root wrapper. `leaf` sits under the
    // fourth, which is at the cap, so it is never walked.
    let nested = projectOf([track('n', 0)], [clip('leaf', 'n')])
    for (let i = 4; i >= 1; i--) {
      nested = projectOf(
        [track('n', 0)],
        [clip(`c${i}`, 'n', { type: 'compound', src: undefined, compound: { project: nested } } as Partial<Clip>)],
      )
    }
    const found = collectClips(withCompound(nested))
    expect(found.map((o) => o.clip.id)).toEqual(['c1', 'c1', 'c2', 'c3', 'c4'])
    expect(found.some((o) => o.clip.id === 'leaf')).toBe(false)
  })
})

describe('compoundSourceFrames', () => {
  it('asks a nested clip about its PARENT source frame, not the output frame', () => {
    // The compound starts at 100 with sourceStartFrame 10, so output frame 100
    // shows nested frame 10. The child starts at nested 5 with sourceStart 0 and
    // speed 1, so it needs source frame 5.
    const nested = projectOf([track('nv', 0)], [clip('v', 'nv', { startFrame: 5, durationFrames: 60 })])
    const project = withCompound(nested, { startFrame: 100, durationFrames: 60, sourceStartFrame: 10 })

    const map = compoundSourceFrames(project, 100)
    expect(map.get(occurrenceKey(['c1']))).toBe(10)
    expect(map.get(occurrenceKey(['c1', 'v']))).toBe(5)
  })

  it('follows speed and a time remap, because the resolver does', () => {
    const nested = projectOf([track('nv', 0)], [clip('v', 'nv', { startFrame: 0, durationFrames: 60, sourceStartFrame: 4 })])
    const fast = withCompound(nested, { startFrame: 0, durationFrames: 60, sourceStartFrame: 0, speed: 2 })
    // Output frame 10 at speed 2 -> nested frame 20 -> child source 24.
    expect(compoundSourceFrames(fast, 10).get(occurrenceKey(['c1', 'v']))).toBe(24)
  })

  it('omits an occurrence that is not active at this frame', () => {
    const nested = projectOf([track('nv', 0)], [clip('v', 'nv', { startFrame: 0, durationFrames: 10 })])
    const project = withCompound(nested, { startFrame: 0, durationFrames: 60 })
    const at = (frame: number) => compoundSourceFrames(project, frame)
    expect(at(0).has(occurrenceKey(['c1', 'v']))).toBe(true)
    // The compound is still on screen at 20; its nested timeline is not.
    expect(at(20).has(occurrenceKey(['c1']))).toBe(true)
    expect(at(20).has(occurrenceKey(['c1', 'v']))).toBe(false)
    // Past the compound entirely, nothing at all.
    expect(at(100).size).toBe(0)
  })

  it('two occurrences of one nested clip can want two different frames at once', () => {
    // ONE child clip id ('v') reached through two parents, each with its own
    // nested project. The second child starts 5 frames into its nested timeline,
    // so the same output frame needs two different source frames of the same
    // source - which is exactly what a clip-id-keyed per-frame image cache gets
    // wrong.
    const makeNested = (childStart: number) =>
      projectOf([track('nv', 0)], [clip('v', 'nv', { startFrame: childStart, durationFrames: 60 })])
    const project = projectOf(
      [track('v1', 0), track('v2', 1)],
      [
        clip('a', 'v1', { type: 'compound', src: undefined, compound: { project: makeNested(0) } } as Partial<Clip>),
        clip('b', 'v2', { type: 'compound', src: undefined, compound: { project: makeNested(5) } } as Partial<Clip>),
      ],
    )
    const map = compoundSourceFrames(project, 10)
    expect(map.get(occurrenceKey(['a', 'v']))).toBe(10)
    expect(map.get(occurrenceKey(['b', 'v']))).toBe(5)
    // Same clip id, two keys, two numbers.
    expect(map.get(occurrenceKey(['a', 'v']))).not.toBe(map.get(occurrenceKey(['b', 'v'])))
  })

  it('walks four levels of compounds', () => {
    let nested = projectOf([track('n', 0)], [clip('leaf', 'n')])
    for (let i = 4; i >= 1; i--) {
      nested = projectOf(
        [track('n', 0)],
        [clip(`c${i}`, 'n', { type: 'compound', src: undefined, compound: { project: nested } } as Partial<Clip>)],
      )
    }
    // The root wrapper is called 'c1' too, so the deep path repeats the name -
    // which is the point: the KEY is the whole chain, not the id. Five compound
    // levels exist here; the fifth sits at the cap, so `leaf` below it is never
    // reached, exactly as the resolver never draws it.
    const map = compoundSourceFrames(withCompound(nested), 0)
    expect(map.get(occurrenceKey(['c1', 'c1', 'c2', 'c3', 'c4']))).toBe(0)
    expect(map.has(occurrenceKey(['c1', 'c1', 'c2', 'c3', 'c4', 'leaf']))).toBe(false)
  })
})
