import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { splitClip } from './split'
import type { Clip, Project, Track } from '../types'

function makeTrack(overrides?: Partial<Track>): Track {
  return {
    id: 't1',
    name: 'T',
    kind: 'video',
    order: 0,
    height: 64,
    locked: false,
    disabled: false,
    muted: false,
    solo: false,
    ...overrides,
  }
}

function makeClip(overrides?: Partial<Clip>): Clip {
  return {
    id: 'c1',
    trackId: 't1',
    type: 'video',
    name: 'C',
    startFrame: 0,
    durationFrames: 30,
    sourceStartFrame: 0,
    sourceDurationFrames: 30,
    src: 'fake.mp4',
    ...overrides,
  }
}

function makeProject(clip: Clip, track: Track = makeTrack()): Project {
  return {
    id: 'p1',
    fps: 30,
    stage: { width: 1080, height: 1920 },
    tracks: [track],
    clips: { [track.id]: [clip] },
    transitions: [],
    version: 1,
  }
}

/**
 * splitClip mutates the draft AND returns [leftId, rightId] | null — Immer
 * forbids a producer from both mutating and returning a value, so the result
 * must be captured via an outer variable (the same pattern
 * TimelineEngine.splitClip itself uses), not by returning it from the recipe.
 */
function runSplit(
  project: Project,
  clipId: string,
  trackId: string,
  atFrame: number,
): { project: Project; ids: [string, string] | null } {
  let ids: [string, string] | null = null
  const next = produce(project, (draft) => {
    ids = splitClip(draft, clipId, trackId, atFrame)
  })
  return { project: next, ids }
}

describe('splitClip (visitor)', () => {
  it('speed=1: matches the original 1:1 split behavior exactly', () => {
    const clip = makeClip({ startFrame: 0, durationFrames: 30, sourceStartFrame: 10, sourceDurationFrames: 30 })
    const project = makeProject(clip)

    const { project: next, ids } = runSplit(project, 'c1', 't1', 12)
    expect(ids).toEqual(['c1', expect.any(String)])
    const [, rightId] = ids!

    const left = next.clips.t1.find((c) => c.id === 'c1')!
    const right = next.clips.t1.find((c) => c.id === rightId)!

    expect(left.durationFrames).toBe(12)
    expect(left.sourceDurationFrames).toBe(12)
    expect(left.sourceStartFrame).toBe(10) // unchanged

    expect(right.startFrame).toBe(12)
    expect(right.durationFrames).toBe(18)
    expect(right.sourceStartFrame).toBe(22) // 10 + 12
    expect(right.sourceDurationFrames).toBe(18)
  })

  it("speed=2: the right half's sourceStartFrame advances by 2x the left timeline duration", () => {
    // 20 timeline frames covering source frames 0..39 at 2x.
    const clip = makeClip({
      startFrame: 0,
      durationFrames: 20,
      sourceStartFrame: 0,
      sourceDurationFrames: 40,
      speed: 2,
    })
    const project = makeProject(clip)

    const { project: next, ids } = runSplit(project, 'c1', 't1', 8)
    const [, rightId] = ids!
    const left = next.clips.t1.find((c) => c.id === 'c1')!
    const right = next.clips.t1.find((c) => c.id === rightId)!

    // Left half: 8 timeline frames * speed 2 = 16 source frames consumed.
    expect(left.durationFrames).toBe(8)
    expect(left.sourceDurationFrames).toBe(16)
    expect(left.sourceStartFrame).toBe(0)
    expect(left.speed).toBe(2)

    // Right half starts where the left's source consumption left off.
    expect(right.startFrame).toBe(8)
    expect(right.durationFrames).toBe(12)
    expect(right.sourceStartFrame).toBe(16)
    expect(right.sourceDurationFrames).toBe(24) // 12 * 2
    expect(right.speed).toBe(2) // carried through the ...clip spread
  })

  it("speed=0.5: the right half's sourceStartFrame advances by half the left timeline duration", () => {
    const clip = makeClip({
      startFrame: 0,
      durationFrames: 20,
      sourceStartFrame: 0,
      sourceDurationFrames: 10,
      speed: 0.5,
    })
    const project = makeProject(clip)

    const { project: next, ids } = runSplit(project, 'c1', 't1', 10)
    const [, rightId] = ids!
    const left = next.clips.t1.find((c) => c.id === 'c1')!
    const right = next.clips.t1.find((c) => c.id === rightId)!

    expect(left.durationFrames).toBe(10)
    expect(left.sourceDurationFrames).toBe(5) // 10 * 0.5
    expect(right.sourceStartFrame).toBe(5)
    expect(right.durationFrames).toBe(10)
    expect(right.sourceDurationFrames).toBe(5) // 10 * 0.5
  })

  it('re-divides clip-relative keyframes so the split is a visual no-op', () => {
    const clip = makeClip({
      startFrame: 0,
      durationFrames: 30,
      keyframes: {
        channels: {
          scale: {
            source: { kind: 'keyframes' },
            keys: [
              { id: 'a', frame: 0, value: 1, easing: 'linear' },
              { id: 'b', frame: 30, value: 2, easing: 'linear' },
            ],
          },
        },
      },
    })
    const { project: next, ids } = runSplit(makeProject(clip), 'c1', 't1', 12)
    const [, rightId] = ids!
    const left = next.clips.t1.find((c) => c.id === 'c1')!
    const right = next.clips.t1.find((c) => c.id === rightId)!

    const l = left.keyframes!.channels.scale!.keys
    const r = right.keyframes!.channels.scale!.keys
    expect(l.map((k) => k.frame)).toEqual([0, 12])
    expect(l[1].value).toBeCloseTo(1.4)
    // Right half's keys are relative to ITS start, not the old clip's.
    expect(r.map((k) => k.frame)).toEqual([0, 18])
    expect(r[0].value).toBeCloseTo(1.4)
    expect(r[1].value).toBe(2)
  })

  it('leaves a clip without keyframes exactly as before', () => {
    const { project: next, ids } = runSplit(makeProject(makeClip()), 'c1', 't1', 12)
    const [, rightId] = ids!
    expect(next.clips.t1.find((c) => c.id === 'c1')!.keyframes).toBeUndefined()
    expect(next.clips.t1.find((c) => c.id === rightId)!.keyframes).toBeUndefined()
  })

  it('returns null and leaves the track untouched when the split point is not strictly inside the clip', () => {
    const clip = makeClip({ startFrame: 0, durationFrames: 30 })
    const project = makeProject(clip)

    const atStart = runSplit(project, 'c1', 't1', 0)
    const atEnd = runSplit(project, 'c1', 't1', 30)
    const outside = runSplit(project, 'c1', 't1', 999)

    expect(atStart.ids).toBeNull()
    expect(atEnd.ids).toBeNull()
    expect(outside.ids).toBeNull()
    expect(atStart.project.clips.t1.length).toBe(1)
    expect(atEnd.project.clips.t1.length).toBe(1)
    expect(outside.project.clips.t1.length).toBe(1)
  })
})

