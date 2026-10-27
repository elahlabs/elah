import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimelineEngine } from '../../editor/TimelineEngine'
import type { Clip, Project } from '../../types'
import { renderAudioMix } from '../exportVideo'
import { applyGainEvents, gainAutomation, type GainEvent } from '../audioMix'

/**
 * `renderAudioMix` wired end-to-end (PV-P10a): master gain, per-clip
 * automation (`applyGainEvents(gain.gain, gainAutomation(...))`) and solo, all
 * through one fake `OfflineAudioContext` that records every `AudioParam` call
 * in order — proving the WIRING calls the right functions with the right
 * arguments, on top of `audioMix.test.ts`'s own proof that those functions'
 * math is right in isolation.
 */

interface GainCall {
  name: 'setValueAtTime' | 'linearRampToValueAtTime'
  value: number
  time: number
}

interface FakeGain {
  gain: { value: number; setValueAtTime: (v: number, t: number) => unknown; linearRampToValueAtTime: (v: number, t: number) => unknown }
  connect: (n: unknown) => unknown
  calls: GainCall[]
}

let gains: FakeGain[] = []
let starts: Array<[number, number, number]> = []
let ctorArgs: [number, number, number] | undefined

function makeFakeGain(): FakeGain {
  const calls: GainCall[] = []
  const g: FakeGain = {
    gain: {
      value: 1,
      setValueAtTime: (v, t) => {
        g.gain.value = v
        calls.push({ name: 'setValueAtTime', value: v, time: t })
      },
      linearRampToValueAtTime: (v, t) => {
        g.gain.value = v
        calls.push({ name: 'linearRampToValueAtTime', value: v, time: t })
      },
    },
    connect: (n: unknown) => n,
    calls,
  }
  gains.push(g)
  return g
}

class FakeOAC {
  constructor(channels: number, length: number, sampleRate: number) {
    ctorArgs = [channels, length, sampleRate]
  }
  createBufferSource() {
    return {
      buffer: null as { duration: number } | null,
      playbackRate: { value: 1 },
      connect: (n: unknown) => n,
      start: (...a: [number, number, number]) => starts.push(a),
    }
  }
  createGain() {
    return makeFakeGain()
  }
  get destination() {
    return {}
  }
  decodeAudioData(_buf: ArrayBuffer) {
    return Promise.resolve({ duration: 60 })
  }
  async startRendering() {
    const length = 100
    return {
      numberOfChannels: 2,
      length,
      getChannelData: () => new Float32Array(length),
    }
  }
}

const audioResolver = vi.fn(async (_src: string) => new ArrayBuffer(8))

