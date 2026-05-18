import { describe, it, expect } from 'vitest'
import { resolveTimeline } from './resolveTimeline'
import type { Project, Track, Clip } from '../../types'

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: 'p1',
    fps: 30,
    tracks: [],
    clips: {},
    version: 1,
    ...overrides,
  }
}

function makeTrack(overrides?: Partial<Track>): Track {
  return {
    id: overrides?.id ?? 't1',
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

describe('resolveTimeline', () => {
  it('returns an empty scene for an empty project', () => {
    const project = makeProject({ tracks: [], clips: {} })
    const scene = resolveTimeline(0, project)

    expect(scene.frame).toBe(0)
    expect(scene.videos.length).toBe(0)
    expect(scene.audios.length).toBe(0)
    expect(scene.texts.length).toBe(0)
    expect(scene.images.length).toBe(0)
    expect(scene.transitions.length).toBe(0)
  })

  it('includes a clip only when frame is inside its half-open range', () => {
    const track = makeTrack({ id: 't1', kind: 'video', order: 0 })
    const clip = makeClip({
      id: 'c1',
      trackId: 't1',
      type: 'video',
      startFrame: 10,
      durationFrames: 40,
      sourceStartFrame: 0,
      sourceDurationFrames: 40,
      src: 'fake.mp4',
    })
    const project = makeProject({ tracks: [track], clips: { t1: [clip] } })

    expect(resolveTimeline(9, project).videos.length).toBe(0)
    expect(resolveTimeline(10, project).videos.length).toBe(1)
    expect(resolveTimeline(49, project).videos.length).toBe(1)
    expect(resolveTimeline(50, project).videos.length).toBe(0)
  })

  it('orders overlapping clips with higher track.order at the back', () => {
    const trackA = makeTrack({ id: 'tA', order: 0 })
    const trackB = makeTrack({ id: 'tB', order: 1 })
    const clipA = makeClip({
      id: 'cA', trackId: 'tA',
      startFrame: 0, durationFrames: 30,
      sourceStartFrame: 0, sourceDurationFrames: 30,
      src: 'a.mp4',
    })
    const clipB = makeClip({
      id: 'cB', trackId: 'tB',
      startFrame: 0, durationFrames: 30,
      sourceStartFrame: 0, sourceDurationFrames: 30,
      src: 'b.mp4',
    })
    const project = makeProject({
      tracks: [trackA, trackB],
      clips: { tA: [clipA], tB: [clipB] },
    })

    const scene = resolveTimeline(0, project)

    expect(scene.videos.length).toBe(2)
    expect(scene.videos[0].trackId).toBe('tB')
    expect(scene.videos[1].trackId).toBe('tA')
    expect(scene.videos[0].zIndex).toBeLessThan(scene.videos[1].zIndex)
  })

  it('honors track and clip flags (muted, disabled)', () => {
    // a) Video track muted → volume 0
    const mutedVideoTrack = makeTrack({ id: 'tv', kind: 'video', muted: true })
    const videoClip = makeClip({ id: 'cv', trackId: 'tv', type: 'video', src: 'v.mp4' })
    const sceneA = resolveTimeline(0, makeProject({
      tracks: [mutedVideoTrack],
      clips: { tv: [videoClip] },
    }))
    expect(sceneA.videos[0].volume).toBe(0)

    // b) Audio track muted → volume 0
    const mutedAudioTrack = makeTrack({ id: 'ta', kind: 'audio', muted: true })
    const audioClip = makeClip({ id: 'ca', trackId: 'ta', type: 'audio', src: 'a.mp3' })
    const sceneB = resolveTimeline(0, makeProject({
      tracks: [mutedAudioTrack],
      clips: { ta: [audioClip] },
    }))
    expect(sceneB.audios[0].volume).toBe(0)

    // c) Disabled track → no clips appear
    const disabledTrack = makeTrack({ id: 'td', kind: 'video', disabled: true })
    const disabledTrackClip = makeClip({ id: 'cd', trackId: 'td', type: 'video', src: 'v.mp4' })
    const sceneC = resolveTimeline(0, makeProject({
      tracks: [disabledTrack],
      clips: { td: [disabledTrackClip] },
    }))
    expect(sceneC.videos.length).toBe(0)

    // d) Disabled clip → absent; sibling clip on same track still present
    const track = makeTrack({ id: 'tt', kind: 'video' })
    const activeClip = makeClip({ id: 'c-on', trackId: 'tt', startFrame: 0, durationFrames: 30 })
    const offClip = makeClip({ id: 'c-off', trackId: 'tt', startFrame: 0, durationFrames: 30, disabled: true })
    const sceneD = resolveTimeline(0, makeProject({
      tracks: [track],
      clips: { tt: [activeClip, offClip] },
    }))
    expect(sceneD.videos.length).toBe(1)
    expect(sceneD.videos[0].id).toBe('c-on')
  })

  it('excludes non-solo tracks of the same kind when solo is set', () => {
    const trackA = makeTrack({ id: 'tA', kind: 'video', order: 0, solo: true })
    const trackB = makeTrack({ id: 'tB', kind: 'video', order: 1 })
    const audioTrack = makeTrack({ id: 'tAudio', kind: 'audio', order: 2 })

    const clipA = makeClip({ id: 'cA', trackId: 'tA', type: 'video', src: 'a.mp4' })
    const clipB = makeClip({ id: 'cB', trackId: 'tB', type: 'video', src: 'b.mp4' })
    const audioClip = makeClip({ id: 'cAudio', trackId: 'tAudio', type: 'audio', src: 'a.mp3' })

    const project = makeProject({
      tracks: [trackA, trackB, audioTrack],
      clips: { tA: [clipA], tB: [clipB], tAudio: [audioClip] },
    })

    const scene = resolveTimeline(0, project)

    expect(scene.videos.length).toBe(1)
    expect(scene.videos[0].trackId).toBe('tA')
    expect(scene.audios.length).toBe(1)
  })
})
