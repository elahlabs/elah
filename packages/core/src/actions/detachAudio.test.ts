import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { canReattachAudio, detachClipAudio, reattachClipAudio } from './detachAudio'
import type { Clip, ClipKeyframes } from '../types'

const keys = (channel: 'volume' | 'opacity'): ClipKeyframes => ({
  channels: {
    [channel]: {
      source: { kind: 'keyframes' as const },
      keys: [
        { id: 'k1', frame: 0, value: 0, easing: 'linear' as const },
        { id: 'k2', frame: 10, value: 1, easing: 'linear' as const },
      ],
    },
  } as ClipKeyframes['channels'],
})

function setup(opts: { audioLane?: boolean } = {}) {
  const engine = new TimelineEngine({
    fps: 30,
    initialTracks: [{ kind: 'video', name: 'V1' }, ...(opts.audioLane ? [{ kind: 'audio' as const, name: 'A1' }] : [])],
  })
  const v1 = engine.getProject().tracks.find((t) => t.kind === 'video')!.id
  const merged = (start = 0, dur = 60) => {
    const c = engine.addClip({
      trackId: v1,
      type: 'video',
      src: 'a.mp4',
      assetId: 'asset-a',
      name: 'A',
      startFrame: start,
      durationFrames: dur,
    })
    engine.updateClip(c.id, v1, {
      embeddedAudio: true,
      sourceStartFrame: 5,
      sourceDurationFrames: 90,
      assetFrames: 200,
      speed: 2,
      volume: 0.7,
    })
    return c.id
  }
  const audioTracks = () => engine.getProject().tracks.filter((t) => t.kind === 'audio')
  const clip = (id: string): Clip => engine.findClip(id)!.clip
  return { engine, v1, merged, audioTracks, clip }
}

describe('detachClipAudio', () => {
  it('splits into a linked audio clip as one undo step and one change emit', () => {
    const { engine, merged, clip, audioTracks } = setup()
    const id = merged()
    let changes = 0
    engine.on('change', () => changes++)

    const r = detachClipAudio(engine, id)

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(changes).toBe(1)
    expect(engine.lastHistoryDescription()).toBe('Split audio and video')
    const audio = clip(r.data.audioClipId)
    expect(audio.type).toBe('audio')
    expect(audio.linkId).toBe(r.data.linkId)
    expect(clip(id).linkId).toBe(r.data.linkId)
    expect(clip(id).embeddedAudio).toBe(false)
    expect(audioTracks()).toHaveLength(1)
    expect(engine.findClip(audio.id)!.trackId).toBe(r.data.trackId)

    // One undo restores the merged clip and removes the lane and clip.
    engine.undo()
    expect(clip(id).embeddedAudio).toBe(true)
    expect(clip(id).linkId).toBeUndefined()
    expect(audioTracks()).toHaveLength(0)
  })

  it('carries everything that defines the sound', () => {
    const { engine, merged, clip } = setup()
    const id = merged(12, 60)
    const r = detachClipAudio(engine, id)
    if (!r.ok) throw new Error('refused')
    expect(clip(r.data.audioClipId)).toMatchObject({
      src: 'a.mp4',
      assetId: 'asset-a',
      startFrame: 12,
      durationFrames: 60,
      sourceStartFrame: 5,
      sourceDurationFrames: 90,
      assetFrames: 200,
      speed: 2,
      volume: 0.7,
    })
  })

  it('carries volume keyframes and drops every other channel', () => {
    const { engine, v1, merged, clip } = setup()
    const id = merged()
    engine.updateClip(id, v1, { keyframes: { channels: { ...keys('volume').channels, ...keys('opacity').channels } } })
    const r = detachClipAudio(engine, id)
    if (!r.ok) throw new Error('refused')
    const a = clip(r.data.audioClipId)
    expect(Object.keys(a.keyframes!.channels)).toEqual(['volume'])
    expect(a.keyframes!.channels.volume!.keys).toHaveLength(2)
  })

  it('omits keyframes entirely when the video has no volume channel', () => {
    const { engine, v1, merged, clip } = setup()
    const id = merged()
    engine.updateClip(id, v1, { keyframes: keys('opacity') })
    const r = detachClipAudio(engine, id)
    if (!r.ok) throw new Error('refused')
    expect(clip(r.data.audioClipId).keyframes).toBeUndefined()
  })

  it('reuses a free audio lane', () => {
    const { engine, merged, audioTracks } = setup({ audioLane: true })
    const r = detachClipAudio(engine, merged())
    if (!r.ok) throw new Error('refused')
    expect(audioTracks()).toHaveLength(1)
    expect(r.data.trackId).toBe(audioTracks()[0]!.id)
  })

  it('makes a new lane when the existing one is occupied across the span', () => {
    const { engine, merged, audioTracks } = setup({ audioLane: true })
    const a1 = audioTracks()[0]!.id
    engine.addClip({ trackId: a1, type: 'audio', src: 'x.wav', startFrame: 10, durationFrames: 20 })
    const r = detachClipAudio(engine, merged(0, 60))
    if (!r.ok) throw new Error('refused')
    expect(audioTracks()).toHaveLength(2)
    expect(r.data.trackId).not.toBe(a1)
  })

  it('falls through to a second audio lane that is free', () => {
    const { engine, merged, audioTracks } = setup({ audioLane: true })
    const second = engine.addTrack('audio')
    engine.addClip({ trackId: audioTracks()[0]!.id, type: 'audio', src: 'x.wav', startFrame: 0, durationFrames: 100 })
    const r = detachClipAudio(engine, merged(0, 60))
    if (!r.ok) throw new Error('refused')
    expect(r.data.trackId).toBe(second.id)
    expect(audioTracks()).toHaveLength(2)
  })

  it('refuses without changing anything when every audio lane is locked', () => {
    const { engine, merged, audioTracks, clip } = setup({ audioLane: true })
    engine.updateTrack(audioTracks()[0]!.id, { locked: true })
    const id = merged()
    expect(detachClipAudio(engine, id)).toEqual({ ok: false, reason: 'no-audio-track' })
    expect(clip(id).embeddedAudio).toBe(true)
    expect(audioTracks()).toHaveLength(1)
  })

  it('refuses unknown, legacy, audio, already-detached and locked-track clips', () => {
    const { engine, v1, merged, clip, audioTracks } = setup({ audioLane: true })
    expect(detachClipAudio(engine, 'nope')).toEqual({ ok: false, reason: 'clip-not-found' })

    const legacy = engine.addClip({ trackId: v1, type: 'video', src: 'b.mp4', startFrame: 100, durationFrames: 30 })
    expect(detachClipAudio(engine, legacy.id)).toEqual({ ok: false, reason: 'no-audio-to-detach' })

    const aud = engine.addClip({ trackId: audioTracks()[0]!.id, type: 'audio', src: 'c.wav', startFrame: 0, durationFrames: 30 })
    expect(detachClipAudio(engine, aud.id)).toEqual({ ok: false, reason: 'no-audio-to-detach' })

    const id = merged(200, 30)
    expect(detachClipAudio(engine, id).ok).toBe(true)
    expect(detachClipAudio(engine, id)).toEqual({ ok: false, reason: 'no-audio-to-detach' })

    const id2 = merged(300, 30)
    engine.updateTrack(v1, { locked: true })
    expect(detachClipAudio(engine, id2)).toEqual({ ok: false, reason: 'track-locked' })
    expect(clip(id2).embeddedAudio).toBe(true)
  })

  it('nests inside an outer batch as one undo step', () => {
    const { engine, merged, v1 } = setup()
    const a = merged(0, 30)
    const b = merged(40, 30)
    engine.batch(() => {
      detachClipAudio(engine, a)
      detachClipAudio(engine, b)
    }, 'Split audio and video')
    expect(engine.getProject().clips[v1]!.every((c) => c.embeddedAudio === false)).toBe(true)
    engine.undo()
    expect(engine.getProject().clips[v1]!.every((c) => c.embeddedAudio === true)).toBe(true)
  })
})

