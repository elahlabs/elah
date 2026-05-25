/**
 * ProviderDisposal — provider lifecycle and cleanup tests.
 *
 * Validates:
 *  - Provider disposed mid-decode: pending decodes reject quietly
 *  - cacheSize === 0 after disposal
 *  - Idempotent dispose
 *  - markIdle does NOT dispose; only the explicit dispose() does
 *  - Provider correctly tracks idle/active/disposed state
 *
 * @see architecture.md § 7 (VideoLayer provider & texture bookkeeping)
 * @see EVOLUTION.md § 4 Phase 1 (provider lifecycle cleanup)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DecoderBackedVideoFrameProvider } from '../DecoderBackedVideoFrameProvider'
import { GpuDebugCounters } from '../../../renderer/gpu/debug/GpuDebugCounters'
import {
  createMockChunk,
  createMockDecoder,
  createMockDemuxerBackend,
} from './helpers/mockDemuxer'

function makeProvider(
  overrides: Partial<ConstructorParameters<typeof DecoderBackedVideoFrameProvider>[0]> = {},
) {
  const demuxerBackend = createMockDemuxerBackend({ chunks: [createMockChunk(0)] })
  return new DecoderBackedVideoFrameProvider({
    src: 'video://lifecycle.mp4',
    fps: 30,
    maxOutstanding: 4,
    demuxerFactory: () => demuxerBackend,
    decoderFactory: () => createMockDecoder(),
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
      const provider = makeProvider()
      await provider.openPromise

      provider.dispose()
      expect(provider.state).toBe('disposed')
    })

    it('is idempotent — multiple dispose calls are safe', async () => {
      const provider = makeProvider()
      await provider.openPromise

      expect(() => {
        provider.dispose()
        provider.dispose()
        provider.dispose()
      }).not.toThrow()

      expect(provider.state).toBe('disposed')
    })

    it('resets cacheSize to 0', async () => {
      const provider = makeProvider()
      await provider.openPromise

      provider.dispose()
      expect(GpuDebugCounters.cacheSize).toBe(0)
      expect(provider.cacheSize).toBe(0)
    })

    it('clears all pending requests', async () => {
      const provider = makeProvider({ maxOutstanding: 4 })
      await provider.openPromise

      provider.requestFrame(1)
      provider.requestFrame(2)
      provider.requestFrame(3)

      provider.dispose()

      // Pending are cleared synchronously on dispose
      expect(provider.pendingCount).toBe(0)
    })

    it('reject pending decodes mid-flight (dispose before resolution)', async () => {
      const provider = makeProvider({ maxOutstanding: 4 })
      await provider.openPromise

      provider.requestFrame(5)

      // Dispose synchronously — the request is still in-flight
      provider.dispose()

      // Let all microtasks run; the resolve callback should guard on disposed state
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      expect(provider.state).toBe('disposed')
      expect(provider.cacheSize).toBe(0)
    })

    it('getCurrent returns null after dispose', async () => {
      const provider = makeProvider()
      await provider.openPromise

      provider.dispose()
      expect(provider.getCurrent(0)).toBeNull()
    })

    it('requestFrame is a no-op after dispose', async () => {
      const provider = makeProvider()
      await provider.openPromise

      provider.dispose()
      expect(() => provider.requestFrame(99)).not.toThrow()
      expect(provider.pendingCount).toBe(0)
    })
  })

  describe('markIdle / markActive lifecycle', () => {
    it('markIdle does not dispose the provider', async () => {
      vi.useFakeTimers()
      const provider = makeProvider()
      await provider.openPromise

      provider.markIdle()
      vi.advanceTimersByTime(10_000)

      // Idle callback fires, but the provider is NOT disposed
      expect(provider.state).toBe('idle')

      provider.dispose()
      vi.useRealTimers()
    })

    it('markActive cancels idle timer before it fires', async () => {
      vi.useFakeTimers()
      const idleCb = vi.fn()
      const provider = makeProvider()
      await provider.openPromise

      provider.setIdleCallback(idleCb)
      provider.markIdle()

      vi.advanceTimersByTime(2000)
      provider.markActive()
      vi.advanceTimersByTime(10_000)

      expect(idleCb).not.toHaveBeenCalled()
      expect(provider.state).toBe('active')

      provider.dispose()
      vi.useRealTimers()
    })

    it('markIdle then dispose clears the idle timer', async () => {
      vi.useFakeTimers()
      const idleCb = vi.fn()
      const provider = makeProvider()
      await provider.openPromise

      provider.setIdleCallback(idleCb)
      provider.markIdle()
      provider.dispose()

      vi.advanceTimersByTime(10_000)
      // Timer should have been cleared by dispose
      expect(idleCb).not.toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('open error paths', () => {
    it('provider with open error disposes cleanly', async () => {
      const badDemuxer = createMockDemuxerBackend({
        openError: new Error('file not found'),
      })
      const provider = new DecoderBackedVideoFrameProvider({
        src: 'video://missing.mp4',
        fps: 30,
        demuxerFactory: () => badDemuxer,
        decoderFactory: () => createMockDecoder(),
      })

      await provider.openPromise

      expect(provider.openError?.message).toContain('file not found')

      // Should not throw
      expect(() => provider.dispose()).not.toThrow()
      expect(provider.state).toBe('disposed')
    })

    it('requestFrame is a no-op when manager is in Errored state', async () => {
      const badDemuxer = createMockDemuxerBackend({
        openError: new Error('broken'),
      })
      const provider = new DecoderBackedVideoFrameProvider({
        src: 'video://errored.mp4',
        fps: 30,
        demuxerFactory: () => badDemuxer,
        decoderFactory: () => createMockDecoder(),
      })

      await provider.openPromise

      // decoderState should be Errored
      expect(provider.decoderState).toBe('Errored')

      // requestFrame should silently no-op (not throw)
      expect(() => provider.requestFrame(0)).not.toThrow()
      expect(provider.pendingCount).toBe(0)

      provider.dispose()
    })
  })
})
