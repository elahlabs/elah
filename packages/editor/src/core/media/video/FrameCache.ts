/**
 * FrameCache — bounded, forward-oriented cache for decoded VideoFrames.
 *
 * **Ownership:** FrameCache owns every VideoFrame stored inside it.
 * Evicted and cleared frames always call `frame.close()`.
 *
 * **Borrowing:** `get()` returns a borrowed reference only. Callers must NOT
 * close or retain frames across render ticks.
 *
 * Eviction is deterministic: when the cache is full, the entry furthest from
 * the current pivot is evicted first; pivot defaults to 0 and must be updated
 * via setPivot() before each put during real playback.
 */

const DEFAULT_MAX_FRAMES = 30

export interface FrameCacheHooks {
  onPut?: (sourceFrame: number) => void
  onEvict?: (sourceFrame: number) => void
  onClear?: () => void
}

export interface FrameCacheOptions {
  maxFrames?: number
  hooks?: FrameCacheHooks
}

export class FrameCache {
  private readonly _maxFrames: number
  private readonly _hooks: FrameCacheHooks
  private readonly _frames = new Map<number, VideoFrame>()
  private _pivot = 0

  constructor(maxFramesOrOptions?: number | FrameCacheOptions) {
    if (typeof maxFramesOrOptions === 'number' || maxFramesOrOptions === undefined) {
      this._maxFrames = maxFramesOrOptions ?? DEFAULT_MAX_FRAMES
      this._hooks = {}
    } else {
      this._maxFrames = maxFramesOrOptions.maxFrames ?? DEFAULT_MAX_FRAMES
      this._hooks = maxFramesOrOptions.hooks ?? {}
    }
  }

  /** Current number of cached frames. */
  get size(): number {
    return this._frames.size
  }

  /** Set the playhead pivot used by eviction. Call from getCurrent() on every lookup. */
  setPivot(sourceFrame: number): void {
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
  get(sourceFrame: number, maxLookback = 0): VideoFrame | null {
    const exact = this._frames.get(sourceFrame)
    if (exact !== undefined) return exact
    if (maxLookback <= 0) return null

    let bestKey = sourceFrame - maxLookback - 1
    let best: VideoFrame | null = null
    for (const [key, frame] of this._frames) {
      if (key <= sourceFrame && key > bestKey) {
        bestKey = key
        best = frame
      }
    }
    return best
  }

  /** Store a frame. Transfers ownership to the cache. */
  put(sourceFrame: number, frame: VideoFrame): void {
    const existing = this._frames.get(sourceFrame)
    if (existing) {
      existing.close()
      this._frames.delete(sourceFrame)
      this._hooks.onEvict?.(sourceFrame)
    } else if (this._frames.size >= this._maxFrames) {
      this._evictFurthest()
    }

    this._frames.set(sourceFrame, frame)
    this._hooks.onPut?.(sourceFrame)
  }

  has(sourceFrame: number): boolean {
    return this._frames.has(sourceFrame)
  }

  /** Close and remove all frames with sourceFrame < n. */
  evictBefore(sourceFrame: number): void {
    for (const key of [...this._frames.keys()]) {
      if (key < sourceFrame) {
        this._frames.get(key)!.close()
        this._frames.delete(key)
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
    this._hooks.onClear?.()
  }

  /** Close and remove every cached frame. Alias for clear(). */
  dispose(): void {
    this.clear()
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _evictFurthest(): void {
    let victimKey: number | null = null
    let maxDist = -1
    for (const key of this._frames.keys()) {
      const dist = Math.abs(key - this._pivot)
      if (dist > maxDist || (dist === maxDist && victimKey !== null && key < victimKey)) {
        maxDist = dist
        victimKey = key
      }
    }

    if (victimKey !== null) {
      this._frames.get(victimKey)!.close()
      this._frames.delete(victimKey)
      this._hooks.onEvict?.(victimKey)
    }
  }
}
