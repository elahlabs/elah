import { describe, expect, it } from 'vitest'
import { resolveTimeline } from './resolveTimeline'
import { isExpressionChannel, isKeyframeChannelName } from './keyframes'
import type { Clip, Keyframe, Project, Track } from '../types'

function key(frame: number, value: number): Keyframe {
  return { id: `k${frame}`, frame, value, easing: 'linear' }
}

function shapeAt(frame: number, clip: Partial<Clip>): { start: number; end: number } | undefined {
  const track: Track = { id: 'e1', name: 'E', kind: 'elements', order: 0, height: 64, locked: false, disabled: false, muted: false, solo: false }
  const project: Project = {
    id: 'p',
    fps: 30,
    stage: { width: 1000, height: 1000 },
    tracks: [track],
    clips: {
      e1: [
        {
          id: 's1',
          trackId: 'e1',
          type: 'shape',
          name: 'S',
          startFrame: 0,
          durationFrames: 100,
          sourceStartFrame: 0,
          sourceDurationFrames: 100,
          shapeKind: 'rect',
          ...clip,
        } as Clip,
      ],
    },
    transitions: [],
    version: 1,
  }
  return resolveTimeline(frame, project).shapes[0]?.shapeDraw
}

describe('draw.start', () => {
  it('is a key channel but never an expression channel', () => {
    expect(isKeyframeChannelName('draw.start')).toBe(true)
    expect(isKeyframeChannelName('draw')).toBe(true)
    expect(isExpressionChannel('draw.start')).toBe(false)
    expect(isExpressionChannel('draw')).toBe(false)
  })

  it('both channels keyed give a travelling window', () => {
    const clip: Partial<Clip> = {
      shapeDraw: { start: 0, end: 1 },
      keyframes: {
        channels: {
          draw: { source: { kind: 'keyframes' }, keys: [key(0, 0.2), key(40, 0.6)] },
          'draw.start': { source: { kind: 'keyframes' }, keys: [key(0, 0), key(40, 0.4)] },
        },
      },
    }
    expect(shapeAt(0, clip)).toEqual({ start: 0, end: 0.2 })
    const mid = shapeAt(20, clip)!
    expect(mid.start).toBeCloseTo(0.2, 10)
    expect(mid.end).toBeCloseTo(0.4, 10)
    expect(shapeAt(40, clip)).toEqual({ start: 0.4, end: 0.6 })
  })

  it('keeps end >= start and clamps to 0..1', () => {
    const clip: Partial<Clip> = {
      keyframes: { channels: { 'draw.start': { source: { kind: 'keyframes' }, keys: [key(0, 0.5), key(10, 3)] } } },
    }
    expect(shapeAt(0, clip)).toEqual({ start: 0.5, end: 1 })
    expect(shapeAt(10, clip)).toEqual({ start: 1, end: 1 })
    const crossing: Partial<Clip> = {
      shapeDraw: { start: 0, end: 0.3 },
      keyframes: { channels: { 'draw.start': { source: { kind: 'keyframes' }, keys: [key(0, 0.6)] } } },
    }
    expect(shapeAt(5, crossing)).toEqual({ start: 0.6, end: 0.6 })
  })

  it('an old document with only draw (and shapeDraw.start) resolves as before', () => {
    const onlyDraw: Partial<Clip> = {
      shapeDraw: { start: 0.1, end: 1 },
      keyframes: { channels: { draw: { source: { kind: 'keyframes' }, keys: [key(0, 0), key(10, 0.5)] } } },
    }
    expect(shapeAt(0, onlyDraw)).toEqual({ start: 0.1, end: 0.1 })
    expect(shapeAt(10, onlyDraw)).toEqual({ start: 0.1, end: 0.5 })
    expect(shapeAt(0, {})).toBeUndefined()
  })
})
