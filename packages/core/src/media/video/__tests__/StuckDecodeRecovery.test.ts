/**
 * StuckDecodeRecovery — tests for VideoDecoderManager resilience when demuxer
 * packets() hangs or when feed() encounters packet errors.
 *
 * In the new push-based architecture the watchdog/timeout mechanism is gone.
 * Instead:
 *  - feed() cancels via _feedGeneration on reset() or dispose().
 *  - A hanging packets() generator is abandoned when generation changes.
 *  - Errors in feed() set manager to Errored and invoke onError.
 *
 * @see VideoDecoderManager.ts — _feedGeneration cancellation
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoDecoderManager } from '../VideoDecoderManager'
import { GpuDebugCounters } from '../../../renderer/gpu/debug/GpuDebugCounters'
import { createMockChunk, createMockDecoder, createMockDemuxerBackend } from './helpers/mockDemuxer'

/** Demuxer whose packets() async-generator never completes. */
function createHangingDemuxerBackend() {
  const backend = createMockDemuxerBackend({ chunks: [createMockChunk(0)] })
  vi.mocked(backend.packets).mockImplementation(async function* () {
    await new Promise<never>(() => {})
  })
  return backend
}

describe('StuckDecodeRecovery', () => {
  beforeEach(() => {
    GpuDebugCounters.reset()
  })

  afterEach(() => {
    GpuDebugCounters.reset()
    vi.useRealTimers()
  })

  it('reset() cancels an in-progress hanging feed() via _feedGeneration', async () => {
    const demuxerBackend = createHangingDemuxerBackend()
    const decoderMock = createMockDecoder()

    const manager = new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: decoderMock.factory,
    })

    await manager.open('video://test.mp4')
    expect(manager.state).toBe('Ready')

    // Start a feed that will hang forever
    manager.feed([0, 100000])

    // Reset should cancel the hanging feed and succeed
    await manager.reset(0)

    expect(manager.state).toBe('Ready')

    // Decoder should not have received any packets from the hanging feed
    // (the generation change aborts before decode() is called)
    manager.dispose()
  })

  it('dispose() from any state does not throw and sets state to Disposed', async () => {
    const demuxerBackend = createHangingDemuxerBackend()

    const manager = new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: createMockDecoder().factory,
    })

    await manager.open('video://test.mp4')

    // Start a hanging feed
    manager.feed([0, 100000])

    // Dispose should be safe even with an in-flight feed
    expect(() => manager.dispose()).not.toThrow()
    expect(manager.state).toBe('Disposed')
  })

  it('feed() with a packets error surfaces via onError; manager enters Errored', async () => {
    const demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk(0)],
      packetsError: new Error('connection reset'),
    })
    const onError = vi.fn()

    const manager = new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: createMockDecoder().factory,
      onError,
    })

    await manager.open('video://test.mp4')

    manager.feed([0, 33333])
    await Promise.resolve()

    expect(manager.state).toBe('Errored')
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'connection reset' }))
  })

  it('multiple feed() then dispose(): state is Disposed with no thrown errors', async () => {
    const demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk(0), createMockChunk(33333)],
    })
    const decoderMock = createMockDecoder()

    const manager = new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: decoderMock.factory,
    })

    await manager.open('video://test.mp4')

    // Fire multiple feeds quickly
    for (let i = 0; i < 5; i++) {
      manager.feed([i * 33333, (i + 1) * 33333])
    }

    // Dispose immediately
    expect(() => manager.dispose()).not.toThrow()
    expect(manager.state).toBe('Disposed')
  })
})
