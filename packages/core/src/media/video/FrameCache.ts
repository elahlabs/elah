/**
 * FrameCache — bounded, forward-oriented cache for decoded frames.
 *
 * Generic over the stored frame type `T` (anything with a `close()` method):
 *  - `FrameCache<ImageBitmap>` — the real decode path (StreamingFrameProducer),
 *    where decoded `VideoFrame`s are copied to `ImageBitmap`s so they no longer
 *    pin a slot in the decoder's hardware output pool.
 *  - `FrameCache<VideoFrame>` (the default) — the Synthetic/Mock dev providers
 *    and the existing cache tests, unchanged.
 *
 * **Ownership:** FrameCache owns every frame stored inside it. Evicted and
 * cleared frames always call `frame.close()`. It is the *only* thing that closes
 * a cached frame.
 *
 * **Borrowing:** `get()` returns a borrowed reference only. Callers must NOT
 * close or retain frames across render ticks.
 *
 * Eviction is deterministic: when the cache is full, the entry furthest from
 * the current pivot is evicted first; pivot defaults to 0 and must be updated
 * via setPivot() before each put during real playback.
 */

/** Minimal contract a cached frame must satisfy: it can be closed. */
export interface Closeable {
  close(): void
}

const DEFAULT_MAX_FRAMES = 30

export interface FrameCacheHooks {
  onPut?: (sourceFrame: number) => void
  onEvict?: (sourceFrame: number) => void
  onClear?: () => void
}

export interface FrameCacheOptions {
  maxFrames?: number
  /**
   * Optional byte budget (RGBA estimate: width × height × 4 per frame).
   * The count bound alone is resolution-blind — 30 cached 4K frames pin ~1 GB
   * where 30 1080p frames pin ~250 MB. When set, eviction runs until BOTH the
   * count and byte budgets are satisfied. Frames whose dimensions can't be
   * read (mock frames in tests) count as 0 bytes, i.e. count-bound only.
   */
  maxBytes?: number
  hooks?: FrameCacheHooks
}

/** RGBA byte estimate for ImageBitmap (width/height) or VideoFrame (codedWidth/codedHeight). */
function estimateFrameBytes(frame: unknown): number {
  const f = frame as { width?: number; height?: number; codedWidth?: number; codedHeight?: number }
  const w = f.width ?? f.codedWidth ?? 0
  const h = f.height ?? f.codedHeight ?? 0
  return w * h * 4
}

export class FrameCache<T extends Closeable = VideoFrame> {
  private readonly _maxFrames: number
  private readonly _maxBytes: number
  private readonly _hooks: FrameCacheHooks
  private readonly _frames = new Map<number, T>()
  private readonly _bytes = new Map<number, number>()
  private _totalBytes = 0
  private _pivot = 0
  /**
   * Scrub direction inferred from pivot movement. Governs which side of the
   * pivot eviction sacrifices first: forward play drops already-shown frames
   * behind the pivot; a backward scrub drops the now-useless lookahead AHEAD of
   * the pivot instead, so the keyframe→pivot run a backward seek just decoded
   * survives to serve the next backward steps.
   */
  private _direction: 'forward' | 'backward' = 'forward'

  constructor(maxFramesOrOptions?: number | FrameCacheOptions) {
    if (typeof maxFramesOrOptions === 'number' || maxFramesOrOptions === undefined) {
      this._maxFrames = maxFramesOrOptions ?? DEFAULT_MAX_FRAMES
      this._maxBytes = Infinity
      this._hooks = {}
    } else {
      this._maxFrames = maxFramesOrOptions.maxFrames ?? DEFAULT_MAX_FRAMES
      this._maxBytes = maxFramesOrOptions.maxBytes ?? Infinity
      this._hooks = maxFramesOrOptions.hooks ?? {}
    }
  }

  /** Current number of cached frames. */
  get size(): number {
    return this._frames.size
  }

  /** Estimated bytes currently pinned by cached frames (RGBA estimate). */
  get totalBytes(): number {
    return this._totalBytes
  }

  /** Set the playhead pivot used by eviction. Call from getCurrent() on every lookup. */
  setPivot(sourceFrame: number): void {
    if (sourceFrame < this._pivot) this._direction = 'backward'
    else if (sourceFrame > this._pivot) this._direction = 'forward'
    // Equal pivot (paused / repeated lookups) keeps the last known direction.
    this._pivot = sourceFrame
  }

