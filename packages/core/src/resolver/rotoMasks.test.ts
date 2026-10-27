import { describe, expect, it } from 'vitest'
import { resolveTimeline } from './resolveTimeline'
import { isDrawableRoto, parseHexColor, rotoFrameUrl } from './rotoMasks'
import type { Clip, ClipRoto, Project, Track } from '../types'

function makeTrack(overrides: Partial<Track> = {}): Track {
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

function roto(overrides: Partial<ClipRoto> = {}, view: Partial<ClipRoto['view']> = {}): ClipRoto {
  return {
    kind: 'sequence',
    runId: 'run1',
    frameUrlTemplate: '/roto/runs/run1/masks/{frame}',
    frameCount: 24,
    width: 1920,
    height: 1080,
    ...overrides,
    view: { mode: 'overlay', color: '#ff0000', opacity: 0.5, ...view },
  }
}

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    trackId: 't1',
    type: 'video',
    name: 'C',
    startFrame: 0,
    durationFrames: 24,
    sourceStartFrame: 0,
    sourceDurationFrames: 24,
    src: 'fake.mp4',
    ...overrides,
  }
}

function makeProject(clips: Clip[], tracks: Track[] = [makeTrack()]): Project {
  const byTrack: Record<string, Clip[]> = {}
  for (const t of tracks) byTrack[t.id] = clips.filter((c) => c.trackId === t.id)
  return {
    id: 'p1',
    fps: 24,
    stage: { width: 1920, height: 1080 },
    tracks,
    clips: byTrack,
    transitions: [],
    version: 1,
  }
}

describe('resolveTimeline — roto masks', () => {
  it('a project without roto has no rotoMasks key at all (scene parity)', () => {
    const scene = resolveTimeline(3, makeProject([makeClip()]))
    expect('rotoMasks' in scene).toBe(false)
  })

  it('emits one mask per roto video, copying the resolved source frame', () => {
    const scene = resolveTimeline(5, makeProject([makeClip({ roto: roto() })]))
    expect(scene.rotoMasks).toHaveLength(1)
    const m = scene.rotoMasks![0]!
    expect(m).toMatchObject({
      id: 'c1:roto',
      clipId: 'c1',
      sourceFrame: 5,
      mode: 'overlay',
      opacity: 0.5,
      width: 1920,
      height: 1080,
      frameUrlTemplate: '/roto/runs/run1/masks/{frame}',
    })
    expect(m.color).toEqual([1, 0, 0])
    expect(m.zIndex).toBe(scene.videos[0]!.zIndex + 0.5)
  })

  it('mode off emits nothing', () => {
    const scene = resolveTimeline(5, makeProject([makeClip({ roto: roto({}, { mode: 'off' }) })]))
    expect(scene.rotoMasks).toBeUndefined()
  })

  it('follows trimmed source frames and clamps to the sequence length', () => {
    const clip = makeClip({ roto: roto({ frameCount: 10 }), sourceStartFrame: 8 })
    const scene = resolveTimeline(1, makeProject([clip]))
    expect(scene.videos[0]!.sourceFrame).toBe(9)
    expect(scene.rotoMasks![0]!.sourceFrame).toBe(9)
    const later = resolveTimeline(6, makeProject([clip]))
    expect(later.rotoMasks![0]!.sourceFrame).toBe(9) // 14 clamped to frameCount-1
  })

  it('follows speed changes (the video sourceFrame, not the timeline frame)', () => {
    const clip = makeClip({ roto: roto(), speed: 2, durationFrames: 12 })
    const scene = resolveTimeline(4, makeProject([clip]))
    expect(scene.rotoMasks![0]!.sourceFrame).toBe(scene.videos[0]!.sourceFrame)
    expect(scene.rotoMasks![0]!.sourceFrame).toBe(8)
  })

  it('copies transform and crop from the video', () => {
    const transform = { x: 0.3, y: 0.6, scale: 0.5, rotation: 0.2, anchor: { x: 0.5, y: 0.5 } }
    const crop = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }
    const scene = resolveTimeline(2, makeProject([makeClip({ roto: roto(), transform, crop })]))
    expect(scene.rotoMasks![0]!.transform).toEqual(scene.videos[0]!.transform)
    expect(scene.rotoMasks![0]!.crop).toEqual(crop)
  })

  it('matte mode is opaque regardless of view opacity, scaled by clip opacity', () => {
    const scene = resolveTimeline(
      2,
      makeProject([makeClip({ opacity: 0.5, roto: roto({}, { mode: 'matte', opacity: 0.1 }) })]),
    )
    expect(scene.rotoMasks![0]!.opacity).toBe(0.5)
    expect(scene.rotoMasks![0]!.mode).toBe('matte')
  })

  it('ignores a clip outside its time range and a malformed roto', () => {
    const bad = { ...roto(), frameCount: 0 }
    const a = resolveTimeline(30, makeProject([makeClip({ roto: roto() })]))
    expect(a.rotoMasks).toBeUndefined()
    const b = resolveTimeline(1, makeProject([makeClip({ roto: bad })]))
    expect(b.rotoMasks).toBeUndefined()
  })

  it('ignores roto on image clips', () => {
    const scene = resolveTimeline(1, makeProject([makeClip({ type: 'image', roto: roto() })]))
    expect(scene.rotoMasks).toBeUndefined()
  })
})

describe('roto helpers', () => {
  it('rotoFrameUrl replaces every placeholder', () => {
    expect(rotoFrameUrl('/m/{frame}.png?f={frame}', 7)).toBe('/m/7.png?f=7')
  })

  it('parseHexColor accepts #rrggbb and falls back on junk', () => {
    expect(parseHexColor('#00ff00')).toEqual([0, 1, 0])
    expect(parseHexColor('nope')).toEqual(parseHexColor(undefined))
  })

  it('isDrawableRoto rejects off, missing template and non-positive size', () => {
    expect(isDrawableRoto(roto())).toBe(true)
    expect(isDrawableRoto(roto({}, { mode: 'off' }))).toBe(false)
    expect(isDrawableRoto(roto({ frameUrlTemplate: '' }))).toBe(false)
    expect(isDrawableRoto(roto({ width: 0 }))).toBe(false)
    expect(isDrawableRoto(undefined)).toBe(false)
  })
})
