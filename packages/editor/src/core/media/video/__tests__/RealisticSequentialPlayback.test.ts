import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StreamingFrameProducer } from '../StreamingFrameProducer'
import type { DemuxerBackend, DemuxerFactory } from '../demuxer/MediabunnyDemuxer'
import type { VideoDecoderLike, VideoDecoderFactory } from '../VideoDecoderManager'

/**
 * Reproduces real playback: a 24fps source rendered in a 30fps project.
 *
 * Unlike helpers/mockDemuxer, this:
 *  - respects the requested [startUs, endUs] time range
 *  - models the contiguous-continuation path (_nextPacket / _lastEndSec)
 *  - emits decoded frames ASYNCHRONOUSLY with a reorder buffer (B-frames)
 *  - exposes decodeQueueSize so the manager's backpressure path runs
 */

const SRC_FPS = 24
const PROJECT_FPS = 30
const SRC_US_PER_FRAME = 1_000_000 / SRC_FPS // ~41666.67
const NUM_SRC_FRAMES = 300 // ~12.5s of source

interface SrcPacket {
  timestamp: number // seconds
  idx: number
}

function buildSourcePackets(): SrcPacket[] {
  const pkts: SrcPacket[] = []
  for (let i = 0; i < NUM_SRC_FRAMES; i++) {
    pkts.push({ timestamp: (i * SRC_US_PER_FRAME) / 1e6, idx: i })
  }
  return pkts
}

function createRealisticDemuxerFactory(): DemuxerFactory {
  return () => {
    const src = buildSourcePackets()
    let nextPos = 0 // index into src for contiguous continuation
    let lastEndSec: number | null = null
    let seekPos: number | null = null

    const backend: DemuxerBackend = {
      async open() {},
      getConfig() {
        return { codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080 }
      },
      async *packets([startUs, endUs]: [number, number]): AsyncIterable<EncodedVideoChunk> {
        const startSec = startUs / 1e6
        const endSec = endUs / 1e6

        let pos: number
        let yieldFirstUnconditionally = false

        if (seekPos !== null) {
          pos = seekPos
          seekPos = null
        } else if (lastEndSec !== null && Math.abs(startSec - lastEndSec) < 1e-9) {
          pos = nextPos
          yieldFirstUnconditionally = true
        } else {
          // seek to nearest keyframe at/before startSec (every frame is a keyframe here)
          pos = src.findIndex((p) => p.timestamp >= startSec)
          if (pos === -1) pos = src.length
          if (pos > 0 && src[pos - 1] && src[pos - 1].timestamp <= startSec) {
            // step back to packet at-or-before
            if (src[pos]?.timestamp > startSec) pos = pos - 1
          }
          if (pos < 0) pos = 0
        }

        while (pos < src.length && (yieldFirstUnconditionally || src[pos].timestamp < endSec)) {
          const p = src[pos]
          yield {
            timestamp: Math.round(p.timestamp * 1e6),
            type: 'key',
            byteLength: 4,
            duration: Math.round(SRC_US_PER_FRAME),
            copyTo: vi.fn(),
          } as unknown as EncodedVideoChunk
          yieldFirstUnconditionally = false
          pos++
        }

        nextPos = pos
        lastEndSec = endSec
      },
      async seekToKeyframe(timeUs: number) {
        const timeSec = timeUs / 1e6
        let pos = src.findIndex((p) => p.timestamp >= timeSec)
        if (pos === -1) pos = src.length - 1
        if (pos > 0 && src[pos]?.timestamp > timeSec) pos -= 1
        seekPos = pos
        nextPos = pos
        lastEndSec = null
      },
      dispose() {},
    }
    return backend
  }
}

/**
 * Decoder that emits frames asynchronously after a microtask + reorder buffer,
 * and reports decodeQueueSize so the manager's MAX_DECODE_QUEUE_DEPTH path runs.
 */
function createRealisticDecoderFactory(): {
  factory: VideoDecoderFactory
  flushAll: () => Promise<void>
} {
  let pending: { resolve: () => void }[] = []
  let outputCb: ((f: VideoFrame) => void) | null = null
  const queue: number[] = [] // timestamps awaiting output

  const factory: VideoDecoderFactory = (output) => {
    outputCb = output
    const decoder = {
      state: 'unconfigured',
      configure: vi.fn(),
      decode: vi.fn((chunk: EncodedVideoChunk) => {
        queue.push(chunk.timestamp)
        // Emit asynchronously to mimic real WebCodecs (never synchronous).
        queueMicrotask(() => {
          // reorder buffer of 2: hold the newest 2, emit the oldest
          if (queue.length > 2) {
            const ts = queue.shift()!
            outputCb?.(makeFrame(ts))
          }
        })
      }),
      flush: vi.fn(async () => {
        while (queue.length > 0) {
          const ts = queue.shift()!
          outputCb?.(makeFrame(ts))
        }
      }),
      close: vi.fn(() => {
        queue.length = 0
      }),
      reset: vi.fn(() => {
        queue.length = 0
      }),
      get decodeQueueSize() {
        return queue.length
      },
    }
    return decoder as unknown as VideoDecoderLike
  }

  function makeFrame(timestamp: number): VideoFrame {
    return {
      timestamp,
      displayWidth: 1920,
      displayHeight: 1080,
      close: vi.fn(),
      clone: vi.fn(function (this: VideoFrame) { return makeFrame(this.timestamp) }),
    } as unknown as VideoFrame
  }

  return {
    factory,
    async flushAll() {
      pending = []
    },
  }
}

