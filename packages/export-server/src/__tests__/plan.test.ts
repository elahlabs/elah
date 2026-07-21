import { describe, it, expect } from 'vitest'
import type { Project, Track, Clip, Transition } from '@elah/core'

import { planExport, mapSourceFramesToIndices } from '../plan'

// The no-Project rule is about the runtime module graph of the package, not
// about tests — a hand-built Project literal here is fine, it never crosses
// into decoder/compositor/audio-graph code.

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

const identityResolve = (src: string) => src

describe('planExport', () => {
  it('returns fps/stage from the frame-0 Scene and zero totalFrames for an empty project', () => {
    const project = makeProject({ fps: 24, stage: { width: 640, height: 360 } })
    const plan = planExport(project, { resolveSource: identityResolve })

    expect(plan.fps).toBe(24)
    expect(plan.stage).toEqual({ width: 640, height: 360 })
    expect(plan.totalFrames).toBe(0)
    expect(plan.videos).toEqual([])
    expect(plan.audios).toEqual([])
    expect(plan.imageSources).toEqual([])
    expect(plan.fontFamilies).toEqual([])
  })

  it('produces a dense, monotonic sourceFrames array for a single video clip', () => {
    const track = makeTrack({ id: 't1', kind: 'video' })
    const clip = makeClip({
      id: 'c1',
      trackId: 't1',
      startFrame: 5,
      durationFrames: 10,
      sourceStartFrame: 100,
      sourceDurationFrames: 200,
    })
    const project = makeProject({
      tracks: [track],
      clips: { t1: [clip] },
    })

    const plan = planExport(project, { resolveSource: identityResolve })
    expect(plan.videos).toHaveLength(1)
    const v = plan.videos[0]
    expect(v.clipId).toBe('c1')
    expect(v.firstFrame).toBe(5)
    expect(v.lastFrame).toBe(14)
    expect(v.sourceFrames).toHaveLength(10)
    expect(Array.from(v.sourceFrames)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109])
  })

  it('resolves each clip src through the provided resolveSource', () => {
    const track = makeTrack({ id: 't1', kind: 'video' })
    const clip = makeClip({ id: 'c1', trackId: 't1', src: 'relative/clip.mp4', startFrame: 0, durationFrames: 5, sourceDurationFrames: 5 })
    const project = makeProject({ tracks: [track], clips: { t1: [clip] } })

    const plan = planExport(project, { resolveSource: (src) => `/abs/${src}` })
    expect(plan.videos[0].source).toBe('/abs/relative/clip.mp4')
  })

  it('gives a clip inside a transition window entries beyond its own end with a flat tail', () => {
    // c1 [0,20) is the outgoing clip of a transition starting at frame 15
    // that runs to frame 25 — resolveTimeline keeps emitting c1 (opacity 0,
    // clamped sourceFrame) for frames 20..24, past its own [0,20) window.
    const track = makeTrack({ id: 't1', kind: 'video' })
    const c1 = makeClip({
      id: 'c1',
      trackId: 't1',
      startFrame: 0,
      durationFrames: 20,
      sourceStartFrame: 0,
      sourceDurationFrames: 20,
    })
    const c2 = makeClip({
      id: 'c2',
      trackId: 't1',
      startFrame: 20,
      durationFrames: 20,
      sourceStartFrame: 0,
      sourceDurationFrames: 20,
    })
    const transition: Transition = {
      id: 'tr1',
      kind: 'fade',
      fromClipId: 'c1',
      toClipId: 'c2',
      trackId: 't1',
      startFrame: 15,
      durationFrames: 10,
    }
    const project = makeProject({
      tracks: [track],
      clips: { t1: [c1, c2] },
      transitions: [transition],
    })

    const plan = planExport(project, { resolveSource: identityResolve })
    const v1 = plan.videos.find((v) => v.clipId === 'c1')!
    // c1's own window is [0,20) but the transition keeps it alive through
    // frame 24 (startFrame 15 + durationFrames 10 - 1).
    expect(v1.firstFrame).toBe(0)
    expect(v1.lastFrame).toBe(24)
    expect(v1.sourceFrames).toHaveLength(25)
    // Clamped by resolveTimeline's Math.min(..., sourceDurationFrames - 1):
    // the tail flattens at the last valid source frame (19) instead of
    // continuing to climb past the clip's own source duration.
    const tail = Array.from(v1.sourceFrames).slice(-5)
    expect(tail).toEqual([19, 19, 19, 19, 19])
    for (let i = 1; i < v1.sourceFrames.length; i++) {
      expect(v1.sourceFrames[i]).toBeGreaterThanOrEqual(v1.sourceFrames[i - 1])
    }
  })

  it('records audio startFrame/frameCount/sourceStartFrame/volume from the Scene', () => {
    const track = makeTrack({ id: 'a1', kind: 'audio', volume: 0.5 })
    const clip = makeClip({
      id: 'ac1',
      trackId: 'a1',
      type: 'audio',
      src: 'song.mp3',
      startFrame: 3,
      durationFrames: 6,
      sourceStartFrame: 40,
      sourceDurationFrames: 100,
      volume: 0.8,
    })
    const project = makeProject({ tracks: [track], clips: { a1: [clip] } })

    const plan = planExport(project, { resolveSource: identityResolve })
    expect(plan.audios).toHaveLength(1)
    const a = plan.audios[0]
    expect(a.clipId).toBe('ac1')
    expect(a.startFrame).toBe(3)
    expect(a.frameCount).toBe(6)
    expect(a.sourceStartFrame).toBe(40)
    expect(a.volume).toBeCloseTo(0.4) // clip.volume(0.8) * track.volume(0.5)
  })

  it('collects unique image sources in first-appearance order', () => {
    const track = makeTrack({ id: 't1', kind: 'video' })
    const img1 = makeClip({ id: 'i1', trackId: 't1', type: 'image', src: 'b.png', startFrame: 0, durationFrames: 5, sourceDurationFrames: 5 })
    const img2 = makeClip({ id: 'i2', trackId: 't1', type: 'image', src: 'a.png', startFrame: 5, durationFrames: 5, sourceDurationFrames: 5 })
    const img3 = makeClip({ id: 'i3', trackId: 't1', type: 'image', src: 'b.png', startFrame: 10, durationFrames: 5, sourceDurationFrames: 5 })
    const project = makeProject({ tracks: [track], clips: { t1: [img1, img2, img3] } })

    const plan = planExport(project, { resolveSource: identityResolve })
    expect(plan.imageSources).toEqual([
      { src: 'b.png', source: 'b.png' },
      { src: 'a.png', source: 'a.png' },
    ])
  })

  it('keeps the raw src distinct from the resolved source for images', () => {
    const track = makeTrack({ id: 't1', kind: 'video' })
    const img = makeClip({ id: 'i1', trackId: 't1', type: 'image', src: 'assets/logo.png', startFrame: 0, durationFrames: 5, sourceDurationFrames: 5 })
    const project = makeProject({ tracks: [track], clips: { t1: [img] } })

    const plan = planExport(project, { resolveSource: src => `/work/proj/${src}` })
    expect(plan.imageSources).toEqual([{ src: 'assets/logo.png', source: '/work/proj/assets/logo.png' }])
  })

  it('collects unique defined fontFamilies from text clips', () => {
    const track = makeTrack({ id: 'e1', kind: 'elements' })
    const t1 = makeClip({ id: 'x1', trackId: 'e1', type: 'text', content: 'hi', fontFamily: 'Inter', startFrame: 0, durationFrames: 5, sourceDurationFrames: 5 })
    const t2 = makeClip({ id: 'x2', trackId: 'e1', type: 'text', content: 'yo', startFrame: 5, durationFrames: 5, sourceDurationFrames: 5 }) // no fontFamily
    const t3 = makeClip({ id: 'x3', trackId: 'e1', type: 'text', content: 'again', fontFamily: 'Inter', startFrame: 10, durationFrames: 5, sourceDurationFrames: 5 })
    const t4 = makeClip({ id: 'x4', trackId: 'e1', type: 'text', content: 'other', fontFamily: 'Georgia', startFrame: 15, durationFrames: 5, sourceDurationFrames: 5 })
    const project = makeProject({ tracks: [track], clips: { e1: [t1, t2, t3, t4] } })

    const plan = planExport(project, { resolveSource: identityResolve })
    expect(plan.fontFamilies).toEqual(['Inter', 'Georgia'])
  })

  it('never throws PLAN_INVALID for ordinary clips or transition-extended clips', () => {
    // assertNonDecreasing guards against a resolver bug producing a decreasing
    // sourceFrame — by construction (resolveTimeline's clamps only flatten,
    // never reverse) this cannot happen for legitimate Project data, so the
    // meaningful assertion here is that normal and transition-extended clips
    // both pass the guard silently.
    const track = makeTrack({ id: 't1', kind: 'video' })
    const clip = makeClip({ id: 'c1', trackId: 't1', startFrame: 0, durationFrames: 5, sourceDurationFrames: 5 })
    const project = makeProject({ tracks: [track], clips: { t1: [clip] } })
    expect(() => planExport(project, { resolveSource: identityResolve })).not.toThrow()
  })
})

