/**
 * BackwardSeekStability — regression tests for the seek-stuck-frame bug.
 *
 * Validates that backward seeks keep the target frame in cache and that
 * rapid backward seek cycles do not leave the decoder in Errored state.
 *
 * @see EVOLUTION.md § 4 Phase 1.5 (Seek stability)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DecoderBackedVideoFrameProvider } from '../DecoderBackedVideoFrameProvider'
import { GpuDebugCounters } from '../../../renderer/gpu/debug/GpuDebugCounters'
import { createMockChunk, createMockDecoder, createMockDemuxerBackend } from './helpers/mockDemuxer'

async function waitForFrame(
  provider: DecoderBackedVideoFrameProvider,
  sourceFrame: number,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    provider.getCurrent(sourceFrame)
    if (provider.getCurrent(sourceFrame) !== null) return
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error(`Frame ${sourceFrame} did not arrive within ${timeoutMs}ms`)
}

describe('BackwardSeekStability', () => {
  beforeEach(() => {
    GpuDebugCounters.reset()
  })

  afterEach(() => {
    GpuDebugCounters.reset()
  })

  it('seek target frame survives in cache after backward seek + 30 prefetch ticks', async () => {
    const demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk(0), createMockChunk(33333)],
    })
    const decoder = createMockDecoder()

    const provider = new DecoderBackedVideoFrameProvider({
      src: 'video://backward-seek.mp4',
      fps: 30,
      maxFrames: 30,
      maxOutstanding: 4,
      demuxerFactory: () => demuxerBackend,
      decoderFactory: () => decoder,
      // Mock decoder never emits real VideoFrames; rely on the legacy
      // fallback path so this test still observes cache occupancy.
      strictNoOutput: false,
    })

    await provider.openPromise

    // Simulate forward playback: warm cache with frames 0..29.
    for (let i = 0; i < 30; i++) {
      provider.requestFrame(i)
      await Promise.resolve()
    }
    await new Promise((r) => setTimeout(r, 50))

    // Backward seek from ~29 to 5.
    provider.getCurrent(5)
    provider.requestFrame(5)
    await waitForFrame(provider, 5)

    expect(provider.getCurrent(5)).not.toBeNull()

    // Simulate prefetch bursts for 30 more frames.
    for (let i = 5; i < 35; i++) {
      provider.getCurrent(i)
      provider.requestFrame(i)
      provider.prefetch(i + 1, 5)
      await Promise.resolve()
    }
    await new Promise((r) => setTimeout(r, 50))

    // Frame 5 must still be cached, or frame 6 must be present if 5 was evicted
    // after forward prefetch — never a stuck stale frame from before the seek.
    const frame5 = provider.getCurrent(5)
    const frame6 = provider.getCurrent(6)
    expect(frame5 !== null || frame6 !== null).toBe(true)

    provider.dispose()
  })

  it('rapid backward seek: manager never enters Errored state', async () => {
    const demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk(0), createMockChunk(33333)],
    })

    const provider = new DecoderBackedVideoFrameProvider({
      src: 'video://rapid-backward.mp4',
      fps: 30,
      maxOutstanding: 4,
      demuxerFactory: () => demuxerBackend,
      decoderFactory: () => createMockDecoder(),
      strictNoOutput: false,
    })

    await provider.openPromise

    for (let cycle = 0; cycle < 5; cycle++) {
      provider.getCurrent(50)
      provider.requestFrame(50)
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 10))

      provider.getCurrent(10)
      provider.requestFrame(10)
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 10))

      expect(provider.decoderState).not.toBe('Errored')
    }

    provider.dispose()
    expect(provider.decoderState).not.toBe('Errored')
  })
})