async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
    vi.advanceTimersByTime(1)
    await Promise.resolve()
  }
}

describe('Realistic sequential playback (24fps source / 30fps project)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not permanently stall after the initial lookahead window', async () => {
    const { factory: decoderFactory } = createRealisticDecoderFactory()
    const producer = new StreamingFrameProducer({
      src: 'test://video.mp4',
      fps: PROJECT_FPS,
      demuxerFactory: createRealisticDemuxerFactory(),
      decoderFactory,
    })

    await producer.openPromise
    await flushMicrotasks(20)

    const usPerFrame = 1_000_000 / PROJECT_FPS
    // Which project frames CAN have a frame (24->30 mapping leaves gaps).
    // Replicate the manager's EXACT two-step rounding: packet timestamps are
    // emitted as integer µs (round(i*SRC_US_PER_FRAME)) and the source frame
    // index is round(timestampUs / usPerFrame). Computing it in one float step
    // disagrees by ±1 on boundary frames (e.g. project 12 vs 13).
    const expectedHit = new Set<number>()
    for (let i = 0; i < NUM_SRC_FRAMES; i++) {
      const timestampUs = Math.round(i * SRC_US_PER_FRAME)
      expectedHit.add(Math.round(timestampUs / usPerFrame))
    }

    const missesOnExpectedHit: number[] = []
    // Simulate continuous playback frame by frame.
    for (let projFrame = 0; projFrame <= 60; projFrame++) {
      producer.setPlayhead(projFrame)
      await flushMicrotasks(8)
      const frame = producer.getCurrent(projFrame)
      // Allow double-rounding gap frames (test's float mapping vs the manager's
      // integer-µs intermediate rounding can disagree by ±1 on boundary frames);
      // a true regression is a RUN of consecutive misses, which we assert below.
      if (frame === null && expectedHit.has(projFrame)) {
        missesOnExpectedHit.push(projFrame)
      }
    }

    // eslint-disable-next-line no-console
    console.log('Misses on frames that SHOULD have a decoded frame:', missesOnExpectedHit)
    console.log('Final cacheSize:', producer.cacheSize, 'decoderState:', producer.decoderState)

    producer.dispose()
    expect(missesOnExpectedHit).toEqual([])
  })

  it('recovers when the playhead races ahead of a slow decoder', async () => {
    const { factory: decoderFactory } = createRealisticDecoderFactory()
    const producer = new StreamingFrameProducer({
      src: 'test://video.mp4',
      fps: PROJECT_FPS,
      demuxerFactory: createRealisticDemuxerFactory(),
      decoderFactory,
    })

    await producer.openPromise
    await flushMicrotasks(20)

    // Production: RAF advances the playhead off the wall clock REGARDLESS of
    // whether frames are ready. Model that: advance several frames between
    // each (tiny) chance for decode to make progress.
    const hitFrames: number[] = []
    const missFrames: number[] = []
    for (let projFrame = 0; projFrame <= 80; projFrame++) {
      producer.setPlayhead(projFrame)
      // Only ONE microtask turn — decode can't keep up at this cadence.
      await Promise.resolve()
      vi.advanceTimersByTime(1)
      const frame = producer.getCurrent(projFrame)
      if (frame) hitFrames.push(projFrame)
      else missFrames.push(projFrame)
    }

    // Give decode time to catch up at the end (playback "paused").
    await flushMicrotasks(40)
    const recovered: number[] = []
    for (let projFrame = 70; projFrame <= 80; projFrame++) {
      producer.setPlayhead(projFrame)
      await flushMicrotasks(8)
      if (producer.getCurrent(projFrame)) recovered.push(projFrame)
    }

    // eslint-disable-next-line no-console
    console.log('Race test — last hit frame:', hitFrames[hitFrames.length - 1])
    console.log('Race test — miss frames:', missFrames)
    console.log('Race test — recovered after pause:', recovered)
    console.log('Race test — final state:', producer.decoderState, 'cacheSize:', producer.cacheSize)

    producer.dispose()
    // The bug signature: once misses start they NEVER recover, even after the
    // playhead pauses and decode is given ample time.
    expect(recovered.length).toBeGreaterThan(0)
  })
})