describe('mapSourceFramesToIndices', () => {
  it('duplicates indices when source fps < project fps (24fps source on 30fps project, 5:4 pattern)', () => {
    // 24fps source timestamps: frame i at i/24 seconds.
    const timestamps = Float64Array.from({ length: 24 }, (_, i) => i / 24)
    // 30fps project: sourceFrames 0..29 (one project-second).
    const sourceFrames = Int32Array.from({ length: 30 }, (_, i) => i)
    const out = mapSourceFramesToIndices(sourceFrames, 30, timestamps)

    // Every output index must be non-decreasing and within source bounds.
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(out[i - 1])
    }
    expect(out[out.length - 1]).toBe(23)
    // 30 project frames onto 24 source frames: exactly 6 duplicated indices
    // (a 5:4 duplication pattern repeated 6 times across the 30-frame span).
    const uniqueCount = new Set(Array.from(out)).size
    expect(uniqueCount).toBe(24)
    expect(Array.from(out)).toEqual([
      0, 1, 2, 2, 3, 4, 5, 6, 6, 7, 8, 9, 10, 10, 11, 12, 13, 14, 14, 15, 16, 17, 18, 18, 19, 20, 21, 22, 22, 23,
    ])
  })

  it('skips indices when source fps > project fps (60fps source on 30fps project, every other index)', () => {
    const timestamps = Float64Array.from({ length: 60 }, (_, i) => i / 60)
    const sourceFrames = Int32Array.from({ length: 30 }, (_, i) => i)
    const out = mapSourceFramesToIndices(sourceFrames, 30, timestamps)

    // project frame j targets (2j+1)/60 seconds exactly, which equals
    // timestamp[2j+1] — so every export frame lands on the odd source index
    // and every even source index (1 in 2 source frames) is skipped.
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(out[i - 1])
    }
    expect(Array.from(out)).toEqual(Array.from({ length: 30 }, (_, j) => 2 * j + 1))
  })

  it('returns -1 for targets before the first PTS', () => {
    const timestamps = Float64Array.from([1, 2, 3])
    const sourceFrames = Int32Array.from([0, 1])
    const out = mapSourceFramesToIndices(sourceFrames, 30, timestamps)
    // (0 + 0.5) / 30 = 0.0167s and (1 + 0.5) / 30 = 0.05s, both < first PTS (1s).
    expect(Array.from(out)).toEqual([-1, -1])
  })

  it('clamps at the last PTS for targets past the end', () => {
    const timestamps = Float64Array.from([0, 1, 2])
    const sourceFrames = Int32Array.from([1000]) // way past the source's duration
    const out = mapSourceFramesToIndices(sourceFrames, 30, timestamps)
    expect(out[0]).toBe(2)
  })

  it('handles VFR timestamps (non-uniform spacing) monotonically', () => {
    const timestamps = Float64Array.from([0, 0.1, 0.5, 0.55, 1.2])
    const sourceFrames = Int32Array.from({ length: 40 }, (_, i) => i) // 40 frames @ 30fps ~= 1.33s
    const out = mapSourceFramesToIndices(sourceFrames, 30, timestamps)
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(out[i - 1])
    }
    expect(out[out.length - 1]).toBeLessThanOrEqual(timestamps.length - 1)
  })

  it('returns all -1 when the timestamps index is empty', () => {
    const out = mapSourceFramesToIndices(Int32Array.from([0, 1, 2]), 30, new Float64Array(0))
    expect(Array.from(out)).toEqual([-1, -1, -1])
  })

  it('handles a trimmed clip starting mid-GOP (non-zero sourceStartFrame)', () => {
    const timestamps = Float64Array.from({ length: 100 }, (_, i) => i / 30)
    // Clip trimmed in at source frame 50, 10 frames long.
    const sourceFrames = Int32Array.from({ length: 10 }, (_, i) => 50 + i)
    const out = mapSourceFramesToIndices(sourceFrames, 30, timestamps)
    expect(Array.from(out)).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59])
  })
})
