import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { rippleEdgeTrim } from './ripple'

/**
 * Ripple by dragging (PV-T5-2): unlike the Q/W `rippleTrim`, the edge may grow
 * as well as shrink, and a linked partner's track follows with it.
 */

/** A video track at [0,30) [30,60) [70,100), and an empty audio track. */
function setup() {
  const engine = new TimelineEngine({
    fps: 30,
    initialTracks: [
      { kind: 'video', name: 'V1' },
      { kind: 'audio', name: 'A1' },
    ],
  })
  const [v, a] = engine.getProject().tracks.map((t) => t.id) as [string, string]
  const add = (trackId: string, name: string, start: number, dur: number) =>
    engine.addClip({ trackId, type: 'video', src: `${name}.mp4`, name, startFrame: start, durationFrames: dur }).id
  const first = add(v, 'a', 0, 30)
  const second = add(v, 'b', 30, 30)
  const third = add(v, 'c', 70, 30)
  // b is the second half of one continuous take, so its in-point is at 30.
  engine.updateClip(second, v, { sourceStartFrame: 30, sourceDurationFrames: 30 })
  const layout = (trackId = v) => engine.getClipsOnTrack(trackId).map((c) => [c.startFrame, c.durationFrames] as const)
  const clip = (id: string) => engine.findClip(id)!.clip
  return { engine, v, a, add, first, second, third, layout, clip }
}

describe('rippleEdgeTrim, end edge', () => {
  it('shrinks and pulls the later clips left, as one undo step', () => {
    const { engine, first, layout } = setup()
    expect(rippleEdgeTrim(engine, first, 'end', 20)).toEqual({ ok: true, data: { delta: -10 } })
    expect(layout()).toEqual([
      [0, 20],
      [20, 30],
      [60, 30],
    ])
    engine.undo()
    expect(layout()).toEqual([
      [0, 30],
      [30, 30],
      [70, 30],
    ])
  })

  it('grows, shifting the later clips first so the resize never overlaps', () => {
    const { engine, first, layout } = setup()
    // The clip's own window is 30, so without a known media length this is the
    // limit; assetFrames is what lets it push past it.
    engine.updateClip(first, engine.getProject().tracks[0]!.id, { assetFrames: 100 })
    expect(rippleEdgeTrim(engine, first, 'end', 40)).toEqual({ ok: true, data: { delta: 10 } })
    expect(layout()).toEqual([
      [0, 40],
      [40, 30],
      [80, 30],
    ])
  })

  it('refuses to grow past the end of the media, changing nothing', () => {
    const { engine, first, layout } = setup()
    const before = engine.getProject()
    expect(rippleEdgeTrim(engine, first, 'end', 40)).toEqual({ ok: false, reason: 'media-limit' })
    expect(layout()).toEqual([
      [0, 30],
      [30, 30],
      [70, 30],
    ])
    expect(engine.getProject()).toBe(before)
  })

  it('does nothing at all when the edge has not moved', () => {
    const { engine, first } = setup()
    const before = engine.getProject()
    expect(rippleEdgeTrim(engine, first, 'end', 30)).toEqual({ ok: true, data: { delta: 0 } })
    expect(engine.getProject()).toBe(before)
  })
})

