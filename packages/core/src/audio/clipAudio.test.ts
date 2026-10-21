import { describe, expect, it } from 'vitest'
import type { Clip, Project, Track } from '../types'
import {
  activeEnhance,
  clipAudioGain,
  dbGain,
  enhancePlan,
  enhanceSignature,
  fadeFrames,
  hasAudioEnvelopeShape,
  readClipAudio,
} from './clipAudio'
import { gainAutomation } from '../export/audioMix'
import { resolveTimeline } from '../resolver/resolveTimeline'
import { latencyLead } from '../media/audio/enhanceChain'
import { splitClip } from '../visitor/split'
import { produce } from 'immer'

const FPS = 30

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: 'a1',
    trackId: 't1',
    type: 'audio',
    name: 'voice',
    src: 'voice.wav',
    startFrame: 0,
    durationFrames: 90,
    sourceStartFrame: 0,
    sourceDurationFrames: 90,
    ...over,
  } as Clip
}

const track: Track = { id: 't1', kind: 'audio', name: 'A1', order: 0, muted: false } as Track

describe('readClipAudio', () => {
  it('drops everything for clip types without sound settings', () => {
    expect(readClipAudio({ muted: true }, 'text')).toBeUndefined()
  })

  it('clamps numbers, drops junk and empty values', () => {
    expect(readClipAudio({ muted: 'yes', boostDb: 99, fadeInSec: -1, fadeOutSec: 2, extra: 1 }, 'audio')).toEqual({
      boostDb: 12,
      fadeOutSec: 2,
    })
    expect(readClipAudio({ enhance: { noise: 0, voice: 0 } }, 'video')).toBeUndefined()
    expect(readClipAudio({ enhance: { noise: 2, voice: 'x' } }, 'video')).toEqual({ enhance: { noise: 1, voice: 0 } })
    expect(readClipAudio(null, 'audio')).toBeUndefined()
  })
})

describe('clipAudioGain', () => {
  it('is 1 for a clip with no settings and 0 when muted', () => {
    expect(clipAudioGain(clip(), 10, FPS)).toBe(1)
    expect(clipAudioGain(clip({ audio: { muted: true, boostDb: 6 } }), 10, FPS)).toBe(0)
  })

  it('applies boost in dB', () => {
    expect(clipAudioGain(clip({ audio: { boostDb: 6 } }), 10, FPS)).toBeCloseTo(dbGain(6))
  })

  it('fades in from silence on frame 0 and out to silence on the last frame', () => {
    const c = clip({ audio: { fadeInSec: 1, fadeOutSec: 1 } }) // 30 frames each
    expect(clipAudioGain(c, 0, FPS)).toBe(0)
    expect(clipAudioGain(c, 15, FPS)).toBeCloseTo(0.5)
    expect(clipAudioGain(c, 30, FPS)).toBe(1)
    expect(clipAudioGain(c, 59, FPS)).toBe(1)
    expect(clipAudioGain(c, 74, FPS)).toBeCloseTo(0.5)
    expect(clipAudioGain(c, 89, FPS)).toBe(0)
  })

  it('caps each fade to half the clip', () => {
    expect(fadeFrames(clip({ audio: { fadeInSec: 10, fadeOutSec: 10 } }), FPS)).toEqual({ fadeIn: 45, fadeOut: 45 })
  })

  it('ignores settings on a compound (export folds compound gain without them)', () => {
    expect(clipAudioGain(clip({ type: 'compound', audio: { muted: true } }), 0, FPS)).toBe(1)
  })

  it('knows when the envelope needs per-frame sampling', () => {
    expect(hasAudioEnvelopeShape(clip({ audio: { boostDb: 3 } }), FPS)).toBe(false)
    expect(hasAudioEnvelopeShape(clip({ audio: { fadeInSec: 0.5 } }), FPS)).toBe(true)
    expect(hasAudioEnvelopeShape(clip({ audio: { fadeInSec: 0.5, muted: true } }), FPS)).toBe(false)
  })
})

