/**
 * VideoFrameProvider — push-based frame access abstraction.
 *
 * Contract change from PR-02: provider interface is now push-based.
 * VideoLayer calls setPlayhead() before getCurrent() on every tick;
 * the provider drives forward decode internally without pull requests.
 *
 * Responsibilities:
 *  - Synchronous frame retrieval via getCurrent()
 *  - Push-based playhead tracking via setPlayhead()
 *  - Provider lifecycle (active / idle / disposed)
 *
 * SyntheticVideoFrameProvider generates real drawable VideoFrames via
 * OffscreenCanvas for visual validation without mediabunny.
 *
 * Invariants:
 *  - getCurrent() is always synchronous
 *  - setPlayhead() never blocks the render path
 */

import { FrameCache } from './FrameCache'
import { GpuDebugCounters } from '../../renderer/gpu/debug/GpuDebugCounters'
import { StreamingFrameProducer } from './StreamingFrameProducer'
import type { DemuxerFactory } from './demuxer/MediabunnyDemuxer'
import type { VideoDecoderFactory } from './VideoDecoderManager'

/**
 * A frame handed to the renderer for upload. Either a raw decoded `VideoFrame`
 * (Synthetic/Mock dev providers) or an `ImageBitmap` copy (real decode path —
 * see StreamingFrameProducer). Both are valid `TexImageSource` and both survive
 * a GL context loss, so the renderer can upload either to a fresh context.
 */
export type ProvidedFrame = VideoFrame | ImageBitmap

/** Frame access contract for VideoLayer. */
export interface VideoFrameProvider {
  /** Synchronous lookup of a cached frame. Returns borrowed reference or null. */
  getCurrent(sourceFrame: number): ProvidedFrame | null

  /** Tell the producer where the playhead is. Drives forward decode. */
  setPlayhead(sourceFrame: number, opts?: { lookaheadFrames?: number }): void

  /** Begin idle lifecycle (starts idle timeout for future decoder cleanup). */
  markIdle(): void

  /** Cancel idle timeout and mark provider active. */
  markActive(): void

  /** Release all resources. Provider must not be used after dispose. */
  dispose(): void
}

export interface MetricsHook {
  onHit?: (sourceFrame: number) => void
  onMiss?: (sourceFrame: number) => void
  onDecodeLatency?: (sourceFrame: number, ms: number) => void
}

export interface MockVideoFrameProviderOptions {
  /** Max frames held in the internal cache. Default 30. */
  maxFrames?: number
  /** Idle timeout in ms before cleanup hook fires. Default 5000. */
  idleTimeoutMs?: number
  /** Mock frame dimensions. Default 320×240. */
  frameWidth?: number
  frameHeight?: number
  /** Optional instrumentation hooks. */
  metrics?: MetricsHook
  /** Optional FrameCache instrumentation hooks. */
  cacheHooks?: import('./FrameCache').FrameCacheHooks
  /** Frames to prefill ahead of playhead on each setPlayhead. Default 8. */
  lookaheadFrames?: number
}

export interface SyntheticVideoFrameProviderOptions {
  maxFrames?: number
  idleTimeoutMs?: number
  frameWidth?: number
  frameHeight?: number
  fps?: number
  metrics?: MetricsHook
  cacheHooks?: import('./FrameCache').FrameCacheHooks
  /** Frames to prefill ahead of playhead on each setPlayhead. Default 8. */
  lookaheadFrames?: number
}

type ProviderState = 'active' | 'idle' | 'disposed'

const DEFAULT_IDLE_TIMEOUT_MS = 5000
const DEFAULT_FRAME_WIDTH = 640
const DEFAULT_FRAME_HEIGHT = 360
const DEFAULT_FPS = 30
const DEFAULT_LOOKAHEAD_FRAMES = 8

function canUseSyntheticFrames(): boolean {
  return (
    typeof OffscreenCanvas !== 'undefined' &&
    typeof VideoFrame !== 'undefined'
  )
}

/**
 * Placeholder provider that generates mock VideoFrames via setTimeout.
 * Used when OffscreenCanvas/VideoFrame are unavailable (vitest/jsdom).
 * setPlayhead() schedules mock frames for [N, N+lookahead] asynchronously.
 */
export class MockVideoFrameProvider implements VideoFrameProvider {
  private readonly _cache: FrameCache
  private readonly _idleTimeoutMs: number
  private readonly _frameWidth: number
  private readonly _frameHeight: number
  private readonly _metrics: MetricsHook
  private readonly _defaultLookahead: number

  private _state: ProviderState = 'active'
  private readonly _pending = new Set<number>()
  private _idleTimer: ReturnType<typeof setTimeout> | null = null
  private _idleCallback: (() => void) | null = null

  constructor(options: MockVideoFrameProviderOptions = {}) {
    this._cache = new FrameCache({
      maxFrames: options.maxFrames,
      hooks: options.cacheHooks,
    })
    this._idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this._frameWidth = options.frameWidth ?? 320
    this._frameHeight = options.frameHeight ?? 240
    this._metrics = options.metrics ?? {}
    this._defaultLookahead = options.lookaheadFrames ?? DEFAULT_LOOKAHEAD_FRAMES
  }

