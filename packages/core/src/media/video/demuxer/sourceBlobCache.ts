/**
 * Shared whole-file Blob cache for video sources.
 *
 * Every consumer of a video's bytes currently downloads the file for itself:
 * the has-audio container probe (`assets/hasAudio.ts`), the demuxer backend
 * (`createMediabunnyBackend.open`), and a second demuxer for the same source on
 * a copy-pasted clip. For a proxied gallery video — which cannot be range-read,
 * because the proxy route answers `Accept-Ranges: none` — that is the same
 * multi-megabyte download two to four times over, and the second one starts
 * only once the user has already dropped the clip on the timeline. The wait
 * they see between drop and first frame is very largely that download.
 *
 * So the download is shared instead. One promise per `src`, handed to whoever
 * asks first and reused by everyone after — which means the probe that import
 * already kicks off (`registerAsset` → `determineAssetHasAudio`) doubles as the
 * warm-up for the decoder that runs minutes later, and the drop lands on bytes
 * that are already in memory.
 *
 * Bounded, unlike `imageCache`, because the entries are whole video files: an
 * LRU of `maxEntries` keeps a working set without letting a long editing
 * session pin every video the user has ever touched. Eviction drops only this
 * cache's reference — a `BlobSource` already holding the Blob keeps it alive
 * for as long as its `Input` lives, exactly as before this cache existed.
 */

/** Fetches a source's bytes. Injectable so tests never touch the network. */
export type BlobFetcher = (src: string) => Promise<Blob>

/**
 * How long a download may go without receiving a byte before it is abandoned.
 *
 * A stall, not a total: a slow but moving download of a big file is fine. What
 * is not fine is an upstream that stops sending mid-body — `fetch` has no
 * timeout of its own, the pending promise stays in the cache, and every later
 * caller for that src (the probe, every demuxer open, the preview's clip
 * spinner) waits on it until the page is reloaded. Aborting turns that into a
 * rejection, which drops the entry so the next caller starts a fresh download.
 */
export const BLOB_FETCH_STALL_MS = 20_000

