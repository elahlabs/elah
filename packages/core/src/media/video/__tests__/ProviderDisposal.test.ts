/**
 * ProviderDisposal — StreamingFrameProducer lifecycle and cleanup tests.
 *
 * Validates:
 *  - Provider disposed after open: state is disposed, cacheSize is 0
 *  - Idempotent dispose
 *  - markIdle does NOT dispose; only the explicit dispose() does
 *  - Provider correctly tracks idle/active/disposed state
 *  - open error: openError is surfaced, provider is still disposable
 *
 * @see StreamingFrameProducer.ts — lifecycle management
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamingFrameProducer } from '../StreamingFrameProducer'
import { GpuDebugCounters } from '../../../renderer/gpu/debug/GpuDebugCounters'
import {
  createMockChunk,
  createMockDecoder,
  createMockDemuxerBackend,
} from './helpers/mockDemuxer'

function makeProducer(
  overrides: Partial<ConstructorParameters<typeof StreamingFrameProducer>[0]> = {},
) {
  const demuxerBackend = createMockDemuxerBackend({ chunks: [createMockChunk(0)] })
  return new StreamingFrameProducer({
    src: 'video://lifecycle.mp4',
    fps: 30,
    demuxerFactory: () => demuxerBackend,
    decoderFactory: createMockDecoder().factory,
    ...overrides,
  })
}

describe('ProviderDisposal', () => {
  beforeEach(() => {
    GpuDebugCounters.reset()
  })

  afterEach(() => {
    GpuDebugCounters.reset()
  })

  describe('dispose', () => {
    it('sets state to disposed', async () => {
      const producer = makeProducer()
      await producer.openPromise

      producer.dispose()
      expect(producer.state).toBe('disposed')
    })

    it('is idempotent — multiple dispose calls are safe', async () => {
      const producer = makeProducer()
      await producer.openPromise

      expect(() => {
        producer.dispose()
        producer.dispose()
        producer.dispose()
      }).not.toThrow()

      expect(producer.state).toBe('disposed')
    })

    it('resets cacheSize to 0', async () => {
      const producer = makeProducer()
      await producer.openPromise

      producer.dispose()
      expect(GpuDebugCounters.cacheSize).toBe(0)
      expect(producer.cacheSize).toBe(0)
    })

    it('getCurrent returns null after dispose', async () => {
      const producer = makeProducer()
      await producer.openPromise

      producer.dispose()
      expect(producer.getCurrent(0)).toBeNull()
    })

    it('setPlayhead is a no-op after dispose', async () => {
      const producer = makeProducer()
      await producer.openPromise

      producer.dispose()
      expect(() => producer.setPlayhead(99)).not.toThrow()
    })

    it('in-flight frames emitted after dispose are closed immediately', async () => {
      const producer = makeProducer()
      await producer.openPromise

      // Trigger decode
      producer.setPlayhead(0)

      // Dispose before onFrame callback fires
      producer.dispose()

      // Let all pending microtasks run
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      expect(producer.state).toBe('disposed')
      expect(producer.cacheSize).toBe(0)
    })
  })

  describe('markIdle / markActive lifecycle', () => {
    it('markIdle does not dispose the provider', async () => {
      vi.useFakeTimers()
      const producer = makeProducer()
      await producer.openPromise

      producer.markIdle()
      vi.advanceTimersByTime(10_000)

      // Idle callback fires, but the provider is NOT disposed
      expect(producer.state).toBe('idle')

      producer.dispose()
      vi.useRealTimers()
    })

    it('markActive cancels idle timer before it fires', async () => {
      vi.useFakeTimers()
      const idleCb = vi.fn()
      const producer = makeProducer()
      await producer.openPromise

      producer.setIdleCallback(idleCb)
      producer.markIdle()

      vi.advanceTimersByTime(2000)
      producer.markActive()
      vi.advanceTimersByTime(10_000)

      expect(idleCb).not.toHaveBeenCalled()
      expect(producer.state).toBe('active')

      producer.dispose()
      vi.useRealTimers()
    })

    it('markIdle then dispose clears the idle timer', async () => {
      vi.useFakeTimers()
      const idleCb = vi.fn()
      const producer = makeProducer()
      await producer.openPromise

      producer.setIdleCallback(idleCb)
      producer.markIdle()
      producer.dispose()

      vi.advanceTimersByTime(10_000)
      // Timer should have been cleared by dispose
      expect(idleCb).not.toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('open error paths', () => {
    it('provider with open error surfaces openError and is still disposable', async () => {
      const badDemuxer = createMockDemuxerBackend({
        openError: new Error('file not found'),
      })
      const producer = new StreamingFrameProducer({
        src: 'video://missing.mp4',
        fps: 30,
        demuxerFactory: () => badDemuxer,
        decoderFactory: createMockDecoder().factory,
      })

      await producer.openPromise

      expect(producer.openError?.message).toContain('file not found')

      // Should not throw
      expect(() => producer.dispose()).not.toThrow()
      expect(producer.state).toBe('disposed')
    })

    it('setPlayhead after open error is a no-op (does not throw)', async () => {
      const badDemuxer = createMockDemuxerBackend({
        openError: new Error('broken'),
      })
      const producer = new StreamingFrameProducer({
        src: 'video://errored.mp4',
        fps: 30,
        demuxerFactory: () => badDemuxer,
        decoderFactory: createMockDecoder().factory,
      })

      await producer.openPromise

      // setPlayhead should not throw even after an open error
      expect(() => producer.setPlayhead(0)).not.toThrow()

      await Promise.resolve()
      await Promise.resolve()

      producer.dispose()
    })
  })
})