describe('splitClip — link groups (PV-T1)', () => {
  it('the right half never joins the left half’s link group', () => {
    const clip = makeClip({ linkId: 'g1', labelColor: 'label-3' })
    const { project, ids } = runSplit(makeProject(clip), 'c1', 't1', 12)
    const [left, right] = project.clips.t1
    expect(ids).not.toBeNull()
    expect(left.linkId).toBe('g1')
    expect(right).not.toHaveProperty('linkId')
    // Other clip fields still carry over, the label included.
    expect(right.labelColor).toBe('label-3')
  })
})
describe('split keeps the media length (PV-T5-1)', () => {
  // Both halves inherit assetFrames by the spread in split.ts, so each can be
  // trimmed back out to the media it came from. `sourceDurationFrames` keeps
  // its per-half window meaning — those assertions above are unchanged.
  it('carries assetFrames onto both halves', () => {
    const clip = makeClip({ durationFrames: 40, sourceDurationFrames: 40, assetFrames: 100 })
    const draft = produce(makeProject(clip), (d) => {
      splitClip(d, 'c1', 't1', 20)
    })
    const [left, right] = draft.clips.t1!
    expect(left).toMatchObject({ startFrame: 0, durationFrames: 20, sourceStartFrame: 0, sourceDurationFrames: 20, assetFrames: 100 })
    expect(right).toMatchObject({ startFrame: 20, durationFrames: 20, sourceStartFrame: 20, sourceDurationFrames: 20, assetFrames: 100 })
  })

  it('leaves a legacy clip without assetFrames exactly as it was', () => {
    const clip = makeClip({ durationFrames: 40, sourceDurationFrames: 40 })
    const draft = produce(makeProject(clip), (d) => {
      splitClip(d, 'c1', 't1', 20)
    })
    for (const half of draft.clips.t1!) {
      expect(half.assetFrames).toBeUndefined()
    }
  })
})

describe('splitClip — EG-P1 provenance', () => {
  it('both halves keep partId', () => {
    const draft = produce(makeProject(makeClip({ partId: 'hero-word-0' })), (d) => {
      splitClip(d, 'c1', 't1', 12)
    })
    expect(draft.clips.t1!.map((c) => c.partId)).toEqual(['hero-word-0', 'hero-word-0'])
  })

  // Pins CURRENT behaviour: a split compound carries `component` on BOTH halves.
  // EG-P2 decides what the Inspector does with a split instance; when it does
  // something other than this, it changes this test on purpose.
  it('a split compound keeps component on BOTH halves (current behaviour, pinned)', () => {
    const component = { v: 1 as const, name: 'kinetic-title', input: { id: 'hero' }, seed: 1, style: { energy: 'standard', camera: true, ambient: 'orbs', transition: 'wipe' } }
    const draft = produce(makeProject(makeClip({ type: 'compound', src: undefined, component, partId: 'hero' })), (d) => {
      splitClip(d, 'c1', 't1', 12)
    })
    const [left, right] = draft.clips.t1!
    expect(left!.component).toEqual(component)
    expect(right!.component).toEqual(component)
    expect(right!.partId).toBe('hero')
  })
})
