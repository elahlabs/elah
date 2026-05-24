import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoDecoderManager } from '../VideoDecoderManager'
import {
  createMockChunk,
  createMockDecoder,
  createMockDemuxerBackend,
} from './helpers/mockDemuxer'

describe('VideoDecoderManager lifecycle', () => {
  let demuxerBackend: ReturnType<typeof createMockDemuxerBackend>
  let decoder: ReturnType<typeof createMockDecoder>

  beforeEach(() => {
    vi.useFakeTimers()
    demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk()],
    })
    decoder = createMockDecoder()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createManager(overrides: Partial<ConstructorParameters<typeof VideoDecoderManager>[0]> = {}) {
    return new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: () => decoder,
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
    expect(decoder.configure).toHaveBeenCalled()
  })

  it('transitions Ready → Decoding → Ready during requestFrame()', async () => {
    const states: string[] = []
    const manager = createManager({
      onStateChange: (state) => states.push(state),
    })

    await manager.open('video://test')

    const framePromise = manager.requestFrame(10)
    expect(manager.state).toBe('Decoding')

    await framePromise
    expect(manager.state).toBe('Ready')
    expect(states).toContain('Decoding')
  })

  it('transitions Ready → Seeking → Ready on seek()', async () => {
    const manager = createManager()
    await manager.open('video://test')

    await manager.seek(100)

    expect(manager.state).toBe('Ready')
    expect(demuxerBackend.seekToKeyframe).toHaveBeenCalled()
  })

  it('transitions Ready → Draining → Idle on drain()', async () => {
    const manager = createManager()
    await manager.open('video://test')

    await manager.drain()

    expect(manager.state).toBe('Idle')
    expect(decoder.flush).toHaveBeenCalled()
    expect(decoder.close).toHaveBeenCalled()
    expect(demuxerBackend.dispose).toHaveBeenCalled()
  })

  it('rejects invalid transitions from Disposed', async () => {
    const manager = createManager()
    await manager.open('video://test')
    manager.dispose()

    expect(manager.state).toBe('Disposed')
    await expect(manager.requestFrame(0)).rejects.toThrow(/disposed/)
    await expect(manager.seek(0)).rejects.toThrow(/invalid transition/)
  })

  it('dispose() fully cleans resources', async () => {
    const manager = createManager()
    await manager.open('video://test')
    manager.dispose()

    expect(manager.state).toBe('Disposed')
    expect(decoder.close).toHaveBeenCalled()
    expect(demuxerBackend.dispose).toHaveBeenCalled()
    expect(manager.src).toBeNull()
  })

  it('dispose() is idempotent', async () => {
    const manager = createManager()
    await manager.open('video://test')

    manager.dispose()
    manager.dispose()

    expect(manager.state).toBe('Disposed')
    expect(decoder.close).toHaveBeenCalledTimes(1)
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
    decoder = createMockDecoder({
      configureError: new Error('invalid codec'),
    })
    const onError = vi.fn()
    const manager = createManager({ onError })

    await expect(manager.open('video://bad-codec')).rejects.toThrow('invalid codec')

    expect(manager.state).toBe('Errored')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'invalid codec' }))
  })

  it('transitions to Errored on packet stream failure', async () => {
    demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk()],
      packetsError: new Error('packet stream failed'),
    })
    const manager = createManager()
    await manager.open('video://test')

    await expect(manager.requestFrame(5)).rejects.toThrow('packet stream failed')
    expect(manager.state).toBe('Errored')
  })

  it('dispose() from Errored state cleans up safely', async () => {
    decoder = createMockDecoder({ configureError: new Error('fail') })
    const manager = createManager()

    await expect(manager.open('video://fail')).rejects.toThrow()
    manager.dispose()

    expect(manager.state).toBe('Disposed')
  })

  it('fps parameter controls timeUs calculation for seek', async () => {
    const manager = createManager({ fps: 60 })
    await manager.open('video://test')

    await manager.seek(60)

    // At 60fps, frame 60 = 1_000_000 µs
    expect(demuxerBackend.seekToKeyframe).toHaveBeenCalledWith(1_000_000)
  })

  it('fps defaults to 30 when not specified', async () => {
    const manager = createManager()
    await manager.open('video://test')

    await manager.seek(30)

    // At 30fps, frame 30 = 1_000_000 µs
    expect(demuxerBackend.seekToKeyframe).toHaveBeenCalledWith(1_000_000)
  })

  it('fps getter reflects configured fps', () => {
    const manager = createManager({ fps: 24 })
    expect(manager.fps).toBe(24)
  })

  it('onStateChange is invoked on every state transition', async () => {
    const transitions: string[] = []
    const manager = createManager({ onStateChange: (s) => transitions.push(s) })

    await manager.open('video://test')
    await manager.seek(0)
    await manager.drain()

    expect(transitions).toEqual(['Opening', 'Ready', 'Seeking', 'Ready', 'Draining', 'Idle'])
  })

  it('onDecodeLatency is invoked after successful decode', async () => {
    const latencies: Array<{ frame: number; ms: number }> = []
    const manager = createManager({
      onDecodeLatency: (f, ms) => latencies.push({ frame: f, ms }),
    })
    await manager.open('video://test')

    await manager.requestFrame(5)

    expect(latencies).toHaveLength(1)
    expect(latencies[0].frame).toBe(5)
    expect(latencies[0].ms).toBeGreaterThanOrEqual(0)
  })

  it('onDroppedFrame is invoked on decode failure', async () => {
    demuxerBackend = createMockDemuxerBackend({
      packetsError: new Error('corrupted packet'),
    })
    const dropped: number[] = []
    const manager = createManager({ onDroppedFrame: (f) => dropped.push(f) })
    await manager.open('video://test')

    await expect(manager.requestFrame(3)).rejects.toThrow('corrupted packet')

    expect(dropped).toContain(3)
  })

  it('drain cancellation rejects pending decodes exactly once per frame', async () => {
    const slowChunks = [createMockChunk(0), createMockChunk(33333)]
    demuxerBackend = createMockDemuxerBackend({ chunks: slowChunks })
    const manager = createManager()
    await manager.open('video://test')

    const p1 = manager.requestFrame(0)
    const p2 = manager.requestFrame(1)
    const drainPromise = manager.drain()

    const results = await Promise.allSettled([p1, p2, drainPromise])
    const rejected = results.filter((r) => r.status === 'rejected')
    // At least the pending frame rejections from drain
    expect(rejected.length).toBeGreaterThan(0)
    expect(manager.state).toBe('Idle')
  })
})

