/**
 * RotoMaskFrameProvider — a synchronous view over an asynchronously fetched
 * mask image sequence (one PNG per source frame).
 *
 * The same contract VideoFrameProvider gives VideoLayer (renderer invariant I4):
 * `getCurrent(n)` never blocks and returns null on a miss; `requestFrame(n)`
 * fetches out-of-band; the layer keeps drawing its last upload meanwhile.
 *
 * Fetching and decoding are injected. The host supplies the loader because
 * mask frame URLs may need authenticated requests (the loader decides how), and tests
 * supply a decoder because Node has no `createImageBitmap`.
 *
 * **Two tiers, because the two costs are wildly different.** A mask frame is a
 * binary gray8 PNG: tens of KB on the wire, but ~8 MiB once decoded to RGBA at
 * 1080p. Playback is bound by the network, not the decode, so the encoded blob
 * is prefetched far ahead (hundreds of frames costs a few MB) while decoded
 * frames are kept to a small window around the playhead. Holding only decoded
 * frames is what made the mask lag the video during playback: the runway was
 * whatever would fit in RAM, which is a fraction of a second.
 *
 * Zero DOM / React imports (invariant I8).
 */

import { rotoFrameUrl } from '../../resolver/rotoMasks'

/** Fetch one mask frame's bytes. */
export type RotoMaskLoader = (url: string, signal?: AbortSignal) => Promise<Blob>

/** A decoded, GPU-uploadable mask frame. */
export interface RotoMaskImage {
  source: TexImageSource
  width: number
  height: number
  /** Free the decoded pixels (ImageBitmap.close). Called exactly once by the provider. */
  close?: () => void
}

export type RotoMaskDecoder = (blob: Blob) => Promise<RotoMaskImage>

/**
 * Default decoder: `createImageBitmap`, available on the main thread and in workers.
 *
 * `imageOrientation: 'flipY'` is load-bearing, exactly as in
 * `media/video/StreamingFrameProducer.ts`: the GL context uploads with
 * `UNPACK_FLIP_Y_WEBGL = true`, and WebGL ignores that flag for ImageBitmap
 * sources. Without the pre-flip every mask draws upside down over its video.
 */
export const decodeRotoMaskWithImageBitmap: RotoMaskDecoder = async (blob) => {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' })
  return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
}

export interface RotoMaskFrameProviderOptions {
  loader: RotoMaskLoader
  decode?: RotoMaskDecoder
  /**
   * Decoded frames kept. A 1080p mask decodes to ~8 MiB of RGBA, so the
   * default of 12 is ~96 MiB at worst. Raise this only for small frames —
   * the playback runway comes from `maxPrefetchedFrames`, not from here.
   */
  maxCachedFrames?: number
  /**
   * Encoded frames kept (the prefetch runway). A binary gray8 mask PNG is tens
   * of KB, so the default of 120 — five seconds at 24 fps — costs a few MB.
   */
  maxPrefetchedFrames?: number
  /**
   * How far ahead of the playhead a fetched frame is decoded. Everything
   * further ahead is held as bytes until the playhead reaches it, which is
   * what keeps the long runway affordable.
   */
  decodeAhead?: number
  /**
   * Concurrent fetches. Requests over the budget are queued (nearest the
   * playhead first), not dropped.
   */
  maxInFlight?: number
  /** A failed frame is not re-requested for this long. */
  retryAfterMs?: number
  now?: () => number
  /**
   * Called after a frame is decoded and cached. A paused host redraws only
   * when told something changed, so this is how a late frame gets shown.
   */
  onFrameReady?: (frame: number) => void
}

export class RotoMaskFrameProvider {
  private readonly _template: string
  private readonly _frameCount: number
  private readonly _loader: RotoMaskLoader
  private readonly _decode: RotoMaskDecoder
  private readonly _maxCached: number
  private readonly _maxPrefetched: number
  private readonly _decodeAhead: number
  private readonly _maxInFlight: number
  private readonly _retryAfterMs: number
  private readonly _now: () => number
  private readonly _onFrameReady: ((frame: number) => void) | undefined

