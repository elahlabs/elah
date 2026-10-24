/**
 * SequenceFrameProvider — a synchronous view over an asynchronously opened,
 * asynchronously decoded SequenceFrameReader (PV-P8b).
 *
 * Same contract as `RotoMaskFrameProvider` (renderer invariant I4): `getCurrent`
 * never blocks and returns null on a miss, `requestFrame` fetches out of band,
 * and the cache/in-flight/eviction/retry logic below is a direct copy of that
 * provider's, per the ticket's explicit instruction not to refactor roto to
 * share it. The one addition is the lazy `open()`: unlike a roto run, which
 * already knows its template and frame count up front, a sequence layer must
 * first await `openAnimatedImage`/`openFrameSequence` before any frame can be
 * requested at all.
 *
 * Zero DOM / React imports (the export worker imports this file too).
 */

import type { SequenceFrameReader, SequenceImage } from './SequenceReader'

export interface SequenceFrameProviderOptions {
  open: () => Promise<SequenceFrameReader>
  /** Decoded frames kept. Default 12. */
  maxCachedFrames?: number
  /** Concurrent decodes. Default 2. */
  maxInFlight?: number
  /** A failed open or a failed frame is not retried for this long. Default 3000ms. */
  retryAfterMs?: number
  now?: () => number
  /** Called after a frame is decoded and cached. */
  onFrameReady?: (index: number) => void
  /** Called once, after the reader successfully opens. */
  onOpen?: (reader: SequenceFrameReader) => void
}

export type SequenceProviderState = 'idle' | 'opening' | 'ready' | 'failed'

export class SequenceFrameProvider {
  private readonly _open: () => Promise<SequenceFrameReader>
  private readonly _maxCached: number
  private readonly _maxInFlight: number
  private readonly _retryAfterMs: number
  private readonly _now: () => number
  private readonly _onFrameReady: ((index: number) => void) | undefined
  private readonly _onOpen: ((reader: SequenceFrameReader) => void) | undefined

  private _state: SequenceProviderState = 'idle'
  private _reader: SequenceFrameReader | null = null
  private _openFailedAt: number | null = null
  private _openPromise: Promise<void> | null = null
  /**
   * Frames asked for before the reader is open (state 'idle'/'opening', or a
   * failed open being retried). Replayed through `requestFrame` in order once
   * `_beginOpen` resolves, so each one goes through the normal maxInFlight
   * gate rather than collapsing to a single "latest wanted" slot the way an
   * already-open provider's overflow does.
   */
  private readonly _openQueue: number[] = []
  private readonly _openQueued = new Set<number>()

  /** Insertion order = recency order (oldest first). */
  private readonly _cache = new Map<number, SequenceImage>()
  private readonly _inFlight = new Set<number>()
  private readonly _failedAt = new Map<number, number>()
  /** The latest frame asked for while the in-flight budget was full. */
  private _wanted: number | null = null
  private _disposed = false

  constructor(options: SequenceFrameProviderOptions) {
    this._open = options.open
    this._maxCached = Math.max(1, options.maxCachedFrames ?? 12)
    this._maxInFlight = Math.max(1, options.maxInFlight ?? 2)
    this._retryAfterMs = options.retryAfterMs ?? 3000
    this._now = options.now ?? (() => Date.now())
    this._onFrameReady = options.onFrameReady
    this._onOpen = options.onOpen
  }

  get state(): SequenceProviderState {
    return this._state
  }

  /** The reader's frameCount once open, else null. */
  get frameCount(): number | null {
    return this._reader?.frameCount ?? null
  }

  /**
   * Cached image for `index` (mapped through `min(index, frameCount - 1)` once
   * open), else null. Refreshes LRU recency.
   */
  getCurrent(index: number): SequenceImage | null {
    const mapped = this._mapIndex(index)
    if (mapped === null) return null
    const img = this._cache.get(mapped)
    if (!img) return null
    this._cache.delete(mapped)
    this._cache.set(mapped, img)
    return img
  }

