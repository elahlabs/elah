import { describe, expect, it } from 'vitest'
import { resolveTimeline } from '../resolveTimeline'
import { DEFAULT_TEXT_TRANSFORM } from '../textAnimation'
import type { AudioMarkerSet, Clip, ClipKeyframes, KeyframeChannelTrack, Project, Track } from '../../types'

/**
 * `audio.*` in expressions (PV-P10b-3): the default hook `createExpressionContext`
 * computes from `project.audioMarkers`, wired through `resolveTimeline` exactly
 * like `prop()` (PV-P7a-2). A project with no `audioMarkers` keeps the previous
 * "unavailable" diagnostic — nothing regresses for a project that never detected
 * beats.
 */

const expr = (source: string): KeyframeChannelTrack => ({ source: { kind: 'expression', source }, keys: [] })
const kf = (channels: ClipKeyframes['channels']): ClipKeyframes => ({ channels })

function tracks(): { audio: Track; elements: Track } {
  return {
    audio: { id: 'a1', name: 'Audio', kind: 'audio', order: 0, height: 54, locked: false, disabled: false, muted: false, solo: false },
    elements: { id: 'el-1', name: 'T', kind: 'elements', order: 1, height: 54, locked: false, disabled: false, muted: false, solo: false },
  }
}

function songClip(): Clip {
  return {
    id: 'song', trackId: 'a1', type: 'audio', name: 'song', startFrame: 0, durationFrames: 120,
    sourceStartFrame: 0, sourceDurationFrames: 120, src: 'song',
  } as Clip
}

function textClip(): Clip {
  return {
    id: 'c1', trackId: 'el-1', type: 'text', name: 'T', content: 'x',
    startFrame: 0, durationFrames: 30, sourceStartFrame: 0, sourceDurationFrames: 30,
    transform: { ...DEFAULT_TEXT_TRANSFORM },
    opacity: 1,
    keyframes: kf({ opacity: expr('audio("beat")') }),
  } as unknown as Clip
}

function makeProject(withMarkers: boolean): Project {
  const { audio, elements } = tracks()
  const set: AudioMarkerSet = { src: 'song', fps: 30, version: 1, beats: [0, 15, 30], silences: [] }
  return {
    id: 'p1',
    fps: 30,
    stage: { width: 1080, height: 1920 },
    tracks: [audio, elements],
    clips: { a1: [songClip()], 'el-1': [textClip()] },
    transitions: [],
    version: 1,
    ...(withMarkers ? { audioMarkers: [set] } : {}),
  } as unknown as Project
}

describe('audio.* in expressions', () => {
  it('reads the beat pulse at frame 0 and frame 3', () => {
    const project = makeProject(true)
    expect(resolveTimeline(0, project).texts[0]!.opacity).toBeCloseTo(1, 9)
    expect(resolveTimeline(3, project).texts[0]!.opacity).toBeCloseTo(0.5, 9)
  })

  it('without audioMarkers, audio() is 0 and reports audio-unavailable', () => {
    const project = makeProject(false)
    const scene = resolveTimeline(0, project)
    expect(scene.texts[0]!.opacity).toBe(0)
    expect(scene.expressionErrors?.some((e) => e.code === 'audio-unavailable')).toBe(true)
  })
})
