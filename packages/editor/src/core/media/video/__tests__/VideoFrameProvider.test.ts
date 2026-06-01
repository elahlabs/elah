import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockVideoFrameProvider } from '../VideoFrameProvider'

describe('MockVideoFrameProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('getCurrent() remains synchronous and returns null before decode', () => {
    const provider = new MockVideoFrameProvider()

    expect(provider.getCurrent(0)).toBeNull()

    // setPlayhead schedules frame via setTimeout — not yet resolved
    provider.setPlayhead(0, { lookaheadFrames: 0 })
    expect(provider.getCurrent(0)).toBeNull()

    vi.runAllTimers()
    const frame = provider.getCurrent(0)
    expect(frame).not.toBeNull()
    expect(frame!.displayWidth).toBe(320)
  })

  it('setPlayhead() schedules async work only — frame not available synchronously', () => {
    const provider = new MockVideoFrameProvider()

    provider.setPlayhead(5, { lookaheadFrames: 0 })
    expect(provider.getCurrent(5)).toBeNull()

    vi.runAllTimers()
    expect(provider.getCurrent(5)).not.toBeNull()
  })

  it('setPlayhead() schedules the lookahead window [N, N+lookahead]', () => {
    const provider = new MockVideoFrameProvider()

    provider.setPlayhead(10, { lookaheadFrames: 2 })

    vi.runAllTimers()

    expect(provider.getCurrent(10)).not.toBeNull()
    expect(provider.getCurrent(11)).not.toBeNull()
    expect(provider.getCurrent(12)).not.toBeNull()
  })

  it('deduplicates overlapping setPlayhead windows', () => {
    const provider = new MockVideoFrameProvider({ lookaheadFrames: 0 })

    provider.setPlayhead(3)
    provider.setPlayhead(3)
    provider.setPlayhead(3)

    vi.runAllTimers()
    expect(provider.getCurrent(3)).not.toBeNull()
    // Only one frame — not multiple duplicates
    expect(provider.cacheSize).toBe(1)
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

  it('dispose() clears cache and timers', () => {
    const provider = new MockVideoFrameProvider({ idleTimeoutMs: 5000 })
    const idleFn = vi.fn()
    provider.setIdleCallback(idleFn)

    provider.setPlayhead(0, { lookaheadFrames: 0 })
    provider.markIdle()

    provider.dispose()

    expect(provider.state).toBe('disposed')
    expect(provider.getCurrent(0)).toBeNull()

    vi.runAllTimers()
    expect(idleFn).not.toHaveBeenCalled()
  })

  it('never blocks the render path', () => {
    const provider = new MockVideoFrameProvider()
    const start = performance.now()

    for (let i = 0; i < 100; i++) {
      provider.getCurrent(i)
      provider.setPlayhead(i)
    }

    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(50)
    expect(provider.getCurrent(0)).toBeNull()
  })

  it('survives all calls safely after dispose', () => {
    const provider = new MockVideoFrameProvider()

    provider.dispose()

    expect(() => {
      provider.getCurrent(99)
      provider.setPlayhead(0, { lookaheadFrames: 5 })
      provider.markIdle()
      provider.markActive()
    }).not.toThrow()

    vi.runAllTimers()
    expect(provider.getCurrent(99)).toBeNull()
  })
})