  /** For testing: register a callback invoked when idle timeout fires. */
  setIdleCallback(cb: (() => void) | null): void {
    this._idleCallback = cb
  }

  getCurrent(sourceFrame: number): VideoFrame | null {
    if (this._state === 'disposed') return null
    this._cache.setPivot(sourceFrame)
    const frame = this._cache.get(sourceFrame)
    if (frame !== null) {
      this._metrics.onHit?.(sourceFrame)
      GpuDebugCounters.cacheHits++
    } else {
      this._metrics.onMiss?.(sourceFrame)
      GpuDebugCounters.cacheMisses++
    }
    GpuDebugCounters.cacheSize = this._cache.size
    return frame
  }

  setPlayhead(sourceFrame: number, opts?: { lookaheadFrames?: number }): void {
    if (this._state === 'disposed') return
    this._cache.setPivot(sourceFrame)
    const lookahead = opts?.lookaheadFrames ?? this._defaultLookahead
    for (let i = 0; i <= lookahead; i++) {
      this._scheduleFrame(sourceFrame + i)
    }
  }

  markIdle(): void {
    if (this._state === 'disposed') return
    this._state = 'idle'
    this._clearIdleTimer()
    this._idleTimer = setTimeout(() => {
      this._idleCallback?.()
    }, this._idleTimeoutMs)
  }

  markActive(): void {
    if (this._state === 'disposed') return
    this._clearIdleTimer()
    this._state = 'active'
  }

  dispose(): void {
    if (this._state === 'disposed') return
    this._state = 'disposed'
    this._clearIdleTimer()
    this._pending.clear()
    this._cache.dispose()
    GpuDebugCounters.cacheSize = 0
  }

  /** Exposed for testing: current lifecycle state. */
  get state(): ProviderState {
    return this._state
  }

  /** Exposed for testing: internal cache size. */
  get cacheSize(): number {
    return this._cache.size
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _scheduleFrame(sourceFrame: number): void {
    if (this._pending.has(sourceFrame)) return
    if (this._cache.has(sourceFrame)) return

    this._pending.add(sourceFrame)
    const startedAt = performance.now()

    setTimeout(() => {
      if (this._state === 'disposed') {
        this._pending.delete(sourceFrame)
        return
      }

      const frame = this._createMockFrame()
      this._cache.put(sourceFrame, frame)
      this._pending.delete(sourceFrame)
      GpuDebugCounters.cacheSize = this._cache.size
      this._metrics.onDecodeLatency?.(sourceFrame, performance.now() - startedAt)
      GpuDebugCounters.recordDecodeLatency(performance.now() - startedAt)
    }, 0)
  }

  private _clearIdleTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer)
      this._idleTimer = null
    }
  }

  private _createMockFrame(): VideoFrame {
    return {
      displayWidth: this._frameWidth,
      displayHeight: this._frameHeight,
      close: () => {},
    } as unknown as VideoFrame
  }
}

/**
 * Generates real drawable VideoFrames from an OffscreenCanvas.
 * Each sourceFrame produces a deterministic solid colour + frame label.
 * setPlayhead() schedules synthetic frames for [N, N+lookahead] asynchronously.
 */
export class SyntheticVideoFrameProvider implements VideoFrameProvider {
  private readonly _cache: FrameCache
  private readonly _idleTimeoutMs: number
  private readonly _frameWidth: number
  private readonly _frameHeight: number
  private readonly _fps: number
  private readonly _metrics: MetricsHook
  private readonly _canvas: OffscreenCanvas
  private readonly _ctx: OffscreenCanvasRenderingContext2D
  private readonly _defaultLookahead: number

  private _state: ProviderState = 'active'
  private readonly _pending = new Set<number>()
  private _idleTimer: ReturnType<typeof setTimeout> | null = null
  private _idleCallback: (() => void) | null = null

  constructor(options: SyntheticVideoFrameProviderOptions = {}) {
    this._cache = new FrameCache({
      maxFrames: options.maxFrames,
      hooks: options.cacheHooks,
    })
    this._idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this._frameWidth = options.frameWidth ?? DEFAULT_FRAME_WIDTH
    this._frameHeight = options.frameHeight ?? DEFAULT_FRAME_HEIGHT
    this._fps = options.fps ?? DEFAULT_FPS
    this._metrics = options.metrics ?? {}
    this._defaultLookahead = options.lookaheadFrames ?? DEFAULT_LOOKAHEAD_FRAMES

    this._canvas = new OffscreenCanvas(this._frameWidth, this._frameHeight)
    const ctx = this._canvas.getContext('2d')
    if (!ctx) {
      throw new Error('SyntheticVideoFrameProvider: 2D context unavailable')
    }
    this._ctx = ctx
  }

  setIdleCallback(cb: (() => void) | null): void {
    this._idleCallback = cb
  }

