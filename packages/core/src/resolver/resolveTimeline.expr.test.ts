import { describe, expect, it } from 'vitest'
import { resolveTimeline } from './resolveTimeline'
import { DEFAULT_TEXT_TRANSFORM } from './textAnimation'
import { clampGeneratorParams } from '../generators/registry'
import type { Clip, ClipKeyframes, Keyframe, KeyframeChannelTrack, Project, Track, Transform } from '../types'

/**
 * Expressions inside the resolver (PV-P5b-2). The parity guarantee is the point
 * of the first case: a project with no expression must produce a scene with no
 * `expressionErrors` KEY AT ALL, not an empty array, because every renderer
 * downstream reads the scene.
 */

const BASE: Transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }

const k = (frame: number, value: number): Keyframe => ({ id: `k${frame}`, frame, value, easing: 'linear' })

const expr = (source: string, keys: Keyframe[] = []): KeyframeChannelTrack => ({
  source: { kind: 'expression', source },
  keys,
})

const kf = (channels: ClipKeyframes['channels']): ClipKeyframes => ({ channels })

function makeTrack(o: Partial<Track> = {}): Track {
  return {
    id: 'el-1', name: 'T', kind: 'elements', order: 0, height: 54,
    locked: false, disabled: false, muted: false, solo: false, ...o,
  }
}

function makeClip(o: Partial<Clip> = {}): Clip {
  return {
    id: 'c1', trackId: 'el-1', type: 'text', name: 'T', content: 'x',
    startFrame: 0, durationFrames: 30, sourceStartFrame: 0, sourceDurationFrames: 30,
    transform: { ...DEFAULT_TEXT_TRANSFORM },
    ...o,
  } as unknown as Clip
}

function makeProject(clips: Clip[], track = makeTrack()): Project {
  return {
    id: 'p1', fps: 30, stage: { width: 1080, height: 1920 },
    tracks: [track], clips: { [track.id]: clips }, transitions: [], version: 1,
  } as unknown as Project
}

describe('resolveTimeline with expressions', () => {
  it('leaves a project with no expression byte-identical', () => {
    const c = makeClip({ keyframes: kf({ x: { source: { kind: 'keyframes' }, keys: [k(0, 0.2), k(10, 0.4)] } }) })
    const scene = resolveTimeline(5, makeProject([c]))
    // Absent, not empty: a renderer doing `'expressionErrors' in scene` must be
    // able to tell "no expressions" from "an expression failed".
    expect('expressionErrors' in scene).toBe(false)
    expect(scene.texts[0]!.transform!.x).toBeCloseTo(0.3, 10)
  })

  it('drives a transform channel from an expression', () => {
    const c = makeClip({ transform: { ...DEFAULT_TEXT_TRANSFORM, x: 0.3 }, keyframes: kf({ x: expr('value + 0.1') }) })
    expect(resolveTimeline(0, makeProject([c])).texts[0]!.transform!.x).toBeCloseTo(0.4, 10)
  })

  it('uses the per-type default when the clip has no transform at all', () => {
    const c = makeClip({ transform: undefined, keyframes: kf({ x: expr('value') }) })
    expect(resolveTimeline(0, makeProject([c])).texts[0]!.transform!.x).toBe(DEFAULT_TEXT_TRANSFORM.x)
  })

  it('clamps an expression exactly as it clamps a key', () => {
    const hi = makeClip({ keyframes: kf({ opacity: expr('2') }) })
    expect(resolveTimeline(0, makeProject([hi])).texts[0]!.opacity).toBe(1)
    const lo = makeClip({ keyframes: kf({ opacity: expr('-1') }) })
    expect(resolveTimeline(0, makeProject([lo])).texts[0]!.opacity).toBe(0)
    const zero = makeClip({ keyframes: kf({ scale: expr('0') }) })
    expect(resolveTimeline(0, makeProject([zero])).texts[0]!.transform!.scale).toBe(0.001)
  })

  it('drives an effect parameter, and the registry still clamps it', () => {
    const c = makeClip({
      effects: [{ id: 'e1', kind: 'gaussianBlur', params: { radius: 10 } }],
      keyframes: kf({ 'fx.e1.radius': expr('value * 2') }),
    } as unknown as Partial<Clip>)
    expect(resolveTimeline(0, makeProject([c])).texts[0]!.effects![0]!.params.radius).toBe(20)

    const wild = makeClip({
      effects: [{ id: 'e1', kind: 'gaussianBlur', params: { radius: 10 } }],
      keyframes: kf({ 'fx.e1.radius': expr('1000') }),
    } as unknown as Partial<Clip>)
    expect(resolveTimeline(0, makeProject([wild])).texts[0]!.effects![0]!.params.radius).toBe(100)
  })

  it('drives a mask field', () => {
    const c = makeClip({
      mask: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
      keyframes: kf({ 'mask.x': expr('0.25') }),
    } as unknown as Partial<Clip>)
    expect(resolveTimeline(0, makeProject([c])).texts[0]!.mask!.x).toBe(0.25)
  })

  it('drives a generator param through vis.extended, not a second sample', () => {
    const c = makeClip({
      type: 'generator',
      generator: { kind: 'particles', params: { speed: 1 } },
      keyframes: kf({ 'gen.speed': expr('3') }),
    } as unknown as Partial<Clip>)
    const scene = resolveTimeline(0, makeProject([c]))
    const expected = clampGeneratorParams('particles', { speed: 3 })!.speed
    expect(scene.generators![0]!.params.speed).toBe(expected)
    // Sampled once: a second sample would report the same error twice.
    expect(scene.expressionErrors).toBeUndefined()
  })

  it('reports a bad expression once and falls back to the authored value', () => {
    const c = makeClip({ transform: { ...DEFAULT_TEXT_TRANSFORM, x: 0.42 }, keyframes: kf({ x: expr('nope + 1') }) })
    const scene = resolveTimeline(0, makeProject([c]))
    expect(scene.texts[0]!.transform!.x).toBe(0.42)
    expect(scene.expressionErrors).toEqual([
      { clipId: 'c1', channel: 'x', code: 'unknown-identifier', message: 'Unknown name "nope"', pos: 0 },
    ])
  })

  it('resolves the same frame twice to the same scene', () => {
    // wiggle is the reason this matters: a seeded noise source must be stable,
    // or a paused preview and a re-render would disagree.
    const c = makeClip({ keyframes: kf({ x: expr('value + wiggle(2, 0.1)') }) })
    const p = makeProject([c])
    expect(resolveTimeline(7, p)).toEqual(resolveTimeline(7, p))
  })

  it('drives the incoming clip of a transition', () => {
    const from = makeClip({ id: 'a', type: 'video', src: 'a.mp4', keyframes: kf({ opacity: expr('0.5') }) })
    const to = makeClip({ id: 'b', type: 'video', src: 'b.mp4', startFrame: 30, keyframes: kf({ opacity: expr('0.25') }) })
    const track = makeTrack({ id: 'v1', kind: 'video' })
    const p = makeProject([from, to], track)
    p.transitions = [{ id: 'x1', fromClipId: 'a', toClipId: 'b', kind: 'fade', durationFrames: 10 }] as Project['transitions']
    // The transition pass samples the incoming clip BEFORE its start.
    const scene = resolveTimeline(28, p)
    const a = scene.videos.find((v) => v.id === 'a')!
    expect(a.opacity).toBeLessThan(1)
  })
})
