/**
 * Preview frames are downscaled at the copy (decoder VideoFrame -> ImageBitmap)
 * so a 4K clip no longer costs a 33 MB bitmap per frame. Coded aspect is kept
 * (the rotation shader maps display UV onto the raw texture), nothing upscales,
 * and the cache accounts the bitmap's real size.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GpuDebugCounters } from '../../../renderer/gpu/debug/GpuDebugCounters'
import {
  capFrameSize,
  DEFAULT_MAX_FRAME_LONG_EDGE,
  StreamingFrameProducer,
  type FrameConverter,
} from '../StreamingFrameProducer'
import { createMockChunk, createMockDecoder, createMockDemuxerBackend } from './helpers/mockDemuxer'

describe('capFrameSize', () => {
  it('3840x2160 -> 1920x1080', () => {
    expect(capFrameSize(3840, 2160, 1920)).toEqual({ width: 1920, height: 1080 })
  })
  it('portrait coded 2160x3840 keeps CODED aspect (no w/h swap)', () => {
    expect(capFrameSize(2160, 3840, 1920)).toEqual({ width: 1080, height: 1920 })
  })
  it('1280x720 is left alone (no upscale), also at exactly the cap', () => {
    expect(capFrameSize(1280, 720, 1920)).toBeNull()
    expect(capFrameSize(1920, 1080, 1920)).toBeNull()
  })
  it('cap disabled (0 / Infinity) or unknown size -> no resize', () => {
    expect(capFrameSize(3840, 2160, 0)).toBeNull()
    expect(capFrameSize(3840, 2160, Infinity)).toBeNull()
    expect(capFrameSize(NaN, 2160, 1920)).toBeNull()
  })
  it('default cap is 1920', () => {
    expect(DEFAULT_MAX_FRAME_LONG_EDGE).toBe(1920)
  })
})

function frameOf(w: number, h: number, ts: number): VideoFrame {
  return { timestamp: ts, displayWidth: w, displayHeight: h, close: vi.fn() } as unknown as VideoFrame
}

/** A decoder that emits frames of a chosen size. */
function sizedDecoder(w: number, h: number) {
  const base = createMockDecoder()
  const factory: typeof base.factory = (output, error) =>
    base.factory((f: VideoFrame) => output(frameOf(w, h, f.timestamp)), error)
  return factory
}

async function run(
  w: number,
  h: number,
  opts: { maxFrameLongEdge?: number; withConverter?: boolean } = {},
) {
  const calls: Array<{ resize?: { width: number; height: number } }> = []
  const frameConverter: FrameConverter = (_f, resize) => {
    calls.push({ resize })
    const bw = resize?.width ?? w
    const bh = resize?.height ?? h
    return Promise.resolve({ width: bw, height: bh, close: vi.fn() } as unknown as ImageBitmap)
  }
  const demuxer = createMockDemuxerBackend({
    chunks: Array.from({ length: 6 }, (_, i) => createMockChunk(i * 33333)),
  })
  const producer = new StreamingFrameProducer({
    src: 'video://x.mp4',
    fps: 30,
    demuxerFactory: () => demuxer,
    decoderFactory: sizedDecoder(w, h),
    frameConverter,
    ...(opts.maxFrameLongEdge !== undefined ? { maxFrameLongEdge: opts.maxFrameLongEdge } : {}),
  })
  await producer.openPromise
  producer.setPlayhead(0)
  const deadline = Date.now() + 500
  while (producer.cacheSize < 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5))
  return { producer, calls }
}

describe('StreamingFrameProducer downscale at the copy', () => {
  beforeEach(() => GpuDebugCounters.reset())
  afterEach(() => GpuDebugCounters.reset())

  it('4K landscape: converter gets 1920x1080; cache bytes use the bitmap size; sourceSize stays 4K', async () => {
    const { producer, calls } = await run(3840, 2160)
    expect(calls[0].resize).toEqual({ width: 1920, height: 1080 })
    const n = producer.cacheSize
    expect(n).toBeGreaterThan(0)
    expect(producer.cacheBytes).toBe(n * 1920 * 1080 * 4)
    expect(producer.sourceSize).toEqual({ width: 3840, height: 2160 })
    producer.dispose()
  })

  it('portrait-coded 2160x3840 stays coded aspect', async () => {
    const { producer, calls } = await run(2160, 3840)
    expect(calls[0].resize).toEqual({ width: 1080, height: 1920 })
    producer.dispose()
  })

  it('720p: no resize passed, no upscale', async () => {
    const { producer, calls } = await run(1280, 720)
    expect(calls[0].resize).toBeUndefined()
    expect(producer.cacheBytes).toBe(producer.cacheSize * 1280 * 720 * 4)
    producer.dispose()
  })

  it('uncapped (maxFrameLongEdge: 0) passes no resize and caches full size', async () => {
    const { producer, calls } = await run(3840, 2160, { maxFrameLongEdge: 0 })
    expect(calls.every((c) => c.resize === undefined)).toBe(true)
    expect(producer.cacheBytes).toBe(producer.cacheSize * 3840 * 2160 * 4)
    producer.dispose()
  })

  it('a smaller explicit cap is honoured', async () => {
    const { producer, calls } = await run(3840, 2160, { maxFrameLongEdge: 960 })
    expect(calls[0].resize).toEqual({ width: 960, height: 540 })
    producer.dispose()
  })
})
