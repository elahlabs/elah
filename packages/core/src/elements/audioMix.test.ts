import { describe, expect, it } from 'vitest'
import type { Clip } from '../types'
import { createClip } from './base'
import {
  dbToGain,
  fadePatch,
  isAudioBearing,
  mergeSpans,
  planCrossfades,
  planDuck,
  volumeAt,
} from './audioMix'

const ctx = { stage: { width: 1920, height: 1080 } }
const audio = (id: string, startFrame: number, durationFrames: number, extra: Partial<Clip> = {}): Clip =>
  ({ ...createClip({ trackId: 't', type: 'audio', name: id, startFrame, durationFrames, src: 's.mp3' }), id, ...extra }) as Clip
const keys = (patch: Partial<Clip>) => (patch.keyframes?.channels?.volume?.keys ?? []).map((k) => [k.frame, Math.round(k.value * 1000) / 1000])

describe('audioMix', () => {
  it('converts decibels to linear gain', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(-12)).toBeCloseTo(0.2512, 4)
    expect(dbToGain(-20)).toBeCloseTo(0.1, 6)
  })

  it('knows which clips make sound: audio, and video that carries its own audio', () => {
    expect(isAudioBearing({ type: 'audio' })).toBe(true)
    expect(isAudioBearing({ type: 'video', embeddedAudio: true })).toBe(true)
    expect(isAudioBearing({ type: 'video' })).toBe(false)
    expect(isAudioBearing({ type: 'video', embeddedAudio: false })).toBe(false)
    expect(isAudioBearing({ type: 'image' })).toBe(false)
  })

  it('reads the volume a clip has at a frame: static, or from its keys', () => {
    expect(volumeAt(audio('a', 0, 90), 10)).toBe(1)
    expect(volumeAt(audio('a', 0, 90, { volume: 0.4 }), 10)).toBe(0.4)
    const keyed = audio('a', 0, 90, { volume: 0.4, keyframes: { channels: { volume: { source: { kind: 'keyframes' }, keys: [{ id: 'k', frame: 10, value: 0.9, easing: 'linear' }] } } } })
    expect(volumeAt(keyed, 50)).toBe(0.9)
  })

  it('fades in and out from the level the clip has, and shortens a fade longer than half the clip', () => {
    const c = audio('a', 0, 90, { volume: 0.5 })
    expect(keys(fadePatch(c, { fadeIn: 3, fadeOut: 3 }, ctx))).toEqual([[0, 0], [3, 0.5], [86, 0.5], [89, 0]])
    expect(keys(fadePatch(audio('s', 0, 11), { fadeIn: 30 }, ctx))).toEqual([[0, 0], [5, 1]])
    expect(fadePatch(audio('tiny', 0, 2), { fadeIn: 1, fadeOut: 1 }, ctx)).toEqual({})
  })

  it('finds joins only between back-to-back sound-making clips on one track', () => {
    const a = audio('a', 0, 30)
    const b = audio('b', 30, 30)
    const c = audio('c', 61, 30) // one frame of air: still a join
    const d = audio('d', 100, 30) // a real gap
    const other = { ...audio('o', 130, 30), trackId: 'u' } as Clip
    const pic = { ...createClip({ trackId: 't', type: 'image', name: 'pic', startFrame: 91, durationFrames: 9, src: 'p.png' }), id: 'pic' } as Clip
    const plan = planCrossfades([d, c, a, b, other, pic], 30, 100, ctx)
    expect(plan.joins).toBe(2)
    expect(plan.patches.map((p) => p.clipId).sort()).toEqual(['a', 'b', 'c'])
    const byId = new Map(plan.patches.map((p) => [p.clipId, keys(p.patch)]))
    expect(byId.get('a')).toEqual([[26, 1], [29, 0]])
    expect(byId.get('b')).toEqual([[0, 0], [3, 1], [26, 1], [29, 0]])
    expect(byId.get('c')).toEqual([[0, 0], [3, 1]])
  })

  it('merges speech spans whose gap is within the limit', () => {
    expect(mergeSpans([[50, 60], [0, 10], [12, 20], [61, 70]], 2)).toEqual([[0, 20], [50, 70]])
    expect(mergeSpans([[5, 5], [NaN, 3]], 2)).toEqual([])
  })

  it('ducks to the gain on the speech edges with the ramps outside them, and not past the clip', () => {
    const music = audio('m', 30, 200)
    const plan = planDuck(music, [[60, 90], [180, 400]], { fps: 30, amountDb: -12, attackSec: 0.1, releaseSec: 0.2 }, ctx)
    const g = Math.round(dbToGain(-12) * 1000) / 1000
    // Music-local: speech 30–60 and 150–370 (clamped to the clip's last frame, 199).
    expect(keys(plan.patch)).toEqual([
      [27, 1],
      [30, g],
      [59, g],
      [65, 1],
      [147, 1],
      [150, g],
      [199, g],
    ])
    expect(plan.spans).toBe(2)
  })

  it('ducks nothing when the speech is entirely outside the music', () => {
    expect(planDuck(audio('m', 0, 60), [[300, 400]], { fps: 30, amountDb: -12, attackSec: 0.1, releaseSec: 0.2 }, ctx)).toEqual({ patch: {}, spans: 0 })
  })
})
