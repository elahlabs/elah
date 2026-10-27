import { describe, expect, it } from 'vitest'
import { resolveTimeline } from './resolveTimeline'
import { embeddedAudioId, clipIdOfSceneAudio } from './scene'
import type { Clip, Project, Track, Transition } from '../types'

/**
 * Compound clips in the resolver (PV-P1a-1).
 *
 * A compound resolves its nested project at the clip's own source frame, so the
 * picture, the nested audio and the nested scene are all one frame consistent.
 * The nested project N used here is deliberately small: a text clip and an audio
 * clip, so a test can assert on ids rather than on pixels.
 *
 * The rules that must NOT change are asserted too: a project with no compound
 * resolves to exactly the scene it did before, with no `compounds` key at all.
 */

const track = (id: string, kind: Track['kind'], order: number, over: Partial<Track> = {}): Track =>
  ({ id, kind, name: id, order, ...over }) as Track

const clip = (over: Record<string, unknown> & { id: string; trackId: string; startFrame: number; durationFrames: number }): Clip =>
  ({
    type: 'video',
    name: over.id,
    sourceStartFrame: 0,
    sourceDurationFrames: over.durationFrames,
    volume: 1,
    opacity: 1,
    ...over,
  }) as Clip

/** The nested project: an elements lane with a text clip, an audio lane with a sound. */
function nested(): Project {
  return {
    id: 'nested',
    version: 4,
    fps: 30,
    stage: { width: 640, height: 360 },
    tracks: [track('ne', 'elements', 0), track('na', 'audio', 1)],
    clips: {
      ne: [clip({ id: 'nt', trackId: 'ne', startFrame: 0, durationFrames: 60, type: 'text', text: { content: 'hi' } })],
      na: [clip({ id: 'nau', trackId: 'na', startFrame: 0, durationFrames: 60, type: 'audio', src: 'a.mp3' })],
    },
    transitions: [],
  } as unknown as Project
}

const compound = (over: Partial<Clip> = {}): Clip =>
  clip({
    id: 'c',
    trackId: 'v',
    startFrame: 30,
    durationFrames: 60,
    type: 'compound',
    compound: { project: nested() },
    ...over,
  })

function root(clips: Clip[], over: Partial<Project> = {}): Project {
  return {
    id: 'root',
    version: 4,
    fps: 30,
    stage: { width: 1080, height: 1920 },
    tracks: [track('v', 'video', 0)],
    clips: { v: clips },
    transitions: [],
    ...over,
  } as unknown as Project
}

