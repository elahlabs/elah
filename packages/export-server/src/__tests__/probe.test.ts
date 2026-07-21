import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * mediabunny is mocked at the module boundary so these tests exercise
 * probe.ts's own logic (source selection, dispose-on-every-path, decode-order
 * -> presentation-order sorting, CFR fallback synthesis, error wrapping)
 * without touching a real file or the network. The one thing intentionally
 * NOT unit-tested here is mediabunny's own demuxing correctness — that's
 * mediabunny's test suite, not ours.
 */

type FakeTrack = {
  computeDuration: () => Promise<number>
  getDisplayWidth: () => Promise<number>
  getDisplayHeight: () => Promise<number>
  getCodedWidth: () => Promise<number>
  getCodedHeight: () => Promise<number>
  computePacketStats: () => Promise<{ packetCount: number; averagePacketRate: number; averageBitrate: number }>
}

function makeTrack(overrides: Partial<FakeTrack> = {}): FakeTrack {
  return {
    computeDuration: async () => 10,
    getDisplayWidth: async () => 1920,
    getDisplayHeight: async () => 1080,
    getCodedWidth: async () => 1920,
    getCodedHeight: async () => 1080,
    computePacketStats: async () => ({ packetCount: 300, averagePacketRate: 30, averageBitrate: 8_000_000 }),
    ...overrides,
  }
}

interface MockState {
  durationSec: number
  videoTrack: FakeTrack | null
  audioTrack: unknown | null
  packetTimestamps: number[]
  disposeCalls: number
  lastSource: { kind: 'url' | 'file'; value: string } | null
  computeDurationImpl: () => Promise<number>
}

let state: MockState

function resetState() {
  state = {
    durationSec: 10,
    videoTrack: makeTrack(),
    audioTrack: null,
    packetTimestamps: [],
    disposeCalls: 0,
    lastSource: null,
    computeDurationImpl: async () => state.durationSec,
  }
}

vi.mock('mediabunny', () => {
  class FakeUrlSource {
    kind = 'url' as const
    constructor(public value: string) {}
  }
  class FakeFilePathSource {
    kind = 'file' as const
    constructor(public value: string) {}
  }
  class FakeInput {
    constructor(opts: { source: { kind: 'url' | 'file'; value: string } }) {
      state.lastSource = opts.source
    }
    computeDuration = async () => state.computeDurationImpl()
    getPrimaryVideoTrack = async () => state.videoTrack
    getPrimaryAudioTrack = async () => state.audioTrack
    dispose = () => {
      state.disposeCalls += 1
    }
  }
  class FakeEncodedPacketSink {
    constructor(_track: FakeTrack) {}
    async *packets() {
      for (const timestamp of state.packetTimestamps) yield { timestamp }
    }
  }
  return {
    ALL_FORMATS: [],
    UrlSource: FakeUrlSource,
    FilePathSource: FakeFilePathSource,
    Input: FakeInput,
    EncodedPacketSink: FakeEncodedPacketSink,
  }
})

vi.mock('../errors', () => {
  class ExportServerError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.name = 'ExportServerError'
      this.code = code
    }
  }
  return { ExportServerError }
})

const { probeMedia, probeVideoSource, buildVideoFrameIndex, validateOutputFile } = await import('../probe')
const { ExportServerError } = await import('../errors')

beforeEach(() => {
  resetState()
})

describe('probeMedia', () => {
  it('reads duration and coded dimensions from the primary video track', async () => {
    const info = await probeMedia('/tmp/clip.mp4')
    expect(info).toEqual({ durationSec: 10, width: 1920, height: 1080 })
  })

  it('leaves width/height undefined when there is no video track (audio-only source)', async () => {
    state.videoTrack = null
    const info = await probeMedia('/tmp/track.mp3')
    expect(info).toEqual({ durationSec: 10 })
  })

  it('opens a FilePathSource for a local path', async () => {
    await probeMedia('/tmp/clip.mp4')
    expect(state.lastSource).toEqual({ kind: 'file', value: '/tmp/clip.mp4' })
  })

  it('opens a UrlSource for an http(s) source', async () => {
    await probeMedia('https://cdn.example.com/clip.mp4')
    expect(state.lastSource).toEqual({ kind: 'url', value: 'https://cdn.example.com/clip.mp4' })
  })

  it('wraps failures in ExportServerError with code PROBE_FAILED, and still disposes', async () => {
    state.computeDurationImpl = async () => {
      throw new Error('boom')
    }
    await expect(probeMedia('/tmp/broken.mp4')).rejects.toMatchObject({
      code: 'PROBE_FAILED',
    })
    await expect(probeMedia('/tmp/broken.mp4')).rejects.toBeInstanceOf(ExportServerError)
    expect(state.disposeCalls).toBeGreaterThan(0)
  })
})

