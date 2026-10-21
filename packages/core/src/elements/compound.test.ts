import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import type { Clip, Project, Track } from '../types'
import { compoundLength, createCompoundClip, flattenAudioClips } from './compound'

/**
 * Compound clips: the factory, and the audio walk the export mix will use
 * (PV-P1a-1).
 *
 * A compound holds a nested project by value. These tests are about the two
 * pure pieces: the clip it builds, and exactly which audio the mix is offered -
 * including through a compound, where a clip has to be cut to the window its
 * parent shows and gain-scaled by its ancestors.
 */

const track = (id: string, over: Partial<Track> = {}): Track => ({ id, kind: 'audio', name: id, order: 0, ...over }) as Track

const audio = (id: string, trackId: string, startFrame: number, durationFrames: number, over: Partial<Clip> = {}): Clip =>
  ({
    id,
    trackId,
    type: 'audio',
    name: id,
    startFrame,
    durationFrames,
    sourceStartFrame: 0,
    sourceDurationFrames: durationFrames,
    volume: 1,
    src: `${id}.mp3`,
    ...over,
  }) as Clip

/** A project whose clips end at frame `end`, so its length is `end + 1`. */
function projectOf(clips: Clip[], over: Partial<Project> = {}): Project {
  return {
    id: 'p',
    version: 4,
    fps: 30,
    stage: { width: 1920, height: 1080 },
    tracks: [track('a'), track('b')],
    clips: { a: clips.filter((c) => c.trackId === 'a'), b: clips.filter((c) => c.trackId === 'b') },
    transitions: [],
    ...over,
  } as Project
}

describe('createCompoundClip', () => {
  const nested = projectOf([audio('a1', 'a', 0, 90)])

  it('takes its length from the nested timeline', () => {
    const clip = createCompoundClip({ trackId: 't', startFrame: 30, project: nested })
    expect(clip.type).toBe('compound')
    expect(clip.name).toBe('Compound')
    expect(clip.startFrame).toBe(30)
    expect(clip.durationFrames).toBe(90)
    expect(clip.sourceStartFrame).toBe(0)
    // The nested timeline is the compound's media, so it bounds trims (PV-T5-1).
    expect(clip.sourceDurationFrames).toBe(90)
    expect(clip.assetFrames).toBe(90)
    expect(clip.compound!.project).toBe(nested)
  })

  it('honours an explicit duration but keeps the source length', () => {
    const clip = createCompoundClip({ trackId: 't', startFrame: 0, durationFrames: 40, project: nested })
    expect(clip.durationFrames).toBe(40)
    expect(clip.assetFrames).toBe(90)
  })

  it('an empty nested project still has one frame of length', () => {
    expect(compoundLength(projectOf([]))).toBe(1)
  })

  it('stamps version 4 through the engine, in the same undo step', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const t = engine.addTrack('video')
    engine.addClip({
      type: 'compound',
      trackId: t.id,
      startFrame: 0,
      durationFrames: 30,
      compound: { project: nested },
    })
    expect(engine.getProject().version).toBe(4)
    engine.undo()
    // The engine calls documentVersionFor on every commit, so removing the
    // compound drops the version back with no engine change.
    expect(engine.getProject().version).toBe(1)
  })
})