export function createStallingBlobFetcher(stallMs = BLOB_FETCH_STALL_MS): BlobFetcher {
  return async (src) => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => controller.abort(), stallMs)
    }
    arm()
    try {
      const r = await fetch(src, { signal: controller.signal })
      if (!r.ok) {
        throw new Error(`sourceBlobCache: failed to fetch "${src}" (${r.status} ${r.statusText})`)
      }
      if (!r.body) return await r.blob()
      const type = r.headers.get('content-type') ?? ''
      const chunks: Uint8Array[] = []
      const reader = r.body.getReader()
      for (;;) {
        arm()
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      return new Blob(chunks as BlobPart[], type ? { type } : undefined)
    } catch (e) {
      if (controller.signal.aborted) {
        throw new Error(`sourceBlobCache: "${src}" stalled for ${stallMs / 1000}s and was abandoned`)
      }
      throw e
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

export const defaultBlobFetcher: BlobFetcher = createStallingBlobFetcher()

export interface SourceBlobCache {
  /** The shared download for `src`, started if nobody has started it yet. */
  resolve: (src: string) => Promise<Blob>
  /** Start the download without waiting for it. Failures are swallowed. */
  warm: (src: string) => void
  /**
   * Answer `src` with bytes the caller already has — e.g. the local File an
   * upload was made from, now that clips point at the hosted copy. Saves a full
   * re-download of a file that is sitting in memory (or on disk) already.
   */
  prime: (src: string, blob: Blob) => void
  /**
   * Hold `blob` for `src` and never evict it (LM-P1). For a lazy, disk-backed
   * `File` from a file handle: it costs no memory, so it counts 0 bytes and
   * does not take part in the entry limit, and `trim` skips it however large
   * it is. `resolve(src)` answers with it until `unpin`, `evict` or `clear`.
   */
  pin: (src: string, blob: Blob) => void
  /** Make a pinned `src` an ordinary entry again: counted, and evictable. */
  unpin: (src: string) => void
  /**
   * The Blob pinned for `src`, or `undefined` when it is not pinned. Synchronous
   * and never starts a download, so a caller can collect the local files of a
   * project (export `sources`) without touching the network.
   */
  pinnedBlob: (src: string) => Blob | undefined
  /** Forget `src` (and its pin), so the next `resolve` downloads again. */
  evict: (src: string) => void
  /** Forget everything. */
  clear: () => void
  /** How many sources are currently held. Test seam. */
  readonly size: number
}

export interface CreateSourceBlobCacheOpts {
  /** How many sources to hold before evicting the least recently used. */
  maxEntries?: number
  /**
   * Total bytes of settled downloads to hold before evicting the least recently
   * used. The newest entry is always kept, however large.
   */
  maxBytes?: number
  fetcher?: BlobFetcher
}

/**
 * Defaults sized for a real edit, not a demo. Four entries was smaller than an
 * ordinary timeline: the import probes of a fifth video pushed out the first,
 * and scrubbing back to it meant downloading the whole file again before a
 * frame appeared. The byte budget is what actually bounds memory now.
 */
export const SOURCE_BLOB_CACHE_MAX_ENTRIES = 24
export const SOURCE_BLOB_CACHE_MAX_BYTES = 1536 * 1024 * 1024

export function createSourceBlobCache(opts: CreateSourceBlobCacheOpts = {}): SourceBlobCache {
  const maxEntries = Math.max(1, opts.maxEntries ?? SOURCE_BLOB_CACHE_MAX_ENTRIES)
  const maxBytes = Math.max(0, opts.maxBytes ?? SOURCE_BLOB_CACHE_MAX_BYTES)
  const fetcher = opts.fetcher ?? defaultBlobFetcher

  // Map iteration order is insertion order, so re-inserting on every hit makes
  // the first key the least recently used.
  const entries = new Map<string, Promise<Blob>>()
  /** Pinned sources and their bytes (LM-P1); never trimmed, never counted. */
  const pinned = new Map<string, Blob>()
  /** Sizes of the entries that have settled; pending ones count as 0. */
  const sizes = new Map<string, number>()
  const totalBytes = () => {
    let n = 0
    for (const s of sizes.values()) n += s
    return n
  }

  const drop = (src: string): void => {
    entries.delete(src)
    sizes.delete(src)
    pinned.delete(src)
  }

  // Pinned entries sit outside the limits: only the others are counted, the
  // least recently used of them goes first, and the newest is always kept.
  const trim = (): void => {
    for (;;) {
      const loose = pinned.size === 0 ? [...entries.keys()] : [...entries.keys()].filter((k) => !pinned.has(k))
      if (loose.length <= 1) break
      if (loose.length <= maxEntries && totalBytes() <= maxBytes) break
      drop(loose[0])
    }
  }

  const touch = (src: string, promise: Promise<Blob>): void => {
    entries.delete(src)
    entries.set(src, promise)
    trim()
  }

  const track = (src: string, promise: Promise<Blob>): void => {
    promise.then(
      (blob) => {
        if (entries.get(src) !== promise) return
        sizes.set(src, blob.size)
        trim()
      },
      () => {},
    )
  }

  const resolve = (src: string): Promise<Blob> => {
    const cached = entries.get(src)
    if (cached) {
      touch(src, cached)
      return cached
    }

    const promise = fetcher(src)
    // A failed download must not be remembered as the answer — but a *newer*
    // attempt for the same src must not be dropped either, hence the identity
    // guard (same rule as `loadCachedImage`).
    promise.catch(() => {
      if (entries.get(src) === promise) drop(src)
    })
    touch(src, promise)
    track(src, promise)
    return promise
  }

  return {
    resolve,
    warm: (src) => {
      // The rejection is already handled inside `resolve`; this catch only stops
      // the extra branch created here from surfacing as an unhandled rejection.
      void resolve(src).catch(() => {})
    },
    pin: (src, blob) => {
      pinned.set(src, blob)
      sizes.delete(src)
      // Re-inserted as the most recent entry, answering with the pinned bytes.
      entries.delete(src)
      entries.set(src, Promise.resolve(blob))
      trim()
    },
    unpin: (src) => {
      const blob = pinned.get(src)
      if (!blob) return
      pinned.delete(src)
      sizes.set(src, blob.size)
      trim()
    },
    pinnedBlob: (src) => pinned.get(src),
    prime: (src, blob) => {
      // A pinned source already answers with its own bytes.
      if (pinned.has(src)) return
      const promise = Promise.resolve(blob)
      sizes.delete(src)
      touch(src, promise)
      track(src, promise)
    },
    evict: (src) => {
      drop(src)
    },
    clear: () => {
      entries.clear()
      sizes.clear()
      pinned.clear()
    },
    get size() {
      return entries.size
    },
  }
}

/**
 * The cache the editor actually uses. Shared across the has-audio probe, every
 * demuxer backend and the preview's warm-up, which is the whole point of it.
 */
export const sourceBlobCache: SourceBlobCache = createSourceBlobCache()

/**
 * Start downloading a video source now, so a later drop onto the timeline finds
 * the bytes already in memory. Safe to call repeatedly — it is a cache hit
 * after the first call.
 */
export function warmVideoSrc(src: string): void {
  sourceBlobCache.warm(src)
}
