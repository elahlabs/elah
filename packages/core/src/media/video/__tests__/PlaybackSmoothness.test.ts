/**
 * Playback smoothness (4K/60 fps clip on a 30 fps project):
 *  1. source frames no project frame will show are closed WITHOUT createImageBitmap
 *  2. decoder: prefer-hardware with a no-preference fallback; latency only on request
 *  3. lookahead is clamped to what the cache can hold, evicted-ahead frames are re-fed
 */
import { describe, expect, it, vi } from 'vitest'
import { StreamingFrameProducer, mapSourceFrame, type FrameConverter } from '../StreamingFrameProducer'
import { VideoDecoderManager, type VideoDecoderFactory, type VideoDecoderLike } from '../VideoDecoderManager'
import { createMockChunk, createMockDecoder, createMockDemuxerBackend, createMockVideoFrame } from './helpers/mockDemuxer'

const U30 = 1_000_000 / 30

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(cond: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond() && Date.now() < deadline) await sleep(5)
}

/** Decoder factory that records every frame it emits (so tests can check close()). */
function recordingDecoder(frames: VideoFrame[]): VideoDecoderFactory {
  const base = createMockDecoder()
  return (output, error) =>
    base.factory((f: VideoFrame) => {
      const frame = createMockVideoFrame(f.timestamp)
      frames.push(frame)
      output(frame)
    }, error)
}

function sourceChunks(srcFps: number, count: number): EncodedVideoChunk[] {
  return Array.from({ length: count }, (_, i) => createMockChunk(Math.round((i * 1_000_000) / srcFps)))
}

function countingConverter(bitmapSize = { width: 640, height: 360 }) {
  const converted: number[] = []
  const frameConverter: FrameConverter = (frame) => {
    converted.push(frame.timestamp)
    return Promise.resolve({ ...bitmapSize, close: vi.fn() } as unknown as ImageBitmap)
  }
  return { converted, frameConverter }
}

describe('mapSourceFrame', () => {
  it('keeps every frame when the source is not faster than the project', () => {
    expect(mapSourceFrame(41667, 41667, U30, 1)).toEqual({ skip: false, idx: 1 })
    expect(mapSourceFrame(33333, 33333, U30, 1)).toEqual({ skip: false, idx: 1 })
    expect(mapSourceFrame(0, null, U30, 0)).toEqual({ skip: false, idx: 0 })
  })
  it('60 fps on 30 fps: keeps the frame current at the project instant, skips the other', () => {
    expect(mapSourceFrame(0, 16667, U30, 0)).toEqual({ skip: false, idx: 0 })
    expect(mapSourceFrame(16667, 16667, U30, 1).skip).toBe(true)
    expect(mapSourceFrame(33333, 16667, U30, 1)).toEqual({ skip: false, idx: 1 })
    expect(mapSourceFrame(50000, 16667, U30, 2).skip).toBe(true)
  })
})

