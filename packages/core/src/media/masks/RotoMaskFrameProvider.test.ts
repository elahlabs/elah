import { describe, expect, it, vi } from 'vitest'
import { RotoMaskFrameProvider, type RotoMaskImage } from './RotoMaskFrameProvider'

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function deferredLoader() {
  const calls: { url: string; resolve: (b: Blob) => void; reject: (e: Error) => void }[] = []
  const loader = vi.fn(
    (url: string) =>
      new Promise<Blob>((resolve, reject) => {
        calls.push({ url, resolve, reject })
      }),
  )
  return { loader, calls }
}

function fakeDecode() {
  const closed: string[] = []
  const decode = vi.fn(async (blob: Blob): Promise<RotoMaskImage> => {
    const tag = await blob.text()
    return { source: {} as TexImageSource, width: 4, height: 4, close: () => closed.push(tag) }
  })
  return { decode, closed }
}

describe('decodeRotoMaskWithImageBitmap', () => {
  it('pre-flips the bitmap: WebGL ignores UNPACK_FLIP_Y for ImageBitmap (masks drew upside down)', async () => {
    const close = vi.fn()
    const create = vi.fn(async () => ({ width: 8, height: 4, close }))
    vi.stubGlobal('createImageBitmap', create)
    try {
      const { decodeRotoMaskWithImageBitmap } = await import('./RotoMaskFrameProvider')
      const blob = new Blob(['png'])
      const img = await decodeRotoMaskWithImageBitmap(blob)
      expect(create).toHaveBeenCalledWith(blob, { imageOrientation: 'flipY' })
      expect([img.width, img.height]).toEqual([8, 4])
      img.close?.()
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('RotoMaskFrameProvider', () => {
  it('miss returns null, fetches with the frame substituted, then hits', async () => {
    const { loader, calls } = deferredLoader()
    const { decode } = fakeDecode()
    const p = new RotoMaskFrameProvider('/m/{frame}', 10, { loader, decode })

    expect(p.getCurrent(3)).toBeNull()
    p.requestFrame(3)
    expect(calls.map((c) => c.url)).toEqual(['/m/3'])
    calls[0]!.resolve(new Blob(['3']))
    await flush()
    expect(p.getCurrent(3)).not.toBeNull()
  })

  it('announces each decoded frame so a paused host can redraw', async () => {
    const { loader, calls } = deferredLoader()
    const ready: number[] = []
    const p = new RotoMaskFrameProvider('/m/{frame}', 10, {
      loader,
      decode: fakeDecode().decode,
      onFrameReady: (f) => ready.push(f),
    })
    p.requestFrame(2)
    p.requestFrame(3)
    calls[1]!.reject(new Error('404'))
    calls[0]!.resolve(new Blob(['2']))
    await flush()
    expect(ready).toEqual([2]) // failures are not announced
  })

  it('does not refetch a cached or in-flight frame and ignores out-of-range frames', () => {
    const { loader } = deferredLoader()
    const p = new RotoMaskFrameProvider('/m/{frame}', 5, { loader, decode: fakeDecode().decode })
    p.requestFrame(1)
    p.requestFrame(1)
    p.requestFrame(-1)
    p.requestFrame(5)
    p.requestFrame(1.5)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('caps in-flight requests and queues the overflow nearest the playhead first', async () => {
    const { loader, calls } = deferredLoader()
    const p = new RotoMaskFrameProvider('/m/{frame}', 100, {
      loader,
      decode: fakeDecode().decode,
      maxInFlight: 2,
    })
    p.requestFrame(0)
    p.requestFrame(1)
    p.requestFrame(2) // over budget, queued
    p.requestFrame(50) // over budget, queued behind 2 (further from the playhead)
    expect(calls).toHaveLength(2)
    expect(p.getPendingCount()).toBe(2)
    calls[0]!.resolve(new Blob(['0']))
    await flush()
    await flush()
    // Frame 2 is what playback needs next, so it runs before 50 — and 50 is
    // not thrown away, which is what starved the runway during playback.
    expect(calls.map((c) => c.url)).toEqual(['/m/0', '/m/1', '/m/2'])
    expect(p.getPendingCount()).toBe(1)
  })

  it('orders the queue around the playhead, so a seek is served before stale frames', async () => {
    const { loader, calls } = deferredLoader()
    const p = new RotoMaskFrameProvider('/m/{frame}', 200, {
      loader,
      decode: fakeDecode().decode,
      maxInFlight: 1,
    })
    p.prewarm(0, 4) // playhead at 0: 0 in flight, 1..3 queued
    expect(calls.map((c) => c.url)).toEqual(['/m/0'])
    p.prewarm(120, 1) // the operator seeks away
    calls[0]!.resolve(new Blob(['0']))
    await flush()
    await flush()
    expect(calls.map((c) => c.url)).toEqual(['/m/0', '/m/120'])
  })

  it('sheds the furthest queued frames rather than growing without bound on a scrub', () => {
    const { loader } = deferredLoader()
    const p = new RotoMaskFrameProvider('/m/{frame}', 1000, {
      loader,
      decode: fakeDecode().decode,
      maxInFlight: 1,
      maxPrefetchedFrames: 4,
    })
    p.prewarm(0, 40)
    expect(p.getPendingCount()).toBe(4)
  })

  it('prefetches bytes far beyond the decode window, and decodes on approach', async () => {
    const { loader, calls } = deferredLoader()
    const { decode } = fakeDecode()
    const p = new RotoMaskFrameProvider('/m/{frame}', 100, {
      loader,
      decode,
      maxInFlight: 10,
      decodeAhead: 2,
    })
    p.prewarm(0, 6)
    for (let i = 0; i < 6; i++) calls[i]!.resolve(new Blob([String(i)]))
    await flush()
    await flush()
    // All six arrived as bytes; only the two in the decode window cost RAM.
    expect(p.getPrefetchedCount()).toBe(6)
    expect(p.getCachedCount()).toBe(2)
    expect(decode).toHaveBeenCalledTimes(2)

    // The playhead advances: frame 4 decodes from the bytes already held, with
    // no second fetch.
    p.prewarm(4, 2)
    await flush()
    await flush()
    expect(p.getCurrent(4)).not.toBeNull()
    expect(calls).toHaveLength(6)
  })

  it('a seek into the prefetched runway decodes that frame without refetching it', async () => {
    const { loader, calls } = deferredLoader()
    const { decode } = fakeDecode()
    const p = new RotoMaskFrameProvider('/m/{frame}', 100, { loader, decode, maxInFlight: 10, decodeAhead: 1 })
    p.prewarm(0, 3)
    for (let i = 0; i < 3; i++) calls[i]!.resolve(new Blob([String(i)]))
    await flush()
    await flush()
    expect(p.getCurrent(2)).toBeNull() // bytes held, not decoded
    await flush()
    await flush()
    expect(p.getCurrent(2)).not.toBeNull() // getCurrent kicked the decode off
    expect(calls).toHaveLength(3)
  })

  it('evicts least-recently-used frames beyond the cap and closes them', async () => {
    const { loader, calls } = deferredLoader()
    const { decode, closed } = fakeDecode()
    const p = new RotoMaskFrameProvider('/m/{frame}', 10, { loader, decode, maxCachedFrames: 2, maxInFlight: 5 })
    p.requestFrame(0)
    p.requestFrame(1)
    calls[0]!.resolve(new Blob(['0']))
    calls[1]!.resolve(new Blob(['1']))
    await flush()
    p.getCurrent(0) // 0 becomes most recent
    p.requestFrame(2)
    calls[2]!.resolve(new Blob(['2']))
    await flush()
    expect(p.getCachedCount()).toBe(2)
    expect(closed).toEqual(['1'])
    expect(p.getCurrent(1)).toBeNull()
    expect(p.getCurrent(0)).not.toBeNull()
  })

  it('backs off a failed frame until retryAfterMs passes', async () => {
    const { loader, calls } = deferredLoader()
    let now = 0
    const p = new RotoMaskFrameProvider('/m/{frame}', 10, {
      loader,
      decode: fakeDecode().decode,
      retryAfterMs: 1000,
      now: () => now,
    })
    p.requestFrame(4)
    calls[0]!.reject(new Error('404'))
    await flush()
    p.requestFrame(4)
    expect(loader).toHaveBeenCalledTimes(1)
    now = 1500
    p.requestFrame(4)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('isKnownMissing: false while in flight, true once the fetch failed, false again once cached', async () => {
    const { loader, calls } = deferredLoader()
    // retryAfterMs 0 so the re-request after the failure is not held by the backoff.
    const p = new RotoMaskFrameProvider('/m/{frame}', 10, { loader, decode: fakeDecode().decode, retryAfterMs: 0 })
    p.requestFrame(4)
    // Still in flight: "has not arrived yet" is not "absent" (invariant I4).
    expect(p.isKnownMissing(4)).toBe(false)
    calls[0]!.reject(new Error('404'))
    await flush()
    expect(p.isKnownMissing(4)).toBe(true)
    // A later success clears it.
    p.requestFrame(4)
    calls[1]!.resolve(new Blob(['4']))
    await flush()
    expect(p.isKnownMissing(4)).toBe(false)
  })

  it('isKnownMissing: a never-requested frame is not missing, nor is one out of range', () => {
    const { loader } = deferredLoader()
    const p = new RotoMaskFrameProvider('/m/{frame}', 10, { loader, decode: fakeDecode().decode })
    expect(p.isKnownMissing(2)).toBe(false)
    expect(p.isKnownMissing(99)).toBe(false)
    expect(p.isKnownMissing(-1)).toBe(false)
  })

  it('prewarm requests the frame and the following ones', () => {
    const { loader, calls } = deferredLoader()
    const p = new RotoMaskFrameProvider('/m/{frame}', 10, { loader, decode: fakeDecode().decode, maxInFlight: 10 })
    p.prewarm(8, 4)
    expect(calls.map((c) => c.url)).toEqual(['/m/8', '/m/9'])
  })

  it('dispose closes cached frames and discards late results', async () => {
    const { loader, calls } = deferredLoader()
    const { decode, closed } = fakeDecode()
    const p = new RotoMaskFrameProvider('/m/{frame}', 10, { loader, decode })
    p.requestFrame(0)
    p.requestFrame(1)
    calls[0]!.resolve(new Blob(['0']))
    await flush()
    p.dispose()
    expect(closed).toEqual(['0'])
    const decodesAtDispose = decode.mock.calls.length
    calls[1]!.resolve(new Blob(['1']))
    await flush()
    // A late result after dispose is dropped before it is decoded at all, so
    // there is nothing to close and nothing to cache. (It used to be decoded
    // and then immediately closed; not decoding it is strictly cheaper.)
    expect(decode.mock.calls.length).toBe(decodesAtDispose)
    expect(closed).toEqual(['0'])
    expect(p.getCachedCount()).toBe(0)
    expect(p.getPrefetchedCount()).toBe(0)
  })
})