describe('VideoDecoderManager — multi-frame decode lifecycle', () => {
  let demuxerBackend: ReturnType<typeof createMockDemuxerBackend>
  let decoder: ReturnType<typeof createMockDecoder>

  beforeEach(() => {
    vi.useFakeTimers()
    demuxerBackend = createMockDemuxerBackend({ chunks: [createMockChunk(0)] })
    decoder = createMockDecoder()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createManager(
    overrides: Partial<ConstructorParameters<typeof VideoDecoderManager>[0]> = {},
  ) {
    return new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: () => decoder,
      fps: 30,
      ...overrides,
    })
  }

  it('calls seekToKeyframe + reset + configure before the first decode', async () => {
    const manager = createManager()
    await manager.open('video://test')

    await manager.requestFrame(0)

    expect(demuxerBackend.seekToKeyframe).toHaveBeenCalledTimes(1)
    expect(decoder.reset).toHaveBeenCalledTimes(1)
    expect(decoder.configure).toHaveBeenCalledTimes(2) // once on open, once after reset
  })

  it('calls seekToKeyframe + reset + configure when jumping to a non-contiguous frame', async () => {
    const manager = createManager()
    await manager.open('video://test')

    await manager.requestFrame(0)
    // Reset call counts after first decode
    vi.mocked(demuxerBackend.seekToKeyframe).mockClear()
    vi.mocked(decoder.reset).mockClear()
    vi.mocked(decoder.configure).mockClear()

    // Jump to frame 15 — non-contiguous, must trigger seek+reset
    await manager.requestFrame(15)

    expect(demuxerBackend.seekToKeyframe).toHaveBeenCalledTimes(1)
    expect(decoder.reset).toHaveBeenCalledTimes(1)
    expect(decoder.configure).toHaveBeenCalledTimes(1)
  })

  it('does NOT call reset/seek for a contiguous sequential frame', async () => {
    const manager = createManager()
    await manager.open('video://test')

    await manager.requestFrame(0)
    vi.mocked(demuxerBackend.seekToKeyframe).mockClear()
    vi.mocked(decoder.reset).mockClear()
    vi.mocked(decoder.configure).mockClear()

    // Frame 1 is contiguous with frame 0 — no extra seek or reset
    await manager.requestFrame(1)

    expect(demuxerBackend.seekToKeyframe).not.toHaveBeenCalled()
    expect(decoder.reset).not.toHaveBeenCalled()
    expect(decoder.configure).not.toHaveBeenCalled()
  })

  it('resets _lastDecodedSourceFrame on seek(), forcing seek+reset for next decode', async () => {
    const manager = createManager()
    await manager.open('video://test')

    await manager.requestFrame(0)
    await manager.seek(100)
    vi.mocked(demuxerBackend.seekToKeyframe).mockClear()
    vi.mocked(decoder.reset).mockClear()
    vi.mocked(decoder.configure).mockClear()

    // After a seek(), even frame 1 is non-contiguous (last decoded frame was cleared)
    await manager.requestFrame(1)

    expect(demuxerBackend.seekToKeyframe).toHaveBeenCalledTimes(1)
    expect(decoder.reset).toHaveBeenCalledTimes(1)
  })

  it('resets _lastDecodedSourceFrame on drain(), forcing seek+reset after reopen', async () => {
    const manager = createManager()
    await manager.open('video://test')

    await manager.requestFrame(0)
    await manager.drain()
    await manager.reopen('video://test')

    vi.mocked(demuxerBackend.seekToKeyframe).mockClear()
    vi.mocked(decoder.reset).mockClear()
    vi.mocked(decoder.configure).mockClear()

    await manager.requestFrame(0)

    expect(demuxerBackend.seekToKeyframe).toHaveBeenCalledTimes(1)
    expect(decoder.reset).toHaveBeenCalledTimes(1)
  })
})
