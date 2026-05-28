/**
 * DecoderBackedVideoFrameProvider — VideoFrameProvider backed by VideoDecoderManager.
 *
 * This is the real decode backend that replaces SyntheticVideoFrameProvider for
 * production playback. It owns a VideoDecoderManager + FrameCache and bridges the
 * synchronous render path to the asynchronous WebCodecs decode pipeline.
 *
 * Invariants preserved:
 *  - I1: getCurrent() is fully synchronous — never awaits.
 *  - I4: cache miss returns null; requestFrame() fires out-of-band.
 *  - I10: FrameCache owns decoded VideoFrames; cache.put transfers ownership.
 *
 * Threading notes:
 *  - All public methods are called on the main thread (render tick or VideoLayer).
 *  - VideoDecoderManager callbacks (onDecodeLatency, onDroppedFrame) fire from
 *    within await continuations, which are microtasks on the main thread.
 *  - No cross-thread access. Worker migration seam: S10 in EVOLUTION.md § 7.
 *
 * Ownership flow:
 *   VideoDecoder.output → VideoDecoderManager.requestFrame() resolves →
 *   cache.put(n, frame) → FrameCache owns → getCurrent borrows →
 *   VideoTexture.upload closes in finally.
 *
 * @see EVOLUTION.md § 4 Phase 1
 * @see architecture.md § 6 (async frame pipeline)
 *
 * @deprecated Replaced by StreamingFrameProducer (PR-02). Kept for one release
 * cycle before deletion. createVideoFrameProvider() no longer returns this class.
 */

import { FrameCache, type FrameCacheHooks } from './FrameCache'
import { GpuDebugCounters } from '../../renderer/gpu/debug/GpuDebugCounters'
import type { VideoFrameProvider } from './VideoFrameProvider'
import { VideoDecoderManager } from './VideoDecoderManager'
import type { DemuxerFactory } from './demuxer/MediabunnyDemuxer'
import type { VideoDecoderFactory } from './VideoDecoderManager'

const DEFAULT_MAX_OUTSTANDING = 4
const DEFAULT_MAX_FRAMES = 30
const DEFAULT_FPS = 30

export interface DecoderBackedVideoFrameProviderOptions {
  /** Source URL passed to VideoDecoderManager.open(). */
  src: string
  /** Frames per second of the source media. Forwarded to VideoDecoderManager. */
  fps?: number
  /**
   * Maximum number of in-flight requestFrame() calls at once.
   * Additional calls are dropped (not queued) to prevent unbounded memory use.
   * Default 4.
   */
  maxOutstanding?: number
  /** Max decoded frames to hold in the LRU cache. Default 30. */
  maxFrames?: number
  /**
   * Injected demuxer factory. Required for real decode; tests inject a mock.
   * If omitted the provider opens in a degraded state and logs a warning.
   */
  demuxerFactory: DemuxerFactory
  /** Optional decoder factory override (tests inject mocks). */
  decoderFactory?: VideoDecoderFactory
  /** Optional FrameCache instrumentation hooks. */
  cacheHooks?: FrameCacheHooks
  /**
   * When true (default), the underlying VideoDecoderManager rejects a decode
   * that produced zero output frames with a "no output produced" error
   * instead of fabricating a fallback `VideoFrame`-shaped object. This
   * prevents the texImage2D-Overload error in production. Tests that drive
   * the provider with a mock decoder which never emits real `VideoFrame`s
   * may set this to false to keep relying on the legacy fallback.
   */
  strictNoOutput?: boolean
  /**
   * Per-decode timeout forwarded to VideoDecoderManager. When a demuxer or
   * decoder hangs, the manager rejects with "no output produced" so the
   * provider's pending slot frees without entering Errored. Default 2000ms.
   * Set to 0 to disable (tests only).
   */
  decodeTimeoutMs?: number
}

type ProviderState = 'active' | 'idle' | 'disposed'

/** Default idle timeout before the provider marks itself available for cleanup. */
const DEFAULT_IDLE_TIMEOUT_MS = 5_000

export class DecoderBackedVideoFrameProvider implements VideoFrameProvider {
  private readonly _src: string
  private readonly _fps: number
  private readonly _maxOutstanding: number
  private readonly _cache: FrameCache
  private readonly _manager: VideoDecoderManager

  /** Frames currently in-flight (requestFrame sent, result not yet in cache). */
  private readonly _pending = new Set<number>()

  /** Last sourceFrame passed to requestFrame(). Used to detect non-contiguous jumps. */
  private _lastRequested: number | null = null

  private _state: ProviderState = 'active'
  private _idleTimer: ReturnType<typeof setTimeout> | null = null
  private _idleCallback: (() => void) | null = null

