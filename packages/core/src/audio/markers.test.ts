import { describe, expect, it } from 'vitest'
import type { AudioAnalysis } from './analysis'
import {
  AUDIO_EXPR_NAMES,
  MAX_ENVELOPE_FRAMES,
  audioValueAt,
  beatFramesOnTimeline,
  clipBeatFrames,
  clipSilenceRanges,
  decodeEnvelope,
  defaultAudioSourceFor,
  encodeEnvelope,
  localBeatsInClip,
  markerSetForClip,
  sourceToTimelineFrame,
  summarizeAnalysis,
} from './markers'
import type { AudioMarkerSet, Clip, Project, Track } from '../types'

function track(overrides: Partial<Track> & Pick<Track, 'id'>): Track {
  return {
    name: overrides.id,
    kind: 'audio',
    order: 0,
    height: 54,
    locked: false,
    disabled: false,
    muted: false,
    solo: false,
    ...overrides,
  }
}

function clip(overrides: Partial<Clip> & Pick<Clip, 'id' | 'trackId'>): Clip {
  return {
    type: 'audio',
    name: overrides.id,
    startFrame: 0,
    durationFrames: 30,
    sourceStartFrame: 0,
    sourceDurationFrames: 30,
    ...overrides,
  }
}

function literalAnalysis(overrides: Partial<AudioAnalysis> = {}): AudioAnalysis {
  return {
    version: 1,
    sampleRate: 22050,
    fps: 30,
    durationFrames: 3,
    bpm: 120,
    tempoConfidence: 0.5,
    beats: [0, 2],
    onsets: [0, 2],
    silences: [[1, 2]],
    loudness: new Float32Array([0, 0.5, 1]),
    bands: {
      low: new Float32Array([0, 0.5, 1]),
      mid: new Float32Array([0, 0.5, 1]),
      high: new Float32Array([0, 0.5, 1]),
    },
    ...overrides,
  }
}

describe('encodeEnvelope / decodeEnvelope', () => {
  it('round-trips through base64', () => {
    expect(encodeEnvelope([0, 0.5, 1, 2, -1])).toBe('AID//wA=')
    expect(Array.from(decodeEnvelope('AID//wA='))).toEqual([0, 128, 255, 255, 0])
  })

  it('an undecodable string decodes to an empty array', () => {
    expect(decodeEnvelope('%%%')).toHaveLength(0)
  })
})

describe('summarizeAnalysis', () => {
  it('summarises a literal analysis with envelopes', () => {
    const set = summarizeAnalysis(literalAnalysis(), 'song.mp3')
    expect(set.src).toBe('song.mp3')
    expect(set.fps).toBe(30)
    expect(set.version).toBe(1)
    expect(set.bpm).toBe(120)
    expect(set.beats).toEqual([0, 2])
    expect(set.silences).toEqual([[1, 2]])
    expect(set.envelopes?.level).toBe('AID/')
  })

  it('omits envelopes when asked', () => {
    const set = summarizeAnalysis(literalAnalysis(), 'song.mp3', { envelopes: false })
    expect('envelopes' in set).toBe(false)
  })

  it('omits bpm when the analysis has none', () => {
    const set = summarizeAnalysis(literalAnalysis({ bpm: undefined }), 'song.mp3')
    expect('bpm' in set).toBe(false)
  })

  it('omits envelopes for a source longer than MAX_ENVELOPE_FRAMES', () => {
    const set = summarizeAnalysis(literalAnalysis({ durationFrames: MAX_ENVELOPE_FRAMES + 1 }), 'song.mp3')
    expect('envelopes' in set).toBe(false)
  })
})

describe('markerSetForClip', () => {
  it('finds the set for the clip src whose fps matches the project', () => {
    const set: AudioMarkerSet = { src: 'song.mp3', fps: 30, version: 1, beats: [], silences: [] }
    const project = { fps: 30, audioMarkers: [set] }
    expect(markerSetForClip(project, { src: 'song.mp3' })).toBe(set)
  })

  it('is undefined when fps does not match', () => {
    const set: AudioMarkerSet = { src: 'song.mp3', fps: 25, version: 1, beats: [], silences: [] }
    const project = { fps: 30, audioMarkers: [set] }
    expect(markerSetForClip(project, { src: 'song.mp3' })).toBeUndefined()
  })
})