  /**
   * Open if needed, then read `index` out of band unless cached, in flight or
   * recently failed. Over `maxInFlight`, remember only the latest wanted index.
   */
  requestFrame(index: number): void {
    if (this._disposed) return

    if (this._state === 'idle') {
      this._queueForOpen(index)
      this._beginOpen()
      return
    }
    if (this._state === 'opening') {
      this._queueForOpen(index)
      return
    }
    if (this._state === 'failed') {
      if (this._openFailedAt !== null && this._now() - this._openFailedAt < this._retryAfterMs) return
      this._queueForOpen(index)
      this._beginOpen()
      return
    }

    // 'ready'
    const mapped = this._mapIndex(index)
    if (mapped === null) return
    if (this._cache.has(mapped) || this._inFlight.has(mapped)) return
    const failedAt = this._failedAt.get(mapped)
    if (failedAt !== undefined && this._now() - failedAt < this._retryAfterMs) return
    if (this._inFlight.size >= this._maxInFlight) {
      this._wanted = mapped
      return
    }
    this._startRead(mapped)
  }

  /**
   * Request `index` and the next `count - 1` frames; past
   * `sequenceFrameCount - 1` they wrap when `loop`, else clamp (deduplicated).
   */
  prewarm(index: number, count: number, sequenceFrameCount: number, loop: boolean): void {
    if (!(sequenceFrameCount >= 1)) return
    const seen = new Set<number>()
    for (let i = 0; i < count; i++) {
      const raw = index + i
      const idx = loop ? ((raw % sequenceFrameCount) + sequenceFrameCount) % sequenceFrameCount : Math.min(sequenceFrameCount - 1, Math.max(0, raw))
      if (seen.has(idx)) continue
      seen.add(idx)
      this.requestFrame(idx)
    }
  }

  /**
   * True when the last read of `index` (mapped as `getCurrent` maps it) failed
   * and nothing is cached or in flight for it: the frame is known to be absent
   * (a 404 on an uncovered roto-mask frame), as opposed to merely not having
   * arrived yet. `SequenceLayer` uses this to draw nothing for an absent frame
   * rather than keep showing the previous frame's pixels; a frame still loading
   * keeps the last upload (invariant I4). Mirrors `RotoMaskFrameProvider`.
   */
  isKnownMissing(index: number): boolean {
    const mapped = this._mapIndex(index)
    if (mapped === null) return false
    if (this._cache.has(mapped) || this._inFlight.has(mapped)) return false
    return this._failedAt.has(mapped)
  }

  /** Close every cached image and the reader; late results are closed on arrival. */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    for (const img of this._cache.values()) img.close()
    this._cache.clear()
    this._inFlight.clear()
    this._failedAt.clear()
    this._wanted = null
    this._openQueue.length = 0
    this._openQueued.clear()
    this._reader?.close()
    this._reader = null
  }

  private _queueForOpen(index: number): void {
    if (this._openQueued.has(index)) return
    this._openQueued.add(index)
    this._openQueue.push(index)
  }

  private _mapIndex(index: number): number | null {
    const frameCount = this._reader?.frameCount
    if (frameCount === undefined || frameCount === null) return null
    return Math.min(frameCount - 1, Math.max(0, Math.floor(index)))
  }

  private _beginOpen(): void {
    if (this._openPromise) return
    this._state = 'opening'
    this._openPromise = this._open().then(
      (reader) => {
        this._openPromise = null
        if (this._disposed) {
          reader.close()
          return
        }
        this._reader = reader
        this._state = 'ready'
        this._openFailedAt = null
        this._onOpen?.(reader)
        const queued = this._openQueue.slice()
        this._openQueue.length = 0
        this._openQueued.clear()
        for (const idx of queued) this.requestFrame(idx)
      },
      () => {
        this._openPromise = null
        if (this._disposed) return
        this._state = 'failed'
        this._openFailedAt = this._now()
        this._openQueue.length = 0
        this._openQueued.clear()
      },
    )
  }

  private _startRead(index: number): void {
    if (!this._reader) return
    this._inFlight.add(index)
    const reader = this._reader

    reader
      .read(index)
      .then(
        (img) => {
          if (this._disposed) {
            img.close()
            return
          }
          this._failedAt.delete(index)
          this._store(index, img)
          this._onFrameReady?.(index)
        },
        () => {
          if (!this._disposed) this._failedAt.set(index, this._now())
        },
      )
      .finally(() => {
        this._inFlight.delete(index)
        if (this._disposed) return
        const next = this._wanted
        this._wanted = null
        if (next !== null) this.requestFrame(next)
      })
  }

  private _store(index: number, img: SequenceImage): void {
    const old = this._cache.get(index)
    if (old && old !== img) old.close()
    this._cache.delete(index)
    this._cache.set(index, img)
    while (this._cache.size > this._maxCached) {
      const oldest = this._cache.keys().next().value as number
      this._cache.get(oldest)?.close()
      this._cache.delete(oldest)
    }
  }
}
