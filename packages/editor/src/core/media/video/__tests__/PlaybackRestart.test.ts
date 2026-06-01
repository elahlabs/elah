/**
 * PlaybackRestart — stress test for repeated play/pause cycles.
 *
 * Simulates 10 play → pause → play cycles over a 60-frame range with a
 * mocked decoder. After each full cycle the TexturePool leased count must
 * return to its initial baseline (no leaked texture handles).
 *
 * @see EVOLUTION.md § 7 Extension Seams (playback lifecycle)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TexturePool } from '../../../renderer/gpu/TexturePool'
import { GpuDebugCounters } from '../../../renderer/gpu/debug/GpuDebugCounters'
import { createMockChunk, createMockDecoder, createMockDemuxerBackend } from './helpers/mockDemuxer'
import { resetTrackingFrameCounter } from '../../../renderer/gpu/__tests__/helpers/trackingFrame'

// Minimal WebGL2 stub for TexturePool — only what acquire/release/dispose use.
function makeGlStub(): WebGL2RenderingContext {
  let handleCounter = 1
  const textures = new Map<WebGLTexture, boolean>()

  return {
    TEXTURE_2D: 0x0de1,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    createTexture: () => {
      const handle = { _id: handleCounter++ }
      textures.set(handle as unknown as WebGLTexture, true)
      return handle as unknown as WebGLTexture
    },
    deleteTexture: (t: WebGLTexture) => { textures.delete(t) },
    bindTexture: () => { /* noop */ },
    texParameteri: () => { /* noop */ },
    texImage2D: () => { /* noop */ },
  } as unknown as WebGL2RenderingContext
}

describe('PlaybackRestart', () => {
  beforeEach(() => {
    GpuDebugCounters.reset()
    resetTrackingFrameCounter()
  })

  afterEach(() => {
    GpuDebugCounters.reset()
  })

  it('TexturePool leased count returns to 0 after 10 play/pause cycles', async () => {
    const gl = makeGlStub()
    const pool = new TexturePool({ maxTextures: 8 })

    // Initial leased count should be 0
    expect(pool.getLeasedCount()).toBe(0)

    // Simulate acquire/release per frame (like VideoTexture would do)
    const WIDTH = 320
    const HEIGHT = 240
    const FORMAT = (gl as unknown as { RGBA: number }).RGBA as GLenum

    for (let cycle = 0; cycle < 10; cycle++) {
      // Simulate a play phase: acquire textures for 4 concurrent frames
      const acquired = []
      for (let f = 0; f < 4; f++) {
        const tex = pool.acquire(gl, WIDTH, HEIGHT, FORMAT)
        if (tex) acquired.push(tex)
      }

      expect(pool.getLeasedCount()).toBe(acquired.length)

      // Simulate pause: release all textures back to pool
      for (const tex of acquired) {
        pool.release(tex)
      }

      // After release, leased count should return to 0
      expect(pool.getLeasedCount()).toBe(0)
    }

    pool.dispose(gl)
    expect(pool.getLeasedCount()).toBe(0)
  })

  it('StreamingFrameProducer: 10 setPlayhead cycles settle cleanly', async () => {
    const { StreamingFrameProducer } = await import('../StreamingFrameProducer')
    const demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk(0), createMockChunk(33333)],
    })

    const producer = new StreamingFrameProducer({
      src: 'video://restart-test.mp4',
      fps: 30,
      demuxerFactory: () => demuxerBackend,
      decoderFactory: createMockDecoder().factory,
    })

    await producer.openPromise

    for (let cycle = 0; cycle < 10; cycle++) {
      // "Play": advance through 60 frames sequentially (contiguous = no reset)
      for (let f = 0; f < 60; f++) {
        producer.setPlayhead(f)
      }

      // Let microtasks drain (simulates a tick boundary)
      await Promise.resolve()
      await Promise.resolve()
    }

    producer.dispose()

    expect(producer.state).toBe('disposed')
    expect(producer.cacheSize).toBe(0)
  })
})
