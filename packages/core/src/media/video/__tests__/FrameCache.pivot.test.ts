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

  it('prefers evicting behind-pivot frames over ahead-pivot lookahead frames, even when the ahead frame is farther away', () => {
    // Regression for a burst-feed cache-miss bug: with a plain Math.abs(key -
    // pivot) distance metric, a fresh lookahead frame decoded several slots
    // ahead of the pivot could tie or beat a stale trailing frame and get
    // evicted moments after being cached — before the playhead ever reached
    // it. Behind-pivot frames (already displayed) must always be evicted
    // first; only fall back to evicting an ahead frame once no behind-pivot
    // frame remains.
    const cache = new FrameCache(3)
    const behind1 = mockFrame() // key 2, dist 6 from pivot 8
    const behind2 = mockFrame() // key 6, dist 2 from pivot 8
    const ahead = mockFrame() // key 9, dist 1 from pivot 8

    cache.setPivot(8)
    cache.put(2, behind1)
    cache.put(6, behind2)
    cache.put(9, ahead)

    // New lookahead frame decoded far ahead of the pivot during a burst.
    const farAhead = mockFrame() // key 20, dist 12 from pivot 8 — furthest overall
    cache.put(20, farAhead)

    // Furthest behind-pivot frame (key 2) is evicted, not the farthest-overall
    // key 20, even though 20 has a much larger raw distance.
    expect(cache.has(2)).toBe(false)
    expect(cache.has(6)).toBe(true)
    expect(cache.has(9)).toBe(true)
    expect(cache.has(20)).toBe(true)
  })

  it('falls back to evicting the nearest ahead-pivot frame once no behind-pivot frame remains', () => {
    const cache = new FrameCache(2)
    const ahead1 = mockFrame() // key 9, dist 1
    const ahead2 = mockFrame() // key 12, dist 4

    cache.setPivot(8)
    cache.put(9, ahead1)
    cache.put(12, ahead2)

    // No behind-pivot frames exist; must evict furthest-ahead (12), not 9.
    const ahead3 = mockFrame()
    cache.put(20, ahead3)

    expect(cache.has(9)).toBe(true)
    expect(cache.has(12)).toBe(false)
    expect(cache.has(20)).toBe(true)
  })
})