describe('sourceToTimelineFrame', () => {
  const clipShape = { startFrame: 60, durationFrames: 90, sourceStartFrame: 30 }
  it('maps a source frame inside the clip', () => {
    expect(sourceToTimelineFrame(clipShape, 45)).toBe(75)
  })
  it('is null before the trim start', () => {
    expect(sourceToTimelineFrame(clipShape, 29)).toBeNull()
  })
  it('is null at/after the clip end', () => {
    expect(sourceToTimelineFrame(clipShape, 120)).toBeNull()
  })
})

describe('clipBeatFrames', () => {
  const songClip = clip({
    id: 'c1',
    trackId: 't1',
    startFrame: 60,
    sourceStartFrame: 30,
    durationFrames: 90,
    src: 'song',
  })

  it('maps beats inside the clip window, dropping the rest', () => {
    const set: AudioMarkerSet = {
      src: 'song',
      fps: 30,
      version: 1,
      beats: [0, 15, 30, 45, 119, 120, 150],
      silences: [],
    }
    const project = { fps: 30, audioMarkers: [set] }
    expect(clipBeatFrames(project, songClip)).toEqual([60, 75, 149])
  })

  it('is empty when the set fps does not match the project', () => {
    const set: AudioMarkerSet = { src: 'song', fps: 25, version: 1, beats: [0, 15, 30], silences: [] }
    const project = { fps: 30, audioMarkers: [set] }
    expect(clipBeatFrames(project, songClip)).toEqual([])
  })
})

describe('clipSilenceRanges', () => {
  it('clips and shifts silences into timeline space', () => {
    const songClip = clip({
      id: 'c1',
      trackId: 't1',
      startFrame: 60,
      sourceStartFrame: 30,
      durationFrames: 90,
      src: 'song',
    })
    const set: AudioMarkerSet = {
      src: 'song',
      fps: 30,
      version: 1,
      beats: [],
      silences: [
        [0, 40],
        [100, 130],
        [140, 200],
      ],
    }
    const project = { fps: 30, audioMarkers: [set] }
    expect(clipSilenceRanges(project, songClip)).toEqual([
      [60, 70],
      [130, 150],
    ])
  })
})

describe('beatFramesOnTimeline', () => {
  const set: AudioMarkerSet = { src: 'song', fps: 30, version: 1, beats: [0, 10], silences: [] }

  function baseProject(overrides: Partial<Project> = {}): Pick<Project, 'fps' | 'audioMarkers' | 'tracks' | 'clips'> {
    return {
      fps: 30,
      audioMarkers: [set],
      tracks: [],
      clips: {},
      ...overrides,
    }
  }

  it('unions beats from two clips of the same src at different starts, deduped', () => {
    const t1 = track({ id: 't1' })
    const t2 = track({ id: 't2' })
    const c1 = clip({ id: 'c1', trackId: 't1', startFrame: 0, durationFrames: 30, src: 'song' })
    const c2 = clip({ id: 'c2', trackId: 't2', startFrame: 20, durationFrames: 30, src: 'song' })
    const project = baseProject({
      tracks: [t1, t2],
      clips: { t1: [c1], t2: [c2] },
    })
    // c1: beats at 0, 10. c2: beats at 20, 30.
    expect(beatFramesOnTimeline(project)).toEqual([0, 10, 20, 30])
  })

  it('a clip on a disabled track contributes nothing', () => {
    const t1 = track({ id: 't1', disabled: true })
    const c1 = clip({ id: 'c1', trackId: 't1', startFrame: 0, durationFrames: 30, src: 'song' })
    const project = baseProject({ tracks: [t1], clips: { t1: [c1] } })
    expect(beatFramesOnTimeline(project)).toEqual([])
  })

  it('a muted track still contributes', () => {
    const t1 = track({ id: 't1', muted: true })
    const c1 = clip({ id: 'c1', trackId: 't1', startFrame: 0, durationFrames: 30, src: 'song' })
    const project = baseProject({ tracks: [t1], clips: { t1: [c1] } })
    expect(beatFramesOnTimeline(project)).toEqual([0, 10])
  })

  it('clipId limits the union to that one clip', () => {
    const t1 = track({ id: 't1' })
    const t2 = track({ id: 't2' })
    const c1 = clip({ id: 'c1', trackId: 't1', startFrame: 0, durationFrames: 30, src: 'song' })
    const c2 = clip({ id: 'c2', trackId: 't2', startFrame: 20, durationFrames: 30, src: 'song' })
    const project = baseProject({ tracks: [t1, t2], clips: { t1: [c1], t2: [c2] } })
    expect(beatFramesOnTimeline(project, { clipId: 'c1' })).toEqual([0, 10])
  })
})

