import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FrameCache } from '../FrameCache'

// ---------------------------------------------------------------------------
// Mock VideoFrame factory
// ---------------------------------------------------------------------------

let frameCounter = 0

function mockFrame(
  overrides: Partial<{ displayWidth: number; displayHeight: number }> = {},
): VideoFrame {
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
})
