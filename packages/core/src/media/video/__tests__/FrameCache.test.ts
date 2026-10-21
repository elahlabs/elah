import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FrameCache } from '../FrameCache'

// ---------------------------------------------------------------------------
// Mock VideoFrame factory
// ---------------------------------------------------------------------------

let frameCounter = 0

function mockFrame(overrides: Partial<{ displayWidth: number; displayHeight: number }> = {}): VideoFrame {
  frameCounter++
  return {
    close: vi.fn(),
    displayWidth: overrides.displayWidth ?? 100,
    displayHeight: overrides.displayHeight ?? 100,
    _id: frameCounter,
  } as unknown as VideoFrame
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FrameCache', () => {
  beforeEach(() => {
    frameCounter = 0
  })

  it('stores and retrieves frames by sourceFrame', () => {
    const cache = new FrameCache(3)
    const frame = mockFrame()

    cache.put(10, frame)
    expect(cache.has(10)).toBe(true)
    expect(cache.get(10)).toBe(frame)
  })

  it('evicts frame furthest from pivot (forward-playback: pivot = current frame)', () => {
    const cache = new FrameCache(3)
    const f0 = mockFrame()
    const f1 = mockFrame()
    const f2 = mockFrame()
    const f3 = mockFrame()

    cache.put(0, f0)
    cache.put(5, f1)
    cache.put(10, f2)
    cache.setPivot(15)
    cache.put(15, f3)

    expect(cache.has(0)).toBe(false)
    expect(cache.has(5)).toBe(true)
    expect(cache.has(10)).toBe(true)
    expect(cache.has(15)).toBe(true)
  })

  it('enforces maxFrames cache size', () => {
    const cache = new FrameCache(2)

    cache.put(1, mockFrame())
    cache.put(2, mockFrame())
    cache.setPivot(3)
    cache.put(3, mockFrame())

    expect(cache.has(1)).toBe(false)
    expect(cache.has(2)).toBe(true)
    expect(cache.has(3)).toBe(true)
  })

  it('calls close() on evicted frames', () => {
    const cache = new FrameCache(2)
    const f0 = mockFrame()
    const f1 = mockFrame()
    const f2 = mockFrame()

    cache.put(0, f0)
    cache.put(1, f1)
    cache.setPivot(2)
    cache.put(2, f2)

    expect(f0.close).toHaveBeenCalledTimes(1)
    expect(f1.close).not.toHaveBeenCalled()
    expect(f2.close).not.toHaveBeenCalled()
  })

  it('clear() closes all frames', () => {
    const cache = new FrameCache(5)
    const f0 = mockFrame()
    const f1 = mockFrame()

    cache.put(0, f0)
    cache.put(1, f1)
    cache.clear()

    expect(f0.close).toHaveBeenCalledTimes(1)
    expect(f1.close).toHaveBeenCalledTimes(1)
    expect(cache.has(0)).toBe(false)
    expect(cache.has(1)).toBe(false)
  })

  it('dispose() closes all frames', () => {
    const cache = new FrameCache(5)
    const f0 = mockFrame()
    const f1 = mockFrame()

    cache.put(0, f0)
    cache.put(1, f1)
    cache.dispose()

    expect(f0.close).toHaveBeenCalledTimes(1)
    expect(f1.close).toHaveBeenCalledTimes(1)
    expect(cache.has(0)).toBe(false)
  })

  it('get() returns borrowed references only', () => {
    const cache = new FrameCache(3)
    const frame = mockFrame()

    cache.put(5, frame)
    const borrowed = cache.get(5)

    expect(borrowed).toBe(frame)
    expect(cache.get(5)).toBe(frame)
    expect(frame.close).not.toHaveBeenCalled()
  })

  it('evictBefore() removes only older frames', () => {
    const cache = new FrameCache(5)
    const f0 = mockFrame()
    const f5 = mockFrame()
    const f10 = mockFrame()

    cache.put(0, f0)
    cache.put(5, f5)
    cache.put(10, f10)

    cache.evictBefore(5)

    expect(f0.close).toHaveBeenCalledTimes(1)
    expect(f5.close).not.toHaveBeenCalled()
    expect(f10.close).not.toHaveBeenCalled()
    expect(cache.has(0)).toBe(false)
    expect(cache.has(5)).toBe(true)
    expect(cache.has(10)).toBe(true)
  })

  it('replacing same sourceFrame closes the old frame safely', () => {
    const cache = new FrameCache(3)
    const oldFrame = mockFrame()
    const newFrame = mockFrame()

    cache.put(7, oldFrame)
    cache.put(7, newFrame)

    expect(oldFrame.close).toHaveBeenCalledTimes(1)
    expect(newFrame.close).not.toHaveBeenCalled()
    expect(cache.get(7)).toBe(newFrame)
    expect(cache.has(7)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Byte-bound (maxBytes) — StreamingFrameProducer's real usage caches
  // ImageBitmap-shaped frames (width/height, not VideoFrame's
  // displayWidth/displayHeight), so these mocks match that shape.
  // -------------------------------------------------------------------------

  function mockBitmap(width: number, height: number) {
    frameCounter++
    return { close: vi.fn(), width, height, _id: frameCounter } as unknown as {
      close: () => void
      width: number
      height: number
    }
  }

  it('evicts under a byte budget even when the count budget is not reached', () => {
    // 1000x1000 RGBA ≈ 4 MB/frame; a 10 MB budget fits ~2.5 frames.
    const cache = new FrameCache<{ close: () => void; width: number; height: number }>({
      maxFrames: 30, // far above what the byte budget allows
      maxBytes: 10 * 1024 * 1024,
    })
    const f0 = mockBitmap(1000, 1000)
    const f1 = mockBitmap(1000, 1000)
    const f2 = mockBitmap(1000, 1000)

    cache.put(0, f0)
    cache.put(1, f1)
    cache.setPivot(2)
    cache.put(2, f2) // pushes total over budget → evicts furthest-from-pivot first

    expect(f0.close).toHaveBeenCalledTimes(1)
    expect(cache.has(0)).toBe(false)
    expect(cache.has(1)).toBe(true)
    expect(cache.has(2)).toBe(true)
    expect(cache.totalBytes).toBeLessThanOrEqual(10 * 1024 * 1024)
  })

  it('caches a single frame larger than the whole byte budget without looping forever', () => {
    const cache = new FrameCache<{ close: () => void; width: number; height: number }>({
      maxFrames: 30,
      maxBytes: 1024, // far smaller than one 4K-ish frame
    })
    const huge = mockBitmap(3840, 2160)

    expect(() => cache.put(0, huge)).not.toThrow()
    expect(cache.has(0)).toBe(true)
    expect(cache.size).toBe(1)
  })

  it('without maxBytes, byte budget is unbounded (count-bound only, unchanged default)', () => {
    const cache = new FrameCache<{ close: () => void; width: number; height: number }>(3)
    cache.put(0, mockBitmap(4000, 4000))
    cache.put(1, mockBitmap(4000, 4000))
    cache.setPivot(2)
    cache.put(2, mockBitmap(4000, 4000))

    expect(cache.size).toBe(3)
  })
})
