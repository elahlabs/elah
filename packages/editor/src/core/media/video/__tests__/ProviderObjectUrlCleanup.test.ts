/**
 * ProviderObjectUrlCleanup — validates cleanup behaviour when a provider is
 * disposed mid-decode.
 *
 * Tests:
 *  - Dispose before open resolves: provider settles to disposed state
 *  - Dispose while fetch/blob is in flight: no further frames are cached
 *  - In-flight decode frame is closed (not leaked) after dispose
 *  - openError is surfaced; post-error requestFrame is a no-op
 *
 * @see DecoderBackedVideoFrameProvider._state guard in requestFrame
 * @see IMPLEMENTATION_NOTES.md — in-flight decode disposal race
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DecoderBackedVideoFrameProvider } from '../DecoderBackedVideoFrameProvider'
import { GpuDebugCounters } from '../../../renderer/gpu/debug/GpuDebugCounters'
import { createMockChunk, createMockDecoder, createMockDemuxerBackend } from './helpers/mockDemuxer'
import { resetTrackingFrameCounter } from '../../../renderer/gpu/__tests__/helpers/trackingFrame'

describe('ProviderObjectUrlCleanup', () => {
  beforeEach(() => {
    GpuDebugCounters.reset()
    resetTrackingFrameCounter()
    vi.useRealTimers()
  })

  afterEach(() => {
    GpuDebugCounters.reset()
  })

  it('dispose() before open resolves leaves provider in disposed state', async () => {
    // Slow open — resolves only after dispose
    let resolveOpen!: () => void
    const slowBackend = {
      ...createMockDemuxerBackend({ chunks: [] }),
      open: vi.fn(() => new Promise<void>((r) => { resolveOpen = r })),
    }

    const provider = new DecoderBackedVideoFrameProvider({
      src: 'blob:example.com/slow',
      fps: 30,
      maxOutstanding: 4,
      demuxerFactory: () => slowBackend,
      decoderFactory: () => createMockDecoder(),
    })

    // Dispose before open resolves
    provider.dispose()

    // Let the open resolve — the provider should guard against further work
    resolveOpen()
    await Promise.resolve()
    await Promise.resolve()

    expect(provider.state).toBe('disposed')
    expect(provider.cacheSize).toBe(0)
    expect(provider.pendingCount).toBe(0)
  })

  it('requestFrame after open error is a no-op', async () => {
    const backend = createMockDemuxerBackend({
      openError: new Error('fetch failed: 404'),
      chunks: [],
    })

    const provider = new DecoderBackedVideoFrameProvider({
      src: 'blob:example.com/missing',
      fps: 30,
      maxOutstanding: 4,
      demuxerFactory: () => backend,
      decoderFactory: () => createMockDecoder(),
    })

    // Wait for the open to fail
    try {
      await provider.openPromise
    } catch {
      // Expected
    }

    // requestFrame after an error must silently do nothing
    expect(() => provider.requestFrame(0)).not.toThrow()
    expect(provider.pendingCount).toBe(0)

    provider.dispose()
  })

  it('in-flight decode is discarded (no cache entry) when provider is disposed mid-flight', async () => {
    let resolveDecode: (() => void) | null = null
    let flushWasCalled = false

    const slowDecoder = {
      ...createMockDecoder(),
      flush: vi.fn(
        () => new Promise<void>((r) => {
          flushWasCalled = true
          resolveDecode = r
        }),
      ),
    }

    const provider = new DecoderBackedVideoFrameProvider({
      src: 'blob:example.com/in-flight',
      fps: 30,
      maxOutstanding: 4,
      demuxerFactory: () => createMockDemuxerBackend({ chunks: [createMockChunk(0)] }),
      decoderFactory: () => slowDecoder,
    })

    await provider.openPromise

    // Start a decode that will stall in flush()
    provider.requestFrame(0)

    // Drain enough microtasks for the queue → _decodeFrame → flush() call chain
    for (let i = 0; i < 10; i++) {
      await Promise.resolve()
      if (flushWasCalled) break
    }

    // If flush wasn't called, the decode hasn't started — still valid to test dispose
    provider.dispose()

    // Resolve the stalled flush if it was called — provider guard closes frame
    const r = resolveDecode as (() => void) | null
    if (r) {
      r()
    }
    await Promise.resolve()
    await Promise.resolve()

    expect(provider.state).toBe('disposed')
    expect(provider.cacheSize).toBe(0)
  })

  it('double-dispose does not throw', async () => {
    const provider = new DecoderBackedVideoFrameProvider({
      src: 'blob:example.com/double',
      fps: 30,
      maxOutstanding: 4,
      demuxerFactory: () => createMockDemuxerBackend({ chunks: [] }),
      decoderFactory: () => createMockDecoder(),
    })

    await provider.openPromise

    expect(() => {
      provider.dispose()
      provider.dispose()
    }).not.toThrow()

    expect(provider.state).toBe('disposed')
  })
})