  /** Decoded frames. Insertion order = recency order (oldest first). */
  private readonly _cache = new Map<number, RotoMaskImage>()
  /** Encoded frames awaiting decode. Insertion order = recency order. */
  private readonly _blobs = new Map<number, Blob>()
  private readonly _inFlight = new Map<number, AbortController>()
  private readonly _decoding = new Set<number>()
  private readonly _failedAt = new Map<number, number>()
  /** Frames asked for while the in-flight budget was full, served nearest-first. */
  private readonly _pending = new Set<number>()
  /** The frame playback is on, so queued work can be ordered around it. */
  private _anchor = 0
  private _disposed = false

  constructor(template: string, frameCount: number, options: RotoMaskFrameProviderOptions) {
    this._template = template
    this._frameCount = Math.max(0, Math.floor(frameCount))
    this._loader = options.loader
    this._decode = options.decode ?? decodeRotoMaskWithImageBitmap
    this._maxCached = Math.max(1, options.maxCachedFrames ?? 12)
    this._maxPrefetched = Math.max(1, options.maxPrefetchedFrames ?? 120)
    this._decodeAhead = Math.max(1, options.decodeAhead ?? 6)
    this._maxInFlight = Math.max(1, options.maxInFlight ?? 6)
    this._retryAfterMs = options.retryAfterMs ?? 3000
    this._now = options.now ?? (() => Date.now())
    this._onFrameReady = options.onFrameReady
  }

  get frameCount(): number {
    return this._frameCount
  }

  /**
   * The decoded frame if cached, else null. Never blocks; refreshes recency.
   * A frame whose bytes have arrived but which is not decoded yet starts
   * decoding here, so a seek into the prefetched runway resolves next tick.
   */
  getCurrent(frame: number): RotoMaskImage | null {
    const img = this._cache.get(frame)
    if (!img) {
      if (this._blobs.has(frame)) this._startDecode(frame)
      return null
    }
    this._cache.delete(frame)
    this._cache.set(frame, img)
    return img
  }

  /** Fetch a frame out-of-band if it is not cached, in flight, or recently failed. */
  requestFrame(frame: number): void {
    if (this._disposed) return
    if (!Number.isInteger(frame) || frame < 0 || frame >= this._frameCount) return
    if (this._cache.has(frame) || this._inFlight.has(frame)) return
    // The bytes are already here; it only needs decoding when the playhead nears it.
    if (this._blobs.has(frame)) {
      if (this._withinDecodeWindow(frame)) this._startDecode(frame)
      return
    }
    const failedAt = this._failedAt.get(frame)
    if (failedAt !== undefined && this._now() - failedAt < this._retryAfterMs) return
    if (this._inFlight.size >= this._maxInFlight) {
      this._enqueue(frame)
      return
    }
    this._start(frame)
  }

  /**
   * Request `frame` and the next `count - 1` frames, nearest first, and treat
   * `frame` as the playhead for ordering and decode decisions.
   */
  prewarm(frame: number, count = 4): void {
    if (Number.isInteger(frame)) this._anchor = frame
    for (let i = 0; i < count; i++) this.requestFrame(frame + i)
  }

  /** Number of decoded frames held — exposed for tests and the debug panel. */
  getCachedCount(): number {
    return this._cache.size
  }

  /** Number of encoded frames held ahead of the playhead. */
  getPrefetchedCount(): number {
    return this._blobs.size
  }

  getInFlightCount(): number {
    return this._inFlight.size
  }

  getPendingCount(): number {
    return this._pending.size
  }

  /**
   * True when the last fetch of `frame` failed and nothing is cached, held as
   * bytes, or in flight for it — i.e. the frame is known to have no mask (a
   * 404 on an uncovered frame), as opposed to merely not having arrived yet.
   *
   * `RotoMaskLayer` uses this to tell the two cases apart: a frame still
   * loading keeps the last upload on screen (invariant I4), while a frame we
   * know is absent must draw nothing rather than the previous frame's mask.
   */
  isKnownMissing(frame: number): boolean {
    if (!Number.isInteger(frame) || frame < 0 || frame >= this._frameCount) return false
    if (this._cache.has(frame) || this._inFlight.has(frame) || this._blobs.has(frame)) return false
    return this._failedAt.has(frame)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    for (const ctrl of this._inFlight.values()) ctrl.abort()
    this._inFlight.clear()
    for (const img of this._cache.values()) img.close?.()
    this._cache.clear()
    this._blobs.clear()
    this._decoding.clear()
    this._failedAt.clear()
    this._pending.clear()
  }

