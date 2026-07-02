/**
 * FrameOwnership — ownership and lifecycle tests for multi-clip scenarios.
 *
 * Validates:
 *  - Frame ownership rule (I10): one open, one close, no double-close
 *  - FrameCache.size == 0 after disposal
 *  - Frames emitted after dispose are immediately closed
 *
 * @see architecture.md § 10 (frame ownership)
 * @see EVOLUTION.md I10
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FrameCache } from '../FrameCache'
import { StreamingFrameProducer } from '../StreamingFrameProducer'
import { GpuDebugCounters } from '../../../renderer/gpu/debug/GpuDebugCounters'
import { createMockChunk, createMockDecoder, createMockDemuxerBackend } from './helpers/mockDemuxer'
import {
  createTrackingFrame,
  resetTrackingFrameCounter,
} from '../../../renderer/gpu/__tests__/helpers/trackingFrame'

describe('FrameOwnership', () => {
  beforeEach(() => {
    GpuDebugCounters.reset()
    resetTrackingFrameCounter()
  })

  afterEach(() => {
    GpuDebugCounters.reset()
  })

  describe('FrameCache ownership rules', () => {
    it('put transfers ownership; evict closes exactly once', () => {
      const frame = createTrackingFrame()
      const cache = new FrameCache({ maxFrames: 1 })

      cache.put(0, frame)
      expect(frame.closeCount()).toBe(0)

      // Evict by putting another frame (cache is full at 1)
      const frame2 = createTrackingFrame()
      cache.put(1, frame2)

      // Frame 0 was evicted → closed exactly once
      expect(frame.closeCount()).toBe(1)
      expect(frame2.closeCount()).toBe(0)

      cache.dispose()
      expect(frame2.closeCount()).toBe(1)
    })

    it('get() returns borrowed reference — caller must not close', () => {
      const frame = createTrackingFrame()
      const cache = new FrameCache({ maxFrames: 5 })

      cache.put(10, frame)
      const borrowed = cache.get(10)

      expect(borrowed).toBe(frame)
      expect(frame.closeCount()).toBe(0) // not closed yet

      cache.dispose()
      expect(frame.closeCount()).toBe(1) // closed exactly once by cache
    })

    it('replacing an existing frame key closes the old frame', () => {
      const frame1 = createTrackingFrame()
      const frame2 = createTrackingFrame()
      const cache = new FrameCache({ maxFrames: 5 })

      cache.put(5, frame1)
      cache.put(5, frame2) // replace same key

      expect(frame1.closeCount()).toBe(1) // old frame closed
      expect(frame2.closeCount()).toBe(0)

      cache.dispose()
      expect(frame2.closeCount()).toBe(1)
    })

    it('dispose closes all frames exactly once', () => {
      const frames = Array.from({ length: 5 }, () => createTrackingFrame())
      const cache = new FrameCache({ maxFrames: 10 })

      frames.forEach((f, i) => cache.put(i, f))
      cache.dispose()

      for (const f of frames) {
        expect(f.closeCount()).toBe(1)
      }
    })

    it('evictBefore closes frames with key < n', () => {
      const frames = Array.from({ length: 5 }, (_) => createTrackingFrame())
      const cache = new FrameCache({ maxFrames: 10 })

      frames.forEach((f, i) => cache.put(i, f))
      cache.evictBefore(3)

      expect(frames[0].closeCount()).toBe(1)
      expect(frames[1].closeCount()).toBe(1)
      expect(frames[2].closeCount()).toBe(1)
      expect(frames[3].closeCount()).toBe(0)
      expect(frames[4].closeCount()).toBe(0)

      cache.dispose()
      expect(frames[3].closeCount()).toBe(1)
      expect(frames[4].closeCount()).toBe(1)
    })

    it('double-close throws (double-close detection)', () => {
      const frame = createTrackingFrame()
      frame.close()
      expect(() => frame.close()).toThrow(/double-close/)
    })
  })

  describe('StreamingFrameProducer frame lifecycle', () => {
    it('frames cached by producer are not double-closed on dispose', async () => {
      const demuxerBackend = createMockDemuxerBackend({ chunks: [createMockChunk(0)] })

      const producer = new StreamingFrameProducer({
        src: 'video://ownership.mp4',
        fps: 30,
        demuxerFactory: () => demuxerBackend,
        decoderFactory: createMockDecoder().factory,
      })

      await producer.openPromise
      producer.setPlayhead(0)
      await new Promise((r) => setTimeout(r, 20))

      // Dispose should not double-close anything
      expect(() => producer.dispose()).not.toThrow()
      expect(producer.state).toBe('disposed')
      expect(producer.cacheSize).toBe(0)
    })

    it('frames emitted after dispose are immediately closed (no leak)', async () => {
      // Track all frames that pass through onFrame
      let frameReceivedAfterDispose = false

      const demuxerBackend = createMockDemuxerBackend({ chunks: [createMockChunk(0)] })
      const baseDecoder = createMockDecoder()

      // Wrap the factory to intercept the output callback
      const captured: { output: ((f: VideoFrame) => void) | null } = { output: null }
      const wrappedFactory = vi.fn(
        (output: (f: VideoFrame) => void, error: (e: DOMException) => void) => {
          captured.output = output
          return baseDecoder.factory(output, error)
        },
      )

      const producer = new StreamingFrameProducer({
        src: 'video://postdispose.mp4',
        fps: 30,
        demuxerFactory: () => demuxerBackend,
        decoderFactory: wrappedFactory,
      })

      await producer.openPromise
      producer.setPlayhead(0)
      await Promise.resolve()

      // Dispose while decode may still be in flight
      producer.dispose()

      // Now simulate a frame arriving after dispose via the captured output callback
      if (captured.output) {
        const lateFrame = {
          timestamp: 0,
          displayWidth: 640,
          displayHeight: 360,
          close: vi.fn(() => {
            frameReceivedAfterDispose = true
          }),
          clone: vi.fn(),
        } as unknown as VideoFrame
        captured.output(lateFrame)
        // Frame should have been closed immediately
        expect(frameReceivedAfterDispose).toBe(true)
      }

      expect(producer.cacheSize).toBe(0)
    })
  })

  describe('multi-clip same-src producer sharing', () => {
    it('FrameCache size returns to 0 after 50 seek cycles and disposal', async () => {
      const demuxerBackend = createMockDemuxerBackend({ chunks: [createMockChunk(0)] })
      const producer = new StreamingFrameProducer({
        src: 'video://shared.mp4',
        fps: 30,
        maxFrames: 10,
        demuxerFactory: () => demuxerBackend,
        decoderFactory: createMockDecoder().factory,
      })

      await producer.openPromise

      for (let i = 0; i < 50; i++) {
        producer.setPlayhead((i * 7) % 15)
        await Promise.resolve()
      }

      producer.dispose()
      expect(producer.cacheSize).toBe(0)
    })
  })
})