describe('probeVideoSource', () => {
  it('returns display dims (post-rotation/PAR), coded dims, and average frame rate', async () => {
    const info = await probeVideoSource('/tmp/clip.mp4')
    expect(info).toEqual({
      durationSec: 10,
      displayWidth: 1920,
      displayHeight: 1080,
      codedWidth: 1920,
      codedHeight: 1080,
      averageFrameRate: 30,
    })
  })

  it('throws ExportServerError when the source has no video track', async () => {
    state.videoTrack = null
    await expect(probeVideoSource('/tmp/audio-only.mp4')).rejects.toMatchObject({ code: 'PROBE_FAILED' })
  })
})

describe('buildVideoFrameIndex', () => {
  it('sorts decode-order packet timestamps into ascending presentation order', async () => {
    // A B-frame source: decode order != presentation order.
    state.packetTimestamps = [0, 0.066, 0.033, 0.1, 0.066 + 0.033]
    const index = await buildVideoFrameIndex('/tmp/bframes.mp4')
    expect(index.exact).toBe(true)
    expect(Array.from(index.timestamps)).toEqual([...state.packetTimestamps].sort((a, b) => a - b))
  })

  it('carries the video source info alongside the timestamp index', async () => {
    state.packetTimestamps = [0, 1 / 30]
    const index = await buildVideoFrameIndex('/tmp/clip.mp4')
    expect(index.displayWidth).toBe(1920)
    expect(index.displayHeight).toBe(1080)
    expect(index.codedWidth).toBe(1920)
    expect(index.codedHeight).toBe(1080)
    expect(index.averageFrameRate).toBe(30)
  })

  it('synthesizes a CFR index from averagePacketRate/duration when no packets come back', async () => {
    state.packetTimestamps = []
    state.videoTrack = makeTrack({
      computeDuration: async () => 2,
      computePacketStats: async () => ({ packetCount: 0, averagePacketRate: 25, averageBitrate: 0 }),
    })
    const index = await buildVideoFrameIndex('/tmp/live-fragment.mp4')
    expect(index.exact).toBe(false)
    expect(index.timestamps.length).toBe(50) // 2s * 25fps
    expect(index.timestamps[0]).toBe(0)
    expect(index.timestamps[1]).toBeCloseTo(1 / 25)
  })

  it('returns an empty (never fabricated) index when rate and duration are both unusable', async () => {
    state.packetTimestamps = []
    state.videoTrack = makeTrack({
      computeDuration: async () => 0,
      computePacketStats: async () => ({ packetCount: 0, averagePacketRate: 0, averageBitrate: 0 }),
    })
    const index = await buildVideoFrameIndex('/tmp/empty.mp4')
    expect(index.exact).toBe(false)
    expect(index.timestamps.length).toBe(0)
  })

  it('throws ExportServerError when the source has no video track', async () => {
    state.videoTrack = null
    await expect(buildVideoFrameIndex('/tmp/audio-only.mp4')).rejects.toMatchObject({ code: 'PROBE_FAILED' })
  })
})

describe('validateOutputFile', () => {
  it('reports frame count, dims, and audio presence for a normal output', async () => {
    state.audioTrack = {}
    const result = await validateOutputFile('/tmp/out.mp4')
    expect(result).toEqual({
      durationSec: 10,
      frameCount: 300,
      width: 1920,
      height: 1080,
      hasAudioTrack: true,
    })
  })

  it('reports hasAudioTrack: false when there is no primary audio track', async () => {
    state.audioTrack = null
    const result = await validateOutputFile('/tmp/out.mp4')
    expect(result.hasAudioTrack).toBe(false)
  })

  it('never throws on a missing video track — returns null frameCount/zero dims for the caller to judge', async () => {
    state.videoTrack = null
    const result = await validateOutputFile('/tmp/audio-only-output.mp4')
    expect(result.frameCount).toBeNull()
    expect(result.width).toBe(0)
    expect(result.height).toBe(0)
  })

  it('does throw ExportServerError when the file itself cannot be opened', async () => {
    state.computeDurationImpl = async () => {
      throw new Error('ENOENT')
    }
    await expect(validateOutputFile('/tmp/missing.mp4')).rejects.toMatchObject({ code: 'PROBE_FAILED' })
  })
})
