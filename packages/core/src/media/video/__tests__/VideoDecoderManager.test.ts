import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoDecoderManager } from '../VideoDecoderManager'
import {
  createMockChunk,
  createMockDecoder,
  createMockDemuxerBackend,
} from './helpers/mockDemuxer'

describe('VideoDecoderManager lifecycle', () => {
  let demuxerBackend: ReturnType<typeof createMockDemuxerBackend>
  let decoderMock: ReturnType<typeof createMockDecoder>

  beforeEach(() => {
    vi.useFakeTimers()
    demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk()],
    })
    decoderMock = createMockDecoder()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createManager(overrides: Partial<ConstructorParameters<typeof VideoDecoderManager>[0]> = {}) {
    return new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: decoderMock.factory,
      idleTimeoutMs: 1000,
      ...overrides,
    })
  }

  it('transitions Idle → Opening → Ready on open()', async () => {
    const states: string[] = []
    const manager = createManager({
      onStateChange: (state) => states.push(state),
    })

    expect(manager.state).toBe('Idle')

    const openPromise = manager.open('video://test')
    expect(manager.state).toBe('Opening')
    await openPromise

    expect(manager.state).toBe('Ready')
    expect(states).toEqual(['Opening', 'Ready'])
    expect(manager.src).toBe('video://test')
    expect(demuxerBackend.open).toHaveBeenCalledWith('video://test')
    expect(decoderMock.lastDecoder.configure).toHaveBeenCalled()
  })

  it('transitions Ready → Resetting → Ready on reset()', async () => {
    const states: string[] = []
    const manager = createManager({
      onStateChange: (state) => states.push(state),
    })

    await manager.open('video://test')
    states.length = 0

    await manager.reset(0)

    expect(manager.state).toBe('Ready')
    expect(states).toEqual(['Resetting', 'Ready'])
    expect(demuxerBackend.seekToKeyframe).toHaveBeenCalled()
  })

  it('transitions Ready → Draining → Idle on drain()', async () => {
    const manager = createManager()
    await manager.open('video://test')

    await manager.drain()

    expect(manager.state).toBe('Idle')
    expect(decoderMock.lastDecoder.flush).toHaveBeenCalled()
    expect(decoderMock.lastDecoder.close).toHaveBeenCalled()
    expect(demuxerBackend.dispose).toHaveBeenCalled()
  })

  it('dispose() fully cleans resources', async () => {
    const manager = createManager()
    await manager.open('video://test')
    manager.dispose()

    expect(manager.state).toBe('Disposed')
    expect(decoderMock.lastDecoder.close).toHaveBeenCalled()
    expect(demuxerBackend.dispose).toHaveBeenCalled()
    expect(manager.src).toBeNull()
  })

  it('dispose() is idempotent', async () => {
    const manager = createManager()
    await manager.open('video://test')

    manager.dispose()
    manager.dispose()

    expect(manager.state).toBe('Disposed')
    expect(decoderMock.lastDecoder.close).toHaveBeenCalledTimes(1)
  })

  it('idle timer cleanup works via markIdle/markActive', async () => {
    const idleFn = vi.fn()
    const manager = createManager()
    await manager.open('video://test')
    manager.setIdleCallback(idleFn)

    manager.markIdle()
    vi.advanceTimersByTime(1000)
    expect(idleFn).toHaveBeenCalledTimes(1)

    manager.markActive()
    vi.advanceTimersByTime(2000)
    expect(idleFn).toHaveBeenCalledTimes(1)
  })

  it('reopen() from Idle transitions safely through Opening → Ready', async () => {
    const manager = createManager()
    await manager.open('video://first')
    await manager.drain()

    expect(manager.state).toBe('Idle')

    await manager.reopen('video://second')

    expect(manager.state).toBe('Ready')
    expect(manager.src).toBe('video://second')
  })

  it('reopen() from Errored recovers to Ready', async () => {
    demuxerBackend = createMockDemuxerBackend({
      openError: new Error('broken source'),
    })
    const manager = createManager()

    await expect(manager.open('video://broken')).rejects.toThrow('broken source')
    expect(manager.state).toBe('Errored')

    demuxerBackend = createMockDemuxerBackend({ chunks: [createMockChunk()] })
    await manager.reopen('video://fixed')

    expect(manager.state).toBe('Ready')
  })

  it('transitions to Errored on decoder configure failure', async () => {
    const errorDecoder = createMockDecoder({
      configureError: new Error('invalid codec'),
    })
    const onError = vi.fn()
    const manager = new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: errorDecoder.factory,
      onError,
    })

    await expect(manager.open('video://bad-codec')).rejects.toThrow('invalid codec')

    expect(manager.state).toBe('Errored')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'invalid codec' }))
  })

  it('transitions to Errored on packet stream failure during feed()', async () => {
    demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk()],
      packetsError: new Error('packet stream failed'),
    })
    const onError = vi.fn()
    const manager = createManager({ onError })
    await manager.open('video://test')

    manager.feed([0, 33333])
    // Flush microtask queue so the async feed loop surfaces the error
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(manager.state).toBe('Errored')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'packet stream failed' }))
  })

  it('dispose() from Errored state cleans up safely', async () => {
    const errorDecoder = createMockDecoder({ configureError: new Error('fail') })
    const manager = new VideoDecoderManager({
      demuxerFactory: () => createMockDemuxerBackend(),
      decoderFactory: errorDecoder.factory,
    })

    await expect(manager.open('video://fail')).rejects.toThrow()
    manager.dispose()
    expect(manager.state).toBe('Disposed')
  })

  it('fps getter reflects configured fps', () => {
    const manager = createManager({ fps: 24 })
    expect(manager.fps).toBe(24)
  })

  it('onStateChange is invoked on every state transition', async () => {
    const transitions: string[] = []
    const manager = createManager({ onStateChange: (s) => transitions.push(s) })

    await manager.open('video://test')
    await manager.reset(0)
    await manager.drain()

    expect(transitions).toEqual(['Opening', 'Ready', 'Resetting', 'Ready', 'Draining', 'Idle'])
  })

  it('onDroppedFrame is invoked on feed() packet stream failure', async () => {
    demuxerBackend = createMockDemuxerBackend({
      packetsError: new Error('corrupted packet'),
    })
    const dropped: number[] = []
    const manager = createManager({ onDroppedFrame: (f) => dropped.push(f) })
    await manager.open('video://test')

    manager.feed([0, 33333])
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(dropped.length).toBeGreaterThan(0)
  })

  it('drain() awaits flush and transitions to Idle', async () => {
    const manager = createManager()
    await manager.open('video://test')

    await manager.drain()

    expect(decoderMock.lastDecoder.flush).toHaveBeenCalledTimes(1)
    expect(manager.state).toBe('Idle')
  })
})

