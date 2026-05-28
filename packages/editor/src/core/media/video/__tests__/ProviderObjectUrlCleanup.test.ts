/**
 * ProviderObjectUrlCleanup — validates cleanup behaviour when a StreamingFrameProducer
 * is disposed mid-decode or before open resolves.
 *
 * Tests:
 *  - Dispose before open resolves: provider settles to disposed state
 *  - Dispose while fetch/blob is in flight: no further frames are cached
 *  - openError is surfaced; post-error setPlayhead is a no-op
 *  - Double-dispose does not throw
 *
 * @see StreamingFrameProducer._state guard in onFrame callback
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamingFrameProducer } from '../StreamingFrameProducer'
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

  it('dispose() before open resolves leaves producer in disposed state', async () => {
    // Slow open — resolves only after dispose
    let resolveOpen!: () => void
    const slowBackend = {
      ...createMockDemuxerBackend({ chunks: [] }),
      open: vi.fn(() => new Promise<void>((r) => { resolveOpen = r })),
    }

    const producer = new StreamingFrameProducer({
      src: 'blob:example.com/slow',
      fps: 30,
      demuxerFactory: () => slowBackend,
      decoderFactory: createMockDecoder().factory,
    })

    // Dispose before open resolves
    producer.dispose()

    // Let the open resolve — the producer should guard against further work
    resolveOpen()
    await Promise.resolve()
    await Promise.resolve()

    expect(producer.state).toBe('disposed')
    expect(producer.cacheSize).toBe(0)
  })

  it('setPlayhead after open error is a no-op', async () => {
    const backend = createMockDemuxerBackend({
      openError: new Error('fetch failed: 404'),
      chunks: [],
    })

    const producer = new StreamingFrameProducer({
      src: 'blob:example.com/missing',
      fps: 30,
      demuxerFactory: () => backend,
      decoderFactory: createMockDecoder().factory,
    })

    await producer.openPromise

    expect(producer.openError?.message).toContain('fetch failed: 404')

    // setPlayhead after an error must silently do nothing
    expect(() => producer.setPlayhead(0)).not.toThrow()

    await Promise.resolve()
    await Promise.resolve()

    producer.dispose()
  })

  it('in-flight decode is discarded (no cache entry) when producer is disposed mid-flight', async () => {
    const producer = new StreamingFrameProducer({
      src: 'blob:example.com/in-flight',
      fps: 30,
      demuxerFactory: () => createMockDemuxerBackend({ chunks: [createMockChunk(0)] }),
      decoderFactory: createMockDecoder().factory,
    })

    await producer.openPromise

    // Start a decode
    producer.setPlayhead(0)

    // Dispose immediately
    producer.dispose()

    // Let all pending microtasks run
    for (let i = 0; i < 10; i++) {
      await Promise.resolve()
    }

    expect(producer.state).toBe('disposed')
    expect(producer.cacheSize).toBe(0)
  })

  it('double-dispose does not throw', async () => {
    const producer = new StreamingFrameProducer({
      src: 'blob:example.com/double',
      fps: 30,
      demuxerFactory: () => createMockDemuxerBackend({ chunks: [] }),
      decoderFactory: createMockDecoder().factory,
    })

    await producer.openPromise

    expect(() => {
      producer.dispose()
      producer.dispose()
    }).not.toThrow()

    expect(producer.state).toBe('disposed')
  })
})
