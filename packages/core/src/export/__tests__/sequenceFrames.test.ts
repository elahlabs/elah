import { describe, it, expect, vi } from 'vitest'
import { createSequenceFrameStore } from '../sequenceFrames'
import type { ActiveSequenceClip } from '../../resolver/scene'
import type { SequenceFallback, SequenceFrameReader, SequenceImage } from '../../media/sequence/SequenceReader'

function seqItem(overrides: Partial<ActiveSequenceClip> = {}): ActiveSequenceClip {
  return {
    id: 'seq1',
    trackId: 'track1',
    name: 'seq',
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
    type: 'sequence',
    kind: 'animated-image',
    src: 'blob:src1',
    frameCount: 4,
    frameIndex: 0,
    ...overrides,
  }
}

/** A fake reader whose `read` counts calls and returns spy-able images. */
function fakeReader(opts: { frameCount?: number; fallback?: SequenceFallback | null } = {}): {
  reader: SequenceFrameReader
  readSpy: ReturnType<typeof vi.fn>
  images: Map<number, SequenceImage & { close: ReturnType<typeof vi.fn> }>
  closeSpy: ReturnType<typeof vi.fn>
} {
  const images = new Map<number, SequenceImage & { close: ReturnType<typeof vi.fn> }>()
  const closeSpy = vi.fn()
  const readSpy = vi.fn(async (index: number) => {
    let img = images.get(index)
    if (!img) {
      const close = vi.fn()
      img = { source: {} as ImageBitmap, width: 8, height: 8, close } as unknown as SequenceImage & { close: ReturnType<typeof vi.fn> }
      images.set(index, img)
    }
    return img
  })
  const reader: SequenceFrameReader = {
    frameCount: opts.frameCount ?? 4,
    fallback: opts.fallback ?? null,
    read: readSpy as unknown as SequenceFrameReader['read'],
    close: closeSpy,
  }
  return { reader, readSpy, images, closeSpy }
}

describe('createSequenceFrameStore', () => {
  it('frameFor(key, item@0) called twice decodes read(0) only once', async () => {
    const { reader, readSpy } = fakeReader()
    const open = vi.fn(async () => reader)
    const store = createSequenceFrameStore({ open })

    const a = await store.frameFor('a', seqItem({ frameIndex: 0 }))
    const b = await store.frameFor('a', seqItem({ frameIndex: 0 }))

    expect(readSpy).toHaveBeenCalledTimes(1)
    expect(readSpy).toHaveBeenCalledWith(0)
    expect(a).toBe(b)
  })

  it('index 0 -> 1 reads frame 1 and closes the held image for frame 0', async () => {
    const { reader, images } = fakeReader()
    const open = vi.fn(async () => reader)
    const store = createSequenceFrameStore({ open })

    await store.frameFor('a', seqItem({ frameIndex: 0 }))
    const img0 = images.get(0)!
    await store.frameFor('a', seqItem({ frameIndex: 1 }))

    expect(img0.close).toHaveBeenCalledTimes(1)
    expect(images.get(1)!.close).not.toHaveBeenCalled()
  })

  it('two keys whose items share a src open the reader once, each key holds its own image', async () => {
    const { reader, readSpy } = fakeReader()
    const open = vi.fn(async () => reader)
    const store = createSequenceFrameStore({ open })

    const a = await store.frameFor('a', seqItem({ frameIndex: 0 }))
    const b = await store.frameFor('b', seqItem({ frameIndex: 1 }))

    expect(open).toHaveBeenCalledTimes(1)
    expect(readSpy).toHaveBeenCalledTimes(2)
    expect(a).not.toBe(b)
  })

  it('retain closes the image held under a key not in the active set', async () => {
    const { reader, images } = fakeReader()
    const open = vi.fn(async () => reader)
    const store = createSequenceFrameStore({ open })

    await store.frameFor('a', seqItem({ frameIndex: 0 }))
    await store.frameFor('b', seqItem({ frameIndex: 1 }))

    store.retain(new Set(['a']))

    expect(images.get(1)!.close).toHaveBeenCalledTimes(1)
    expect(images.get(0)!.close).not.toHaveBeenCalled()
  })

  it('a reader with frameCount 1 and frameIndex 3 reads frame 0', async () => {
    const { reader, readSpy } = fakeReader({ frameCount: 1 })
    const open = vi.fn(async () => reader)
    const store = createSequenceFrameStore({ open })

    await store.frameFor('a', seqItem({ frameIndex: 3 }))

    expect(readSpy).toHaveBeenCalledWith(0)
  })

  it('a rejected open resolves frameFor to null, calls onError once for the source across 3 frames, and never throws', async () => {
    const open = vi.fn(async () => {
      throw new Error('network down')
    })
    const onError = vi.fn()
    const store = createSequenceFrameStore({ open, onError })

    const r1 = await store.frameFor('a', seqItem({ frameIndex: 0 }))
    const r2 = await store.frameFor('a', seqItem({ frameIndex: 1 }))
    const r3 = await store.frameFor('a', seqItem({ frameIndex: 2 }))

    expect(r1).toBeNull()
    expect(r2).toBeNull()
    expect(r3).toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('a reader reporting a fallback calls onFallback once per source', async () => {
    const { reader } = fakeReader({ fallback: 'no-image-decoder' })
    const open = vi.fn(async () => reader)
    const onFallback = vi.fn()
    const store = createSequenceFrameStore({ open, onFallback })

    await store.frameFor('a', seqItem({ frameIndex: 0 }))
    await store.frameFor('b', seqItem({ frameIndex: 1 }))

    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(onFallback).toHaveBeenCalledWith(expect.anything(), 'no-image-decoder')
  })

  it('dispose closes every held image and every opened reader', async () => {
    const { reader, images, closeSpy } = fakeReader()
    const open = vi.fn(async () => reader)
    const store = createSequenceFrameStore({ open })

    await store.frameFor('a', seqItem({ frameIndex: 0 }))
    await store.frameFor('b', seqItem({ frameIndex: 1 }))

    store.dispose()

    expect(images.get(0)!.close).toHaveBeenCalledTimes(1)
    expect(images.get(1)!.close).toHaveBeenCalledTimes(1)
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('a frame that fails to decode calls onError and returns null without caching', async () => {
    const reader: SequenceFrameReader = {
      frameCount: 4,
      fallback: null,
      read: vi.fn(async () => {
        throw new Error('decode failed')
      }),
      close: vi.fn(),
    }
    const open = vi.fn(async () => reader)
    const onError = vi.fn()
    const store = createSequenceFrameStore({ open, onError })

    const result = await store.frameFor('a', seqItem({ frameIndex: 0 }))

    expect(result).toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
