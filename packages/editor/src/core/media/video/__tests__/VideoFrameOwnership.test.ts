import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FrameCache } from '../FrameCache'
import { TexturePool } from '../../../renderer/gpu/TexturePool'
import { VideoTexture } from '../../../renderer/gpu/VideoTexture'
import { GpuDebugCounters } from '../../../renderer/gpu/debug/GpuDebugCounters'
import {
  createTrackingFrame,
  resetTrackingFrameCounter,
} from '../../../renderer/gpu/__tests__/helpers/trackingFrame'

describe('VideoFrame ownership', () => {
  beforeEach(() => {
    resetTrackingFrameCounter()
    GpuDebugCounters.reset()
  })

  it('FrameCache.put() transfers ownership to the cache', () => {
    const cache = new FrameCache(3)
    const frame = createTrackingFrame()

    cache.put(0, frame)
    expect(cache.has(0)).toBe(true)
    expect(frame.closeCount()).toBe(0)
  })

  it('evicted frames close exactly once', () => {
    const cache = new FrameCache(2)
    const f0 = createTrackingFrame()
    const f1 = createTrackingFrame()
    const f2 = createTrackingFrame()

    cache.put(0, f0)
    cache.put(5, f1)
    cache.setPivot(10)
    cache.put(10, f2)

    expect(f0.closeCount()).toBe(1)
    expect(f1.closeCount()).toBe(0)
    expect(f2.closeCount()).toBe(0)
  })

  it('replacing same sourceFrame closes old frame without double-close', () => {
    const cache = new FrameCache(3)
    const oldFrame = createTrackingFrame()
    const newFrame = createTrackingFrame()

    cache.put(7, oldFrame)
    cache.put(7, newFrame)

    expect(oldFrame.closeCount()).toBe(1)
    expect(newFrame.closeCount()).toBe(0)
    expect(cache.get(7)).toBe(newFrame)
  })

  it('clear() and dispose() close all frames exactly once', () => {
    const cache = new FrameCache(5)
    const f0 = createTrackingFrame()
    const f1 = createTrackingFrame()

    cache.put(0, f0)
    cache.put(1, f1)
    cache.clear()

    expect(f0.closeCount()).toBe(1)
    expect(f1.closeCount()).toBe(1)
    expect(cache.size).toBe(0)

    const f2 = createTrackingFrame()
    cache.put(2, f2)
    cache.dispose()
    expect(f2.closeCount()).toBe(1)
  })

  it('get() returns borrowed references without closing', () => {
    const cache = new FrameCache(3)
    const frame = createTrackingFrame()

    cache.put(5, frame)
    const borrowed = cache.get(5)

    expect(borrowed).toBe(frame)
    expect(frame.closeCount()).toBe(0)
    expect(cache.get(5)).toBe(frame)
  })

  it('evictBefore() closes only older frames', () => {
    const cache = new FrameCache(5)
    const f0 = createTrackingFrame()
    const f5 = createTrackingFrame()
    const f10 = createTrackingFrame()

    cache.put(0, f0)
    cache.put(5, f5)
    cache.put(10, f10)
    cache.evictBefore(5)

    expect(f0.closeCount()).toBe(1)
    expect(f5.closeCount()).toBe(0)
    expect(f10.closeCount()).toBe(0)
  })

  it('VideoTexture.upload() closes frame in finally even on GL error', () => {
    const pool = new TexturePool({ maxTextures: 4 })
    const gl = createMockGL({ texImage2DThrowsOnUpload: true })
    const texture = new VideoTexture(pool)
    const frame = createTrackingFrame()

    expect(() => texture.upload(gl, frame)).toThrow('GL upload failed')
    expect(frame.closeCount()).toBe(1)
  })

  it('VideoTexture.upload() closes frame after successful upload', () => {
    const pool = new TexturePool({ maxTextures: 4 })
    const gl = createMockGL()
    const texture = new VideoTexture(pool)
    const frame = createTrackingFrame()

    const result = texture.upload(gl, frame)

    expect(result).toBe(true)
    expect(frame.closeCount()).toBe(1)
    expect(texture.hasContent).toBe(true)
  })

  it('counter balance: active + closed + cacheSize stays consistent', () => {
    let cache!: FrameCache
    cache = new FrameCache({
      maxFrames: 3,
      hooks: {
        onPut: () => {
          GpuDebugCounters.activeVideoFrames++
          GpuDebugCounters.cacheSize = cache.size
        },
        onEvict: () => {
          GpuDebugCounters.closedVideoFrames++
          GpuDebugCounters.activeVideoFrames--
          GpuDebugCounters.cacheSize = cache.size
        },
        onClear: () => {
          GpuDebugCounters.cacheSize = 0
        },
      },
    })

    const frames = [0, 1, 2, 3].map(() => createTrackingFrame())
    for (let i = 0; i < frames.length; i++) {
      cache.put(i, frames[i]!)
    }

    expect(GpuDebugCounters.closedVideoFrames).toBe(1)
    expect(cache.size).toBe(3)
    expect(GpuDebugCounters.activeVideoFrames).toBe(3)

    cache.clear()
    expect(GpuDebugCounters.cacheSize).toBe(0)
    expect(cache.size).toBe(0)
  })

  it('FrameCache never leaks VideoFrames on dispose', () => {
    const cache = new FrameCache(5)
    const frames = Array.from({ length: 5 }, (_, i) => {
      const f = createTrackingFrame()
      cache.put(i, f)
      return f
    })

    cache.dispose()

    for (const frame of frames) {
      expect(frame.closeCount()).toBe(1)
    }
    expect(cache.size).toBe(0)
  })
})

function createMockGL(options: { texImage2DThrowsOnUpload?: boolean } = {}): WebGL2RenderingContext {
  const gl = {
    TEXTURE_2D: 0x0de1,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    NEAREST: 0x2600,
    CLAMP_TO_EDGE: 0x812f,
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: options.texImage2DThrowsOnUpload
      ? vi.fn((...args: unknown[]) => {
          const source = args[args.length - 1]
          if (source !== null && source !== undefined) {
            throw new Error('GL upload failed')
          }
        })
      : vi.fn(),
  }
  return gl as unknown as WebGL2RenderingContext
}
