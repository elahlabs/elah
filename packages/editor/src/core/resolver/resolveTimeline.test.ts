import { describe, it, expect } from 'vitest'
import { resolveTimeline } from './resolveTimeline'
import type { Project, Track, Clip } from '../types'

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: 'p1',
    fps: 30,
    stage: { width: 1080, height: 1920 },
    tracks: [],
    clips: {},
    transitions: [],
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
    expect(scene.fps).toBe(30)
    expect(scene.stage).toEqual({ width: 1080, height: 1920 })
    expect(scene.videos.length).toBe(0)
    expect(scene.audios.length).toBe(0)
    expect(scene.texts.length).toBe(0)
    expect(scene.images.length).toBe(0)
    expect(scene.transitions.length).toBe(0)
  })

  it('propagates fps and stage from project into every Scene', () => {
    const project = makeProject({ fps: 60, stage: { width: 1920, height: 1080 }, tracks: [], clips: {} })
    const scene = resolveTimeline(42, project)

    expect(scene.fps).toBe(60)
    expect(scene.stage).toEqual({ width: 1920, height: 1080 })
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

  it('computes sourceFrame correctly at the start boundary and mid-clip', () => {
    const track = makeTrack({ id: 't1', kind: 'video' })
    const clip = makeClip({
      id: 'c1',
      trackId: 't1',
      type: 'video',
      startFrame: 10,
      durationFrames: 40,
      sourceStartFrame: 5,
      sourceDurationFrames: 40,
      src: 'v.mp4',
    })
    const project = makeProject({ tracks: [track], clips: { t1: [clip] } })

    expect(resolveTimeline(10, project).videos[0].sourceFrame).toBe(5)
    expect(resolveTimeline(20, project).videos[0].sourceFrame).toBe(15)
  })

  it('propagates clip-level opacity and volume; muted track overrides volume to 0', () => {
    const track = makeTrack({ id: 't1', kind: 'video', muted: false })
    const clip = makeClip({
      id: 'c1',
      trackId: 't1',
      type: 'video',
      src: 'v.mp4',
      opacity: 0.5,
      volume: 0.25,
    })

    const sceneUnmuted = resolveTimeline(0, makeProject({ tracks: [track], clips: { t1: [clip] } }))
    expect(sceneUnmuted.videos[0].opacity).toBe(0.5)
    expect(sceneUnmuted.videos[0].volume).toBe(0.25)

    const mutedTrack = makeTrack({ id: 't1', kind: 'video', muted: true })
    const sceneMuted = resolveTimeline(0, makeProject({ tracks: [mutedTrack], clips: { t1: [clip] } }))
    expect(sceneMuted.videos[0].volume).toBe(0)
    expect(sceneMuted.videos[0].opacity).toBe(0.5)
  })

  it('activates text clips and defaults missing content to empty string', () => {
    const track = makeTrack({ id: 'tt', kind: 'text' })
    const clipWithContent = makeClip({
      id: 'c-text',
      trackId: 'tt',
      type: 'text',
      content: 'hello',
    })
    const scene = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [clipWithContent] } }))

    expect(scene.texts.length).toBe(1)
    expect(scene.texts[0].content).toBe('hello')
    expect(typeof scene.texts[0].sourceFrame).toBe('number')
    expect(typeof scene.texts[0].zIndex).toBe('number')

    const clipNoContent = makeClip({ id: 'c-empty', trackId: 'tt', type: 'text' })
    const sceneEmpty = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [clipNoContent] } }))
    expect(sceneEmpty.texts[0].content).toBe('')
  })

  it('passes text style fields through to the active text clip', () => {
    const track = makeTrack({ id: 'tt', kind: 'text' })
    const styled = makeClip({
      id: 'c-styled',
      trackId: 'tt',
      type: 'text',
      content: 'styled',
      fontSize: 96,
      color: '#ff0000',
      fontFamily: 'Inter',
      fontWeight: 'bold',
      textAlign: 'left',
    })
    const scene = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [styled] } }))
    const text = scene.texts[0]

    expect(text.fontSize).toBe(96)
    expect(text.color).toBe('#ff0000')
    expect(text.fontFamily).toBe('Inter')
    expect(text.fontWeight).toBe('bold')
    expect(text.textAlign).toBe('left')

    // Unstyled clip leaves the fields undefined (TextLayer applies defaults).
    const plain = makeClip({ id: 'c-plain', trackId: 'tt', type: 'text', content: 'x' })
    const scenePlain = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [plain] } }))
    expect(scenePlain.texts[0].fontSize).toBeUndefined()
    expect(scenePlain.texts[0].color).toBeUndefined()
  })

  it('image clips follow video solo rules', () => {
    const trackVid = makeTrack({ id: 'tVid', kind: 'video', order: 0, solo: true })
    const trackImg = makeTrack({ id: 'tImg', kind: 'video', order: 1, solo: false })
    const videoClip = makeClip({ id: 'cVid', trackId: 'tVid', type: 'video', src: 'v.mp4' })
    const imageClip = makeClip({ id: 'cImg', trackId: 'tImg', type: 'image', src: 'img.png' })

    const projectWithSolo = makeProject({
      tracks: [trackVid, trackImg],
      clips: { tVid: [videoClip], tImg: [imageClip] },
    })
    expect(resolveTimeline(0, projectWithSolo).images.length).toBe(0)

    const trackVidNoSolo = makeTrack({ id: 'tVid', kind: 'video', order: 0, solo: false })
    const projectNoSolo = makeProject({
      tracks: [trackVidNoSolo, trackImg],
      clips: { tVid: [videoClip], tImg: [imageClip] },
    })
    const scene = resolveTimeline(0, projectNoSolo)
    expect(scene.images.length).toBe(1)
    expect(scene.images[0].src).toBe('img.png')
    expect(typeof scene.images[0].sourceFrame).toBe('number')
  })

  it('drops video and audio clips when src is an empty string', () => {
    const videoTrack = makeTrack({ id: 'tv', kind: 'video' })
    const videoClip = makeClip({ id: 'cv', trackId: 'tv', type: 'video', src: '' })
    const sceneVideo = resolveTimeline(0, makeProject({ tracks: [videoTrack], clips: { tv: [videoClip] } }))
    expect(sceneVideo.videos.length).toBe(0)

    const audioTrack = makeTrack({ id: 'ta', kind: 'audio' })
    const audioClip = makeClip({ id: 'ca', trackId: 'ta', type: 'audio', src: '' })
    const sceneAudio = resolveTimeline(0, makeProject({ tracks: [audioTrack], clips: { ta: [audioClip] } }))
    expect(sceneAudio.audios.length).toBe(0)
  })

  it('handles a track with no clips entry without throwing', () => {
    const track = makeTrack({ id: 't-orphan', kind: 'video' })
    const project = makeProject({ tracks: [track], clips: {} })
    const scene = resolveTimeline(0, project)

    expect(scene.videos.length).toBe(0)
    expect(scene.audios.length).toBe(0)
    expect(scene.texts.length).toBe(0)
    expect(scene.images.length).toBe(0)
  })

  it('passes Clip.transform through to ActiveClipBase.transform', () => {
    const transform = {
      x: 0.5, y: 0.5, scale: 1.5, rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
    }
    const project = makeProject({
      tracks: [makeTrack()],
      clips: { t1: [makeClip({ transform })] },
    })
    const scene = resolveTimeline(0, project)
    expect(scene.videos[0].transform).toEqual(transform)
  })

  it('still excludes a disabled clip even when its track is solo', () => {
    const track = makeTrack({ id: 'ts', kind: 'video', solo: true })
    const activeClip = makeClip({ id: 'c-on', trackId: 'ts', type: 'video', src: 'a.mp4', startFrame: 0, durationFrames: 30 })
    const disabledClip = makeClip({ id: 'c-off', trackId: 'ts', type: 'video', src: 'b.mp4', startFrame: 0, durationFrames: 30, disabled: true })
    const project = makeProject({ tracks: [track], clips: { ts: [activeClip, disabledClip] } })

    const scene = resolveTimeline(0, project)
    expect(scene.videos.length).toBe(1)
    expect(scene.videos[0].id).toBe('c-on')
  })
})