describe('localBeatsInClip', () => {
  it('reports beats local to the target, only those inside its span', () => {
    const set: AudioMarkerSet = { src: 'song', fps: 30, version: 1, beats: [0, 15], silences: [] }
    const t1 = track({ id: 't1' })
    // A clip whose clipBeatFrames yields timeline beats [60, 75, 149].
    const audioClip = clip({
      id: 'audio1',
      trackId: 't1',
      startFrame: 60,
      sourceStartFrame: 30,
      durationFrames: 90,
      src: 'song',
    })
    const fullSet: AudioMarkerSet = {
      src: 'song',
      fps: 30,
      version: 1,
      beats: [0, 15, 30, 45, 119, 120, 150],
      silences: [],
    }
    const project: Pick<Project, 'fps' | 'audioMarkers' | 'tracks' | 'clips'> = {
      fps: 30,
      audioMarkers: [fullSet],
      tracks: [t1],
      clips: { t1: [audioClip] },
    }
    // Sanity: the timeline beats this fixture produces are [60, 75, 149].
    expect(beatFramesOnTimeline(project)).toEqual([60, 75, 149])
    const target = clip({ id: 'target', trackId: 'v1', startFrame: 70, durationFrames: 50 })
    expect(localBeatsInClip(project, target)).toEqual([5])
  })
})

describe('defaultAudioSourceFor', () => {
  const set: AudioMarkerSet = { src: 'song', fps: 30, version: 1, beats: [], silences: [] }

  it('picks the clip with the larger overlap', () => {
    const t1 = track({ id: 't1' })
    const target = clip({ id: 'target', trackId: 'v1', startFrame: 0, durationFrames: 100 })
    // Overlaps target [0,100) by 20 frames.
    const small = clip({ id: 'small', trackId: 't1', startFrame: -80, durationFrames: 100, src: 'song' })
    // Overlaps target [0,100) by 40 frames.
    const big = clip({ id: 'big', trackId: 't1', startFrame: 60, durationFrames: 100, src: 'song' })
    const project = { fps: 30, audioMarkers: [set], tracks: [t1], clips: { t1: [small, big] } }
    expect(defaultAudioSourceFor(project, target)).toBe(big)
  })

  it('never chooses a clip without an analysed set', () => {
    const t1 = track({ id: 't1' })
    const target = clip({ id: 'target', trackId: 'v1', startFrame: 0, durationFrames: 100 })
    const noSet = clip({ id: 'unanalysed', trackId: 't1', startFrame: 0, durationFrames: 100, src: 'other' })
    const project = { fps: 30, audioMarkers: [set], tracks: [t1], clips: { t1: [noSet] } }
    expect(defaultAudioSourceFor(project, target)).toBeUndefined()
  })

  it('is undefined when nothing overlaps', () => {
    const t1 = track({ id: 't1' })
    const target = clip({ id: 'target', trackId: 'v1', startFrame: 0, durationFrames: 100 })
    const far = clip({ id: 'far', trackId: 't1', startFrame: 1000, durationFrames: 100, src: 'song' })
    const project = { fps: 30, audioMarkers: [set], tracks: [t1], clips: { t1: [far] } }
    expect(defaultAudioSourceFor(project, target)).toBeUndefined()
  })
})