  /**
   * Return a borrowed frame reference, or null if not cached.
   *
   * When maxLookback > 0 and the exact key is missing, returns the frame with
   * the largest key ≤ sourceFrame within maxLookback steps. This bridges
   * fps-mismatch gaps (e.g. 24fps video indexed at 30fps skips every 5th slot)
   * without returning content from an unrelated part of the timeline.
   * Do not close the returned frame.
   */
  get(sourceFrame: number, maxLookback = 0): T | null {
    const exact = this._frames.get(sourceFrame)
    if (exact !== undefined) return exact
    if (maxLookback <= 0) return null

    let bestKey = sourceFrame - maxLookback - 1
    let best: T | null = null
    for (const [key, frame] of this._frames) {
      if (key <= sourceFrame && key > bestKey) {
        bestKey = key
        best = frame
      }
    }
    return best
  }

  /** Store a frame. Transfers ownership to the cache. */
  put(sourceFrame: number, frame: T): void {
    const entryBytes = estimateFrameBytes(frame)
    if (this._frames.has(sourceFrame)) {
      this._remove(sourceFrame)
      this._hooks.onEvict?.(sourceFrame)
    }
    // Evict until both budgets hold. Guard on size so a single frame larger
    // than the whole byte budget still caches (bounded at one entry) instead
    // of looping.
    while (
      this._frames.size > 0 &&
      (this._frames.size >= this._maxFrames ||
        this._totalBytes + entryBytes > this._maxBytes)
    ) {
      this._evictFurthest()
    }

    this._frames.set(sourceFrame, frame)
    this._bytes.set(sourceFrame, entryBytes)
    this._totalBytes += entryBytes
    this._hooks.onPut?.(sourceFrame)
  }

  has(sourceFrame: number): boolean {
    return this._frames.has(sourceFrame)
  }

  /** Close and remove all frames with sourceFrame < n. */
  evictBefore(sourceFrame: number): void {
    for (const key of [...this._frames.keys()]) {
      if (key < sourceFrame) {
        this._remove(key)
        this._hooks.onEvict?.(key)
      }
    }
  }

  /** Close and remove every cached frame. */
  clear(): void {
    for (const frame of this._frames.values()) {
      frame.close()
    }
    this._frames.clear()
    this._bytes.clear()
    this._totalBytes = 0
    this._hooks.onClear?.()
  }

  /** Close and remove every cached frame. Alias for clear(). */
  dispose(): void {
    this.clear()
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Evict one frame, preferring frames BEHIND the pivot over frames AHEAD of it.
   *
   * This cache is forward-oriented: frames ahead of the pivot are the lookahead
   * buffer a burst feed just paid to decode, while frames behind the pivot have
   * already been displayed and are safe to drop. A plain `Math.abs(key - pivot)`
   * distance treats both sides symmetrically, so a multi-frame burst (which
   * decodes up to `lookaheadFrames` ahead while the pivot stays fixed for the
   * whole burst) can tie a fresh lookahead frame against a stale trailing frame
   * and evict the frame it just cached — before the playhead ever reaches it,
   * producing a cache miss moments later during otherwise-steady playback.
   *
   * Fix: only consider ahead-of-pivot frames for eviction when no behind-pivot
   * frame remains. Within each group, evict the one furthest from the pivot
   * (ties broken by lowest key, as before).
   *
   * When the pivot is moving BACKWARD the roles flip: the lookahead ahead of the
   * pivot is what's already been shown, while the frames behind it (the
   * keyframe→pivot run the backward seek just decoded) are exactly where the
   * playhead is heading. Sacrificing the behind side there re-creates the miss
   * on every backward step and thrashes the decoder with keyframe re-seeks.
   */
  private _evictFurthest(): void {
    let behindVictim: number | null = null
    let behindMaxDist = -1
    let aheadVictim: number | null = null
    let aheadMaxDist = -1

    for (const key of this._frames.keys()) {
      const dist = Math.abs(key - this._pivot)
      if (key <= this._pivot) {
        if (dist > behindMaxDist || (dist === behindMaxDist && behindVictim !== null && key < behindVictim)) {
          behindMaxDist = dist
          behindVictim = key
        }
      } else {
        if (dist > aheadMaxDist || (dist === aheadMaxDist && aheadVictim !== null && key < aheadVictim)) {
          aheadMaxDist = dist
          aheadVictim = key
        }
      }
    }

    const victimKey =
      this._direction === 'backward'
        ? aheadVictim !== null
          ? aheadVictim
          : behindVictim
        : behindVictim !== null
          ? behindVictim
          : aheadVictim

    if (victimKey !== null) {
      this._remove(victimKey)
      this._hooks.onEvict?.(victimKey)
    }
  }

  /** Close + delete one entry, keeping the byte ledger in sync. No hooks. */
  private _remove(key: number): void {
    const frame = this._frames.get(key)
    if (frame === undefined) return
    frame.close()
    this._frames.delete(key)
    this._totalBytes -= this._bytes.get(key) ?? 0
    this._bytes.delete(key)
  }
}