  /** Within the decode window: at the playhead or just ahead of it. */
  private _withinDecodeWindow(frame: number): boolean {
    return frame >= this._anchor && frame < this._anchor + this._decodeAhead
  }

  /**
   * Queue a frame, keeping the queue bounded by dropping whatever is furthest
   * from the playhead. A fast scrub therefore sheds the frames it flew past
   * instead of working through them.
   */
  private _enqueue(frame: number): void {
    this._pending.add(frame)
    const limit = this._maxPrefetched
    while (this._pending.size > limit) {
      let worst: number | null = null
      let worstDistance = -1
      for (const f of this._pending) {
        const d = Math.abs(f - this._anchor)
        if (d > worstDistance) {
          worstDistance = d
          worst = f
        }
      }
      if (worst === null) break
      this._pending.delete(worst)
    }
  }

  /** The queued frame nearest the playhead, preferring frames ahead of it. */
  private _takeNextPending(): number | null {
    let best: number | null = null
    let bestRank = Number.POSITIVE_INFINITY
    for (const f of this._pending) {
      if (this._cache.has(f) || this._blobs.has(f) || this._inFlight.has(f)) {
        this._pending.delete(f)
        continue
      }
      const ahead = f >= this._anchor
      // Frames behind the playhead are still worth having (a scrub back), but
      // never before the ones playback is about to need.
      const rank = ahead ? f - this._anchor : this._frameCount + (this._anchor - f)
      if (rank < bestRank) {
        bestRank = rank
        best = f
      }
    }
    if (best !== null) this._pending.delete(best)
    return best
  }

  /** Fill the in-flight budget from the queue. */
  private _pump(): void {
    while (!this._disposed && this._inFlight.size < this._maxInFlight) {
      const next = this._takeNextPending()
      if (next === null) return
      const failedAt = this._failedAt.get(next)
      if (failedAt !== undefined && this._now() - failedAt < this._retryAfterMs) continue
      this._start(next)
    }
  }

  private _start(frame: number): void {
    const ctrl = new AbortController()
    this._inFlight.set(frame, ctrl)
    const url = rotoFrameUrl(this._template, frame)

    void this._loader(url, ctrl.signal)
      .then(
        (blob) => {
          if (this._disposed || ctrl.signal.aborted) return
          this._failedAt.delete(frame)
          this._storeBlob(frame, blob)
          // Decode straight away only if the playhead is on or near this frame;
          // the rest of the runway stays as bytes until it is needed.
          if (this._withinDecodeWindow(frame)) this._startDecode(frame)
        },
        () => {
          if (!this._disposed) this._failedAt.set(frame, this._now())
        },
      )
      .finally(() => {
        this._inFlight.delete(frame)
        if (this._disposed) return
        this._pump()
      })
  }

  private _startDecode(frame: number): void {
    if (this._disposed || this._decoding.has(frame) || this._cache.has(frame)) return
    const blob = this._blobs.get(frame)
    if (!blob) return
    this._decoding.add(frame)
    void this._decode(blob)
      .then(
        (img) => {
          if (this._disposed) {
            img.close?.()
            return
          }
          this._store(frame, img)
          this._onFrameReady?.(frame)
        },
        () => {
          // Undecodable bytes are worse than none: drop them so the frame can
          // be refetched rather than retried against the same bad blob.
          if (this._disposed) return
          this._blobs.delete(frame)
          this._failedAt.set(frame, this._now())
        },
      )
      .finally(() => {
        this._decoding.delete(frame)
      })
  }

  private _storeBlob(frame: number, blob: Blob): void {
    this._blobs.delete(frame)
    this._blobs.set(frame, blob)
    while (this._blobs.size > this._maxPrefetched) {
      const oldest = this._blobs.keys().next().value as number
      this._blobs.delete(oldest)
    }
  }

  private _store(frame: number, img: RotoMaskImage): void {
    const old = this._cache.get(frame)
    if (old && old !== img) old.close?.()
    this._cache.delete(frame)
    this._cache.set(frame, img)
    while (this._cache.size > this._maxCached) {
      const oldest = this._cache.keys().next().value as number
      this._cache.get(oldest)?.close?.()
      this._cache.delete(oldest)
    }
  }
}
