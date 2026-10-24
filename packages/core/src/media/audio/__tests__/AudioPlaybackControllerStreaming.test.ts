import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioPlaybackController } from '../AudioPlaybackController'
import type { AudioStream } from '../streamDecode'
import { MAX_STREAM_CHUNKS_PER_SOURCE, STREAM_CHUNK_SEC } from '../audioChunkCache'
import type { PlaybackEngine, PlaybackSnapshot } from '../../../playback/PlaybackEngine'
import type { Project } from '../../../types'

/**
 * LM-P5: the controller plays a large local source from decoded windows. The
 * context, engine and stream are fakes; this proves the scheduling and the
 * memory bound, not the browser's audio output (a browser row owns that).
 */

const FPS = 30
const SR = 8000
const HOUR = 3600
const BIG = 'local://podcast'

function makeEngine() {
  let listener: ((snap: PlaybackSnapshot) => void) | null = null
  const state = { currentFrame: 0, isPlaying: false, playbackRate: 1, loop: false }
  const engine = {
    get currentFrame() { return state.currentFrame },
    get isPlaying() { return state.isPlaying },
    get playbackRate() { return state.playbackRate },
    get loop() { return state.loop },
    subscribe(fn: (snap: PlaybackSnapshot) => void) {
      listener = fn
      return () => { listener = null }
    },
    setAudioContext: vi.fn(),
    reanchor: vi.fn(),
  }
  function emit(snap: Partial<PlaybackSnapshot> & { epoch: number }): void {
    state.currentFrame = snap.currentFrame ?? state.currentFrame
    state.isPlaying = snap.isPlaying ?? state.isPlaying
    if (snap.playbackRate !== undefined) state.playbackRate = snap.playbackRate
    listener?.({
      currentFrame: state.currentFrame,
      isPlaying: state.isPlaying,
      playbackRate: state.playbackRate,
      loop: state.loop,
      epoch: snap.epoch,
    })
  }
  return { engine: engine as unknown as PlaybackEngine, emit }
}

interface FakeNode {
  buffer: { duration: number } | null
  playbackRate: { value: number }
  onended: (() => void) | null
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

function makeContext() {
  const nodes: FakeNode[] = []
  const param = () => ({
    value: 1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  })
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    createBufferSource: vi.fn(() => {
      const n: FakeNode = {
        buffer: null,
        playbackRate: { value: 1 },
        onended: null,
        connect: vi.fn((t: unknown) => t),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
      }
      nodes.push(n)
      return n
    }),
    createGain: vi.fn(() => ({ gain: param(), connect: vi.fn((t: unknown) => t), disconnect: vi.fn() })),
    createAnalyser: vi.fn(() => ({
      fftSize: 1024,
      getFloatTimeDomainData: vi.fn(),
      connect: vi.fn((t: unknown) => t),
      disconnect: vi.fn(),
    })),
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      copyToChannel: vi.fn(),
    })),
    decodeAudioData: vi.fn(async () => ({ duration: 4 })),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  return { ctx, nodes }
}

function makeStream(durationSec = HOUR) {
  const readRange = vi.fn(async (a: number, b: number) => ({
    channels: [new Float32Array(Math.round(b * SR) - Math.round(a * SR))],
    sampleRate: SR,
  }))
  const close = vi.fn()
  const stream: AudioStream = { durationSec, sampleRate: SR, numberOfChannels: 1, readRange, close }
  return { stream, readRange, close }
}

function project(src: string, speed?: number): Project {
  return {
    id: 'p1',
    fps: FPS,
    stage: { width: 1920, height: 1080 },
    tracks: [
      { id: 't', name: 'A', kind: 'audio', order: 0, height: 60, locked: false, disabled: false, muted: false, solo: false, volume: 1 },
    ],
    clips: {
      t: [
        {
          id: 'c',
          trackId: 't',
          type: 'audio',
          name: 'pod',
          startFrame: 0,
          durationFrames: HOUR * FPS,
          sourceStartFrame: 0,
          sourceDurationFrames: HOUR * FPS,
          src,
          volume: 1,
          ...(speed ? { speed } : {}),
        },
      ],
    },
    transitions: [],
    version: 1,
  } as Project
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0))
const bigBlob = { size: 5 * 1024 ** 3 } as Blob
const smallBlob = { size: 1024 } as Blob

function build(opts: {
  blob?: Blob
  stream?: ReturnType<typeof makeStream>
  speed?: number
  open?: () => Promise<AudioStream>
}) {
  const { engine, emit } = makeEngine()
  const { ctx, nodes } = makeContext()
  const s = opts.stream ?? makeStream()
  const open = vi.fn(opts.open ?? (async () => s.stream))
  const controller = new AudioPlaybackController(engine, () => project(BIG, opts.speed), {
    audioContextFactory: () => ctx as unknown as AudioContext,
    audioBlobFor: (src) => (src === BIG ? (opts.blob ?? bigBlob) : undefined),
    openAudioStream: open,
    audioResolver: vi.fn(async () => new ArrayBuffer(8)),
  })
  controller.start()
  return { controller, emit, ctx, nodes, s, open }
}

