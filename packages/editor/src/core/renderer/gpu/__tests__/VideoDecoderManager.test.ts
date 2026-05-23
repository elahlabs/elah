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
})
