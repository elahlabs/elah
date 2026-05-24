/**
 * NoOutputDecode.test.ts — locks the texImage2D-overload-error fix.
 *
 * Repro condition:
 *   A "contiguous" decode (frame N → N+1, no seek) that ends up feeding zero
 *   packets to the WebCodecs decoder. Before the fix, VideoDecoderManager
 *   fabricated a fake `VideoFrame`-shaped object via _createFallbackFrame()
 *   which propagated through provider.getCurrent() → frame.clone() →
 *   gl.texImage2D(...) and crashed the render tick with
 *     "TypeError: Failed to execute 'texImage2D' on 'WebGL2RenderingContext':
 *      Overload resolution failed."
 *
 * After the fix:
 *  1. createMediabunnyBackend.packets() guarantees forward progress in the
 *     contiguous-continuation branch — at least one packet is yielded for
 *     any non-EOF call when a buffered packet exists.
 *  2. VideoDecoderManager (with strictNoOutput: true) rejects the requestFrame
 *     promise with a tagged "no output produced" error rather than producing
 *     a fake VideoFrame, and the rejection is treated as a dropped frame
 *     without transitioning the manager to Errored.
 *
 * @see VideoDecoderManager.ts strictNoOutput
 * @see createMediabunnyBackend.ts packets() forward-progress invariant
 * @see DecoderBackedVideoFrameProvider.ts strictNoOutput pass-through
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoDecoderManager, NO_OUTPUT_PRODUCED_TAG } from '../VideoDecoderManager'
import {
  createMediabunnyBackend,
  type MediabunnyModule,
} from '../demuxer/createMediabunnyBackend'
import { createMockChunk, createMockDecoder } from './helpers/mockDemuxer'

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
// VideoDecoderManager strictNoOutput test
// ---------------------------------------------------------------------------

describe('VideoDecoderManager strictNoOutput', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects requestFrame with a "no output produced" error when no packets feed the decoder', async () => {
    // Demuxer that yields zero packets — simulates the contiguous decode
    // race that previously produced a fallback fake VideoFrame.
    const demuxerBackend = {
      open: vi.fn(async () => {}),
      getConfig: vi.fn(() => ({ codec: 'vp8', codedWidth: 640, codedHeight: 360 })),
      packets: vi.fn(async function* (_r: [number, number]) {
        // empty — no chunks at all
      }),
      seekToKeyframe: vi.fn(async () => {}),
      dispose: vi.fn(),
    }
    const decoder = createMockDecoder()

    const dropped: number[] = []
    const manager = new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: () => decoder,
      strictNoOutput: true,
      onDroppedFrame: (f) => dropped.push(f),
    })

    await manager.open('video://test')
    await expect(manager.requestFrame(0)).rejects.toThrow(
      new RegExp(NO_OUTPUT_PRODUCED_TAG),
    )

    expect(dropped).toContain(0)
    // Manager must remain usable — a no-output drop must NOT transition to Errored.
    expect(manager.state).toBe('Ready')
  })

  it('preserves the legacy fallback path when strictNoOutput is false', async () => {
    // This is the historical contract relied upon by 30+ existing tests.
    const demuxerBackend = {
      open: vi.fn(async () => {}),
      getConfig: vi.fn(() => ({ codec: 'vp8', codedWidth: 640, codedHeight: 360 })),
      packets: vi.fn(async function* (_r: [number, number]) {
        yield createMockChunk()
      }),
      seekToKeyframe: vi.fn(async () => {}),
      dispose: vi.fn(),
    }
    const decoder = createMockDecoder()

    const manager = new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: () => decoder,
      // strictNoOutput omitted → defaults to false
    })

    await manager.open('video://test')
    const frame = await manager.requestFrame(0)
    expect(frame).toBeTruthy()
    expect(manager.state).toBe('Ready')
  })

  it('does not poison the queue after a no-output drop (state stays Ready, follow-up request is accepted)', async () => {
    // Both decodes yield zero packets — the second must reject the same
    // way (with the no-output tag), proving the manager did not transition
    // to Errored after the first drop.
    const demuxerBackend = {
      open: vi.fn(async () => {}),
      getConfig: vi.fn(() => ({ codec: 'vp8', codedWidth: 640, codedHeight: 360 })),
      packets: vi.fn(async function* (_r: [number, number]) {
        // empty for every call
      }),
      seekToKeyframe: vi.fn(async () => {}),
      dispose: vi.fn(),
    }
    const decoder = createMockDecoder()

    const manager = new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: () => decoder,
      strictNoOutput: true,
    })

    await manager.open('video://test')

    await expect(manager.requestFrame(0)).rejects.toThrow(
      new RegExp(NO_OUTPUT_PRODUCED_TAG),
    )
    expect(manager.state).toBe('Ready')

    // Follow-up request is accepted (would throw "invalid state" if the
    // first drop had transitioned to Errored).
    await expect(manager.requestFrame(1)).rejects.toThrow(
      new RegExp(NO_OUTPUT_PRODUCED_TAG),
    )
    expect(manager.state).toBe('Ready')
  })
})