describe('resolveTimeline — compound clips (PV-P1)', () => {
  it('leaves a project with no compound exactly as it was', () => {
    for (const frame of [0, 10]) {
      const scene = resolveTimeline(frame, root([clip({ id: 'a', trackId: 'v', startFrame: 0, durationFrames: 60, src: 'a.mp4' })]))
      // A legacy scene must not gain the key: the shape is compared elsewhere.
      expect('compounds' in scene).toBe(false)
    }
  })

  it('resolves the nested project at the compound’s own source frame', () => {
    const project = root([compound({ sourceStartFrame: 10 })])
    const scene = resolveTimeline(40, project)
    expect(scene.compounds ?? []).toHaveLength(1)
    const active = scene.compounds![0]!
    expect(active.sourceFrame).toBe(20)
    expect(active.scene.frame).toBe(20)
    expect(active.scene.texts[0]!.id).toBe('nt')
    expect(active.contentSize).toEqual({ width: 640, height: 360 })
    // Nothing authored, so nothing carried.
    expect(active.transform).toBeUndefined()
    expect(active.cornerRadius).toBeUndefined()
    expect(active.zIndex).toBe(0)
  })

  it('is active only inside its own range', () => {
    const project = root([compound()])
    expect(resolveTimeline(29, project).compounds ?? []).toHaveLength(0)
    expect(resolveTimeline(30, project).compounds ?? []).toHaveLength(1)
    expect(resolveTimeline(89, project).compounds ?? []).toHaveLength(1)
    expect(resolveTimeline(90, project).compounds ?? []).toHaveLength(0)
  })

  it('maps a constant speed onto the nested timeline', () => {
    const project = root([compound({ sourceStartFrame: 10, speed: 2 })])
    // local 10 at speed 2 is 20 nested frames, plus sourceStartFrame 10.
    expect(resolveTimeline(40, project).compounds![0]!.sourceFrame).toBe(30)
  })

  it('carries the image-shaped fields across', () => {
    const project = root([compound({ transform: { x: 0.1, y: 0.2, scale: 2, rotation: 0, anchor: { x: 0.5, y: 0.5 } }, opacity: 0.5, cornerRadius: 0.1, crop: { x: 0, y: 0, width: 0.5, height: 0.5 } })])
    const active = resolveTimeline(40, project).compounds![0]!
    expect(active.opacity).toBe(0.5)
    expect(active.transform!.scale).toBe(2)
    expect(active.cornerRadius).toBe(0.1)
    expect(active.crop).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 })
  })

  it('nests a compound inside a compound', () => {
    const inner = compound({ id: 'inner', startFrame: 0, durationFrames: 60, sourceStartFrame: 0 })
    const outer = compound({ id: 'outer', compound: { project: { ...nested(), clips: { ne: [inner], na: [] } } } })
    const scene = resolveTimeline(40, root([outer]))
    expect(scene.compounds![0]!.scene.compounds![0]!.scene.texts).toHaveLength(1)
  })

  it('stops nesting at the depth limit even for a hand-built project', () => {
    // Five compounds, each holding the next. The reader would refuse this; the
    // resolver must still not resolve past the limit.
    let deepest: Clip = clip({ id: 'leaf', trackId: 'ne', startFrame: 0, durationFrames: 60, type: 'text', text: { content: 'x' } })
    for (let i = 5; i >= 1; i--) {
      const innerProject = { ...nested(), clips: { ne: [deepest], na: [] } }
      deepest = compound({ id: `c${i}`, startFrame: 0, durationFrames: 60, compound: { project: innerProject as never } })
    }
    const scene = resolveTimeline(40, root([deepest]))
    // Walk down and count the levels that carry a compounds array.
    let level: { scene?: { compounds?: unknown[] } } | undefined = { scene }
    let levels = 0
    while (level) {
      const compounds = level.scene?.compounds
      if (!compounds || compounds.length === 0) break
      levels++
      level = compounds[0] as never
    }
    expect(levels).toBeLessThanOrEqual(4)
  })

  it('hoists nested audio into the parent, with the gain folded in', () => {
    const project = root([compound({ volume: 0.8 })], { tracks: [track('v', 'video', 0, { volume: 0.5 })] })
    const scene = resolveTimeline(40, project)
    const hoisted = scene.audios.find((a) => a.id === 'c/nau')
    expect(hoisted).toBeDefined()
    expect(hoisted!.trackId).toBe('v')
    // 1 (nested) x 0.8 (compound) x 0.5 (its track) = 0.4
    expect(hoisted!.volume).toBeCloseTo(0.4, 6)
    expect(hoisted!.sourceFrame).toBe(10)
  })

  it('hoists nothing for a retimed compound', () => {
    const project = root([compound({ speed: 2 })])
    expect(resolveTimeline(40, project).audios.find((a) => a.id === 'c/nau')).toBeUndefined()
  })

  it('hoists a merged clip nested in a compound under the composed #audio id', () => {
    const inner = nested()
    inner.tracks.push(track('nv', 'video', 2))
    inner.clips.nv = [
      clip({ id: 'nm', trackId: 'nv', startFrame: 0, durationFrames: 60, type: 'video', src: 'm.mp4', embeddedAudio: true }),
    ]
    const project = root([compound({ compound: { project: inner } as never, volume: 0.5 })])
    const scene = resolveTimeline(40, project)
    const hoisted = scene.audios.find((a) => a.id === `c/${embeddedAudioId('nm')}`)
    expect(hoisted).toBeDefined()
    expect(hoisted!.id).toBe('c/nm#audio')
    expect(hoisted!.trackId).toBe('v')
    expect(hoisted!.volume).toBeCloseTo(0.5, 6)
    expect(hoisted!.sourceFrame).toBe(10)
    expect(clipIdOfSceneAudio(hoisted!.id)).toBe('c/nm')
    // A retimed compound hoists neither kind of nested sound.
    const retimed = resolveTimeline(40, root([compound({ compound: { project: inner } as never, speed: 2 })]))
    expect(retimed.audios.find((a) => a.id === 'c/nm#audio')).toBeUndefined()
  })

  it('a muted compound track mutes what it hoists', () => {
    const project = root([compound()], { tracks: [track('v', 'video', 0, { volume: 0 })] })
    expect(resolveTimeline(40, project).audios.find((a) => a.id === 'c/nau')!.volume).toBe(0)
  })

  it('keeps the nested project’s own frame rate', () => {
    const project = root([compound()])
    expect(resolveTimeline(40, project).compounds![0]!.scene.fps).toBe(project.fps)
  })

  it('extends a transition onto a compound the way it does an image', () => {
    const a = clip({ id: 'a', trackId: 'v', startFrame: 0, durationFrames: 30, src: 'a.mp4' })
    const c = compound({ startFrame: 30, durationFrames: 60, sourceStartFrame: 0 })
    const transition: Transition = {
      id: 't1',
      kind: 'fade',
      fromClipId: a.id,
      toClipId: c.id,
      trackId: 'v',
      startFrame: 25,
      durationFrames: 10,
    }
    const project = root([a, c], { transitions: [transition] })
    // Before its own range, the incoming compound is drawn by the transition
    // pass, at a clamped source frame.
    const scene = resolveTimeline(26, project)
    expect(scene.compounds).toHaveLength(1)
    expect(scene.compounds![0]!.zIndex).toBe(1)
    expect(scene.compounds![0]!.sourceFrame).toBe(0)
  })
})