describe('VideoDecoderManager — feed/reset API', () => {
  let demuxerBackend: ReturnType<typeof createMockDemuxerBackend>
  let decoderMock: ReturnType<typeof createMockDecoder>

  beforeEach(() => {
    demuxerBackend = createMockDemuxerBackend({ chunks: [createMockChunk(0)] })
    decoderMock = createMockDecoder()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createManager(
    overrides: Partial<ConstructorParameters<typeof VideoDecoderManager>[0]> = {},
  ) {
    return new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: decoderMock.factory,
      fps: 30,
      ...overrides,
    })
  }

  it('reset() calls seekToKeyframe, decoder.reset, and decoder.configure', async () => {
    const manager = createManager()
    await manager.open('video://test')

    vi.mocked(demuxerBackend.seekToKeyframe).mockClear()
    vi.mocked(decoderMock.lastDecoder.reset).mockClear()
    vi.mocked(decoderMock.lastDecoder.configure).mockClear()

    await manager.reset(0)

    expect(demuxerBackend.seekToKeyframe).toHaveBeenCalledTimes(1)
    expect(decoderMock.lastDecoder.reset).toHaveBeenCalledTimes(1)
    expect(decoderMock.lastDecoder.configure).toHaveBeenCalledTimes(1)
  })

  it('reset() calls seekToKeyframe with the provided microsecond timestamp', async () => {
    const manager = createManager()
    await manager.open('video://test')

    await manager.reset(500_000)

    expect(demuxerBackend.seekToKeyframe).toHaveBeenCalledWith(500_000)
  })

  it('feed() calls demuxer.packets with the provided time range', async () => {
    const manager = createManager()
    await manager.open('video://test')
    await manager.reset(0)

    vi.mocked(demuxerBackend.packets).mockClear()

    manager.feed([0, 33333])
    await Promise.resolve()
    await Promise.resolve()

    expect(demuxerBackend.packets).toHaveBeenCalledWith([0, 33333])
  })

  it('feed() calls decoder.decode for each packet', async () => {
    const chunk0 = createMockChunk(0)
    const chunk1 = createMockChunk(33333)
    demuxerBackend = createMockDemuxerBackend({ chunks: [chunk0, chunk1] })
    const manager = createManager()
    await manager.open('video://test')
    await manager.reset(0)

    vi.mocked(decoderMock.lastDecoder.decode).mockClear()

    manager.feed([0, 66666])
    // Each async generator yield consumes ~2 microtask cycles; flush enough for both chunks
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(decoderMock.lastDecoder.decode).toHaveBeenCalledWith(chunk0)
    expect(decoderMock.lastDecoder.decode).toHaveBeenCalledWith(chunk1)
  })

  it('feed() does NOT call decoder.flush on the contiguous path', async () => {
    const manager = createManager()
    await manager.open('video://test')
    await manager.reset(0)

    vi.mocked(decoderMock.lastDecoder.flush).mockClear()

    manager.feed([0, 33333])
    manager.feed([33333, 66666])
    await Promise.resolve()
    await Promise.resolve()

    expect(decoderMock.lastDecoder.flush).not.toHaveBeenCalled()
  })

  it('onFrame receives frame with correct sourceFrameIdx (fps=30, usPerFrame=33333)', async () => {
    const receivedFrames: Array<{ idx: number }> = []
    const chunk = createMockChunk(33333)  // frame 1 at 30fps
    demuxerBackend = createMockDemuxerBackend({ chunks: [chunk] })

    const manager = createManager({ fps: 30 })
    manager.onFrame = (frame, idx) => {
      receivedFrames.push({ idx })
      frame.close()
    }

    await manager.open('video://test')
    await manager.reset(0)
    manager.feed([0, 66666])
    await Promise.resolve()
    await Promise.resolve()

    expect(receivedFrames).toHaveLength(1)
    expect(receivedFrames[0].idx).toBe(1)  // Math.round(33333 / 33333) = 1
  })

  it('reset() increments generation, causing in-progress feed to abandon packet delivery', async () => {
    const pending: { resolve: (() => void) | null } = { resolve: null }
    const slowDemuxerBackend = {
      ...demuxerBackend,
      packets: vi.fn(async function* (_range: [number, number]) {
        yield createMockChunk(0)
        await new Promise<void>(r => { pending.resolve = r as () => void })
        yield createMockChunk(33333)
      }),
    }

    const manager = new VideoDecoderManager({
      demuxerFactory: () => slowDemuxerBackend,
      decoderFactory: decoderMock.factory,
      fps: 30,
    })
    await manager.open('video://test')
    await manager.reset(0)

    vi.mocked(decoderMock.lastDecoder.decode).mockClear()

    manager.feed([0, 66666])
    await Promise.resolve()
    await Promise.resolve()

    expect(decoderMock.lastDecoder.decode).toHaveBeenCalledTimes(1)

    await manager.reset(33333)

    vi.mocked(decoderMock.lastDecoder.decode).mockClear()
    pending.resolve?.()
    await Promise.resolve()
    await Promise.resolve()

    // Stale feed must NOT deliver the second packet after reset.
    expect(decoderMock.lastDecoder.decode).not.toHaveBeenCalled()
  })

  it('reopen() increments generation, so a stale feed cannot poison the fresh decoder', async () => {
    // Regression: an EncodingError → reopen() while a feed loop is parked in an
    // await used to let that stale loop wake up and decode() a mid-stream delta
    // packet against the freshly-configured decoder, throwing again → reopen
    // loop. reopen() must bump the feed generation so the stale loop exits.
    const pending: { resolve: (() => void) | null } = { resolve: null }
    const slowDemuxerBackend = {
      ...demuxerBackend,
      packets: vi.fn(async function* (_range: [number, number]) {
        yield createMockChunk(0)
        await new Promise<void>(r => { pending.resolve = r as () => void })
        yield createMockChunk(33333)
      }),
    }

    const manager = new VideoDecoderManager({
      demuxerFactory: () => slowDemuxerBackend,
      decoderFactory: decoderMock.factory,
      fps: 30,
    })
    await manager.open('video://test')

    manager.feed([0, 66666])
    await Promise.resolve()
    await Promise.resolve()

    // First packet fed; loop now parked on the pending promise.
    expect(decoderMock.lastDecoder.decode).toHaveBeenCalledTimes(1)

    // Simulate error-recovery reopen: drain to Idle, then reopen builds a fresh
    // decoder + demuxer. (reopen from Errored follows the same generation-bump
    // path; draining first keeps the mock demuxer generator simple.)
    await manager.drain()
    await manager.reopen('video://recovered')
    expect(manager.state).toBe('Ready')

    // The reopen created a fresh decoder — clear its call count.
    vi.mocked(decoderMock.lastDecoder.decode).mockClear()

    // Wake the stale feed loop. Its captured gen is now behind, so it must exit
    // WITHOUT feeding the second (stale, mid-stream) packet to the new decoder.
    pending.resolve?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(decoderMock.lastDecoder.decode).not.toHaveBeenCalled()
  })

  it('feed() is a no-op when state is not Ready', async () => {
    const manager = createManager()
    await manager.open('video://test')
    manager.dispose()

    vi.mocked(demuxerBackend.packets).mockClear()
    manager.feed([0, 33333])
    await Promise.resolve()
    await Promise.resolve()

    expect(demuxerBackend.packets).not.toHaveBeenCalled()
  })

  it('drain() after reset leaves manager Idle', async () => {
    const manager = createManager()
    await manager.open('video://test')
    await manager.reset(0)
    await manager.drain()

    expect(manager.state).toBe('Idle')
    expect(decoderMock.lastDecoder.flush).toHaveBeenCalled()
  })
})