describe('flattenAudioClips', () => {
  it('returns a flat project’s own clip objects, in order', () => {
    const a1 = audio('a1', 'a', 0, 30)
    const a2 = audio('a2', 'b', 10, 30)
    const project = projectOf([a1, a2, { ...audio('v1', 'a', 0, 10), type: 'video' } as Clip, { ...audio('nosrc', 'a', 0, 10), src: '' } as Clip])
    const result = flattenAudioClips(project)
    expect(result).toHaveLength(2)
    // Identity, not a copy: the flat case is what the existing mix already had.
    expect(result[0]!.clip).toBe(a1)
    expect(result[0]!.offsetFrames).toBe(0)
    expect(result[0]!.parentChain).toEqual([])
    expect(result[1]!.clip).toBe(a2)
  })

  it('excludes disabled clips and muted or disabled tracks', () => {
    const project = projectOf(
      [audio('off', 'a', 0, 30, { disabled: true }), audio('on', 'a', 30, 30)],
      { tracks: [track('a', { muted: true }), track('b', { disabled: true })] },
    )
    expect(flattenAudioClips(project)).toHaveLength(0)
  })

  /**
   * A compound clip wrapping `inner` at `startFrame`. The nested project holds
   * an audio track for the clips AND a video track named `v`, so a compound
   * inside it (whose own trackId is `v`) resolves a real track - the walker skips
   * a clip whose track is missing, exactly as it must.
   */
  const compound = (id: string, inner: Clip[], startFrame: number, over: Partial<Clip> = {}): Clip =>
    ({
      id,
      trackId: 'v',
      type: 'compound',
      name: id,
      startFrame,
      durationFrames: 60,
      sourceStartFrame: 0,
      sourceDurationFrames: 60,
      volume: 1,
      compound: {
        project: {
          ...projectOf(inner, { tracks: [track('na'), track('v', { kind: 'video' })] }),
          clips: { na: inner.filter((c) => c.trackId === 'na'), v: inner.filter((c) => c.trackId === 'v') },
          stage: { width: 640, height: 360 },
        },
      },
      ...over,
    }) as Clip

  it('cuts a nested clip to the window its compound shows', () => {
    // The compound sits at 100, shows nested frame 20 at its first frame, and is
    // 60 frames long. The nested clip starts at 10, lasts 100 from source 5.
    const nestedClip = audio('n', 'na', 10, 100, { sourceStartFrame: 5 })
    const cmp = compound('cmp', [nestedClip], 100, { sourceStartFrame: 20 })
    const root = projectOf([], {
      tracks: [track('v', { kind: 'video' }), track('a')],
      clips: { v: [cmp], a: [] },
    })
    const result = flattenAudioClips(root)
    expect(result).toHaveLength(1)
    const entry = result[0]!
    expect(entry.parentChain).toEqual(['cmp'])
    // offset 80 + start 10 = absolute 100: the compound's own first frame.
    expect(entry.offsetFrames).toBe(80)
    expect(entry.clip.startFrame).toBe(20)
    // A 10-frame head at speed 1 consumes 10 source frames: 5 + 10 = 15.
    expect(entry.clip.sourceStartFrame).toBe(15)
    expect(entry.clip.durationFrames).toBe(60)
  })

  it('multiplies the ancestor gains into the nested volume', () => {
    const nestedClip = audio('n', 'na', 0, 30, { volume: 0.5 })
    const cmp = compound('cmp', [nestedClip], 0, { volume: 0.5 })
    const root = projectOf([], { tracks: [track('v', { kind: 'video', volume: 0.8 })], clips: { v: [cmp] } })
    // 0.5 (own) x 0.5 (compound) x 0.8 (compound's track) = 0.2
    expect(flattenAudioClips(root)[0]!.clip.volume).toBeCloseTo(0.2, 6)
  })

  it('leaves the volume alone when every gain is 1', () => {
    const nestedClip = audio('n', 'na', 0, 30, { volume: 0.7 })
    const root = projectOf([], { tracks: [track('v', { kind: 'video' })], clips: { v: [compound('cmp', [nestedClip], 0)] } })
    expect(flattenAudioClips(root)[0]!.clip.volume).toBe(0.7)
  })

  it('skips audio inside a retimed compound', () => {
    const root = projectOf([], {
      tracks: [track('v', { kind: 'video' })],
      clips: { v: [compound('cmp', [audio('n', 'na', 0, 30)], 0, { speed: 2 })] },
    })
    expect(flattenAudioClips(root)).toHaveLength(0)
  })

  it('skips a nested clip entirely outside the window', () => {
    // The compound is at 0..60, so a nested clip at 500 is never heard.
    const root = projectOf([], {
      tracks: [track('v', { kind: 'video' })],
      clips: { v: [compound('cmp', [audio('n', 'na', 500, 30)], 0)] },
    })
    expect(flattenAudioClips(root)).toHaveLength(0)
  })

  it('walks two levels and chains them outermost first', () => {
    const leaf = audio('leaf', 'na', 5, 30)
    const inner = compound('inner', [leaf], 10)
    const outer = compound('outer', [inner], 0)
    const root = projectOf([], { tracks: [track('v', { kind: 'video' })], clips: { v: [outer] } })
    const result = flattenAudioClips(root)
    expect(result).toHaveLength(1)
    expect(result[0]!.parentChain).toEqual(['outer', 'inner'])
    // 0 + 10 (inner at 10) + 5 = absolute 15.
    expect(result[0]!.offsetFrames + result[0]!.clip.startFrame).toBe(15)
  })
})
