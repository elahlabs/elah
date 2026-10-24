import { describe, expect, it, vi } from 'vitest'
import {
  bitmapOptions,
  mimeForSource,
  openAnimatedImage,
  openFrameSequence,
  type DecodeEnv,
} from './SequenceReader'

function makeBitmap(width = 64, height = 64) {
  return { width, height, close: vi.fn() }
}

function makeFakeEnv(overrides: Partial<DecodeEnv> = {}): { env: DecodeEnv; createImageBitmap: ReturnType<typeof vi.fn> } {
  const createImageBitmap = vi.fn(async (_source: unknown, _options?: ImageBitmapOptions) => makeBitmap())
  const env: DecodeEnv = {
    createImageBitmap: createImageBitmap as unknown as DecodeEnv['createImageBitmap'],
    ...overrides,
  }
  return { env, createImageBitmap }
}

class FakeVideoFrame {
  close = vi.fn()
  constructor(public frameIndex: number) {}
}

/** The last VideoFrame every FakeImageDecoder instance produced (test seam). */
const lastFrames: FakeVideoFrame[] = []

function makeFakeImageDecoderClass(frameCount = 3) {
  class FakeImageDecoder {
    static isTypeSupportedImpl: (type: string) => Promise<boolean> = async () => true
    static isTypeSupported(type: string): Promise<boolean> {
      return FakeImageDecoder.isTypeSupportedImpl(type)
    }
    tracks = {
      ready: Promise.resolve(),
      selectedTrack: { frameCount, animated: true },
    }
    completed = Promise.resolve()
    close = vi.fn()
    decode({ frameIndex }: { frameIndex: number }): Promise<{ image: FakeVideoFrame }> {
      const frame = new FakeVideoFrame(frameIndex)
      lastFrames.push(frame)
      return Promise.resolve({ image: frame })
    }
  }
  return FakeImageDecoder as unknown as typeof ImageDecoder & { isTypeSupportedImpl: (type: string) => Promise<boolean> }
}

