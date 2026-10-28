import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimelineEngine } from '../../editor/TimelineEngine'
import type { Clip } from '../../types'
import type { AudioStream } from '../../media/audio/streamDecode'
import { renderAudioMix } from '../exportVideo'

/**
 * LM-P5: for a large local source the export mix decodes only the source range
 * each clip plays, not the whole file. The context and stream are fakes.
 */

const FPS = 30
const SR = 8000

let starts: Array<[number, number, number]> = []
let buffers: Array<{ length: number; sampleRate: number }> = []

class FakeOAC {
  createBufferSource() {
    return {
      buffer: null as unknown,
      playbackRate: { value: 1 },
      connect: (n: unknown) => n,
      start: (...a: [number, number, number]) => starts.push(a),
    }
  }
  createGain() {
    return {
      gain: { value: 1, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined },
      connect: (n: unknown) => n,
    }
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    buffers.push({ length, sampleRate })
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, copyToChannel: () => undefined }
  }
  get destination() {
    return {}
  }
  decodeAudioData() {
    return Promise.resolve({ duration: 60 })
  }
  async startRendering() {
    return { numberOfChannels: 2, length: 100, getChannelData: () => new Float32Array(100) }
  }
}

function makeStream(durationSec: number) {
  const readRange = vi.fn(async (a: number, b: number) => ({
    channels: [new Float32Array(Math.round(b * SR) - Math.round(a * SR))],
    sampleRate: SR,
  }))
  const close = vi.fn()
  const stream: AudioStream = { durationSec, sampleRate: SR, numberOfChannels: 1, readRange, close }
  return { stream, readRange, close }
}

function projectWithClip(over: Partial<Clip> & { startFrame: number; durationFrames: number }) {
  const engine = new TimelineEngine({ fps: FPS })
  const track = engine.addTrack('audio')
  const clip = {
    type: 'audio', src: 'local://podcast', name: 'p', trackId: '', sourceStartFrame: 0, volume: 1, ...over,
  } as Clip
  const added = engine.addClip({ ...clip, trackId: track.id } as never)
  const patch: Partial<Clip> = {}
  if (clip.sourceStartFrame) patch.sourceStartFrame = clip.sourceStartFrame
  if (clip.speed !== undefined) patch.speed = clip.speed
  if (Object.keys(patch).length) engine.updateClip(added.id, track.id, patch)
  return engine.getProject()
}

const big = { size: 5 * 1024 ** 3 } as Blob
const small = { size: 1024 } as Blob

beforeEach(() => {
  starts = []
  buffers = []
  ;(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = FakeOAC
})
afterEach(() => {
  delete (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext
})

describe('renderAudioMix - ranged decode of large sources (LM-P5)', () => {
  it('reads only the clip\'s used source range and never fetches the whole file', async () => {
    // A 2-hour source; the clip plays 10 s of it starting 1 h 5 min in.
    const project = projectWithClip({ startFrame: 0, durationFrames: 10 * FPS, sourceStartFrame: 3900 * FPS })
    const { stream, readRange, close } = makeStream(7200)
    const audioResolver = vi.fn(async () => new ArrayBuffer(8))

    const mixed = await renderAudioMix(project, audioResolver, undefined, undefined, {
      blobFor: () => big,
      open: async () => stream,
    })

    expect(mixed).not.toBeNull()
    expect(audioResolver).not.toHaveBeenCalled()
    expect(readRange).toHaveBeenCalledTimes(1)
    expect(readRange.mock.calls[0]![0]).toBeCloseTo(3900)
    expect(readRange.mock.calls[0]![1]).toBeCloseTo(3910)
    // The slice is 10 s of audio, and the node plays it from its own start.
    expect(buffers).toEqual([{ length: 10 * SR, sampleRate: SR }])
    expect(starts).toEqual([[0, 0, 10]])
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('accounts for clip speed: a 2x clip consumes twice the source', async () => {
    const project = projectWithClip({ startFrame: 0, durationFrames: 5 * FPS, sourceStartFrame: 60 * FPS, speed: 2 })
    const { stream, readRange } = makeStream(7200)
    await renderAudioMix(project, vi.fn(async () => new ArrayBuffer(8)), undefined, undefined, {
      blobFor: () => big,
      open: async () => stream,
    })
    expect(readRange.mock.calls[0]![0]).toBeCloseTo(60)
    expect(readRange.mock.calls[0]![1]).toBeCloseTo(70)
    expect(starts).toEqual([[0, 0, 10]])
  })

  it('reads only the export range when the clip straddles it', async () => {
    const project = projectWithClip({ startFrame: 0, durationFrames: 100 * FPS, sourceStartFrame: 0 })
    const { stream, readRange } = makeStream(7200)
    await renderAudioMix(
      project,
      vi.fn(async () => new ArrayBuffer(8)),
      undefined,
      { startFrame: 30 * FPS, endFrame: 40 * FPS, totalFrames: 100 * FPS },
      { blobFor: () => big, open: async () => stream },
    )
    expect(readRange.mock.calls[0]![0]).toBeCloseTo(30)
    expect(readRange.mock.calls[0]![1]).toBeCloseTo(40)
  })

  it('opens one stream per source for several clips, and closes it', async () => {
    const engine = new TimelineEngine({ fps: FPS })
    const track = engine.addTrack('audio')
    for (const startFrame of [0, 10 * FPS]) {
      engine.addClip({
        type: 'audio', src: 'local://podcast', name: 'p', trackId: track.id, startFrame, durationFrames: 5 * FPS,
        sourceStartFrame: 0, volume: 1,
      } as never)
    }
    const { stream, readRange, close } = makeStream(7200)
    const open = vi.fn(async () => stream)
    await renderAudioMix(engine.getProject(), vi.fn(async () => new ArrayBuffer(8)), undefined, undefined, {
      blobFor: () => big,
      open,
    })
    expect(open).toHaveBeenCalledTimes(1)
    expect(readRange).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('a small source keeps the whole-file resolver path', async () => {
    const project = projectWithClip({ startFrame: 0, durationFrames: 10 * FPS })
    const open = vi.fn()
    const audioResolver = vi.fn(async () => new ArrayBuffer(8))
    await renderAudioMix(project, audioResolver, undefined, undefined, { blobFor: () => small, open })
    expect(audioResolver).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
    expect(starts).toEqual([[0, 0, 10]])
  })

  it('a source with no local Blob keeps the whole-file resolver path', async () => {
    const project = projectWithClip({ startFrame: 0, durationFrames: 10 * FPS })
    const open = vi.fn()
    const audioResolver = vi.fn(async () => new ArrayBuffer(8))
    await renderAudioMix(project, audioResolver, undefined, undefined, { blobFor: () => undefined, open })
    expect(audioResolver).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
  })

  it('reports a stream that fails to open and still returns the mix', async () => {
    const project = projectWithClip({ startFrame: 0, durationFrames: 10 * FPS })
    const issues: string[] = []
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mixed = await renderAudioMix(
      project,
      vi.fn(async () => new ArrayBuffer(8)),
      (m) => issues.push(m),
      undefined,
      {
        blobFor: () => big,
        open: async () => {
          throw new Error('no decoder')
        },
      },
    )
    expect(mixed).not.toBeNull()
    expect(issues[0]).toContain('decode error')
    vi.restoreAllMocks()
  })
})
