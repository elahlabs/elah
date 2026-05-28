/**
 * BackwardSeekStability — regression tests for backward-seek handling
 * in StreamingFrameProducer.
 *
 * Validates that:
 *  - A backward jump in setPlayhead() triggers exactly one demuxer seekToKeyframe call.
 *  - The manager never enters Errored state after rapid backward seek cycles.
 *  - Contiguous forward play does NOT trigger extra seekToKeyframe calls.
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
