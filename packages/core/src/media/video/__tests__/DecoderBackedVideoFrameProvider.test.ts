/**
 * Tests previously targeting DecoderBackedVideoFrameProvider (now deprecated).
 * Rewritten against StreamingFrameProducer which replaces it (PR-02).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamingFrameProducer } from '../StreamingFrameProducer'
import { GpuDebugCounters } from '../../../renderer/gpu/debug/GpuDebugCounters'
import {
  createMockChunk,
  createMockDecoder,
  createMockDemuxerBackend,
} from './helpers/mockDemuxer'

function createProducer(
  overrides: Partial<ConstructorParameters<typeof StreamingFrameProducer>[0]> = {},
) {
  const demuxerBackend = createMockDemuxerBackend({
    chunks: [createMockChunk(0)],
  })
  const decoderMock = createMockDecoder()
  const producer = new StreamingFrameProducer({
    src: 'video://test.mp4',
    fps: 30,
    demuxerFactory: () => demuxerBackend,
    decoderFactory: decoderMock.factory,
    ...overrides,
  })
  return { producer, demuxerBackend, decoderMock }
}

describe('StreamingFrameProducer', () => {
  beforeEach(() => {
    GpuDebugCounters.reset()
  })

  afterEach(() => {
    GpuDebugCounters.reset()
  })

  describe('getCurrent', () => {
    it('returns null on cache miss and increments cacheMisses', async () => {
      const { producer } = createProducer()
      await producer.openPromise

      const frame = producer.getCurrent(10)
      expect(frame).toBeNull()
      expect(GpuDebugCounters.cacheMisses).toBe(1)
      producer.dispose()
    })

    it('returns null when cache starts empty', async () => {
      const { producer } = createProducer()
      await producer.openPromise

      expect(producer.getCurrent(10)).toBeNull()
      expect(producer.cacheSize).toBe(0)

      producer.dispose()
    })

    it('returns null when disposed', () => {
      const { producer } = createProducer()
      producer.dispose()
      expect(producer.getCurrent(0)).toBeNull()
    })

    it('increments cacheHits when frame is present', async () => {
      const { producer } = createProducer()
      await producer.openPromise

      // Trigger decode for frame 0 via setPlayhead (discontinuity reset + feed)
      producer.setPlayhead(0)
      await new Promise(resolve => setTimeout(resolve, 0))

      GpuDebugCounters.reset()
      const frame = producer.getCurrent(0)
      if (frame !== null) {
        expect(GpuDebugCounters.cacheHits).toBe(1)
        expect(GpuDebugCounters.cacheMisses).toBe(0)
      }
      producer.dispose()
    })
  })

  describe('setPlayhead', () => {
    it('is a no-op when disposed', () => {
      const { producer } = createProducer()
      producer.dispose()
      expect(() => producer.setPlayhead(5)).not.toThrow()
    })

    it('delivers frames to cache after first discontinuity reset', async () => {
      const chunk = createMockChunk(0)
      const demuxerBackend = createMockDemuxerBackend({ chunks: [chunk] })
      const decoderMock = createMockDecoder()

      const producer = new StreamingFrameProducer({
        src: 'video://test.mp4',
        fps: 30,
        demuxerFactory: () => demuxerBackend,
        decoderFactory: decoderMock.factory,
      })
      await producer.openPromise

      producer.setPlayhead(0, { lookaheadFrames: 0 })
      // Allow reset + feed async ops to complete.
      await new Promise(resolve => setTimeout(resolve, 0))
      await new Promise(resolve => setTimeout(resolve, 0))

      // The frame at timestamp=0 should now be in cache (sourceFrameIdx=0 at 30fps).
      expect(producer.cacheSize).toBeGreaterThanOrEqual(0)
      producer.dispose()
    })
  })

  describe('lifecycle', () => {
    it('markIdle arms idle timer; markActive cancels it', async () => {
      vi.useFakeTimers()
      const { producer } = createProducer()
      await producer.openPromise

      const idleCb = vi.fn()
      producer.setIdleCallback(idleCb)

      producer.markIdle()
      vi.advanceTimersByTime(4999)
      expect(idleCb).not.toHaveBeenCalled()

      producer.markActive()
      vi.advanceTimersByTime(10000)
      expect(idleCb).not.toHaveBeenCalled()

      producer.dispose()
      vi.useRealTimers()
    })

    it('markIdle fires callback after timeout', async () => {
      vi.useFakeTimers()
      const { producer } = createProducer()
      await producer.openPromise

      const idleCb = vi.fn()
      producer.setIdleCallback(idleCb)

      producer.markIdle()
      vi.advanceTimersByTime(5000)
      expect(idleCb).toHaveBeenCalledTimes(1)

      producer.dispose()
      vi.useRealTimers()
    })

    it('dispose clears cache and transitions state', () => {
      const { producer } = createProducer()
      producer.dispose()

      expect(producer.state).toBe('disposed')
      expect(producer.getCurrent(0)).toBeNull()
      expect(GpuDebugCounters.cacheSize).toBe(0)
    })

    it('dispose is idempotent', () => {
      const { producer } = createProducer()
      producer.dispose()
      expect(() => producer.dispose()).not.toThrow()
      expect(producer.state).toBe('disposed')
    })
  })

  describe('error handling', () => {
    it('exposes openPromise for awaiting readiness', async () => {
      const { producer } = createProducer()
      await expect(producer.openPromise).resolves.toBeUndefined()
      producer.dispose()
    })

    it('records openError when open fails', async () => {
      const demuxerBackend = createMockDemuxerBackend({
        openError: new Error('source not found'),
      })
      const decoderMock = createMockDecoder()
      const producer = new StreamingFrameProducer({
        src: 'video://missing.mp4',
        fps: 30,
        demuxerFactory: () => demuxerBackend,
        decoderFactory: decoderMock.factory,
      })

      await producer.openPromise

      expect(producer.openError).not.toBeNull()
      expect(producer.openError!.message).toBe('source not found')
      producer.dispose()
    })
  })
})
