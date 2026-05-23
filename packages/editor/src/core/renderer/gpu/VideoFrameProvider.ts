/**
 * VideoFrameProvider — frame access abstraction isolated from decoding.
 *
 * Responsibilities:
 *  - Synchronous frame retrieval via getCurrent()
 *  - Async frame scheduling via requestFrame() / prefetch()
 *  - Provider lifecycle (active / idle / disposed)
 *
 * Current Phase 4 implementation uses MockVideoFrameProvider with placeholder
 * frame generation. Real decoding (MediaBunny, WebCodecs) plugs in later.
 *
 * Invariants:
 *  - getCurrent() is always synchronous
 *  - requestFrame() never blocks the render path
 *  - prefetch() is fire-and-forget
 */

import { FrameCache } from './FrameCache'

/** Frame access contract for VideoLayer. */
export interface VideoFrameProvider {
  /** Synchronous lookup of a cached frame. Returns borrowed reference or null. */
  getCurrent(sourceFrame: number): VideoFrame | null

  /** Schedule async frame generation. Must not block. */
  requestFrame(sourceFrame: number): void

  /** Fire-and-forget prefetch of a range of source frames. */
  prefetch(fromSourceFrame: number, count: number): void

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
}

type ProviderState = 'active' | 'idle' | 'disposed'

const DEFAULT_IDLE_TIMEOUT_MS = 5000
const DEFAULT_FRAME_WIDTH = 320
const DEFAULT_FRAME_HEIGHT = 240

/**
 * Placeholder provider that generates mock VideoFrames via setTimeout.
 * Used for Phase 4 orchestration validation before real decoding lands.
 */
export class MockVideoFrameProvider implements VideoFrameProvider {
  private readonly _cache: FrameCache
  private readonly _idleTimeoutMs: number
  private readonly _frameWidth: number
  private readonly _frameHeight: number
  private readonly _metrics: MetricsHook

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
    this._frameWidth = options.frameWidth ?? DEFAULT_FRAME_WIDTH
    this._frameHeight = options.frameHeight ?? DEFAULT_FRAME_HEIGHT
    this._metrics = options.metrics ?? {}
  }

  /** For testing: register a callback invoked when idle timeout fires. */
  setIdleCallback(cb: (() => void) | null): void {
    this._idleCallback = cb
  }

  getCurrent(sourceFrame: number): VideoFrame | null {
    if (this._state === 'disposed') return null
    const frame = this._cache.get(sourceFrame)
    if (frame !== null) {
      this._metrics.onHit?.(sourceFrame)
    } else {
      this._metrics.onMiss?.(sourceFrame)
    }
    return frame
  }

  requestFrame(sourceFrame: number): void {
    if (this._state === 'disposed') return
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
      this._metrics.onDecodeLatency?.(sourceFrame, performance.now() - startedAt)
    }, 0)
  }

  prefetch(fromSourceFrame: number, count: number): void {
    if (this._state === 'disposed') return
    for (let i = 0; i < count; i++) {
      this.requestFrame(fromSourceFrame + i)
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
  }

  /** Exposed for testing: number of in-flight frame requests. */
  get pendingCount(): number {
    return this._pending.size
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

/** Default factory used by VideoLayer when none is supplied. */
export function createVideoFrameProvider(src: string): VideoFrameProvider {
  return new MockVideoFrameProvider()
}