describe('rippleEdgeTrim, start edge', () => {
  it('keeps the clip where it is, moves its in-point, and follows with later clips', () => {
    const { engine, second, layout, clip } = setup()
    engine.updateClip(second, engine.getProject().tracks[0]!.id, { assetFrames: 100 })
    // b starts at 30 with sourceStartFrame 30; dragging its head to 40 cuts 10.
    expect(rippleEdgeTrim(engine, second, 'start', 40)).toEqual({ ok: true, data: { delta: -10 } })
    const b = clip(second)
    expect([b.startFrame, b.durationFrames, b.sourceStartFrame]).toEqual([30, 20, 40])
    expect(layout()).toEqual([
      [0, 30],
      [30, 20],
      [60, 30],
    ])
  })

  it('grows the head back out, revealing earlier media', () => {
    const { engine, second, layout, clip } = setup()
    engine.updateClip(second, engine.getProject().tracks[0]!.id, { assetFrames: 100 })
    expect(rippleEdgeTrim(engine, second, 'start', 25)).toEqual({ ok: true, data: { delta: 5 } })
    const b = clip(second)
    expect([b.startFrame, b.durationFrames, b.sourceStartFrame]).toEqual([30, 35, 25])
    expect(layout()[2]).toEqual([75, 30])
  })

  it('refuses a head that would come off before the media does', () => {
    const { engine, second, v, clip } = setup()
    // An in-point at source frame 10 leaves only 10 frames to grow back.
    engine.updateClip(second, v, { sourceStartFrame: 10 })
    expect(rippleEdgeTrim(engine, second, 'start', 0)).toEqual({ ok: false, reason: 'media-limit' })
    expect(clip(second).durationFrames).toBe(30)
  })

  it('shifts keyframes by the negated head cut so they stay put', () => {
    const { engine, second, v, clip } = setup()
    engine.updateClip(second, v, { assetFrames: 100 })
    // A key 30 frames into the clip; the head moves 10 frames later into the
    // media, so the key is 20 frames into the clip afterwards.
    engine.updateClip(second, v, {
      keyframes: { channels: { opacity: { source: { kind: 'keyframes' }, keys: [{ id: 'k1', frame: 30, value: 0, easing: 'linear' }] } } },
    })
    expect(rippleEdgeTrim(engine, second, 'start', 40).ok).toBe(true)
    expect(clip(second).keyframes?.channels?.opacity?.keys[0]?.frame).toBe(20)
  })
})

describe('rippleEdgeTrim with linked partners', () => {
  /** A linked A/V pair at [0,30) on both tracks, each with one later clip. */
  function setupPair() {
    const engine = new TimelineEngine({
      fps: 30,
      initialTracks: [
        { kind: 'video', name: 'V1' },
        { kind: 'audio', name: 'A1' },
      ],
    })
    const [v, a] = engine.getProject().tracks.map((t) => t.id) as [string, string]
    const add = (trackId: string, name: string, start: number, dur: number) =>
      engine.addClip({ trackId, type: 'video', src: `${name}.mp4`, name, startFrame: start, durationFrames: dur }).id
    const first = add(v, 'a', 0, 30)
    const audio = add(a, 'a-audio', 0, 30)
    engine.updateClip(first, v, { linkId: 'pair' })
    engine.updateClip(audio, a, { linkId: 'pair' })
    add(v, 'v-later', 40, 20)
    add(a, 'a-later', 40, 20)
    const layout = (trackId: string) => engine.getClipsOnTrack(trackId).map((c) => [c.startFrame, c.durationFrames] as const)
    return { engine, v, a, first, audio, layout }
  }

  it('ripples the partner’s own track the same way', () => {
    const { engine, first, audio, layout } = setupPair()
    expect(rippleEdgeTrim(engine, first, 'end', 20, [audio])).toEqual({ ok: true, data: { delta: -10 } })
    expect(layout(first && engine.getProject().tracks[0]!.id)).toEqual([
      [0, 20],
      [30, 20],
    ])
    expect(layout(engine.getProject().tracks[1]!.id)).toEqual([
      [0, 20],
      [30, 20],
    ])
    engine.undo()
    expect(layout(engine.getProject().tracks[0]!.id)).toEqual([
      [0, 30],
      [40, 20],
    ])
  })

  it('refuses the whole edit when a partner’s track is locked, changing nothing', () => {
    const { engine, v, a, first, audio, layout } = setupPair()
    engine.updateTrack(a, { locked: true })
    const before = engine.getProject()
    expect(rippleEdgeTrim(engine, first, 'end', 20, [audio])).toEqual({ ok: false, reason: 'track-locked' })
    expect(layout(v)).toEqual([
      [0, 30],
      [40, 20],
    ])
    expect(layout(a)).toEqual([
      [0, 30],
      [40, 20],
    ])
    expect(engine.getProject()).toBe(before)
  })

  it('refuses when the members would not make the same change', () => {
    const { engine, v, a, first, audio } = setupPair()
    // The audio half ends at 20 while the video half ends at 30: the caller
    // passed partners that are not actually on the same edge.
    engine.updateClip(audio, a, { durationFrames: 20 })
    expect(rippleEdgeTrim(engine, first, 'end', 20, [audio])).toEqual({ ok: false, reason: 'engine-rejected' })
    expect(v).toBeDefined()
  })
})
