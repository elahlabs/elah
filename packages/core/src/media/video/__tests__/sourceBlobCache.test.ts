import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSourceBlobCache, createStallingBlobFetcher } from '../demuxer/sourceBlobCache'

const blobFor = (text: string): Blob => new Blob([text])

describe('sourceBlobCache', () => {
  it('downloads a source once and hands the same promise to every caller', async () => {
    const fetcher = vi.fn(async (src: string) => blobFor(src))
    const cache = createSourceBlobCache({ fetcher })

    const a = cache.resolve('a.mp4')
    const b = cache.resolve('a.mp4')

    expect(a).toBe(b)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(a).resolves.toBeInstanceOf(Blob)

    // Still a hit after it has settled.
    cache.resolve('a.mp4')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('evicts the least recently used source past maxEntries', async () => {
    const fetcher = vi.fn(async (src: string) => blobFor(src))
    const cache = createSourceBlobCache({ fetcher, maxEntries: 2 })

    await cache.resolve('a.mp4')
    await cache.resolve('b.mp4')
    // Touching 'a' makes 'b' the least recently used.
    await cache.resolve('a.mp4')
    await cache.resolve('c.mp4')

    expect(cache.size).toBe(2)
    expect(fetcher).toHaveBeenCalledTimes(3)

    await cache.resolve('a.mp4') // still held — no new download
    expect(fetcher).toHaveBeenCalledTimes(3)
    await cache.resolve('b.mp4') // evicted by 'c' — downloads again
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('forgets a failed download so the next caller can retry', async () => {
    const fetcher = vi
      .fn<(src: string) => Promise<Blob>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(blobFor('ok'))
    const cache = createSourceBlobCache({ fetcher })

    await expect(cache.resolve('a.mp4')).rejects.toThrow('offline')
    expect(cache.size).toBe(0)

    await expect(cache.resolve('a.mp4')).resolves.toBeInstanceOf(Blob)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('warm starts the download without throwing on failure', async () => {
    const fetcher = vi
      .fn<(src: string) => Promise<Blob>>()
      .mockRejectedValue(new Error('offline'))
    const cache = createSourceBlobCache({ fetcher })

    expect(() => cache.warm('a.mp4')).not.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
    // Let the rejection settle; an unhandled rejection would fail the run.
    await new Promise((r) => setTimeout(r, 0))
  })

  it('evict and clear drop held sources', async () => {
    const fetcher = vi.fn(async (src: string) => blobFor(src))
    const cache = createSourceBlobCache({ fetcher })

    await cache.resolve('a.mp4')
    await cache.resolve('b.mp4')
    cache.evict('a.mp4')
    expect(cache.size).toBe(1)
    cache.clear()
    expect(cache.size).toBe(0)

    await cache.resolve('b.mp4')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('resolve works detached from the cache object', async () => {
    // createMediabunnyBackend does `opts.blobResolver ?? sourceBlobCache.resolve`,
    // so the method must not depend on `this`.
    const fetcher = vi.fn(async (src: string) => blobFor(src))
    const cache = createSourceBlobCache({ fetcher })
    const { resolve } = cache

    await expect(resolve('a.mp4')).resolves.toBeInstanceOf(Blob)
    expect(cache.size).toBe(1)
  })

  it('prime answers a source with bytes already in hand, without fetching', async () => {
    const fetcher = vi.fn(async (src: string) => blobFor(src))
    const cache = createSourceBlobCache({ fetcher })
    const local = blobFor('local bytes')

    cache.prime('https://cdn/a.mp4', local)

    await expect(cache.resolve('https://cdn/a.mp4')).resolves.toBe(local)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('evicts by total bytes as well as by count, keeping the newest', async () => {
    const fetcher = vi.fn(async (src: string) => new Blob([new Uint8Array(src === 'big.mp4' ? 80 : 30)]))
    const cache = createSourceBlobCache({ fetcher, maxEntries: 10, maxBytes: 100 })

    await cache.resolve('a.mp4') // 30
    await cache.resolve('b.mp4') // 60
    await cache.resolve('big.mp4') // 140 → 'a' then 'b' go
    await new Promise((r) => setTimeout(r, 0))

    expect(cache.size).toBe(1)
    await cache.resolve('big.mp4')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})

describe('createStallingBlobFetcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** A response whose body sends `first` and then never sends anything again. */
  const stallingFetch = (first: Uint8Array) =>
    vi.fn((_src: string, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(first)
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
        },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    })

  it('abandons a download that stops sending, so it is not cached forever', async () => {
    vi.stubGlobal('fetch', stallingFetch(new Uint8Array([1, 2, 3])))
    const cache = createSourceBlobCache({ fetcher: createStallingBlobFetcher(30) })

    await expect(cache.resolve('a.mp4')).rejects.toThrow(/stalled/)
    // Dropped, so the next caller starts over instead of waiting on the dead one.
    expect(cache.size).toBe(0)
  })

  it('returns the whole body of a download that completes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'video/mp4' } })),
    )
    const blob = await createStallingBlobFetcher(30)('a.mp4')
    expect(blob.size).toBe(4)
    expect(blob.type).toBe('video/mp4')
  })

  it('rejects a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502, statusText: 'Bad Gateway' })))
    await expect(createStallingBlobFetcher(30)('a.mp4')).rejects.toThrow(/502/)
  })
})

describe('sourceBlobCache pinning (LM-P1)', () => {
  /** A lazy, disk-backed File stand-in: tiny in memory, huge by `size`. */
  const hugeBlob = (): Blob => {
    const b = new Blob(['x'])
    Object.defineProperty(b, 'size', { value: 2 * 1024 ** 3 })
    return b
  }

  it('never evicts a pinned source while others churn through', async () => {
    const fetcher = vi.fn(async (src: string) => blobFor(src))
    const cache = createSourceBlobCache({ fetcher, maxEntries: 2 })
    const local = hugeBlob()
    cache.pin('blob:local', local)

    for (const s of ['a', 'b', 'c', 'd', 'e']) await cache.resolve(s)

    await expect(cache.resolve('blob:local')).resolves.toBe(local)
    expect(fetcher).not.toHaveBeenCalledWith('blob:local')
    // The loose entries still obey maxEntries, pinned ones sit outside it.
    expect(cache.size).toBe(3)
  })

  it('counts a pinned source as 0 bytes, however large', async () => {
    const fetcher = vi.fn(async (src: string) => blobFor(src.repeat(40)))
    const cache = createSourceBlobCache({ fetcher, maxBytes: 100 })
    cache.pin('blob:local', hugeBlob())

    await cache.resolve('a') // 40 bytes
    await cache.resolve('b') // 40 bytes: 80 <= 100, so both stay
    await cache.resolve('a')
    await cache.resolve('b')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('makes an unpinned source an ordinary, evictable entry again', async () => {
    const fetcher = vi.fn(async (src: string) => blobFor(src))
    const cache = createSourceBlobCache({ fetcher, maxBytes: 1000 })
    const local = hugeBlob()
    cache.pin('blob:local', local)
    cache.unpin('blob:local')

    // Its 2 GiB now counts, so the next download pushes it out.
    await cache.resolve('a')
    expect(cache.size).toBe(1)
    await cache.resolve('blob:local')
    expect(fetcher).toHaveBeenCalledWith('blob:local')
  })

  it('pin answers with the pinned bytes instead of a download in flight', async () => {
    const fetcher = vi.fn(async (src: string) => blobFor(src))
    const cache = createSourceBlobCache({ fetcher })
    const first = cache.resolve('blob:local')
    const file = blobFor('file')
    cache.pin('blob:local', file)
    await first
    await expect(cache.resolve('blob:local')).resolves.toBe(file)
    // priming a pinned source does not displace it
    cache.prime('blob:local', blobFor('other'))
    await expect(cache.resolve('blob:local')).resolves.toBe(file)
  })

  it('pinnedBlob answers synchronously for a pinned src only, without fetching', () => {
    const fetcher = vi.fn(async (src: string) => blobFor(src))
    const cache = createSourceBlobCache({ fetcher })
    const file = blobFor('file')
    cache.pin('blob:local', file)
    expect(cache.pinnedBlob('blob:local')).toBe(file)
    expect(cache.pinnedBlob('blob:other')).toBeUndefined()
    cache.unpin('blob:local')
    expect(cache.pinnedBlob('blob:local')).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('evict and clear drop the pin too', async () => {
    const fetcher = vi.fn(async (src: string) => blobFor(src))
    const cache = createSourceBlobCache({ fetcher })
    cache.pin('blob:one', blobFor('1'))
    cache.pin('blob:two', blobFor('2'))

    cache.evict('blob:one')
    await cache.resolve('blob:one')
    expect(fetcher).toHaveBeenCalledWith('blob:one')

    cache.clear()
    expect(cache.size).toBe(0)
    await cache.resolve('blob:two')
    expect(fetcher).toHaveBeenCalledWith('blob:two')
  })
})