describe('reattachClipAudio', () => {
  it('merges an untouched pair back in one undo step and one change emit', () => {
    const { engine, merged, clip } = setup()
    const id = merged()
    const r = detachClipAudio(engine, id)
    if (!r.ok) throw new Error('refused')
    expect(canReattachAudio(engine.getProject(), id)).toBe(true)
    let changes = 0
    engine.on('change', () => changes++)

    const back = reattachClipAudio(engine, id)

    expect(back.ok).toBe(true)
    expect(changes).toBe(1)
    expect(engine.findClip(r.data.audioClipId)).toBeNull()
    expect(clip(id).embeddedAudio).toBe(true)
    expect(clip(id).linkId).toBeUndefined()
    engine.undo()
    expect(clip(id).embeddedAudio).toBe(false)
    expect(engine.findClip(r.data.audioClipId)).not.toBeNull()
  })

  it.each([
    ['trimmed', (e: TimelineEngine, a: Clip, t: string) => e.updateClip(a.id, t, { durationFrames: a.durationFrames - 5 })],
    ['moved', (e: TimelineEngine, a: Clip, t: string) => e.updateClip(a.id, t, { startFrame: a.startFrame + 3 })],
    ['re-levelled', (e: TimelineEngine, a: Clip, t: string) => e.updateClip(a.id, t, { volume: 0.2 })],
    ['re-sped', (e: TimelineEngine, a: Clip, t: string) => e.updateClip(a.id, t, { speed: 1 })],
    ['keyframed', (e: TimelineEngine, a: Clip, t: string) => e.updateClip(a.id, t, { keyframes: keys('volume') })],
  ])('is unavailable once the audio clip is %s', (_name, change) => {
    const { engine, merged, clip } = setup()
    const id = merged()
    const r = detachClipAudio(engine, id)
    if (!r.ok) throw new Error('refused')
    change(engine, clip(r.data.audioClipId), r.data.trackId)
    expect(canReattachAudio(engine.getProject(), id)).toBe(false)
    expect(reattachClipAudio(engine, id)).toEqual({ ok: false, reason: 'no-audio-to-detach' })
    expect(clip(id).embeddedAudio).toBe(false)
  })

  it('is unavailable when the group holds a second audio clip, or none', () => {
    const { engine, merged, audioTracks } = setup()
    const id = merged()
    const r = detachClipAudio(engine, id)
    if (!r.ok) throw new Error('refused')
    const extra = engine.addClip({ trackId: audioTracks()[0]!.id, type: 'audio', src: 'z.wav', startFrame: 100, durationFrames: 10 })
    engine.linkClips([id, r.data.audioClipId, extra.id])
    expect(canReattachAudio(engine.getProject(), id)).toBe(false)
    engine.unlinkClips([r.data.audioClipId, extra.id])
    expect(canReattachAudio(engine.getProject(), id)).toBe(false)
  })

  it('is unavailable for a merged clip', () => {
    const { engine, merged } = setup()
    expect(canReattachAudio(engine.getProject(), merged())).toBe(false)
  })
})