describe('AudioPlaybackController - streaming large sources (LM-P5)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a large source decodes its first window only, never the whole file', async () => {
    const { emit, ctx, nodes, s, open } = build({})
    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await settle()

    expect(open).toHaveBeenCalledTimes(1)
    expect(ctx.decodeAudioData).not.toHaveBeenCalled()
    expect(s.readRange.mock.calls[0]).toEqual([0, STREAM_CHUNK_SEC])
    // The playing window plus two scheduled ahead, back to back.
    expect(nodes).toHaveLength(3)
    expect(nodes[0]!.start).toHaveBeenCalledWith(0.02, 0)
    expect(nodes[1]!.start).toHaveBeenCalledWith(0.02 + STREAM_CHUNK_SEC, 0)
    expect(nodes[2]!.start).toHaveBeenCalledWith(0.02 + 2 * STREAM_CHUNK_SEC, 0)
    // Nothing past the lookahead was decoded.
    expect(s.readRange).toHaveBeenCalledTimes(3)
  })

  it('a seek starts in the window that holds the playhead, at the right offset', async () => {
    const { emit, nodes, s } = build({})
    emit({ epoch: 1, isPlaying: true, currentFrame: 45 * FPS }) // 45 s: window 2 (40-60), 5 s in
    await settle()

    expect(s.readRange.mock.calls[0]).toEqual([40, 60])
    expect(nodes[0]!.start).toHaveBeenCalledWith(0.02, 5)
    expect(nodes[1]!.start).toHaveBeenCalledWith(0.02 + 15, 0) // window 3 begins 15 s after the playhead
  })

  it('retimed playback scales window starts by the effective rate', async () => {
    const { emit, nodes } = build({ speed: 2 })
    emit({ epoch: 1, isPlaying: true, currentFrame: 0, playbackRate: 1 })
    await settle()
    expect(nodes[0]!.playbackRate.value).toBe(2)
    expect(nodes[1]!.start).toHaveBeenCalledWith(0.02 + STREAM_CHUNK_SEC / 2, 0)
  })

  it('keeps at most 3 windows scheduled and at most 6 decoded while playing through', async () => {
    const { controller, emit, nodes, s } = build({})
    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await settle()

    const caches = (controller as unknown as { _chunkCaches: Map<string, { size: number }> })._chunkCaches
    let played = 0
    let maxCached = 0
    for (let i = 0; i < 40; i++) {
      // The earliest unfinished window ends; the controller schedules the next.
      const node = nodes[played++]!
      node.onended?.()
      await settle()
      maxCached = Math.max(maxCached, caches.get(BIG)?.size ?? 0)
    }
    expect(s.readRange.mock.calls.length).toBeGreaterThan(40)
    expect(maxCached).toBeLessThanOrEqual(MAX_STREAM_CHUNKS_PER_SOURCE)
    const live = nodes.filter((n) => n.stop.mock.calls.length === 0 && n.onended).length
    expect(live).toBeLessThanOrEqual(3 + played) // ended nodes keep their handler; only 3 are ever unplayed
    expect(nodes.length - played).toBeLessThanOrEqual(3)
  })

  it('pausing stops every scheduled window and schedules nothing more', async () => {
    const { emit, nodes, s } = build({})
    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await settle()
    const decodedBefore = s.readRange.mock.calls.length
    emit({ epoch: 2, isPlaying: false })
    await settle()

    for (const n of nodes) expect(n.stop).toHaveBeenCalled()
    nodes[0]!.onended?.()
    await settle()
    expect(s.readRange.mock.calls.length).toBe(decodedBefore)
    expect(nodes).toHaveLength(3)
  })

  it('a small source still uses the whole-buffer path and never opens a stream', async () => {
    const { emit, ctx, nodes, s, open } = build({ blob: smallBlob })
    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await settle()

    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
    expect(s.readRange).not.toHaveBeenCalled()
    expect(nodes).toHaveLength(1)
  })

  it('falls back to the whole-file decode when a mid-size source cannot be streamed', async () => {
    const { emit, ctx } = build({
      blob: { size: 100 * 1024 ** 2 } as Blob,
      open: async () => {
        throw new Error('no WebCodecs decoder')
      },
    })
    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await settle()
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1)
  })

  it('refuses, instead of decoding whole, a source over 2 GiB that cannot be streamed', async () => {
    const { emit, ctx, nodes } = build({
      open: async () => {
        throw new Error('no WebCodecs decoder')
      },
    })
    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await settle()
    expect(ctx.decodeAudioData).not.toHaveBeenCalled()
    expect(nodes).toHaveLength(0)
    expect(console.warn).toHaveBeenCalled()
  })

  it('warming a large source opens its stream and first window, not a whole-file decode', async () => {
    const { controller, ctx, s, open } = build({})
    controller.warmAudioSrc(BIG)
    await settle()
    expect(ctx.decodeAudioData).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledTimes(1)
    expect(s.readRange.mock.calls[0]).toEqual([0, STREAM_CHUNK_SEC])
  })

  it('destroy closes the stream', async () => {
    const { controller, emit, s } = build({})
    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await settle()
    controller.destroy()
    await settle()
    expect(s.close).toHaveBeenCalledTimes(1)
  })
})
