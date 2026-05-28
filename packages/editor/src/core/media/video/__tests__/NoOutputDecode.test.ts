/**
 * NoOutputDecode.test.ts — tests for the no-output / empty-packets decode paths.
 *
 * Section 1: createMediabunnyBackend forward-progress invariant.
 *   A "contiguous" decode that feeds zero packets would previously fabricate a fake
 *   VideoFrame causing a GL texImage2D crash. The fix ensures packets() always yields
 *   ≥1 packet when a buffered packet exists past the range end.
 *
 * Section 2: VideoDecoderManager feed error handling.
 *   When feed() encounters a demuxer error, the manager transitions to Errored and
 *   invokes onError. The manager stays in Errored (does not stay Ready).
 *
 * @see createMediabunnyBackend.ts packets() forward-progress invariant
 * @see VideoDecoderManager.ts feed() error path
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoDecoderManager } from '../VideoDecoderManager'
import {
  createMediabunnyBackend,
  type MediabunnyModule,
} from '../demuxer/createMediabunnyBackend'
import { createMockChunk, createMockDecoder, createMockDemuxerBackend } from './helpers/mockDemuxer'

// ---------------------------------------------------------------------------
// Demuxer continuity test — forward-progress invariant for packets()
// ---------------------------------------------------------------------------

describe('createMediabunnyBackend — contiguous packets() forward progress', () => {
  /** Build a mediabunny mock with packets at the given timestamps (seconds). */
  function buildMb(packetTimestampsSec: number[]) {
    const packets = packetTimestampsSec.map((tsSec) => ({
      timestamp: tsSec,
      toEncodedVideoChunk: vi.fn(() => ({
        type: 'key',
        timestamp: Math.round(tsSec * 1e6),
        duration: 33333,
        byteLength: 100,
      })),
    }))

    let cursor = 0
    const sink = {
      getKeyPacket: vi.fn(async (sec: number) => {
        // Return the latest packet at or before `sec`.
        let idx = 0
        for (let i = 0; i < packets.length; i++) {
          if (packets[i]!.timestamp <= sec) idx = i
          else break
        }
        cursor = idx
        return packets[idx] ?? null
      }),
      getNextPacket: vi.fn(async (_prev: unknown) => {
        cursor++
        return packets[cursor] ?? null
      }),
    }

    const track = {
      getDecoderConfig: vi.fn(async () => ({ codec: 'avc1.42001e' })),
    }

    const input = {
      getPrimaryVideoTrack: vi.fn(async () => track),
    }

    const mb = {
      Input: vi.fn(() => input),
      BlobSource: vi.fn((blob: Blob) => ({ blob })),
      EncodedPacketSink: vi.fn(() => sink),
      ALL_FORMATS: ['mp4', 'webm'],
    } as unknown as MediabunnyModule

    return { mb, sink, packets }
  }

  const blobResolver = vi.fn(async () => new Blob(['x']))

  it('yields at least one packet for a contiguous range whose buffered packet has timestamp >= endSec', async () => {
    // Source packet cadence is sparser than the manager's frame cadence
    // (e.g. 10 fps source vs 30 fps manager): packets at 0s, 0.1s, 0.2s.
    const { mb } = buildMb([0, 0.1, 0.2])
    const backend = createMediabunnyBackend(mb, { blobResolver })
    await backend.open('blob:x')

    // Frame 0 at 30fps: range [0, 33333] µs = [0, 0.033333] sec.
    const firstChunks: EncodedVideoChunk[] = []
    for await (const c of backend.packets([0, 33_333])) firstChunks.push(c)
    expect(firstChunks.length).toBe(1) // packet at 0 only

    // Frame 1 (contiguous): range [33333, 66666] µs = [0.033333, 0.066666] sec.
    // The buffered _nextPacket has timestamp 0.1, which is past endSec.
    // The fix guarantees we still yield it, keeping the decoder fed.
    const secondChunks: EncodedVideoChunk[] = []
    for await (const c of backend.packets([33_333, 66_666])) secondChunks.push(c)

    expect(
      secondChunks.length,
      'contiguous packets() must yield ≥1 packet to preserve forward progress',
    ).toBeGreaterThan(0)
  })

  it('does not loop forever when the buffered packet is past endSec', async () => {
    // Same sparse-source setup, but verify the loop terminates after one
    // forced yield (it must not keep yielding the same packet).
    const { mb } = buildMb([0, 0.1, 0.2])
    const backend = createMediabunnyBackend(mb, { blobResolver })
    await backend.open('blob:x')

    for await (const _c of backend.packets([0, 33_333])) { /* prime */ }

    const second: EncodedVideoChunk[] = []
    for await (const c of backend.packets([33_333, 66_666])) {
      second.push(c)
      // Failsafe: if the loop ever re-yields the same packet without
      // advancing, this test would explode in size. Cap at 100.
      if (second.length > 100) break
    }
    // The buffered packet at 0.1 is yielded once; the next packet at 0.2
    // is past endSec=0.066 so the loop exits.
    expect(second.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// VideoDecoderManager feed error handling
// ---------------------------------------------------------------------------

describe('VideoDecoderManager feed error handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('feed() with demuxer packetsError transitions manager to Errored', async () => {
    const demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk(0)],
      packetsError: new Error('stream broken'),
    })
    const onError = vi.fn()
    const manager = new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: createMockDecoder().factory,
      onError,
    })

    await manager.open('video://test')
    expect(manager.state).toBe('Ready')

    manager.feed([0, 33333])
    await Promise.resolve()

    // After the async feed loop surfaces the error:
    expect(manager.state).toBe('Errored')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'stream broken' }))
  })

  it('empty demuxer (zero packets) completes feed without error', async () => {
    const demuxerBackend = {
      open: vi.fn(async () => {}),
      getConfig: vi.fn(() => ({ codec: 'vp8', codedWidth: 640, codedHeight: 360 })),
      packets: vi.fn(async function* (_r: [number, number]) {
        // empty — no chunks at all
      }),
      seekToKeyframe: vi.fn(async () => {}),
      dispose: vi.fn(),
    }
    const onError = vi.fn()
    const manager = new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: createMockDecoder({ emitFrames: false }).factory,
      onError,
    })

    await manager.open('video://test')
    manager.feed([0, 33333])
    await Promise.resolve()

    // Manager stays Ready — zero packets is not an error in the new API
    expect(manager.state).toBe('Ready')
    expect(onError).not.toHaveBeenCalled()
  })

  it('feed() delivers decoded frames via onFrame callback', async () => {
    const demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk(0), createMockChunk(33333)],
    })
    const receivedFrames: number[] = []
    const manager = new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: createMockDecoder().factory,
    })
    manager.onFrame = (_frame, sourceFrameIdx) => {
      receivedFrames.push(sourceFrameIdx)
      _frame.close()
    }

    await manager.open('video://test')
    manager.feed([0, 66666])
    await Promise.resolve()
    await Promise.resolve()

    expect(receivedFrames.length).toBeGreaterThan(0)
    expect(manager.state).toBe('Ready')
  })
})
