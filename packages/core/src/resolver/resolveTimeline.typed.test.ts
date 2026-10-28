import { describe, expect, it } from 'vitest'
import { resolveTimeline } from './resolveTimeline'
import type { Clip, ClipKeyframes, Keyframe, Project, Track } from '../types'
import { parseColor } from '../utils/color'

function colorKey(frame: number, color: string): Keyframe {
  return { id: `k-${frame}`, frame, value: 0, vec: parseColor(color)!, easing: 'linear' }
}

function pathKey(frame: number, path: string): Keyframe {
  return { id: `p-${frame}`, frame, value: 0, path, easing: 'linear' }
}

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 't1',
    name: 'T',
    kind: 'elements',
    order: 0,
    height: 64,
    locked: false,
    disabled: false,
    muted: false,
    solo: false,
    ...overrides,
  }
}

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    trackId: 't1',
    type: 'text',
    name: 'C',
    startFrame: 0,
    durationFrames: 60,
    sourceStartFrame: 0,
    sourceDurationFrames: 60,
    content: 'Hi',
    ...overrides,
  }
}

function makeProject(clips: Clip[], track = makeTrack()): Project {
  return {
    id: 'p1',
    fps: 30,
    stage: { width: 1080, height: 1920 },
    tracks: [track],
    clips: { [track.id]: clips },
    transitions: [],
    version: 1,
  }
}

describe('resolveTimeline typed channels (PV-P5c)', () => {
  it('a keyed text colour resolves through the sampler', () => {
    const keyframes: ClipKeyframes = {
      channels: { color: { source: { kind: 'keyframes' }, keys: [colorKey(0, '#ff0000'), colorKey(60, '#0000ff')] } },
    }
    const scene = resolveTimeline(15, makeProject([makeClip({ keyframes })]))
    expect(scene.texts[0]!.color).toBe('#bf0040')
  })

  it('an unkeyed text clip has no color key at all', () => {
    const scene = resolveTimeline(0, makeProject([makeClip()]))
    expect('color' in scene.texts[0]!).toBe(false)
  })

  it('a shape with shape.fill keys resolves fill from the keys and keeps the authored stroke', () => {
    const keyframes: ClipKeyframes = {
      channels: { 'shape.fill': { source: { kind: 'keyframes' }, keys: [colorKey(0, '#ff0000'), colorKey(60, '#0000ff')] } },
    }
    const clip = makeClip({ type: 'shape', shapeKind: 'rect', shapeStroke: '#123456', content: undefined, keyframes })
    const scene = resolveTimeline(15, makeProject([clip]))
    expect(scene.shapes[0]!.shapeFill).toBe('#bf0040')
    expect(scene.shapes[0]!.shapeStroke).toBe('#123456')
  })

  it('a shape with no typed keys resolves the same defaults as before', () => {
    const clip = makeClip({ type: 'shape', shapeKind: 'rect', content: undefined })
    const scene = resolveTimeline(0, makeProject([clip]))
    expect(scene.shapes[0]!.shapeFill).toBe('transparent')
    expect(scene.shapes[0]!.shapeStroke).toBe('#ffffff')
  })

  it('a path shape with shape.path keys resolves a morphed path at the midpoint and the exact key at the key frames', () => {
    const square = 'M0 0 L10 0 L10 10 L0 10 Z'
    const biggerSquare = 'M0 0 L20 0 L20 20 L0 20 Z'
    const keyframes: ClipKeyframes = {
      channels: { 'shape.path': { source: { kind: 'keyframes' }, keys: [pathKey(0, square), pathKey(60, biggerSquare)] } },
    }
    const clip = makeClip({ type: 'shape', shapeKind: 'path', content: undefined, keyframes, durationFrames: 61 })
    const project = makeProject([clip])
    expect(resolveTimeline(0, project).shapes[0]!.shapePath).toBe(square)
    expect(resolveTimeline(60, project).shapes[0]!.shapePath).toBe(biggerSquare)
    const mid = resolveTimeline(30, project).shapes[0]!.shapePath
    expect(mid).not.toBe(square)
    expect(mid).not.toBe(biggerSquare)
  })
})