beforeEach(() => {
  gains = []
  starts = []
  ctorArgs = undefined
  audioResolver.mockClear()
  ;(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = FakeOAC
})

afterEach(() => {
  delete (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext
})

// --- project builders --------------------------------------------------------

function audioClip(over: Partial<Clip> & { startFrame: number; durationFrames: number }): Clip {
  return {
    type: 'audio',
    src: 'a.mp3',
    name: 'a',
    trackId: '',
    sourceStartFrame: 0,
    volume: 1,
    ...over,
  } as Clip
}

function insert(engine: TimelineEngine, trackId: string, clip: Clip): Clip {
  const added = engine.addClip({ ...clip, trackId } as never)
  const patch: Partial<Clip> = {}
  if (clip.disabled) patch.disabled = true
  if (clip.sourceStartFrame) patch.sourceStartFrame = clip.sourceStartFrame
  if (clip.speed !== undefined) patch.speed = clip.speed
  if (clip.keyframes) patch.keyframes = clip.keyframes
  if (Object.keys(patch).length) engine.updateClip(added.id, trackId, patch)
  return added
}

const FPS = 30

describe('renderAudioMix — wired (PV-P10a)', () => {
  it('(a) legacy: constructor args, exact start() calls, exact gain calls, master gain 1', async () => {
    const engine = new TimelineEngine({ fps: FPS })
    const track = engine.addTrack('audio')
    insert(engine, track.id, audioClip({ startFrame: 0, sourceStartFrame: 0, durationFrames: 60, volume: 1 }))
    insert(engine, track.id, audioClip({ startFrame: 90, sourceStartFrame: 15, durationFrames: 30, volume: 0.5 }))
    const project = engine.getProject()

    const mixed = await renderAudioMix(project, audioResolver)
    expect(mixed).not.toBeNull()

    // 120 frames total @ 30fps = 4s @ 44100Hz.
    expect(ctorArgs).toEqual([2, Math.ceil(44100 * 4), 44100])

    expect(starts).toEqual([
      [0, 0, 2],
      [3, 0.5, 1],
    ])

    // gains[0] is the master (created before the loop); gains[1..] are the
    // clips, in scheduling order.
    expect(gains).toHaveLength(3)
    expect(gains[0]!.gain.value).toBe(1) // master, no masterVolume set
    expect(gains[1]!.calls).toEqual([{ name: 'setValueAtTime', value: 1, time: 0 }])
    expect(gains[2]!.calls).toEqual([{ name: 'setValueAtTime', value: 0.5, time: 3 }])
  })

  it('(b) masterVolume sets the master gain node, not any clip gain', async () => {
    const engine = new TimelineEngine({ fps: FPS })
    const track = engine.addTrack('audio')
    insert(engine, track.id, audioClip({ startFrame: 0, durationFrames: 30, volume: 1 }))
    const project: Project = { ...engine.getProject(), masterVolume: 0.5 }

    await renderAudioMix(project, audioResolver)
    expect(gains[0]!.gain.value).toBe(0.5)
    expect(gains[1]!.calls).toEqual([{ name: 'setValueAtTime', value: 1, time: 0 }])
  })

  it('(c) a keyed clip: the gain node receives exactly the calls applyGainEvents(gainAutomation(...)) would make', async () => {
    const keys = [
      { id: 'k0', frame: 0, value: 0, easing: 'linear' as const },
      { id: 'k10', frame: 10, value: 1, easing: 'linear' as const },
    ]
    const clip: Clip = audioClip({
      startFrame: 0,
      durationFrames: 20,
      sourceStartFrame: 0,
      keyframes: { channels: { volume: { source: { kind: 'keyframes' }, keys } } },
    })
    const engine = new TimelineEngine({ fps: FPS })
    const track = engine.addTrack('audio')
    insert(engine, track.id, clip)
    const project = engine.getProject()
    const stored = project.clips[track.id]![0]!

    await renderAudioMix(project, audioResolver)

    const expected = gainAutomation(stored, project.tracks.find((t) => t.id === track.id)!, FPS, {
      startFrame: 0,
      endFrame: 20,
    })
    const recorder: GainEvent[] = []
    applyGainEvents(
      {
        setValueAtTime: (value, time) => recorder.push({ kind: 'set', time, value }),
        linearRampToValueAtTime: (value, time) => recorder.push({ kind: 'ramp', time, value }),
      },
      expected,
    )
    const actual = gains[1]!.calls.map((c) => ({
      kind: c.name === 'setValueAtTime' ? ('set' as const) : ('ramp' as const),
      time: c.time,
      value: c.value,
    }))
    expect(actual).toEqual(recorder)
  })

  it('(d) two audio tracks, the second soloed: only the soloed track\'s clip is started', async () => {
    const engine = new TimelineEngine({ fps: FPS })
    const trackA = engine.addTrack('audio')
    insert(engine, trackA.id, audioClip({ startFrame: 0, durationFrames: 30, src: 'a.mp3' }))
    const trackB = engine.addTrack('audio')
    insert(engine, trackB.id, audioClip({ startFrame: 0, durationFrames: 30, src: 'b.mp3' }))
    const project = {
      ...engine.getProject(),
      tracks: engine.getProject().tracks.map((t) => (t.id === trackB.id ? { ...t, solo: true } : t)),
    }

    await renderAudioMix(project, audioResolver)
    expect(starts).toHaveLength(1)
    expect(audioResolver).toHaveBeenCalledTimes(1)
    expect(audioResolver).toHaveBeenCalledWith('b.mp3')
  })

  it('(e) a clip on a muted track: audioResolver is never called with its src', async () => {
    const engine = new TimelineEngine({ fps: FPS })
    const trackA = engine.addTrack('audio')
    insert(engine, trackA.id, audioClip({ startFrame: 0, durationFrames: 30, src: 'muted.mp3' }))
    const trackB = engine.addTrack('audio')
    insert(engine, trackB.id, audioClip({ startFrame: 0, durationFrames: 30, src: 'ok.mp3' }))
    const project = {
      ...engine.getProject(),
      tracks: engine.getProject().tracks.map((t) => (t.id === trackA.id ? { ...t, muted: true } : t)),
    }

    await renderAudioMix(project, audioResolver)
    const calledSrcs = audioResolver.mock.calls.map((c) => c[0])
    expect(calledSrcs).not.toContain('muted.mp3')
    expect(calledSrcs).toContain('ok.mp3')
  })
})
