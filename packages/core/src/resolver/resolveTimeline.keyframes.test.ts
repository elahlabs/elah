import { describe, expect, it } from 'vitest'
import { resolveTimeline } from './resolveTimeline'
import { DEFAULT_TEXT_TRANSFORM } from './textAnimation'
import type { Clip, ClipKeyframes, Keyframe, Project, Track, Transform, Transition } from '../types'

/**
 * Keyframes inside the resolver: the composition order, the parity guarantee
 * for clips that have none, and the two transition-pass behaviours that
 * keyframes made visible.
 */

const BASE: Transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }

function key(frame: number, value: number, extra: Partial<Keyframe> = {}): Keyframe {
  return { id: `k${frame}`, frame, value, easing: 'linear', ...extra }
}

function kf(channels: ClipKeyframes['channels']): ClipKeyframes {
  return { channels }
}

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

function makeClip(overrides: Partial<Clip> = {}): Clip {
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

function makeProject(clips: Clip[], extra: Partial<Project> = {}, track = makeTrack()): Project {
  return {
    id: 'p1',
    fps: 30,
    stage: { width: 1080, height: 1920 },
    tracks: [track],
    clips: { [track.id]: clips },
    transitions: [],
    version: 1,
    ...extra,
  }
}

describe('resolveTimeline + keyframes — parity for clips without any', () => {
  it('a clip with no keyframes resolves exactly as before, transform absent stays absent', () => {
    const scene = resolveTimeline(10, makeProject([makeClip({ opacity: 0.4, volume: 0.6, cornerRadius: 0.1 })]))
    expect(scene.videos).toEqual([
      {
        type: 'video',
        id: 'c1',
        trackId: 't1',
        name: 'C',
        src: 'fake.mp4',
        sourceFrame: 10,
        opacity: 0.4,
        volume: 0.6,
        zIndex: 0,
        cornerRadius: 0.1,
      },
    ])
    expect('transform' in scene.videos[0]).toBe(false)
  })

  it('an empty keyframes object is indistinguishable from none', () => {
    const plain = resolveTimeline(7, makeProject([makeClip({ transform: BASE })]))
    const empty = resolveTimeline(7, makeProject([makeClip({ transform: BASE, keyframes: kf({}) })]))
    expect(empty).toEqual(plain)
  })
})

describe('resolveTimeline + keyframes — video / image', () => {
  it('interpolates a scale keyframe track on a video clip (Ken Burns) — the first animation media ever had', () => {
    const clip = makeClip({
      transform: BASE,
      keyframes: kf({ scale: { source: { kind: 'keyframes' }, keys: [key(0, 1), key(30, 2)] } }),
    })
    const project = makeProject([clip])
    expect(resolveTimeline(0, project).videos[0].transform!.scale).toBe(1)
    expect(resolveTimeline(15, project).videos[0].transform!.scale).toBeCloseTo(1.5)
    expect(resolveTimeline(29, project).videos[0].transform!.scale).toBeCloseTo(1 + 29 / 30)
    // Unkeyed channels ride the authored transform.
    expect(resolveTimeline(15, project).videos[0].transform!.x).toBe(0.5)
  })

  it('a keyed opacity REPLACES the authored opacity (absolute, not min)', () => {
    const clip = makeClip({
      type: 'image',
      src: 'a.png',
      opacity: 0.2,
      keyframes: kf({ opacity: { source: { kind: 'keyframes' }, keys: [key(0, 1), key(30, 0)] } }),
    })
    const project = makeProject([clip])
    expect(resolveTimeline(0, project).images[0].opacity).toBe(1)
    expect(resolveTimeline(15, project).images[0].opacity).toBeCloseTo(0.5)
  })

  it('keyed cornerRadius drives the circle-iris reveal with no renderer change', () => {
    const clip = makeClip({
      type: 'image',
      src: 'a.png',
      keyframes: kf({ cornerRadius: { source: { kind: 'keyframes' }, keys: [key(0, 0.5), key(30, 0)] } }),
    })
    expect(resolveTimeline(0, makeProject([clip])).images[0].cornerRadius).toBe(0.5)
    expect(resolveTimeline(15, makeProject([clip])).images[0].cornerRadius).toBeCloseTo(0.25)
  })

  it('a transform-less media clip with keys falls back to the identity base', () => {
    const clip = makeClip({
      keyframes: kf({ x: { source: { kind: 'keyframes' }, keys: [key(0, 0.1)] } }),
    })
    expect(resolveTimeline(0, makeProject([clip])).videos[0].transform).toEqual({ ...BASE, x: 0.1 })
  })

  it('keyframe frames are relative to the clip start', () => {
    const clip = makeClip({
      startFrame: 100,
      transform: BASE,
      keyframes: kf({ x: { source: { kind: 'keyframes' }, keys: [key(0, 0), key(10, 1)] } }),
    })
    expect(resolveTimeline(105, makeProject([clip])).videos[0].transform!.x).toBeCloseTo(0.5)
  })

  it('keyed volume replaces the authored volume and still folds track gain', () => {
    const clip = makeClip({
      type: 'audio',
      src: 'a.mp3',
      volume: 0.9,
      keyframes: kf({ volume: { source: { kind: 'keyframes' }, keys: [key(0, 0.5)] } }),
    })
    const scene = resolveTimeline(0, makeProject([clip], {}, makeTrack({ kind: 'audio', volume: 0.5 })))
    expect(scene.audios[0].volume).toBeCloseTo(0.25)
  })

  it('volume keys drive a merged clip’s embedded sound and still fold track gain', () => {
    const clip = makeClip({
      type: 'video',
      src: 'movie.mp4',
      embeddedAudio: true,
      volume: 0.9,
      keyframes: kf({ volume: { source: { kind: 'keyframes' }, keys: [key(0, 0), key(30, 1)] } }),
    })
    const project = makeProject([clip], {}, makeTrack({ kind: 'video', volume: 0.5 }))
    const at = (f: number) => resolveTimeline(f, project).audios.find((a) => a.id === 'c1#audio')!
    expect(at(0).volume).toBeCloseTo(0)
    expect(at(15).volume).toBeCloseTo(0.25)
    // The picture's own volume field is the same resolved value.
    expect(resolveTimeline(15, project).videos[0].volume).toBeCloseTo(at(15).volume)
  })
})

describe('resolveTimeline + keyframes — text / shape composition', () => {
  it('keyframes become the REST that the entry animation re-bases onto', () => {
    // slide-up entry: at localFrame 0 the clip sits displaced below rest; at
    // the end of the ramp it is AT rest. Rest is the keyframed x.
    const clip = makeClip({
      type: 'text',
      content: 'hi',
      transform: DEFAULT_TEXT_TRANSFORM,
      textAnimation: { in: 'slide-up', durationFrames: 10 },
      keyframes: kf({ x: { source: { kind: 'keyframes' }, keys: [key(0, 0.2), key(30, 0.8)] } }),
    })
    const project = makeProject([clip], {}, makeTrack({ kind: 'elements' }))
    // Fully arrived, on the keyframe curve: x = 0.2 + 15/30 * 0.6 = 0.5
    expect(resolveTimeline(15, project).texts[0].transform!.x).toBeCloseTo(0.5)
    // slide-up only displaces y; x tracks the keyframe even mid-ramp.
    expect(resolveTimeline(3, project).texts[0].transform!.x).toBeCloseTo(0.2 + (3 / 30) * 0.6)
    expect(resolveTimeline(3, project).texts[0].transform!.y).toBeGreaterThan(0.5)
  })

  it('opacity: keyed value replaces the authored one, then the fade takes the MIN', () => {
    const clip = makeClip({
      type: 'text',
      content: 'hi',
      opacity: 0.1,
      textAnimation: { in: 'fade', durationFrames: 10 },
      keyframes: kf({ opacity: { source: { kind: 'keyframes' }, keys: [key(0, 0.8)] } }),
    })
    const project = makeProject([clip], {}, makeTrack({ kind: 'elements' }))
    expect(resolveTimeline(20, project).texts[0].opacity).toBeCloseTo(0.8)
    expect(resolveTimeline(5, project).texts[0].opacity).toBeLessThan(0.8)
  })

  it('a shape with only an opacity key keeps transform undefined so the renderer default still applies', () => {
    const clip = makeClip({
      type: 'shape',
      shapeKind: 'rect',
      keyframes: kf({ opacity: { source: { kind: 'keyframes' }, keys: [key(0, 0.5)] } }),
    })
    const scene = resolveTimeline(0, makeProject([clip], {}, makeTrack({ kind: 'elements' })))
    expect(scene.shapes[0].opacity).toBe(0.5)
    expect(scene.shapes[0].transform).toBeUndefined()
  })
})

describe('resolveTimeline + keyframes — transition pass', () => {
  function transitionProject(from: Partial<Clip>, to: Partial<Clip>): Project {
    const a = makeClip({ id: 'a', startFrame: 0, durationFrames: 30, ...from })
    const b = makeClip({ id: 'b', startFrame: 30, durationFrames: 30, ...to })
    const t: Transition = {
      id: 'tr',
      trackId: 't1',
      fromClipId: 'a',
      toClipId: 'b',
      kind: 'fade',
      startFrame: 20,
      durationFrames: 20,
    }
    return makeProject([a, b], { transitions: [t] })
  }

  it('the incoming clip keeps its RESOLVED opacity — it is no longer forced to 1', () => {
    const project = transitionProject({}, { opacity: 0.5 })
    // Before its own start (pushed fresh by the transition pass):
    expect(resolveTimeline(25, project).videos.find((v) => v.id === 'b')!.opacity).toBe(0.5)
    // After its start (main loop resolved it, pass leaves opacity alone):
    expect(resolveTimeline(35, project).videos.find((v) => v.id === 'b')!.opacity).toBe(0.5)
  })

  // EDX-P9c: the outgoing clip is no longer forced to 0 and shown as a frozen
  // snapshot; the GPU transition composites it at its resolved opacity.
  it('the outgoing clip keeps its RESOLVED (keyframed) opacity through the transition', () => {
    const project = transitionProject(
      { keyframes: kf({ opacity: { source: { kind: 'keyframes' }, keys: [key(0, 1), key(30, 0.3)] } }) },
      {},
    )
    // Frame 25: 1 → 0.3 over 0..30, linear.
    expect(resolveTimeline(25, project).videos.find((v) => v.id === 'a')!.opacity).toBeCloseTo(1 - (0.7 * 25) / 30)
    // Frame 35 is past the clip's end: its last frame (29) holds.
    expect(resolveTimeline(35, project).videos.find((v) => v.id === 'a')!.opacity).toBeCloseTo(1 - (0.7 * 29) / 30)
  })

  it('a keyframed incoming clip HOLDS its first key before its own start instead of extrapolating', () => {
    const project = transitionProject(
      {},
      {
        transform: BASE,
        keyframes: kf({ scale: { source: { kind: 'keyframes' }, keys: [key(0, 2), key(30, 1)] } }),
      },
    )
    expect(resolveTimeline(25, project).videos.find((v) => v.id === 'b')!.transform!.scale).toBe(2)
    expect(resolveTimeline(45, project).videos.find((v) => v.id === 'b')!.transform!.scale).toBeCloseTo(1.5)
  })

  it('a keyframed outgoing clip holds its LAST key after its own end', () => {
    const project = transitionProject(
      {
        transform: BASE,
        keyframes: kf({ x: { source: { kind: 'keyframes' }, keys: [key(0, 0), key(29, 0.9)] } }),
      },
      {},
    )
    expect(resolveTimeline(35, project).videos.find((v) => v.id === 'a')!.transform!.x).toBeCloseTo(0.9)
  })
})
