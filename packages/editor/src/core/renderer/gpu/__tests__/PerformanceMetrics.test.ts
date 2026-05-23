import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FrameCache } from '../FrameCache'
import { MockVideoFrameProvider } from '../VideoFrameProvider'
import { GpuDebugCounters } from '../debug/GpuDebugCounters'
import {
  installGpuDebugGlobal,
  uninstallGpuDebugGlobal,
  type GpuDebugState,
} from '../debug/GpuDebugGlobal'

describe('Performance instrumentation', () => {
  beforeEach(() => {
    GpuDebugCounters.reset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    uninstallGpuDebugGlobal()
  })

  it('GpuDebugCounters.reset() zeroes all fields', () => {
    GpuDebugCounters.activeVideoFrames = 5
    GpuDebugCounters.closedVideoFrames = 3
    GpuDebugCounters.cacheSize = 2
    GpuDebugCounters.decoderCount = 1
    GpuDebugCounters.pendingDecodeRequests = 4
    GpuDebugCounters.cacheHits = 10
    GpuDebugCounters.cacheMisses = 5
    GpuDebugCounters.decodeLatencyMs = [1, 2, 3]
    GpuDebugCounters.frameUploadTimingsMs = [4, 5]

    GpuDebugCounters.reset()

    const snap = GpuDebugCounters.snapshot()
    expect(snap.activeVideoFrames).toBe(0)
    expect(snap.closedVideoFrames).toBe(0)
    expect(snap.cacheSize).toBe(0)
    expect(snap.decoderCount).toBe(0)
    expect(snap.pendingDecodeRequests).toBe(0)
    expect(snap.cacheHits).toBe(0)
    expect(snap.cacheMisses).toBe(0)
    expect(snap.decodeLatencySampleCount).toBe(0)
    expect(snap.frameUploadSampleCount).toBe(0)
  })

  it('FrameCache hooks track cache size via counters', () => {
    const cache = new FrameCache({
      maxFrames: 3,
      hooks: {
        onPut: () => { GpuDebugCounters.cacheSize++ },
        onEvict: () => { GpuDebugCounters.cacheSize-- },
        onClear: () => { GpuDebugCounters.cacheSize = 0 },
      },
    })

    cache.put(0, mockFrame())
    cache.put(1, mockFrame())
    expect(GpuDebugCounters.cacheSize).toBe(2)

    cache.put(2, mockFrame())
    cache.put(3, mockFrame())
    expect(GpuDebugCounters.cacheSize).toBe(3)

    cache.clear()
    expect(GpuDebugCounters.cacheSize).toBe(0)
  })

  it('MetricsHook tracks cache hit ratio', () => {
    const provider = new MockVideoFrameProvider({
      metrics: {
        onHit: () => { GpuDebugCounters.cacheHits++ },
        onMiss: () => { GpuDebugCounters.cacheMisses++ },
      },
    })

    provider.requestFrame(1)
    vi.runAllTimers()

    provider.getCurrent(1)
    provider.getCurrent(1)
    provider.getCurrent(99)

    const snap = GpuDebugCounters.snapshot()
    expect(snap.cacheHits).toBe(2)
    expect(snap.cacheMisses).toBe(1)
    expect(snap.cacheHitRatio).toBeCloseTo(2 / 3)
  })

  it('onDecodeLatency accumulates decode latency samples', () => {
    const provider = new MockVideoFrameProvider({
      metrics: {
        onDecodeLatency: (_frame, ms) => {
          GpuDebugCounters.recordDecodeLatency(ms)
        },
      },
    })

    provider.requestFrame(0)
    vi.runAllTimers()

    const snap = GpuDebugCounters.snapshot()
    expect(snap.decodeLatencySampleCount).toBe(1)
    expect(snap.avgDecodeLatencyMs).toBeGreaterThanOrEqual(0)
  })

  it('recordFrameUpload accumulates upload timings with bounded samples', () => {
    for (let i = 0; i < 300; i++) {
      GpuDebugCounters.recordFrameUpload(i)
    }

    expect(GpuDebugCounters.frameUploadTimingsMs.length).toBeLessThanOrEqual(256)
    expect(GpuDebugCounters.snapshot().frameUploadSampleCount).toBe(256)
  })

  it('snapshot serializes cleanly to JSON', () => {
    GpuDebugCounters.cacheHits = 8
    GpuDebugCounters.cacheMisses = 2
    GpuDebugCounters.recordDecodeLatency(12.5)

    const json = JSON.stringify(GpuDebugCounters.snapshot())
    const parsed = JSON.parse(json)

    expect(parsed.cacheHitRatio).toBeCloseTo(0.8)
    expect(parsed.avgDecodeLatencyMs).toBe(12.5)
    expect(parsed).not.toHaveProperty('circular')
  })

  it('installGpuDebugGlobal exposes state via getter', () => {
    const getState = (): GpuDebugState => ({
      decoderStates: { 'video://a': 'Ready' },
      cacheSizes: { 'video://a': 5 },
      textureCount: 2,
      activeClipIds: ['clip-1'],
      counters: GpuDebugCounters.snapshot(),
    })

    const mockWindow = { __GPU_DEBUG__: undefined as GpuDebugState | undefined }
    vi.stubGlobal('window', mockWindow)

    installGpuDebugGlobal(getState)

    expect(mockWindow.__GPU_DEBUG__).toEqual(getState())
    expect(mockWindow.__GPU_DEBUG__!.decoderStates['video://a']).toBe('Ready')
    expect(mockWindow.__GPU_DEBUG__!.counters.cacheHits).toBe(0)

    vi.unstubAllGlobals()
  })

  it('installGpuDebugGlobal is no-op without window', () => {
    vi.stubGlobal('window', undefined)
    expect(() => installGpuDebugGlobal(() => ({
      decoderStates: {},
      cacheSizes: {},
      textureCount: 0,
      activeClipIds: [],
      counters: GpuDebugCounters.snapshot(),
    }))).not.toThrow()
    vi.unstubAllGlobals()
  })
})

function mockFrame(): VideoFrame {
  return {
    displayWidth: 640,
    displayHeight: 360,
    close: () => {},
  } as unknown as VideoFrame
}
