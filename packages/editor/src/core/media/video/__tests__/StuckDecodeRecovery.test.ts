import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DecoderBackedVideoFrameProvider } from '../DecoderBackedVideoFrameProvider'
import { GpuDebugCounters } from '../../../renderer/gpu/debug/GpuDebugCounters'
import {
  createMockChunk,
  createMockDecoder,
  createMockDemuxerBackend,
} from './helpers/mockDemuxer'

/** Demuxer whose packets() async-generator never completes (simulates stuck getNextPacket). */
function createHangingDemuxerBackend() {
  const backend = createMockDemuxerBackend({ chunks: [createMockChunk(0)] })
  vi.mocked(backend.packets).mockImplementation(async function* () {
    await new Promise<never>(() => {})
  })
  return backend
}

function lastRequested(provider: DecoderBackedVideoFrameProvider): number | null {
  return (provider as unknown as { _lastRequested: number | null })._lastRequested
}

describe('StuckDecodeRecovery', () => {
  beforeEach(() => {
    GpuDebugCounters.reset()
  })

  afterEach(() => {
    GpuDebugCounters.reset()
    vi.useRealTimers()
  })

  it('scrub-recovery: discontinuity bypasses pendingFull and cancels stuck slots', async () => {
    const demuxerBackend = createHangingDemuxerBackend()
    const provider = new DecoderBackedVideoFrameProvider({
      src: 'video://test.mp4',
      fps: 30,
      maxOutstanding: 4,
      decodeTimeoutMs: 0,
      demuxerFactory: () => demuxerBackend,
      decoderFactory: () => createMockDecoder(),
    })
    await provider.openPromise

    provider.requestFrame(0)
    provider.requestFrame(1)
    provider.requestFrame(2)
    provider.requestFrame(3)
    expect(provider.pendingCount).toBe(4)

    provider.requestFrame(100)

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(provider.pendingCount).toBe(1)
    expect(lastRequested(provider)).toBe(100)
    expect(GpuDebugCounters.droppedFrames).toBe(0)

    provider.dispose()
  })

  it('watchdog: decode timeout drains stuck pending slots without a scrub', async () => {
    vi.useFakeTimers()
    const demuxerBackend = createHangingDemuxerBackend()
    const provider = new DecoderBackedVideoFrameProvider({
      src: 'video://test.mp4',
      fps: 30,
      maxOutstanding: 4,
      decodeTimeoutMs: 25,
      demuxerFactory: () => demuxerBackend,
      decoderFactory: () => createMockDecoder(),
    })
    await provider.openPromise

    provider.requestFrame(0)
    provider.requestFrame(1)
    provider.requestFrame(2)
    provider.requestFrame(3)
    expect(provider.pendingCount).toBe(4)

    await vi.advanceTimersByTimeAsync(150)

    expect(provider.pendingCount).toBe(0)
    expect(GpuDebugCounters.droppedFrames).toBe(4)
    expect(provider.decoderState).toBe('Ready')

    provider.requestFrame(4)
    expect(provider.pendingCount).toBe(1)

    provider.dispose()
  })
})
