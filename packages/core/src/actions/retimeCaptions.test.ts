import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { retimeCaptions } from './retimeCaptions'

// A 20 s source at frame 0 (30 fps), speed 1, and a caption clip made from it.
function setup() {
  const engine = new TimelineEngine({
    fps: 30,
    initialTracks: [
      { kind: 'video', name: 'V1' },
      { kind: 'elements', name: 'Captions' },
    ],
  })
  const tracks = engine.getProject().tracks
  const v1 = tracks.find((t) => t.kind === 'video')!.id
  const el = tracks.find((t) => t.kind === 'elements')!.id
  const src = engine.addClip({
    trackId: v1,
    type: 'video',
    src: 'a.mp4',
    name: 'A',
    startFrame: 0,
    durationFrames: 600,
  })
  engine.updateClip(src.id, v1, { sourceStartFrame: 0, sourceDurationFrames: 1200 })
  const cap = engine.addClip({
    trackId: el,
    type: 'text',
    name: 'cap',
    startFrame: 60,
    durationFrames: 240,
    text: { content: 'one two' },
  })
  engine.updateClip(cap.id, el, {
    words: [
      { text: 'one', start: 0, end: 120 }, // 4 s into the clip is frame 120
      { text: 'two', start: 120, end: 240 },
    ],
  })
  const bare = engine.addClip({
    trackId: el,
    type: 'text',
    name: 'no words',
    startFrame: 1000,
    durationFrames: 40,
    text: { content: 'plain' },
  })
  engine.linkClips([src.id, cap.id, bare.id])
  const prev = { speed: 1, sourceStartFrame: 0, durationFrames: 600 }
  return { engine, v1, el, src: src.id, cap: cap.id, bare: bare.id, prev }
}

describe('captions follow setClipSpeed (same commit)', () => {
  it('speed 1 to 2 halves every word frame and the clip duration, and keeps the source moment', () => {
    const s = setup()
    s.engine.setClipSpeed(s.src, s.v1, 2)

    const cap = s.engine.findClip(s.cap)!.clip
    expect(cap.durationFrames).toBe(120)
    expect(cap.startFrame).toBe(30)
    expect(cap.words).toEqual([
      { text: 'one', start: 0, end: 60 },
      { text: 'two', start: 60, end: 120 },
    ])
    // The second word began 4 s into the clip; now it starts 2 s in.
    expect(cap.words![1]!.start / 30).toBe(2)
  })

  it('is one undo entry with the speed change', () => {
    const s = setup()
    const before = s.engine.getProject()
    s.engine.setClipSpeed(s.src, s.v1, 2)
    s.engine.undo()
    expect(s.engine.getProject()).toBe(before)
  })

  it('slowing down stretches the other way', () => {
    const s = setup()
    s.engine.setClipSpeed(s.src, s.v1, 0.5)
    const cap = s.engine.findClip(s.cap)!.clip
    expect(cap.durationFrames).toBe(480)
    expect(cap.startFrame).toBe(120)
    expect(cap.words![1]).toEqual({ text: 'two', start: 240, end: 480 })
  })

  it('a slow-down clamped by the next clip scales captions by the ACTUAL length ratio, not the speed ratio', () => {
    const s = setup()
    // The source can grow to frame 900 only: next clip starts there on the video track.
    s.engine.addClip({ trackId: s.v1, type: 'video', src: 'b.mp4', name: 'B', startFrame: 900, durationFrames: 60 })
    s.engine.setClipSpeed(s.src, s.v1, 0.5) // wants 1200 frames, clamped to 900

    const src = s.engine.findClip(s.src)!.clip
    expect(src.durationFrames).toBe(900)
    const cap = s.engine.findClip(s.cap)!.clip
    // scale 1.5 (900/600), not 2 (the speed ratio): 240 -> 360, start 60 -> 90
    expect(cap.durationFrames).toBe(360)
    expect(cap.startFrame).toBe(90)
    expect(cap.words![1]).toEqual({ text: 'two', start: 180, end: 360 })
    expect(cap.startFrame + cap.durationFrames).toBeLessThanOrEqual(src.startFrame + src.durationFrames)
  })

  it('leaves a linked caption with no words, and the source position, untouched', () => {
    const s = setup()
    const bareBefore = s.engine.findClip(s.bare)!.clip
    s.engine.setClipSpeed(s.src, s.v1, 2)
    expect(s.engine.findClip(s.bare)!.clip).toBe(bareBefore)
    expect(s.engine.findClip(s.src)!.clip.startFrame).toBe(0)
  })

  it('never throws: a caption that would hit a neighbour is skipped and the speed change still lands', () => {
    const s = setup()
    // A foreign clip sits where the stretched caption would end up (60..300 -> 120..600).
    s.engine.addClip({ trackId: s.el, type: 'text', name: 'x', startFrame: 320, durationFrames: 20, text: { content: 'x' } })
    expect(() => s.engine.setClipSpeed(s.src, s.v1, 0.5)).not.toThrow()
    expect(s.engine.findClip(s.src)!.clip.speed).toBe(0.5)
    expect(s.engine.findClip(s.cap)!.clip.durationFrames).toBe(240) // left where it was
  })

  it('an unlinked source moves no captions', () => {
    const s = setup()
    s.engine.unlinkClips([s.src])
    s.engine.setClipSpeed(s.src, s.v1, 2)
    expect(s.engine.findClip(s.cap)!.clip.durationFrames).toBe(240)
  })
})

describe('retimeCaptions action', () => {
  it('re-times captions after a source length change made some other way, in one undo step', () => {
    const s = setup()
    s.engine.updateClip(s.src, s.v1, { durationFrames: 300 })
    const afterEdit = s.engine.getProject()

    const out = retimeCaptions(s.engine, s.src, s.prev)

    expect(out).toEqual({ retimed: [s.cap], skipped: [] })
    const cap = s.engine.findClip(s.cap)!.clip
    expect(cap.durationFrames).toBe(120)
    expect(cap.words![1]).toEqual({ text: 'two', start: 60, end: 120 })
    s.engine.undo()
    expect(s.engine.getProject()).toBe(afterEdit)
  })

  it('does nothing when the length is unchanged or the source is unlinked', () => {
    const s = setup()
    expect(retimeCaptions(s.engine, s.src, s.prev)).toEqual({ retimed: [], skipped: [] })
    s.engine.unlinkClips([s.src])
    expect(retimeCaptions(s.engine, s.src, { ...s.prev, durationFrames: 300 })).toEqual({ retimed: [], skipped: [] })
  })
})
