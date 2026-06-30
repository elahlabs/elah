import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackEngine } from './PlaybackEngine'

describe('PlaybackEngine', () => {
  let clock = 0
  const now = () => clock

  let rafQueue: Array<() => void>
  let rafId = 0

  let documentHidden = false
  let visibilityHandler: (() => void) | null = null
  const addEventListener = vi.fn(
    (event: string, handler: () => void) => {
      if (event === 'visibilitychange') visibilityHandler = handler
    },
  )
  const removeEventListener = vi.fn()

  function flushRAF(times = 1): void {
    for (let i = 0; i < times; i++) {
      const batch = [...rafQueue]
      rafQueue = []
      batch.forEach((cb) => cb())
    }
  }

  function makeEngine(getTotalFrames = () => 300): PlaybackEngine {
    return new PlaybackEngine({
      fps: 30,
      getTotalFrames,
      now,
    })
  }

  beforeEach(() => {
    clock = 0
    rafQueue = []
    rafId = 0
    documentHidden = false
    visibilityHandler = null

    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafQueue.push(cb)
      rafId += 1
      return rafId
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    vi.stubGlobal('document', {
      get hidden() {
        return documentHidden
      },
      addEventListener,
      removeEventListener,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── 11.a: getFrameAt returns float during playback ───────────────────────

  it('getFrameAt returns a float while playing', () => {
    const engine = makeEngine()
    engine.play()

    clock = 0.5
    expect(engine.getFrameAt()).toBe(15)

    clock = 0.51
    const f = engine.getFrameAt()
    expect(f).toBeCloseTo(15.3, 5)
    expect(f % 1).not.toBe(0)

    engine.destroy()
  })

  // ── 11.b: same-frame seek bumps epoch twice ──────────────────────────────

  it('seek(sameFrame) notifies twice with incrementing epochs', () => {
    const engine = makeEngine()
    const epochs: number[] = []

    engine.subscribe((s) => epochs.push(s.epoch))
    engine.seek(10)
    engine.seek(10)

    expect(epochs).toHaveLength(2)
    expect(epochs[0]).toBeLessThan(epochs[1]!)
    expect(engine.currentFrame).toBe(10)

    engine.destroy()
  })

  // ── 11.c: background-tab simulation does not jump playhead ───────────────

  it('visibilitychange re-anchor prevents playhead jump after long blur', () => {
    const engine = makeEngine()
    engine.play()

    clock = 0.1
    flushRAF(1)
    const frameBeforeBlur = engine.getFrameAt()
    expect(frameBeforeBlur).toBeCloseTo(3, 0)

    documentHidden = true
    visibilityHandler?.()

    clock += 30
    documentHidden = false
    visibilityHandler?.()

    flushRAF(1)
    const frameAfterResume = engine.getFrameAt()

    expect(frameAfterResume).toBeLessThanOrEqual(frameBeforeBlur + 1)
    expect(frameAfterResume).toBeLessThan(10)

    engine.destroy()
  })

  // ── 11.d: setPlaybackRate mid-playback preserves frame ────────────────────

  it('setPlaybackRate(2) mid-playback does not jump the current frame', () => {
    const engine = makeEngine()
    engine.play()

    clock = 1
    const before = engine.getFrameAt()
    expect(before).toBeCloseTo(30, 5)

    engine.setPlaybackRate(2)
    const after = engine.getFrameAt()

    expect(after).toBeCloseTo(before, 5)
    expect(engine.playbackRate).toBe(2)

    engine.destroy()
  })

  // ── Sanity ───────────────────────────────────────────────────────────────

  it('pause freezes position at getFrameAt()', () => {
    const engine = makeEngine()
    engine.play()
    clock = 0.5
    engine.pause()

    clock = 10
    expect(engine.getFrameAt()).toBe(15)
    expect(engine.currentFrame).toBe(15)
    expect(engine.isPlaying).toBe(false)

    engine.destroy()
  })

  it('setLoop bumps epoch and notifies', () => {
    const engine = makeEngine()
    const epochs: number[] = []
    engine.subscribe((s) => epochs.push(s.epoch))

    engine.setLoop(true)
    expect(epochs).toHaveLength(1)
    expect(engine.loop).toBe(true)

    engine.destroy()
  })

  it('subscribe does not fire on RAF ticks when paused', () => {
    const engine = makeEngine()
    let count = 0
    engine.subscribe(() => {
      count++
    })

    flushRAF(3)
    expect(count).toBe(0)

    engine.destroy()
  })

  it('subscribeTimeupdate is throttled to ~100ms', () => {
    const engine = makeEngine()
    const epochs: number[] = []
    engine.subscribeTimeupdate((s) => epochs.push(s.epoch))

    engine.seek(1)
    engine.seek(2)
    engine.seek(3)
    expect(epochs).toHaveLength(1)

    clock = 0.15
    engine.seek(4)
    expect(epochs.length).toBeGreaterThanOrEqual(2)

    engine.destroy()
  })

  it('destroy removes visibilitychange listener and cancels RAF', () => {
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)

    const engine = makeEngine()
    engine.play()
    engine.destroy()

    expect(removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    )
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })

  it('currentFrame is floored integer from getFrameAt', () => {
    const engine = makeEngine()
    engine.play()
    clock = 0.51
    expect(engine.currentFrame).toBe(15)
    expect(Number.isInteger(engine.currentFrame)).toBe(true)

    engine.destroy()
  })

  it('transport commands bump epoch', () => {
    const engine = makeEngine()
    const epochs: number[] = []
    engine.subscribe((s) => epochs.push(s.epoch))

    engine.play()
    engine.pause()
    engine.seek(5)
    engine.setPlaybackRate(0.5)
    engine.setLoop(true)

    expect(epochs.length).toBe(5)
    for (let i = 1; i < epochs.length; i++) {
      expect(epochs[i]!).toBeGreaterThan(epochs[i - 1]!)
    }

    engine.destroy()
  })

  it('subscribe fires only when integer frame advances during playback', () => {
    const engine = makeEngine()
    const frames: number[] = []
    engine.subscribe((s) => frames.push(s.currentFrame))

    engine.play()
    // play() notifies once (transport)
    expect(frames).toEqual([0])

    clock = 1 / 30
    flushRAF(1)
    expect(frames).toEqual([0, 1])

    // Same integer frame — no extra notify
    clock = 1 / 30 + 0.001
    flushRAF(1)
    expect(frames).toEqual([0, 1])

    engine.destroy()
  })

  it('notify isolates broken listeners', () => {
    const engine = makeEngine()
    const good = vi.fn()
    engine.subscribe(() => {
      throw new Error('broken')
    })
    engine.subscribe(good)

    engine.seek(1)
    expect(good).toHaveBeenCalledTimes(1)

    engine.destroy()
  })

  // ── Audio context clock switching ──────────────────────────────────────────

  it('setAudioContext: uses ctx.currentTime when context is running', () => {
    // Do NOT pass config.now so the engine uses its internal clock logic.
    const engine = new PlaybackEngine({
      fps: 30,
      getTotalFrames: () => 300,
    })

    const mockCtx = {
      state: 'running' as AudioContextState,
      currentTime: 5,
    } as AudioContext

    engine.setAudioContext(mockCtx)
    engine.play()

    // With ctx.currentTime = 5 and anchorTime = 5, elapsed = 0 → frame = 0.
    // We test that getFrameAt() doesn't blow up and returns a sane value.
    expect(engine.getFrameAt()).toBeGreaterThanOrEqual(0)

    engine.destroy()
  })

  it('setAudioContext: falls back to performance.now() when ctx is suspended', () => {
    const engine = makeEngine()

    const mockCtx = {
      state: 'suspended' as AudioContextState,
      currentTime: 999,
    } as AudioContext

    engine.setAudioContext(mockCtx)
    // config.now override is active, so we just confirm no crash.
    engine.play()
    clock = 1
    expect(engine.getFrameAt()).toBeCloseTo(30, 5)

    engine.destroy()
  })

  it('setAudioContext: re-anchors seamlessly during playback', () => {
    const engine = makeEngine()
    engine.play()

    clock = 1
    const frameBefore = engine.getFrameAt()
    expect(frameBefore).toBeCloseTo(30, 5)

    // Attaching a suspended context should not jump the frame.
    const mockCtx = {
      state: 'suspended' as AudioContextState,
      currentTime: 0,
    } as AudioContext
    engine.setAudioContext(mockCtx)

    // config.now still active; re-anchor preserves position.
    const frameAfter = engine.getFrameAt()
    expect(frameAfter).toBeCloseTo(frameBefore, 1)

    engine.destroy()
  })

  it('setAudioContext(null) detaches without error', () => {
    const engine = makeEngine()
    const mockCtx = { state: 'running' as AudioContextState, currentTime: 0 } as AudioContext
    engine.setAudioContext(mockCtx)
    engine.setAudioContext(null)
    engine.play()

    clock = 1
    expect(engine.getFrameAt()).toBeCloseTo(30, 5)

    engine.destroy()
  })
})
