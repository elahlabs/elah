/**
 * BackwardSeekStability — regression tests for backward-seek handling
 * in StreamingFrameProducer.
 *
 * Validates that:
 *  - A backward jump in setPlayhead() triggers exactly one demuxer seekToKeyframe call.
 *  - The manager never enters Errored state after rapid backward seek cycles.
 *  - Contiguous forward play does NOT trigger extra seekToKeyframe calls.
 *  - A backward step to an evicted frame (|delta| ≤ lookahead, so normally "contiguous")
 *    still triggers a re-seek so getCurrent() returns non-null.
 *
 * @see StreamingFrameProducer.ts — discontinuity detection and reset logic
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamingFrameProducer } from '../StreamingFrameProducer'
import { GpuDebugCounters } from '../../../renderer/gpu/debug/GpuDebugCounters'
import { createMockChunk, createMockDecoder, createMockDemuxerBackend } from './helpers/mockDemuxer'

describe('BackwardSeekStability', () => {
  beforeEach(() => {
    GpuDebugCounters.reset()
  })

  afterEach(() => {
    GpuDebugCounters.reset()
  })

  it('backward jump triggers exactly one seekToKeyframe on the demuxer', async () => {
    const demuxerBackend = createMockDemuxerBackend({
      chunks: Array.from({ length: 60 }, (_, i) => createMockChunk(i * 33333)),
    })
    const decoderMock = createMockDecoder()

    const producer = new StreamingFrameProducer({
      src: 'video://backward-seek.mp4',
      fps: 30,
      maxFrames: 30,
      lookaheadFrames: 4,
      demuxerFactory: () => demuxerBackend,
      decoderFactory: decoderMock.factory,
    })

    await producer.openPromise

    // Trigger initial discontinuity (first ever setPlayhead) and wait for it to settle
    producer.setPlayhead(0)
    await new Promise(r => setTimeout(r, 40))

    // Advance forward contiguously from frame 0 to 30
    for (let i = 1; i <= 30; i++) {
      producer.setPlayhead(i)
    }
    await new Promise(r => setTimeout(r, 20))

    // Count seeks so far (includes the initial open-time seek)
    const seekCountBeforeBackward = vi.mocked(demuxerBackend.seekToKeyframe).mock.calls.length

    // Backward jump: 30 → 0 (|delta| = 30 > 1 → discontinuity → exactly one seek)
    producer.setPlayhead(0)
    await new Promise(r => setTimeout(r, 50))

    const seekCountAfterBackward = vi.mocked(demuxerBackend.seekToKeyframe).mock.calls.length
    expect(seekCountAfterBackward - seekCountBeforeBackward).toBe(1)

    producer.dispose()
    expect(producer.state).toBe('disposed')
  })

  it('rapid backward seek cycles: producer never enters errored state', async () => {
    const demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk(0), createMockChunk(33333)],
    })
    const decoderMock = createMockDecoder()

    const producer = new StreamingFrameProducer({
      src: 'video://rapid-backward.mp4',
      fps: 30,
      demuxerFactory: () => demuxerBackend,
      decoderFactory: decoderMock.factory,
    })

    await producer.openPromise

    for (let cycle = 0; cycle < 5; cycle++) {
      // Jump forward (discontinuity)
      producer.setPlayhead(50)
      await new Promise(r => setTimeout(r, 10))

      // Jump backward (discontinuity)
      producer.setPlayhead(10)
      await new Promise(r => setTimeout(r, 10))

      expect(producer.state).not.toBe('disposed')
    }

    producer.dispose()
    expect(producer.state).toBe('disposed')
  })

  it('backward step within lookahead to an evicted frame re-decodes and returns non-null', async () => {
    // Small cache (5) + small lookahead (2) so forward play quickly evicts early frames.
    // After playing 0→8 the cache holds ~frames 6-10; frames 0-5 are evicted.
    // A step backward from 6 → 5 has |delta|=1 ≤ lookahead(2) — "contiguous" by the
    // old threshold — but frame 5 is no longer in cache.
    // Without the backwardMiss fix, getCurrent(5) returns null (evicted, not re-decoded).
    // With the fix, the miss forces a re-seek so the frame is decoded before getCurrent.
    const chunks = Array.from({ length: 30 }, (_, i) => createMockChunk(i * 33333))
    const demuxerBackend = createMockDemuxerBackend({ chunks })
    // The shared mock's packets() ignores the requested time range and always
    // replays the full chunk list. The real MediabunnyDemuxer/backend only
    // yields packets inside [startUs, endUs] (see createMediabunnyBackend.ts).
    // This test relies on range-scoped replay after a seek — a full 0..29
    // replay after seeking to frame 5 would refill the cache with everything
    // up to frame 29, evicting frame 5 again before the assertions run.
    // Chunk timestamps use an integer 33333us/frame step while the producer's
    // startUs/endUs are computed from the fractional 1_000_000/30 usPerFrame,
    // so exact `>=` filtering can off-by-one exclude the target frame (e.g.
    // frame 5 at ts=166665 vs. a computed startUs of 166667). Snap to the
    // nearest frame index instead of comparing raw timestamps.
    const usPerFrame = 1_000_000 / 30
    vi.mocked(demuxerBackend.packets).mockImplementation(async function* ([startUs, endUs]) {
      const startFrame = Math.round(startUs / usPerFrame)
      const endFrame = Math.round(endUs / usPerFrame)
      for (const chunk of chunks) {
        const frame = Math.round(chunk.timestamp / usPerFrame)
        if (frame >= startFrame && frame < endFrame) yield chunk
      }
    })
    const { factory } = createMockDecoder()

    const producer = new StreamingFrameProducer({
      src: 'video://backward-evict.mp4',
      fps: 30,
      maxFrames: 5,
      lookaheadFrames: 2,
      demuxerFactory: () => demuxerBackend,
      decoderFactory: factory,
    })

    await producer.openPromise

    // Play forward 0 → 8 so the cache fills and evicts early frames.
    producer.setPlayhead(0)
    await new Promise(r => setTimeout(r, 40))

    for (let i = 1; i <= 8; i++) {
      producer.setPlayhead(i)
      await new Promise(r => setTimeout(r, 15))
    }

    // Frame 5 must be evicted for the test to be meaningful.
    expect(producer.getCurrent(5)).toBeNull()

    // Step backward from 8 → 5 one frame at a time.
    // Steps 8→7 and 7→6 are cache hits (frames 7, 6 still present).
    // Step 6→5 is a cache miss with |delta|=1 — the regression case.
    for (let i = 7; i >= 5; i--) {
      producer.setPlayhead(i)
      await new Promise(r => setTimeout(r, 40))
      expect(producer.getCurrent(i)).not.toBeNull()
    }

    producer.dispose()
  })

  it('contiguous forward play does not trigger additional seekToKeyframe after initial open', async () => {
    const demuxerBackend = createMockDemuxerBackend({
      chunks: Array.from({ length: 10 }, (_, i) => createMockChunk(i * 33333)),
    })
    const decoderMock = createMockDecoder()

    const producer = new StreamingFrameProducer({
      src: 'video://contiguous.mp4',
      fps: 30,
      maxFrames: 30,
      lookaheadFrames: 4,
      demuxerFactory: () => demuxerBackend,
      decoderFactory: decoderMock.factory,
    })

    await producer.openPromise

    // Wait for the initial open-time seek (discontinuity on first setPlayhead)
    producer.setPlayhead(0)
    await new Promise(r => setTimeout(r, 40))

    const seekCountAfterFirst = vi.mocked(demuxerBackend.seekToKeyframe).mock.calls.length

    // Contiguous forward advancement should NOT call seekToKeyframe again
    for (let i = 1; i <= 8; i++) {
      producer.setPlayhead(i)
      await Promise.resolve()
    }
    await new Promise(r => setTimeout(r, 20))

    const seekCountAfterPlay = vi.mocked(demuxerBackend.seekToKeyframe).mock.calls.length
    expect(seekCountAfterPlay).toBe(seekCountAfterFirst) // no extra seeks during contiguous play

    producer.dispose()
  })
})