describe('audioValueAt', () => {
  function fullProject(overrides: Partial<Project> = {}): Project {
    return {
      id: 'p1',
      fps: 30,
      stage: { width: 1920, height: 1080 },
      tracks: [],
      clips: {},
      transitions: [],
      version: 1,
      ...overrides,
    }
  }

  function songProject(): Project {
    const levelEnvelope = encodeEnvelope(Array.from({ length: 120 }, (_, i) => i / 119))
    const set: AudioMarkerSet = {
      src: 'song',
      fps: 30,
      version: 1,
      bpm: 120,
      beats: [0, 15, 30],
      silences: [[40, 60]],
      envelopes: { level: levelEnvelope, low: levelEnvelope, mid: levelEnvelope, high: levelEnvelope },
    }
    const t1 = track({ id: 't1' })
    const songClip = clip({ id: 'song', trackId: 't1', startFrame: 0, durationFrames: 120, src: 'song' })
    return fullProject({ audioMarkers: [set], tracks: [t1], clips: { t1: [songClip] } })
  }

  it('AUDIO_EXPR_NAMES lists exactly the nine names', () => {
    expect(AUDIO_EXPR_NAMES).toEqual(['beat', 'sinceBeat', 'beatIndex', 'bpm', 'silent', 'level', 'low', 'mid', 'high'])
  })

  it('beat: 1 on the beat, decaying, 0 past the pulse window', () => {
    const project = songProject()
    expect(audioValueAt(project, 0, 'beat')).toBe(1)
    expect(audioValueAt(project, 3, 'beat')).toBeCloseTo(0.5, 9)
    expect(audioValueAt(project, 6, 'beat')).toBe(0)
    expect(audioValueAt(project, 15, 'beat')).toBe(1)
  })

  it('sinceBeat: seconds since the last beat', () => {
    const project = songProject()
    expect(audioValueAt(project, 20, 'sinceBeat')).toBeCloseTo(5 / 30, 9)
  })

  it('beatIndex: index of the last beat, -1 before the first', () => {
    const project = songProject()
    expect(audioValueAt(project, 20, 'beatIndex')).toBe(1)
    const set: AudioMarkerSet = { src: 'song', fps: 30, version: 1, beats: [10], silences: [] }
    const t1 = track({ id: 't1' })
    const songClip = clip({ id: 'song', trackId: 't1', startFrame: 0, durationFrames: 120, src: 'song' })
    const only10 = fullProject({ audioMarkers: [set], tracks: [t1], clips: { t1: [songClip] } })
    expect(audioValueAt(only10, 5, 'beatIndex')).toBe(-1)
  })

  it('bpm: the first analysed clip with one', () => {
    const project = songProject()
    expect(audioValueAt(project, 0, 'bpm')).toBe(120)
  })

  it('silent: 1 inside a silence, 0 outside, 1 when no clip is active', () => {
    const project = songProject()
    expect(audioValueAt(project, 45, 'silent')).toBe(1)
    expect(audioValueAt(project, 10, 'silent')).toBe(0)
    expect(audioValueAt(project, 200, 'silent')).toBe(1)
  })

  it('level: the envelope byte at the mapped source frame', () => {
    const project = songProject()
    const expected = Math.round((60 / 119) * 255) / 255
    expect(audioValueAt(project, 60, 'level')).toBeCloseTo(expected, 6)
  })

  it('an unknown name is undefined', () => {
    const project = songProject()
    expect(audioValueAt(project, 0, 'nonsense')).toBeUndefined()
  })

  it('a project without audioMarkers is undefined', () => {
    const project = fullProject()
    expect(audioValueAt(project, 0, 'beat')).toBeUndefined()
  })

  it('reuses its per-project cache, and a changed audioMarkers array changes the answer', () => {
    const project = songProject()
    const first = audioValueAt(project, 0, 'bpm')
    const second = audioValueAt(project, 0, 'bpm')
    expect(second).toBe(first)

    const otherSet: AudioMarkerSet = { src: 'song', fps: 30, version: 1, bpm: 90, beats: [0], silences: [] }
    const changed: Project = { ...project, audioMarkers: [otherSet] }
    expect(audioValueAt(changed, 0, 'bpm')).toBe(90)
    // The original project's cached answer is untouched.
    expect(audioValueAt(project, 0, 'bpm')).toBe(120)
  })
})