describe('StreamingFrameProducer skips unshown source frames', () => {
  async function play(srcFps: number, count: number) {
    const frames: VideoFrame[] = []
    const { converted, frameConverter } = countingConverter()
    const producer = new StreamingFrameProducer({
      src: 'video://x.mp4',
      fps: 30,
      demuxerFactory: () => createMockDemuxerBackend({ chunks: sourceChunks(srcFps, count), honorRange: true }),
      decoderFactory: recordingDecoder(frames),
      frameConverter,
    })
    await producer.openPromise
    producer.setPlayhead(0)
    await until(() => frames.length >= 2 && producer.cacheSize > 0)
    await sleep(60)
    return { producer, frames, converted }
  }

  it('60 fps source on a 30 fps project converts one bitmap per project frame and closes the rest', async () => {
    const { producer, frames, converted } = await play(60, 60)
    expect(frames.length).toBeGreaterThan(20)
    // One conversion per cached project frame, none wasted.
    expect(converted.length).toBe(producer.cacheSize)
    // Roughly half the source frames are converted (plus the unknown-interval first frame).
    expect(converted.length).toBeLessThanOrEqual(Math.ceil(frames.length / 2) + 1)
    // Every skipped frame was closed immediately; converted frames close after copy too.
    expect(frames.every((f) => (f.close as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(true)
    // The converted frames are the ones ON the project grid (hold rule), not the in-between ones.
    for (const ts of converted.slice(1)) expect(Math.abs(ts / U30 - Math.round(ts / U30))).toBeLessThan(0.02)
    // Consecutive project frames are all present.
    for (let k = 1; k <= 12; k++) expect(producer.getCurrent(k)).not.toBeNull()
    producer.dispose()
  })

  it('24 fps source on a 30 fps project skips nothing', async () => {
    const { producer, frames, converted } = await play(24, 24)
    expect(frames.length).toBeGreaterThan(10)
    expect(converted.length).toBe(frames.length)
    producer.dispose()
  })
})

describe('VideoDecoderManager hardware acceleration + latency', () => {
  function decoderSpy(opts: { throwOnHardware?: boolean } = {}) {
    const configure = vi.fn((c: VideoDecoderConfig) => {
      if (opts.throwOnHardware && c.hardwareAcceleration === 'prefer-hardware') throw new Error('hw unsupported')
    })
    const factory: VideoDecoderFactory = () =>
      ({ state: 'unconfigured', configure, decode: vi.fn(), flush: vi.fn(async () => {}), close: vi.fn(), reset: vi.fn() }) as VideoDecoderLike
    return { configure, factory }
  }
  const backend = () => createMockDemuxerBackend({})

  it('configures prefer-hardware with optimizeForLatency false', async () => {
    const d = decoderSpy()
    const m = new VideoDecoderManager({ demuxerFactory: backend, decoderFactory: d.factory })
    await m.open('video://a')
    expect(d.configure).toHaveBeenCalledTimes(1)
    expect(d.configure.mock.calls[0][0]).toMatchObject({ hardwareAcceleration: 'prefer-hardware', optimizeForLatency: false })
  })

  it('falls back to no-preference when isConfigSupported says no', async () => {
    const d = decoderSpy()
    const m = new VideoDecoderManager({
      demuxerFactory: backend,
      decoderFactory: d.factory,
      isConfigSupported: async () => false,
    })
    await m.open('video://a')
    expect(d.configure.mock.calls[0][0]).toMatchObject({ hardwareAcceleration: 'no-preference' })
  })

  it('retries once with no-preference when configure throws', async () => {
    const d = decoderSpy({ throwOnHardware: true })
    const m = new VideoDecoderManager({ demuxerFactory: backend, decoderFactory: d.factory })
    await m.open('video://a')
    expect(m.state).toBe('Ready')
    expect(d.configure).toHaveBeenCalledTimes(2)
    expect(d.configure.mock.calls[0][0].hardwareAcceleration).toBe('prefer-hardware')
    expect(d.configure.mock.calls[1][0].hardwareAcceleration).toBe('no-preference')
  })

  it('a decoder error under prefer-hardware makes the reopen use no-preference', async () => {
    const configure = vi.fn()
    let fireError: (e: DOMException) => void = () => {}
    const factory: VideoDecoderFactory = (_o, err) => {
      fireError = err
      return { state: 'unconfigured', configure, decode: vi.fn(), flush: vi.fn(async () => {}), close: vi.fn(), reset: vi.fn() } as VideoDecoderLike
    }
    const m = new VideoDecoderManager({ demuxerFactory: backend, decoderFactory: factory })
    await m.open('video://a')
    fireError(new DOMException('boom'))
    await m.reopen('video://a')
    expect(configure.mock.calls.at(-1)![0].hardwareAcceleration).toBe('no-preference')
  })

  it('reset() requests optimizeForLatency only when asked (paused scrub)', async () => {
    const d = decoderSpy()
    const m = new VideoDecoderManager({ demuxerFactory: backend, decoderFactory: d.factory })
    await m.open('video://a')
    await m.reset(0)
    expect(d.configure.mock.calls.at(-1)![0].optimizeForLatency).toBe(false)
    await m.reset(0, { optimizeForLatency: true })
    expect(d.configure.mock.calls.at(-1)![0].optimizeForLatency).toBe(true)
  })
})

describe('lookahead vs cache capacity', () => {
  it('never feeds further ahead than the cache can hold', async () => {
    const demuxer = createMockDemuxerBackend({
      chunks: Array.from({ length: 80 }, (_, i) => createMockChunk(Math.round(i * U30))),
      honorRange: true,
    })
    // 4096x4096 RGBA = 64 MiB -> 256 MiB budget holds 4 frames -> lookahead 2.
    const { frameConverter } = countingConverter({ width: 4096, height: 4096 })
    const producer = new StreamingFrameProducer({
      src: 'video://big.mp4',
      fps: 30,
      lookaheadFrames: 16,
      demuxerFactory: () => demuxer,
      decoderFactory: createMockDecoder().factory,
      frameConverter,
    })
    await producer.openPromise
    for (let n = 0; n < 30; n++) {
      producer.setPlayhead(n)
      await sleep(8)
    }
    const maxEnd = Math.max(...vi.mocked(demuxer.packets).mock.calls.map((c) => c[0][1]))
    // Final playhead 29, capacity 4 -> lookahead 2 -> end <= (29 + 2 + 1) frames.
    expect(maxEnd).toBeLessThanOrEqual(Math.round(32 * U30) + 1)
    expect(producer.cacheSize).toBeLessThanOrEqual(4)
    producer.dispose()
  })

  it('re-feeds a frame that was evicted while still ahead of the playhead', async () => {
    const demuxer = createMockDemuxerBackend({
      chunks: Array.from({ length: 60 }, (_, i) => createMockChunk(Math.round(i * U30))),
      honorRange: true,
    })
    const { frameConverter } = countingConverter()
    const producer = new StreamingFrameProducer({
      src: 'video://x.mp4',
      fps: 30,
      lookaheadFrames: 16,
      demuxerFactory: () => demuxer,
      decoderFactory: createMockDecoder().factory,
      frameConverter,
    })
    await producer.openPromise
    producer.setPlayhead(0)
    await until(() => producer.cacheSize >= 16)
    producer.setPlayhead(1)
    producer.setPlayhead(2)
    const seeksBefore = vi.mocked(demuxer.seekToKeyframe).mock.calls.length
    // Simulate cache pressure eating the middle of the lookahead window.
    const cache = (producer as unknown as { _cache: { evictBefore(n: number): void } })._cache
    cache.evictBefore(9) // drops 0..8; 3..8 are ahead of playhead 2
    expect(producer.getCurrent(5)).toBeNull()
    producer.setPlayhead(3)
    await until(() => producer.getCurrent(5) !== null)
    expect(producer.getCurrent(5)).not.toBeNull()
    expect(vi.mocked(demuxer.seekToKeyframe).mock.calls.length).toBe(seeksBefore + 1)
    producer.dispose()
  })
})