  getCurrent(sourceFrame: number): VideoFrame | null {
    if (this._state === 'disposed') return null
    this._cache.setPivot(sourceFrame)
    const frame = this._cache.get(sourceFrame)
    if (frame !== null) {
      this._metrics.onHit?.(sourceFrame)
      GpuDebugCounters.cacheHits++
    } else {
      this._metrics.onMiss?.(sourceFrame)
      GpuDebugCounters.cacheMisses++
    }
    GpuDebugCounters.cacheSize = this._cache.size
    return frame
  }

  setPlayhead(sourceFrame: number, opts?: { lookaheadFrames?: number }): void {
    if (this._state === 'disposed') return
    this._cache.setPivot(sourceFrame)
    const lookahead = opts?.lookaheadFrames ?? this._defaultLookahead
    for (let i = 0; i <= lookahead; i++) {
      this._scheduleFrame(sourceFrame + i)
    }
  }

  markIdle(): void {
    if (this._state === 'disposed') return
    this._state = 'idle'
    this._clearIdleTimer()
    this._idleTimer = setTimeout(() => {
      this._idleCallback?.()
    }, this._idleTimeoutMs)
  }

  markActive(): void {
    if (this._state === 'disposed') return
    this._clearIdleTimer()
    this._state = 'active'
  }

  dispose(): void {
    if (this._state === 'disposed') return
    this._state = 'disposed'
    this._clearIdleTimer()
    this._pending.clear()
    this._cache.dispose()
    GpuDebugCounters.cacheSize = 0
  }

  get state(): ProviderState {
    return this._state
  }

  get cacheSize(): number {
    return this._cache.size
  }

  private _scheduleFrame(sourceFrame: number): void {
    if (this._pending.has(sourceFrame)) return
    if (this._cache.has(sourceFrame)) return

    this._pending.add(sourceFrame)
    const startedAt = performance.now()

    setTimeout(() => {
      if (this._state === 'disposed') {
        this._pending.delete(sourceFrame)
        return
      }

      const frame = this._createSyntheticFrame(sourceFrame)
      this._cache.put(sourceFrame, frame)
      this._pending.delete(sourceFrame)
      GpuDebugCounters.cacheSize = this._cache.size
      const latency = performance.now() - startedAt
      this._metrics.onDecodeLatency?.(sourceFrame, latency)
      GpuDebugCounters.recordDecodeLatency(latency)
    }, 0)
  }

  private _clearIdleTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer)
      this._idleTimer = null
    }
  }

  private _createSyntheticFrame(sourceFrame: number): VideoFrame {
    const hue = (sourceFrame * 37) % 360
    this._ctx.fillStyle = `hsl(${hue}, 70%, 45%)`
    this._ctx.fillRect(0, 0, this._frameWidth, this._frameHeight)

    this._ctx.fillStyle = '#ffffff'
    this._ctx.font = 'bold 48px monospace'
    this._ctx.textAlign = 'center'
    this._ctx.textBaseline = 'middle'
    this._ctx.fillText(
      String(sourceFrame),
      this._frameWidth / 2,
      this._frameHeight / 2,
    )

    const timestamp = Math.round((sourceFrame / this._fps) * 1_000_000)
    return new VideoFrame(this._canvas, { timestamp })
  }
}

/** Options for wiring a real decode backend into the provider factory. */
export interface VideoFrameProviderDeps {
  /** Injected demuxer factory. When provided, returns StreamingFrameProducer. */
  demuxerFactory?: DemuxerFactory
  /** Optional decoder factory override (for tests). */
  decoderFactory?: VideoDecoderFactory
  /** Frames per second. Default 30. */
  fps?: number
  /** Lookahead window for StreamingFrameProducer. Default 8. */
  lookaheadFrames?: number
  /**
   * Copies a decoded `VideoFrame` into a context-independent `ImageBitmap` so the
   * original frame can be closed immediately, freeing its decoder-pool slot.
   * Defaults to `createImageBitmap`. Injectable for tests (jsdom has no real
   * `createImageBitmap`). See StreamingFrameProducer.
   */
  frameConverter?: (frame: VideoFrame) => Promise<ImageBitmap>
}

/**
 * Default factory used by VideoLayer when none is supplied.
 *
 * Selection:
 *  1. deps.demuxerFactory provided → StreamingFrameProducer (push-based real decode)
 *  2. OffscreenCanvas + VideoFrame available → SyntheticVideoFrameProvider (visual dev)
 *  3. otherwise → MockVideoFrameProvider (jsdom / test environment)
 */
export function createVideoFrameProvider(
  src: string,
  deps?: VideoFrameProviderDeps,
): VideoFrameProvider {
  if (deps?.demuxerFactory) {
    return new StreamingFrameProducer({
      src,
      fps: deps.fps,
      lookaheadFrames: deps.lookaheadFrames,
      demuxerFactory: deps.demuxerFactory,
      decoderFactory: deps.decoderFactory,
      frameConverter: deps.frameConverter,
    })
  }
  if (canUseSyntheticFrames()) {
    return new SyntheticVideoFrameProvider()
  }
  return new MockVideoFrameProvider()
}
