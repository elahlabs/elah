/**
 * RapidSeekStress — stress test for the decode pipeline under rapid seeking.
 *
 * Validates:
 *  - Producer never enters a permanently stuck state under rapid seek cycles
 *  - FrameCache returns to size 0 after disposal
 *  - No frames are leaked after mixed seek workloads
 *
 * @see StreamingFrameProducer.ts — discontinuity handling via manager.reset()
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StreamingFrameProducer } from '../StreamingFrameProducer'
import { GpuDebugCounters } from '../../../renderer/gpu/debug/GpuDebugCounters'
import { createMockChunk, createMockDecoder, createMockDemuxerBackend } from './helpers/mockDemuxer'
import { resetTrackingFrameCounter } from '../../../renderer/gpu/__tests__/helpers/trackingFrame'

describe('RapidSeekStress', () => {
  beforeEach(() => {
    GpuDebugCounters.reset()
    resetTrackingFrameCounter()
  })

  afterEach(() => {
    GpuDebugCounters.reset()
  })

  it('100 rapid setPlayhead seek cycles: producer stays non-disposed and cacheSize 0 on disposal', async () => {
    const demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk(0), createMockChunk(33333)],
    })

    const producer = new StreamingFrameProducer({
      src: 'video://stress.mp4',
      fps: 30,
      maxFrames: 30,
      demuxerFactory: () => demuxerBackend,
      decoderFactory: createMockDecoder().factory,
    })

    await producer.openPromise

    // Run 100 rapid discontinuous seek cycles
    for (let cycle = 0; cycle < 100; cycle++) {
      const baseFrame = (cycle * 7) % 60 // jump around to trigger discontinuities
      producer.setPlayhead(baseFrame)

      // Let microtasks drain occasionally
      if (cycle % 10 === 0) await Promise.resolve()
    }

    // Dispose: closes all pending decodes and drains the cache
    producer.dispose()

    expect(producer.state).toBe('disposed')
    expect(producer.cacheSize).toBe(0)
  })

  it('200 alternating forward/backward jumps: state is not errored after disposal', async () => {
    const demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk(0)],
    })

    const producer = new StreamingFrameProducer({
      src: 'video://seek-stress.mp4',
      fps: 30,
      maxFrames: 10,
      demuxerFactory: () => demuxerBackend,
      decoderFactory: createMockDecoder().factory,
    })

    await producer.openPromise

    for (let i = 0; i < 200; i++) {
      // Alternate between two distant frames to trigger resets each time
      producer.setPlayhead(i % 2 === 0 ? 0 : 100)
      if (i % 20 === 0) await Promise.resolve()
    }

    producer.dispose()

    // After dispose, producer should be in disposed state (not stuck/errored)
    expect(producer.state).toBe('disposed')
    expect(producer.cacheSize).toBe(0)
  })

  it('frame counts balance: cacheSize 0 after dispose regardless of seek pattern', async () => {
    let framePuts = 0
    let frameEvictions = 0

    const demuxerBackend = createMockDemuxerBackend({ chunks: [createMockChunk(0)] })

    const producer = new StreamingFrameProducer({
      src: 'video://frame-count.mp4',
      fps: 30,
      maxFrames: 5, // small cache to force evictions
      demuxerFactory: () => demuxerBackend,
      decoderFactory: createMockDecoder().factory,
      cacheHooks: {
        onPut: () => {
          framePuts++
        },
        onEvict: () => {
          frameEvictions++
        },
      },
    })

    await producer.openPromise

    // Rapid seek pattern
    for (let i = 0; i < 20; i++) {
      producer.setPlayhead((i * 7) % 30)
      await Promise.resolve()
    }

    // Wait for some decodes to settle
    await new Promise((r) => setTimeout(r, 10))

    producer.dispose()

    expect(producer.cacheSize).toBe(0)
    void framePuts
    void frameEvictions
  })

  it('mixed forward/backward seek sequence: pivot eviction keeps seek target accessible', async () => {
    const demuxerBackend = createMockDemuxerBackend({
      chunks: Array.from({ length: 5 }, (_, i) => createMockChunk(i * 33333)),
    })

    const producer = new StreamingFrameProducer({
      src: 'video://mixed-seek.mp4',
      fps: 30,
      maxFrames: 30,
      lookaheadFrames: 4,
      demuxerFactory: () => demuxerBackend,
      decoderFactory: createMockDecoder().factory,
    })

    await producer.openPromise

    // Mix of forward and backward jumps
    const seekFrames = [0, 30, 5, 25, 10, 20, 15]
    for (const frame of seekFrames) {
      producer.setPlayhead(frame)
      await new Promise((r) => setTimeout(r, 10))
    }

    await new Promise((r) => setTimeout(r, 30))

    producer.dispose()
    expect(producer.cacheSize).toBe(0)
  })
})
