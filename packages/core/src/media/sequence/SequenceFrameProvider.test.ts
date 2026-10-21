import { describe, expect, it, vi } from 'vitest'
import { SequenceFrameProvider } from './SequenceFrameProvider'
import type { SequenceFrameReader, SequenceImage } from './SequenceReader'

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

function makeImage(index: number): SequenceImage & { closeSpy: ReturnType<typeof vi.fn> } {
  const closeSpy = vi.fn()
  return {
    source: { __frame: index } as unknown as ImageBitmap,
    width: 8,
    height: 8,
    close: closeSpy,
    closeSpy,
  }
}

/** A fake reader whose read() promises the test controls and resolves by hand. */
function makeControlledReader(frameCount = 8) {
  const pending = new Map<number, { resolve: (img: SequenceImage) => void; reject: (err: unknown) => void }>()
  const closeSpy = vi.fn()
  const readSpy = vi.fn((index: number) => {
    return new Promise<SequenceImage>((resolve, reject) => {
      pending.set(index, { resolve, reject })
    })
  })
  const reader: SequenceFrameReader = {
    frameCount,
    fallback: null,
    read: readSpy,
    close: closeSpy,
  }
  return {
    reader,
    readSpy,
    closeSpy,
    resolveFrame: (index: number, img?: SequenceImage) => {
      const p = pending.get(index)
      if (!p) throw new Error(`no pending read for frame ${index}`)
      pending.delete(index)
      p.resolve(img ?? makeImage(index))
    },
    rejectFrame: (index: number, err: unknown = new Error('fail')) => {
      const p = pending.get(index)
      if (!p) throw new Error(`no pending read for frame ${index}`)
      pending.delete(index)
      p.reject(err)
    },
    pendingCount: () => pending.size,
  }
}