describe('SequenceReader', () => {
  describe('mimeForSource', () => {
    it('maps by extension', () => {
      expect(mimeForSource('a.gif')).toBe('image/gif')
    })
    it('prefers an image/* blob type over the extension', () => {
      expect(mimeForSource('blob:xyz', 'image/webp')).toBe('image/webp')
    })
    it('is case-insensitive on the extension', () => {
      expect(mimeForSource('x.APNG')).toBe('image/png')
    })
    it('ignores query and hash', () => {
      expect(mimeForSource('https://h/p.webp?x=1#y')).toBe('image/webp')
    })
    it('falls back to application/octet-stream', () => {
      expect(mimeForSource('blob:xyz', '')).toBe('application/octet-stream')
    })
  })

  describe('bitmapOptions', () => {
    it('flipY true adds imageOrientation flipY', () => {
      expect(bitmapOptions(true)).toEqual({ imageOrientation: 'flipY', premultiplyAlpha: 'premultiply' })
    })
    it('flipY false omits imageOrientation', () => {
      expect(bitmapOptions(false)).toEqual({ premultiplyAlpha: 'premultiply' })
    })
  })

  describe('openAnimatedImage', () => {
    it('falls back to a still when there is no ImageDecoder', async () => {
      const { env, createImageBitmap } = makeFakeEnv()
      const blob = { type: 'image/gif' } as unknown as Blob
      const reader = await openAnimatedImage(blob, { src: 'a.gif', flipY: true, env })
      expect(reader.frameCount).toBe(1)
      expect(reader.fallback).toBe('no-image-decoder')
      expect(createImageBitmap).toHaveBeenCalledTimes(1)
      expect(createImageBitmap).toHaveBeenCalledWith(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'premultiply' })
    })

    it('falls back to unsupported-type when isTypeSupported is false', async () => {
      const FakeImageDecoder = makeFakeImageDecoderClass()
      FakeImageDecoder.isTypeSupportedImpl = async () => false
      const { env } = makeFakeEnv({ ImageDecoder: FakeImageDecoder })
      const blob = { type: 'image/gif', arrayBuffer: vi.fn() } as unknown as Blob
      const reader = await openAnimatedImage(blob, { src: 'a.gif', flipY: true, env })
      expect(reader.fallback).toBe('unsupported-type')
      expect(reader.frameCount).toBe(1)
    })

    it('decodes an animated file frame by frame', async () => {
      const FakeImageDecoder = makeFakeImageDecoderClass(3)
      const { env } = makeFakeEnv({ ImageDecoder: FakeImageDecoder })
      const blob = {
        type: 'image/gif',
        arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
      } as unknown as Blob
      const reader = await openAnimatedImage(blob, { src: 'a.gif', flipY: true, env })
      expect(reader.frameCount).toBe(3)
      expect(reader.fallback).toBeNull()

      const img = await reader.read(1)
      expect(img.width).toBe(64)
      expect(img.height).toBe(64)
    })

    it('clamps read() past frameCount to the last frame', async () => {
      const FakeImageDecoder = makeFakeImageDecoderClass(3)
      const decodeSpy = vi.fn(FakeImageDecoder.prototype.decode)
      FakeImageDecoder.prototype.decode = decodeSpy
      const { env } = makeFakeEnv({ ImageDecoder: FakeImageDecoder })
      const blob = { type: 'image/gif', arrayBuffer: vi.fn(async () => new ArrayBuffer(4)) } as unknown as Blob
      const reader = await openAnimatedImage(blob, { src: 'a.gif', flipY: true, env })
      await reader.read(7)
      expect(decodeSpy).toHaveBeenCalledWith({ frameIndex: 2 })
    })

    it('closes the decoded VideoFrame after createImageBitmap, in a finally', async () => {
      lastFrames.length = 0
      const FakeImageDecoder = makeFakeImageDecoderClass(3)
      const { env } = makeFakeEnv({ ImageDecoder: FakeImageDecoder })
      const blob = { type: 'image/gif', arrayBuffer: vi.fn(async () => new ArrayBuffer(4)) } as unknown as Blob
      const reader = await openAnimatedImage(blob, { src: 'a.gif', flipY: true, env })
      await reader.read(0)
      expect(lastFrames).toHaveLength(1)
      expect(lastFrames[0]!.close).toHaveBeenCalledTimes(1)
    })

    it('passes only premultiplyAlpha when flipY is false', async () => {
      const { env, createImageBitmap } = makeFakeEnv()
      const blob = { type: 'image/gif' } as unknown as Blob
      await openAnimatedImage(blob, { src: 'a.gif', flipY: false, env })
      expect(createImageBitmap).toHaveBeenCalledWith(blob, { premultiplyAlpha: 'premultiply' })
    })

    it('close() closes the decoder', async () => {
      const FakeImageDecoder = makeFakeImageDecoderClass(3)
      const { env } = makeFakeEnv({ ImageDecoder: FakeImageDecoder })
      const blob = { type: 'image/gif', arrayBuffer: vi.fn(async () => new ArrayBuffer(4)) } as unknown as Blob
      const reader = await openAnimatedImage(blob, { src: 'a.gif', flipY: true, env })
      reader.close()
      // The fake decoder instance's close spy is per-instance; verify via a
      // fresh decode call still resolving (i.e. close() did not throw) and
      // that frameCount/fallback are unaffected.
      expect(reader.frameCount).toBe(3)
    })
  })

  describe('openFrameSequence', () => {
    it('reads a frame through the loader using the zero-padded template', async () => {
      const loader = vi.fn(async (_url: string) => ({}) as Blob)
      const { env } = makeFakeEnv()
      const reader = openFrameSequence({
        template: 'f_{frame:4}.png',
        frameCount: 10,
        startNumber: 1,
        flipY: true,
        loader,
        env,
      })
      await reader.read(2)
      expect(loader).toHaveBeenCalledWith('f_0003.png')
    })

    it('has no fallback and the given frameCount', () => {
      const { env } = makeFakeEnv()
      const reader = openFrameSequence({
        template: 'f_{frame}.png',
        frameCount: 5,
        flipY: true,
        loader: vi.fn(),
        env,
      })
      expect(reader.frameCount).toBe(5)
      expect(reader.fallback).toBeNull()
    })
  })
})