describe('enhance', () => {
  it('is inactive when off or both strengths are 0', () => {
    expect(activeEnhance(clip())).toBeUndefined()
    expect(activeEnhance(clip({ audio: { enhance: { noise: 0, voice: 0 } } }))).toBeUndefined()
    expect(enhancePlan(undefined)).toEqual([])
    expect(enhanceSignature(undefined)).toBe('')
  })

  it('noise only: high-pass then the denoiser', () => {
    const plan = enhancePlan({ noise: 0.6, voice: 0 })
    expect(plan.map((s) => s.kind)).toEqual(['biquad', 'denoise'])
    expect(plan[1]).toEqual({ kind: 'denoise', amount: 0.6 })
  })

  it('voice scales EQ, compression and make-up gain', () => {
    const plan = enhancePlan({ noise: 0, voice: 1 })
    expect(plan.map((s) => s.kind)).toEqual(['biquad', 'biquad', 'biquad', 'biquad', 'biquad', 'compressor', 'gain'])
    const presence = plan.find((s) => s.kind === 'biquad' && s.frequency === 3000)
    expect(presence).toMatchObject({ gainDb: 5 })
    expect(plan.at(-1)).toEqual({ kind: 'gain', value: dbGain(4) })
  })

  it('signature changes with strength', () => {
    expect(enhanceSignature({ noise: 0.5, voice: 0.5 })).not.toBe(enhanceSignature({ noise: 0.6, voice: 0.5 }))
  })
})

describe('preview and export apply the same envelope', () => {
  function project(c: Clip): Project {
    return {
      id: 'p',
      name: 'p',
      fps: FPS,
      stage: { width: 1920, height: 1080 },
      tracks: [track],
      clips: { t1: [c] },
      transitions: [],
    } as unknown as Project
  }

  it('fades: export samples match the preview scene volume frame by frame', () => {
    const c = clip({ volume: 0.8, audio: { fadeInSec: 0.5, fadeOutSec: 0.5, boostDb: 3 } })
    const p = project(c)
    const events = gainAutomation(c, track, FPS, { startFrame: 0, endFrame: 90 }, 0)
    // Replay the set/ramp events into a per-frame curve.
    const curve: number[] = []
    for (let f = 0; f < 90; f++) {
      const t = f / FPS
      let v = events[0]!.value
      for (let i = 1; i < events.length; i++) {
        const a = events[i - 1]!
        const b = events[i]!
        if (t >= b.time) v = b.value
        else if (t > a.time) {
          v = a.value + ((b.value - a.value) * (t - a.time)) / (b.time - a.time)
          break
        } else break
      }
      curve.push(v)
    }
    for (const f of [0, 5, 14, 15, 40, 80, 89]) {
      const scene = resolveTimeline(f, p)
      expect(scene.audios[0]!.volume).toBeCloseTo(curve[f]!, 6)
    }
  })

  it('a static boost/mute stays one set event', () => {
    const muted = clip({ audio: { muted: true } })
    expect(gainAutomation(muted, track, FPS, { startFrame: 0, endFrame: 90 }, 0)).toEqual([
      { kind: 'set', time: 0, value: 0 },
    ])
    expect(resolveTimeline(10, project(muted)).audios[0]!.volume).toBe(0)
  })

  it('the scene carries Enhance for the player', () => {
    const c = clip({ audio: { enhance: { noise: 0.4, voice: 0.2 } } })
    expect(resolveTimeline(10, project(c)).audios[0]!.enhance).toEqual({ noise: 0.4, voice: 0.2 })
    expect(resolveTimeline(10, project(clip())).audios[0]).not.toHaveProperty('enhance')
  })
})

describe('split keeps fades on the outer ends', () => {
  it('left keeps the fade-in, right keeps the fade-out, other settings on both', () => {
    const c = clip({ audio: { fadeInSec: 1, fadeOutSec: 1, muted: true } })
    const p = { clips: { t1: [c] } } as unknown as Project
    const next = produce(p, (draft) => {
      splitClip(draft, 'a1', 't1', 45)
    })
    const [left, right] = next.clips.t1!
    expect(left!.audio).toEqual({ fadeInSec: 1, muted: true })
    expect(right!.audio).toEqual({ fadeOutSec: 1, muted: true })
  })

  it('drops an emptied settings object', () => {
    const c = clip({ audio: { fadeInSec: 1 } })
    const next = produce({ clips: { t1: [c] } } as unknown as Project, (draft) => {
      splitClip(draft, 'a1', 't1', 45)
    })
    expect(next.clips.t1![1]).not.toHaveProperty('audio')
  })
})

describe('latencyLead', () => {
  it('starts early by the latency when the range and source allow', () => {
    expect(latencyLead(0.008, 2, 5, 1)).toBe(0.008)
  })
  it('is limited by the start time and the source before the offset', () => {
    expect(latencyLead(0.008, 0, 5, 1)).toBe(0)
    expect(latencyLead(0.008, 2, 0.004, 2)).toBeCloseTo(0.002)
    expect(latencyLead(0, 2, 5, 1)).toBe(0)
  })
})
