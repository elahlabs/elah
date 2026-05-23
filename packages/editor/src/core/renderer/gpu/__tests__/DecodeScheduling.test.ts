import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockVideoFrameProvider } from '../VideoFrameProvider'
import { VideoDecoderManager } from '../VideoDecoderManager'
import {
  createMockChunk,
  createMockDecoder,
  createMockDemuxerBackend,
} from './helpers/mockDemuxer'

describe('Decode scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('MockVideoFrameProvider', () => {
    it('requestFrame() is async-safe and non-blocking', () => {
      const provider = new MockVideoFrameProvider()
      const start = performance.now()

      for (let i = 0; i < 100; i++) {
        provider.getCurrent(i)
        provider.requestFrame(i)
      }

      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(50)
      expect(provider.getCurrent(0)).toBeNull()
    })

    it('deduplicates duplicate requestFrame() calls', () => {
      const provider = new MockVideoFrameProvider()

      provider.requestFrame(3)
      provider.requestFrame(3)
      provider.requestFrame(3)

      expect(provider.pendingCount).toBe(1)

      vi.runAllTimers()
      expect(provider.getCurrent(3)).not.toBeNull()
      expect(provider.pendingCount).toBe(0)
    })

    it('prefetch() schedules N requests without blocking', () => {
      const provider = new MockVideoFrameProvider()

      provider.prefetch(10, 5)
      expect(provider.pendingCount).toBe(5)

      vi.runAllTimers()

      for (let i = 10; i < 15; i++) {
        expect(provider.getCurrent(i)).not.toBeNull()
      }
      expect(provider.pendingCount).toBe(0)
    })

    it('rapid seek requests do not deadlock', async () => {
      const provider = new MockVideoFrameProvider()

      provider.requestFrame(0)
      provider.requestFrame(1000)
      provider.requestFrame(500)
      provider.requestFrame(2000)

      await vi.runAllTimersAsync()

      expect(provider.getCurrent(0)).not.toBeNull()
      expect(provider.getCurrent(1000)).not.toBeNull()
      expect(provider.getCurrent(500)).not.toBeNull()
      expect(provider.getCurrent(2000)).not.toBeNull()
      expect(provider.pendingCount).toBe(0)
    })

    it('dispose during in-flight requests prevents frame storage', () => {
      const provider = new MockVideoFrameProvider()

      provider.requestFrame(42)
      expect(provider.pendingCount).toBe(1)

      provider.dispose()

      vi.runAllTimers()
      expect(provider.getCurrent(42)).toBeNull()
      expect(provider.pendingCount).toBe(0)
    })

    it('pending set does not grow unboundedly for duplicate frames', () => {
      const provider = new MockVideoFrameProvider()

      for (let i = 0; i < 1000; i++) {
        provider.requestFrame(7)
      }

      expect(provider.pendingCount).toBe(1)
    })
  })

  describe('VideoDecoderManager', () => {
    it('coalesces duplicate decode requests for same sourceFrame', async () => {
      const demuxerBackend = createMockDemuxerBackend({
        chunks: [createMockChunk()],
      })
      const decoder = createMockDecoder()
      const manager = new VideoDecoderManager({
        demuxerFactory: () => demuxerBackend,
        decoderFactory: () => decoder,
      })

      await manager.open('video://test')

      const p1 = manager.requestFrame(10)
      const p2 = manager.requestFrame(10)
      const p3 = manager.requestFrame(10)

      expect(manager.pendingDecodeCount).toBe(3)

      const [f1, f2, f3] = await Promise.all([p1, p2, p3])

      expect(f1).toBeDefined()
      expect(f2).toBeDefined()
      expect(f3).toBeDefined()
      expect(decoder.decode).toHaveBeenCalledTimes(1)
    })

    it('survives rapid scrubbing without unbounded queue growth', async () => {
      const demuxerBackend = createMockDemuxerBackend({
        chunks: [createMockChunk()],
      })
      const manager = new VideoDecoderManager({
        demuxerFactory: () => demuxerBackend,
        decoderFactory: () => createMockDecoder(),
      })

      await manager.open('video://test')

      const promises: Promise<VideoFrame>[] = []
      for (let i = 0; i < 20; i++) {
        promises.push(manager.requestFrame(i * 10))
      }

      await Promise.all(promises)

      expect(manager.pendingDecodeCount).toBe(0)
      expect(manager.state).toBe('Ready')
    })

    it('seek cancels pending decodes without deadlock', async () => {
      const demuxerBackend = createMockDemuxerBackend({
        chunks: [createMockChunk()],
      })
      const manager = new VideoDecoderManager({
        demuxerFactory: () => demuxerBackend,
        decoderFactory: () => createMockDecoder(),
      })

      await manager.open('video://test')

      const pending = manager.requestFrame(50)
      await manager.seek(100)

      await expect(pending).rejects.toThrow(/seek cancelled/)
      expect(manager.state).toBe('Ready')
    })
  })
})