  /** Resolves once the manager has successfully opened the source. */
  private _openPromise: Promise<void> | null = null
  private _openError: Error | null = null
  /** Guards against re-entrant reopen attempts triggered by onError. */
  private _reopening = false

  constructor(opts: DecoderBackedVideoFrameProviderOptions) {
    this._src = opts.src
    this._fps = opts.fps ?? DEFAULT_FPS
    this._maxOutstanding = opts.maxOutstanding ?? DEFAULT_MAX_OUTSTANDING

    this._cache = new FrameCache({
      maxFrames: opts.maxFrames ?? DEFAULT_MAX_FRAMES,
      hooks: opts.cacheHooks,
    })

    this._manager = new VideoDecoderManager({
      fps: this._fps,
      demuxerFactory: opts.demuxerFactory,
      decoderFactory: opts.decoderFactory,
      onDroppedFrame: () => {
        GpuDebugCounters.incDropped()
      },
      onError: (_err) => {
        if (this._state === 'disposed' || this._reopening) return
        this._reopening = true
        this._openPromise = this._manager
          .reopen(this._src)
          .catch((reopenErr: Error) => {
            this._openError = reopenErr
          })
          .finally(() => {
            this._reopening = false
          })
      },
    })

    this._openPromise = this._manager.open(this._src).catch((err: Error) => {
      this._openError = err
    })
  }

  // ---------------------------------------------------------------------------
  // VideoFrameProvider interface
  // ---------------------------------------------------------------------------

  /**
   * Synchronous frame lookup. Returns a borrowed reference from the cache,
   * or null on a miss. Never awaits. Invariant I1, I4.
   */
  getCurrent(sourceFrame: number): VideoFrame | null {
    if (this._state === 'disposed') return null

    this._cache.setPivot(sourceFrame)

    const frame = this._cache.get(sourceFrame)
    if (frame !== null) {
      GpuDebugCounters.cacheHits++
    } else {
      GpuDebugCounters.cacheMisses++
    }
    GpuDebugCounters.cacheSize = this._cache.size
    return frame
  }

  /**
   * DEPRECATED. Push-based replacement: setPlayhead().
   * Kept as a class method (not on VideoFrameProvider interface) for one
   * release cycle. Does nothing with the new VideoDecoderManager API.
   */
  requestFrame(_sourceFrame: number): void {
    // no-op: this class is deprecated. Use StreamingFrameProducer.
  }

  /** DEPRECATED. See requestFrame(). */
  prefetch(_fromSourceFrame: number, _count: number): void {
    // no-op: this class is deprecated.
  }

  /**
   * Push-based interface method (PR-02). No-op in the deprecated provider;
   * StreamingFrameProducer implements this correctly.
   */
  setPlayhead(_sourceFrame: number, _opts?: { lookaheadFrames?: number }): void {
    // no-op: DecoderBackedVideoFrameProvider is deprecated.
  }

  markIdle(): void {
    if (this._state === 'disposed') return
    this._state = 'idle'
    this._clearIdleTimer()
    this._idleTimer = setTimeout(() => {
      this._idleCallback?.()
    }, DEFAULT_IDLE_TIMEOUT_MS)
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
    // Cancel all in-flight decodes — their .catch() will run but _pending
    // cleanup is harmless after dispose.
    this._manager.dispose()
    // Close all cached frames (I10: cache owns, so it's responsible for closing).
    this._cache.dispose()
    GpuDebugCounters.cacheSize = 0
    this._pending.clear()
    this._lastRequested = null
  }

  // ---------------------------------------------------------------------------
  // Test / diagnostic surface
  // ---------------------------------------------------------------------------

  /** Current lifecycle state. */
  get state(): ProviderState {
    return this._state
  }

  /** Number of in-flight decode requests. */
  get pendingCount(): number {
    return this._pending.size
  }

  /** Current cache size (number of decoded frames stored). */
  get cacheSize(): number {
    return this._cache.size
  }

  /** Underlying decoder state (for diagnostics and debug panel). */
  get decoderState(): string {
    return this._manager.state
  }

  /** Open error, if any. null if open succeeded or is still in progress. */
  get openError(): Error | null {
    return this._openError
  }

  /**
   * Returns the open promise so callers can await readiness in tests.
   * The render path never awaits this — it is only for test synchronization.
   */
  get openPromise(): Promise<void> | null {
    return this._openPromise
  }

  /** For testing: register a callback invoked when idle timeout fires. */
  setIdleCallback(cb: (() => void) | null): void {
    this._idleCallback = cb
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _clearIdleTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer)
      this._idleTimer = null
    }
  }

  /** DEPRECATED stub. No-op — see setPlayhead() and StreamingFrameProducer. */
  private _enqueueRequestFrame(_sourceFrame: number): void {
    // no-op: this class is deprecated.
  }
}

