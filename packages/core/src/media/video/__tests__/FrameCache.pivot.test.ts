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

describe('FrameCache — pivot-aware eviction', () => {
  beforeEach(() => {
    frameCounter = 0
  })

  it('backward-seek: keeps the seek-target frame when siblings fill the cache', () => {
    const cache = new FrameCache(3)
    const f10 = mockFrame()
    const f11 = mockFrame()
    const f12 = mockFrame()
    const f3 = mockFrame()

    cache.setPivot(10)
    cache.put(10, f10)
    cache.put(11, f11)
    cache.put(12, f12)

    cache.setPivot(3)
    cache.put(3, f3)

    expect(cache.has(3)).toBe(true)
    expect(cache.has(12)).toBe(false)
  })

  it('evicts frame with max distance; ties broken by lowest key', () => {
    const cache = new FrameCache(2)
    const f0 = mockFrame()
    const f10 = mockFrame()
    const f2 = mockFrame()

    cache.setPivot(5)
    cache.put(0, f0)
    cache.put(10, f10)
    cache.put(2, f2)

    expect(cache.has(0)).toBe(false)
    expect(cache.has(10)).toBe(true)
    expect(cache.has(2)).toBe(true)
  })

  it('default pivot=0 evicts highest key (no pivot set)', () => {
    const cache = new FrameCache(2)

    cache.put(1, mockFrame())
    cache.put(5, mockFrame())
    cache.put(10, mockFrame())

    expect(cache.has(5)).toBe(false)
    expect(cache.has(1)).toBe(true)
    expect(cache.has(10)).toBe(true)
  })

  it('onEvict hook fires for pivot-driven eviction', () => {
    const onEvict = vi.fn()
    const cache = new FrameCache({ maxFrames: 2, hooks: { onEvict } })

    cache.setPivot(10)
    cache.put(1, mockFrame())
    cache.put(5, mockFrame())
    cache.put(10, mockFrame())

    expect(onEvict).toHaveBeenCalledWith(1)
  })
})