describe('SequenceFrameProvider', () => {
  it('getCurrent(0) is null before any request', () => {
    const { reader } = makeControlledReader()
    const provider = new SequenceFrameProvider({ open: async () => reader })
    expect(provider.getCurrent(0)).toBeNull()
  })

  it('two requestFrame(0) calls open once and read once', async () => {
    const { reader, readSpy, resolveFrame } = makeControlledReader()
    const open = vi.fn(async () => reader)
    const onFrameReady = vi.fn()
    const provider = new SequenceFrameProvider({ open, onFrameReady })

    provider.requestFrame(0)
    provider.requestFrame(0)
    await flush()

    expect(open).toHaveBeenCalledTimes(1)
    expect(readSpy).toHaveBeenCalledTimes(1)

    resolveFrame(0)
    await flush()

    expect(provider.getCurrent(0)).not.toBeNull()
    expect(onFrameReady).toHaveBeenCalledWith(0)
  })

  it('evicts the oldest cached frame past maxCachedFrames', async () => {
    const { reader, resolveFrame } = makeControlledReader()
    const provider = new SequenceFrameProvider({ open: async () => reader, maxCachedFrames: 2 })

    provider.requestFrame(0)
    await flush()
    const img0 = makeImage(0)
    resolveFrame(0, img0)
    await flush()

    provider.requestFrame(1)
    await flush()
    resolveFrame(1, makeImage(1))
    await flush()

    provider.requestFrame(2)
    await flush()
    resolveFrame(2, makeImage(2))
    await flush()

    expect(img0.closeSpy).toHaveBeenCalledTimes(1)
    expect(provider.getCurrent(0)).toBeNull()
    expect(provider.getCurrent(1)).not.toBeNull()
    expect(provider.getCurrent(2)).not.toBeNull()
  })

  it('maxInFlight 2: requesting 0, 1, 2 reads 0 and 1 first, 2 after one settles', async () => {
    const { reader, readSpy, resolveFrame, pendingCount } = makeControlledReader()
    const provider = new SequenceFrameProvider({ open: async () => reader, maxInFlight: 2 })

    provider.requestFrame(0)
    provider.requestFrame(1)
    provider.requestFrame(2)
    await flush()

    expect(readSpy).toHaveBeenCalledTimes(2)
    expect(readSpy).toHaveBeenCalledWith(0)
    expect(readSpy).toHaveBeenCalledWith(1)
    expect(pendingCount()).toBe(2)

    resolveFrame(0)
    await flush()

    expect(readSpy).toHaveBeenCalledTimes(3)
    expect(readSpy).toHaveBeenCalledWith(2)
  })

  it('maps getCurrent past frameCount-1 to the last frame', async () => {
    const { reader, resolveFrame } = makeControlledReader(1)
    const provider = new SequenceFrameProvider({ open: async () => reader })

    provider.requestFrame(0)
    await flush()
    resolveFrame(0)
    await flush()

    expect(provider.getCurrent(3)).not.toBeNull()
  })

  it('a rejected open sets state failed; retries only after retryAfterMs', async () => {
    let now = 0
    const open = vi.fn(async () => {
      throw new Error('open failed')
    })
    const provider = new SequenceFrameProvider({ open, retryAfterMs: 1000, now: () => now })

    provider.requestFrame(0)
    await flush()
    expect(provider.state).toBe('failed')
    expect(open).toHaveBeenCalledTimes(1)

    provider.requestFrame(0)
    await flush()
    expect(open).toHaveBeenCalledTimes(1) // still within retryAfterMs

    now = 1001
    provider.requestFrame(0)
    await flush()
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('dispose() closes cached images and the reader; a late read is closed on arrival', async () => {
    const { reader, resolveFrame, closeSpy: readerClose } = makeControlledReader()
    const provider = new SequenceFrameProvider({ open: async () => reader })

    provider.requestFrame(0)
    await flush()
    provider.requestFrame(1)
    await flush()
    resolveFrame(0)
    await flush()

    provider.dispose()
    expect(readerClose).toHaveBeenCalledTimes(1)

    const lateImg = makeImage(1)
    resolveFrame(1, lateImg)
    await flush()
    expect(lateImg.closeSpy).toHaveBeenCalledTimes(1)
  })

  it('prewarm(3, 3, 4, true) requests 3, 0, 1', async () => {
    const { reader, readSpy } = makeControlledReader(4)
    const provider = new SequenceFrameProvider({ open: async () => reader, maxInFlight: 10 })

    provider.prewarm(3, 3, 4, true)
    await flush()

    expect(readSpy.mock.calls.map((c) => c[0])).toEqual([3, 0, 1])
  })

  it('prewarm(3, 3, 4, false) requests 3 only', async () => {
    const { reader, readSpy } = makeControlledReader(4)
    const provider = new SequenceFrameProvider({ open: async () => reader, maxInFlight: 10 })

    provider.prewarm(3, 3, 4, false)
    await flush()

    expect(readSpy.mock.calls.map((c) => c[0])).toEqual([3])
  })

  it('isKnownMissing: false while in flight, true once the read failed, false again once cached', async () => {
    const { reader, resolveFrame, rejectFrame } = makeControlledReader(8)
    const provider = new SequenceFrameProvider({ open: async () => reader, retryAfterMs: 0, now: () => 0 })

    expect(provider.isKnownMissing(4)).toBe(false) // not open yet
    provider.requestFrame(4)
    await flush()
    expect(provider.isKnownMissing(4)).toBe(false) // in flight
    rejectFrame(4)
    await flush()
    expect(provider.isKnownMissing(4)).toBe(true)
    expect(provider.isKnownMissing(3)).toBe(false) // never requested

    provider.requestFrame(4) // retry (retryAfterMs 0) succeeds
    await flush()
    resolveFrame(4)
    await flush()
    expect(provider.isKnownMissing(4)).toBe(false)
  })

  it('onOpen fires once per successful open', async () => {
    const { reader } = makeControlledReader()
    const onOpen = vi.fn()
    const provider = new SequenceFrameProvider({ open: async () => reader, onOpen })

    provider.requestFrame(0)
    await flush()
    provider.requestFrame(0)
    await flush()

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(reader)
  })
})
