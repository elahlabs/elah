import { describe, expect, it } from 'vitest'
import { beatCutFrames, silenceFreezeKeys, silenceFreezePatch, MAX_BEAT_CUTS } from './beatEdits'
import { sourceFrameFor } from '../resolver/sourceTime'
import type { BaselineContext } from './keyframes'
import type { Clip } from '../types'

const CTX: BaselineContext = { stage: { width: 1920, height: 1080 } }

function videoClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'v1',
    trackId: 't1',
    type: 'video',
    name: 'B-roll',
    startFrame: 0,
    durationFrames: 90,
    sourceStartFrame: 0,
    sourceDurationFrames: 90,
    src: 'clip.mp4',
    ...overrides,
  } as Clip
}

describe('beatCutFrames', () => {
  it('every beat past 0', () => {
    expect(beatCutFrames([0, 5, 10, 15, 20], 1)).toEqual([5, 10, 15, 20])
  })
  it('every Nth beat past 0, starting with the first', () => {
    expect(beatCutFrames([0, 5, 10, 15, 20], 2)).toEqual([5, 15])
  })
  it('caps at MAX_BEAT_CUTS', () => {
    const beats = Array.from({ length: 300 }, (_, i) => i + 1)
    expect(beatCutFrames(beats, 1).length).toBe(MAX_BEAT_CUTS)
  })
})

describe('silenceFreezeKeys', () => {
  it('one silence in the middle', () => {
    const clip = videoClip()
    expect(silenceFreezeKeys(clip, [[30, 45]])).toEqual([
      { frame: 0, value: 0 },
      { frame: 30, value: 30, hold: true },
      { frame: 45, value: 30 },
      { frame: 89, value: 74 },
    ])
  })

  it('two silences', () => {
    const clip = videoClip()
    expect(silenceFreezeKeys(clip, [[10, 20], [50, 60]])).toEqual([
      { frame: 0, value: 0 },
      { frame: 10, value: 10, hold: true },
      { frame: 20, value: 10 },
      { frame: 50, value: 40, hold: true },
      { frame: 60, value: 40 },
      { frame: 89, value: 69 },
    ])
  })

  it('a silence starting at frame 0', () => {
    const clip = videoClip()
    expect(silenceFreezeKeys(clip, [[0, 10]])).toEqual([
      { frame: 0, value: 0, hold: true },
      { frame: 10, value: 0 },
      { frame: 89, value: 79 },
    ])
  })

  it('a silence reaching the end of the clip', () => {
    const clip = videoClip()
    expect(silenceFreezeKeys(clip, [[80, 90]])).toEqual([
      { frame: 0, value: 0 },
      { frame: 80, value: 80, hold: true },
    ])
  })

  it('a non-zero sourceStartFrame offsets every value', () => {
    const clip = videoClip({ sourceStartFrame: 100 })
    expect(silenceFreezeKeys(clip, [[30, 45]])).toEqual([
      { frame: 0, value: 100 },
      { frame: 30, value: 130, hold: true },
      { frame: 45, value: 130 },
      { frame: 89, value: 174 },
    ])
  })

  it('assetFrames caps every value below the legacy sourceDurationFrames', () => {
    const clip = videoClip({ assetFrames: 120, sourceStartFrame: 100, sourceDurationFrames: 900 })
    const keys = silenceFreezeKeys(clip, [[30, 45]])
    for (const k of keys) expect(k.value).toBeLessThanOrEqual(119)
  })

  it('a one-frame clip emits no key beyond frame 0', () => {
    const clip = videoClip({ durationFrames: 1 })
    const keys = silenceFreezeKeys(clip, [[0, 1]])
    expect(keys.every((k) => k.frame === 0)).toBe(true)
  })
})

describe('silenceFreezePatch + sourceFrameFor', () => {
  it('the patched clip samples the frozen frame during the silence and resumes after', () => {
    const clip = videoClip()
    const patch = silenceFreezePatch(clip, [[30, 45]], CTX)
    const patched: Clip = { ...clip, ...patch }
    expect(sourceFrameFor(patched, patched.startFrame + 20)).toBe(20)
    expect(sourceFrameFor(patched, patched.startFrame + 35)).toBe(30)
    expect(sourceFrameFor(patched, patched.startFrame + 60)).toBe(45)
  })
})
