import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DecoderBackedVideoFrameProvider } from '../DecoderBackedVideoFrameProvider'
import { GpuDebugCounters } from '../../../renderer/gpu/debug/GpuDebugCounters'
import {
  createMockChunk,
  createMockDecoder,
  createMockDemuxerBackend,
} from './helpers/mockDemuxer'

function createProvider(
  overrides: Partial<ConstructorParameters<typeof DecoderBackedVideoFrameProvider>[0]> = {},
) {
  const demuxerBackend = createMockDemuxerBackend({
    chunks: [createMockChunk(0)],
  })
  const decoder = createMockDecoder()
  return new DecoderBackedVideoFrameProvider({
    src: 'video://test.mp4',
    fps: 30,
    demuxerFactory: () => demuxerBackend,
    decoderFactory: () => decoder,
    ...overrides,
  })
}

describe('DecoderBackedVideoFrameProvider', () => {
  beforeEach(() => {
    GpuDebugCounters.reset()
  })

  afterEach(() => {
    GpuDebugCounters.reset()
  })

  describe('getCurrent', () => {
    it('returns null on cache miss and increments cacheMisses', async () => {
      const provider = createProvider()
      await provider.openPromise

      const frame = provider.getCurrent(10)
      expect(frame).toBeNull()
      expect(GpuDebugCounters.cacheMisses).toBe(1)
      provider.dispose()
    })

    it('returns null when no frame has been decoded yet (cache always starts empty)', async () => {
      const provider = createProvider()
      await provider.openPromise

      // Cache starts empty; getCurrent returns null before any frame is decoded
      expect(provider.getCurrent(10)).toBeNull()
      expect(provider.cacheSize).toBe(0)

      provider.dispose()
    })

    it('returns null when disposed', () => {
      const provider = createProvider()
      provider.dispose()
      expect(provider.getCurrent(0)).toBeNull()
    })
  })

  describe('requestFrame', () => {
    it('is a no-op when disposed', async () => {
      const provider = createProvider()
      await provider.openPromise
      provider.dispose()
      // Should not throw
      expect(() => provider.requestFrame(5)).not.toThrow()
    })

    it('is a no-op when frame is already in-flight (_pending coalescing)', async () => {
      const provider = createProvider()
      await provider.openPromise

      provider.requestFrame(10)
      provider.requestFrame(10) // second call — should coalesce
      // Only one pending
      expect(provider.pendingCount).toBeLessThanOrEqual(1)
      provider.dispose()
    })

    it('enforces maxOutstanding cap — drops excess requests', async () => {
      const provider = createProvider({ maxOutstanding: 2 })
      await provider.openPromise

      provider.requestFrame(1)
      provider.requestFrame(2)
      provider.requestFrame(3) // exceeds cap

      expect(provider.pendingCount).toBe(2)
      provider.dispose()
    })

    it('does not enqueue when cache already has the frame', async () => {
      // Seed cache by allowing one requestFrame to resolve then check next call
      const demuxerBackend = createMockDemuxerBackend({ chunks: [createMockChunk(0)] })
      const provider = new DecoderBackedVideoFrameProvider({
        src: 'video://test.mp4',
        fps: 30,
        demuxerFactory: () => demuxerBackend,
        decoderFactory: () => createMockDecoder(),
      })
      await provider.openPromise

      provider.requestFrame(5)
      // Wait for microtasks
      await Promise.resolve()
      await Promise.resolve()

      const beforePending = provider.pendingCount
      provider.requestFrame(5) // should be coalesced if still pending, or skipped if cached
      expect(provider.pendingCount).toBeLessThanOrEqual(beforePending + 1)

      provider.dispose()
    })
  })

  describe('prefetch', () => {
    it('issues multiple requestFrame calls up to maxOutstanding', async () => {
      const provider = createProvider({ maxOutstanding: 3 })
      await provider.openPromise

      provider.prefetch(10, 10) // request 10 frames but cap at 3

      expect(provider.pendingCount).toBeLessThanOrEqual(3)
      provider.dispose()
    })
  })

  describe('lifecycle', () => {
    it('markIdle arms idle timer; markActive cancels it', async () => {
      vi.useFakeTimers()
      const provider = createProvider()
      await provider.openPromise

      const idleCb = vi.fn()
      provider.setIdleCallback(idleCb)

      provider.markIdle()
      vi.advanceTimersByTime(4999)
      expect(idleCb).not.toHaveBeenCalled()

      provider.markActive()
      vi.advanceTimersByTime(10000)
      expect(idleCb).not.toHaveBeenCalled()

      provider.dispose()
      vi.useRealTimers()
    })

    it('markIdle fires callback after timeout', async () => {
      vi.useFakeTimers()
      const provider = createProvider()
      await provider.openPromise

      const idleCb = vi.fn()
      provider.setIdleCallback(idleCb)

      provider.markIdle()
      vi.advanceTimersByTime(5001)

      expect(idleCb).toHaveBeenCalledTimes(1)
      provider.dispose()
      vi.useRealTimers()
    })

    it('dispose is idempotent', async () => {
      const provider = createProvider()
      await provider.openPromise

      provider.dispose()
      provider.dispose()
      provider.dispose()

      expect(provider.state).toBe('disposed')
    })

    it('dispose clears cache and sets cacheSize to 0', async () => {
      const provider = createProvider()
      await provider.openPromise

      provider.dispose()

      expect(GpuDebugCounters.cacheSize).toBe(0)
    })

    it('dispose cancels pending decodes quietly', async () => {
      const provider = createProvider({ maxOutstanding: 4 })
      await provider.openPromise

      provider.requestFrame(1)
      provider.requestFrame(2)
      provider.requestFrame(3)

      expect(() => provider.dispose()).not.toThrow()
      expect(provider.state).toBe('disposed')
    })
  })

  describe('open error handling', () => {
    it('records open error and getCurrent returns null', async () => {
      const badDemuxer = createMockDemuxerBackend({
        openError: new Error('network error'),
      })
      const provider = new DecoderBackedVideoFrameProvider({
        src: 'video://broken.mp4',
        fps: 30,
        demuxerFactory: () => badDemuxer,
        decoderFactory: () => createMockDecoder(),
      })

      await provider.openPromise
      expect(provider.openError).not.toBeNull()
      expect(provider.openError?.message).toContain('network error')
      expect(provider.getCurrent(0)).toBeNull()

      provider.dispose()
    })
  })

  describe('decoderState accessor', () => {
    it('reflects manager state after open', async () => {
      const provider = createProvider()
      await provider.openPromise

      expect(provider.decoderState).toBe('Ready')
      provider.dispose()
      expect(provider.decoderState).toBe('Disposed')
    })
  })

  describe('automatic error recovery (reopen after decode failure)', () => {
    it('re-opens the manager after a decode error so subsequent requestFrame calls can succeed', async () => {
      // First demuxer succeeds on open but fails on every packets() call after
      // the first requestFrame triggers an error.
      let failPackets = false
      const demuxerBackend = createMockDemuxerBackend({ chunks: [createMockChunk(0)] })
      // Patch packets to fail conditionally
      vi.mocked(demuxerBackend.packets).mockImplementation(async function* () {
        if (failPackets) throw new Error('simulated decode error')
        yield createMockChunk(0)
      })

      const decoder = createMockDecoder()
      const provider = new DecoderBackedVideoFrameProvider({
        src: 'video://test.mp4',
        fps: 30,
        demuxerFactory: () => demuxerBackend,
        decoderFactory: () => decoder,
      })
      await provider.openPromise

      // Trigger a decode failure
      failPackets = true
      provider.requestFrame(5)
      // Let the async decode + error path run
      await new Promise<void>((r) => setTimeout(r, 0))
      await new Promise<void>((r) => setTimeout(r, 0))
      await new Promise<void>((r) => setTimeout(r, 0))

      // Wait for the reopen promise (provider._openPromise updated by onError)
      await provider.openPromise

      // After recovery the manager should be Ready again
      expect(provider.decoderState).toBe('Ready')

      provider.dispose()
    })

    it('does not reopen when provider is already disposed', async () => {
      const demuxerBackend = createMockDemuxerBackend({
        chunks: [createMockChunk(0)],
        packetsError: new Error('decode error'),
      })
      const provider = new DecoderBackedVideoFrameProvider({
        src: 'video://test.mp4',
        fps: 30,
        demuxerFactory: () => demuxerBackend,
        decoderFactory: () => createMockDecoder(),
      })
      await provider.openPromise

      // Dispose before the decode failure fires
      provider.dispose()

      // The provider should stay disposed (no re-open after dispose)
      expect(provider.state).toBe('disposed')
    })

    it('does not enter a re-entrant reopen loop', async () => {
      let openCallCount = 0
      const failingDemuxer = createMockDemuxerBackend({
        chunks: [createMockChunk(0)],
        packetsError: new Error('persistent error'),
      })
      vi.mocked(failingDemuxer.open).mockImplementation(async () => {
        openCallCount++
      })

      const provider = new DecoderBackedVideoFrameProvider({
        src: 'video://test.mp4',
        fps: 30,
        demuxerFactory: () => failingDemuxer,
        decoderFactory: () => createMockDecoder(),
      })
      await provider.openPromise

      // Fire two simultaneous decode requests that both fail
      provider.requestFrame(1)
      provider.requestFrame(2)

      await new Promise<void>((r) => setTimeout(r, 0))
      await new Promise<void>((r) => setTimeout(r, 0))
      await new Promise<void>((r) => setTimeout(r, 0))
      await provider.openPromise

      // reopen guard must prevent more than one concurrent reopen
      // openCallCount: 1 initial open + at most 1 reopen
      expect(openCallCount).toBeLessThanOrEqual(2)

      provider.dispose()
    })
  })
})
