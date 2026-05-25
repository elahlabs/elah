import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockVideoFrameProvider } from '../VideoFrameProvider'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MockVideoFrameProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('getCurrent() remains synchronous', () => {
    const provider = new MockVideoFrameProvider()

    expect(provider.getCurrent(0)).toBeNull()

    provider.requestFrame(0)
    expect(provider.getCurrent(0)).toBeNull()

    vi.runAllTimers()
    const frame = provider.getCurrent(0)
    expect(frame).not.toBeNull()
    expect(frame!.displayWidth).toBe(320)
  })

  it('requestFrame() schedules async work only', () => {
    const provider = new MockVideoFrameProvider()

    provider.requestFrame(5)
    expect(provider.getCurrent(5)).toBeNull()
    expect(provider.pendingCount).toBe(1)

    vi.runAllTimers()
    expect(provider.getCurrent(5)).not.toBeNull()
    expect(provider.pendingCount).toBe(0)
  })

  it('prefetch() schedules future requests', () => {
    const provider = new MockVideoFrameProvider()

    provider.prefetch(10, 3)
    expect(provider.pendingCount).toBe(3)

    vi.runAllTimers()

    expect(provider.getCurrent(10)).not.toBeNull()
    expect(provider.getCurrent(11)).not.toBeNull()
    expect(provider.getCurrent(12)).not.toBeNull()
    expect(provider.pendingCount).toBe(0)
  })

  it('deduplicates duplicate requestFrame() calls', () => {
    const provider = new MockVideoFrameProvider()

    provider.requestFrame(3)
    provider.requestFrame(3)
    provider.requestFrame(3)

    expect(provider.pendingCount).toBe(1)

    vi.runAllTimers()
    expect(provider.getCurrent(3)).not.toBeNull()
  })

  it('markIdle() starts idle lifecycle', () => {
    const provider = new MockVideoFrameProvider({ idleTimeoutMs: 1000 })
    const idleFn = vi.fn()
    provider.setIdleCallback(idleFn)

    provider.markIdle()
    expect(provider.state).toBe('idle')

    vi.advanceTimersByTime(1000)
    expect(idleFn).toHaveBeenCalledTimes(1)
  })

  it('markActive() cancels idle lifecycle', () => {
    const provider = new MockVideoFrameProvider({ idleTimeoutMs: 1000 })
    const idleFn = vi.fn()
    provider.setIdleCallback(idleFn)

    provider.markIdle()
    provider.markActive()

    expect(provider.state).toBe('active')

    vi.advanceTimersByTime(2000)
    expect(idleFn).not.toHaveBeenCalled()
  })

  it('dispose() clears cache, pending set, and timers', () => {
    const provider = new MockVideoFrameProvider({ idleTimeoutMs: 5000 })
    const idleFn = vi.fn()
    provider.setIdleCallback(idleFn)

    provider.requestFrame(0)
    provider.markIdle()

    provider.dispose()

    expect(provider.state).toBe('disposed')
    expect(provider.getCurrent(0)).toBeNull()
    expect(provider.pendingCount).toBe(0)

    vi.runAllTimers()
    expect(idleFn).not.toHaveBeenCalled()
  })

  it('never blocks the render path', () => {
    const provider = new MockVideoFrameProvider()
    const start = performance.now()

    for (let i = 0; i < 100; i++) {
      provider.getCurrent(i)
      provider.requestFrame(i)
    }

    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(50)
    expect(provider.getCurrent(0)).toBeNull()
  })

  it('survives missing frame requests safely after dispose', () => {
    const provider = new MockVideoFrameProvider()

    provider.dispose()

    expect(() => {
      provider.getCurrent(99)
      provider.requestFrame(99)
      provider.prefetch(0, 5)
      provider.markIdle()
      provider.markActive()
    }).not.toThrow()

    vi.runAllTimers()
    expect(provider.getCurrent(99)).toBeNull()
  })
})
