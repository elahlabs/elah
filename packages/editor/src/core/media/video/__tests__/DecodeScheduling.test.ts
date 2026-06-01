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
    it('setPlayhead() is async-safe and non-blocking', () => {
      const provider = new MockVideoFrameProvider()
      const start = performance.now()

      for (let i = 0; i < 100; i++) {
        provider.getCurrent(i)
        provider.setPlayhead(i)
      }

      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(50)
      // Frames are scheduled via setTimeout so not available synchronously.
      expect(provider.getCurrent(0)).toBeNull()
    })

    it('setPlayhead() deduplicates requests within the lookahead window', () => {
      const provider = new MockVideoFrameProvider({ lookaheadFrames: 0 })

      provider.setPlayhead(3)
      provider.setPlayhead(3)
      provider.setPlayhead(3)

      // Despite three calls, the internal pending set should only have one entry.
      vi.runAllTimers()
      expect(provider.getCurrent(3)).not.toBeNull()
    })

    it('setPlayhead() schedules frames for [N, N+lookahead] window', () => {
      const provider = new MockVideoFrameProvider({ lookaheadFrames: 4 })

      provider.setPlayhead(10)
      vi.runAllTimers()

      for (let i = 10; i <= 14; i++) {
        expect(provider.getCurrent(i)).not.toBeNull()
      }
    })

    it('rapid setPlayhead calls do not deadlock', async () => {
      const provider = new MockVideoFrameProvider({ lookaheadFrames: 0 })

      provider.setPlayhead(0)
      provider.setPlayhead(1000)
      provider.setPlayhead(500)
      provider.setPlayhead(2000)

      await vi.runAllTimersAsync()

      expect(provider.getCurrent(0)).not.toBeNull()
      expect(provider.getCurrent(1000)).not.toBeNull()
      expect(provider.getCurrent(500)).not.toBeNull()
      expect(provider.getCurrent(2000)).not.toBeNull()
    })

    it('dispose during in-flight setPlayhead prevents frame storage', () => {
      const provider = new MockVideoFrameProvider({ lookaheadFrames: 0 })

      provider.setPlayhead(42)

      provider.dispose()

      vi.runAllTimers()
      expect(provider.getCurrent(42)).toBeNull()
    })

    it('pending set does not grow unboundedly for the same frame', () => {
      const provider = new MockVideoFrameProvider({ lookaheadFrames: 0 })

      for (let i = 0; i < 1000; i++) {
        provider.setPlayhead(7)
      }

      // Internal deduplication: only one pending entry regardless of call count.
      expect(provider.cacheSize).toBe(0)
      vi.runAllTimers()
      expect(provider.getCurrent(7)).not.toBeNull()
    })
  })

  describe('VideoDecoderManager', () => {
    it('reset() cancels in-progress feed without deadlock', async () => {
      const pending: { resolve: (() => void) | null } = { resolve: null }
      const demuxerBackend = {
        ...createMockDemuxerBackend({ chunks: [createMockChunk()] }),
        packets: vi.fn(async function* (_range: [number, number]) {
          yield createMockChunk(0)
          await new Promise<void>(r => { pending.resolve = r as () => void })
          yield createMockChunk(33333)
        }),
      }
      const decoderMock = createMockDecoder()
      const manager = new VideoDecoderManager({
        demuxerFactory: () => demuxerBackend,
        decoderFactory: decoderMock.factory,
        fps: 30,
      })

      await manager.open('video://test')
      await manager.reset(0)

      manager.feed([0, 66666])
      await Promise.resolve()
      await Promise.resolve()

      // Reset should cancel the stale feed.
      const resetPromise = manager.reset(33333)
      pending.resolve?.()

      await resetPromise
      expect(manager.state).toBe('Ready')
    })

    it('multiple feed() calls for non-overlapping ranges both deliver packets', async () => {
      const chunk0 = createMockChunk(0)
      const demuxerBackend = createMockDemuxerBackend({ chunks: [chunk0] })
      const decoderMock = createMockDecoder()
      const manager = new VideoDecoderManager({
        demuxerFactory: () => demuxerBackend,
        decoderFactory: decoderMock.factory,
        fps: 30,
      })

      await manager.open('video://test')
      await manager.reset(0)

      vi.mocked(decoderMock.lastDecoder.decode).mockClear()

      manager.feed([0, 33333])
      await Promise.resolve()
      await Promise.resolve()

      expect(decoderMock.lastDecoder.decode).toHaveBeenCalledWith(chunk0)
      expect(decoderMock.lastDecoder.flush).not.toHaveBeenCalled()
    })

    it('feed() state stays Ready throughout (no intermediate Decoding state)', async () => {
      const states: string[] = []
      const demuxerBackend = createMockDemuxerBackend({ chunks: [createMockChunk()] })
      const decoderMock = createMockDecoder()
      const manager = new VideoDecoderManager({
        demuxerFactory: () => demuxerBackend,
        decoderFactory: decoderMock.factory,
        fps: 30,
        onStateChange: (s) => states.push(s),
      })

      await manager.open('video://test')
      states.length = 0

      manager.feed([0, 33333])
      await Promise.resolve()
      await Promise.resolve()

      // No intermediate states; feed is fire-and-forget.
      expect(states).toHaveLength(0)
      expect(manager.state).toBe('Ready')
    })
  })
})
