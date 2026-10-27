import { describe, expect, it, vi } from 'vitest'
import { fpsFromFrameDurations, probeAnimatedImage, probeAnimatedImageSrc } from './probeAnimatedImage'
import type { DecodeEnv } from './SequenceReader'

describe('fpsFromFrameDurations', () => {
  it('averages three equal 100ms frames to 10fps', () => {
    expect(fpsFromFrameDurations([100000, 100000, 100000])).toBe(10)
  })

  it('averages two 40ms frames to 25fps', () => {
    expect(fpsFromFrameDurations([40000, 40000])).toBe(25)
  })

  it('treats a missing or too-short duration as 100ms', () => {
    expect(fpsFromFrameDurations([null, 0, 10000])).toBe(10)
  })

  it('rounds to 3 decimals', () => {
    expect(fpsFromFrameDurations([16667])).toBe(59.999)
  })

  it('clamps to 60', () => {
    expect(fpsFromFrameDurations([10001])).toBe(60)
  })

  it('clamps to 1', () => {
    expect(fpsFromFrameDurations([2_000_000])).toBe(1)
  })

  it('defaults to 10 for empty input', () => {
    expect(fpsFromFrameDurations([])).toBe(10)
  })

  it('averages two near-33ms frames to 30fps', () => {
    expect(fpsFromFrameDurations([33333, 33334])).toBe(30)
  })
})

/** Fake WebCodecs `ImageDecoder`: 3 frames, durations 100000/100000/50000, 64x64. */
class FakeAnimatedDecoder {
  static frames = [
    { duration: 100000, displayWidth: 64, displayHeight: 64 },
    { duration: 100000, displayWidth: 64, displayHeight: 64 },
    { duration: 50000, displayWidth: 64, displayHeight: 64 },
  ]
  static closedFrames = 0
  static isTypeSupported = vi.fn(async () => true)

  tracks = {
    ready: Promise.resolve(),
    selectedTrack: { animated: true, frameCount: 3 },
  }
  completed = Promise.resolve()
  closed = false

  constructor(_init: { data: ArrayBuffer; type: string }) {}

  async decode({ frameIndex }: { frameIndex: number }) {
    const f = FakeAnimatedDecoder.frames[frameIndex]!
    return {
      image: {
        duration: f.duration,
        displayWidth: f.displayWidth,
        displayHeight: f.displayHeight,
        close: () => {
          FakeAnimatedDecoder.closedFrames += 1
        },
      },
    }
  }

  close() {
    this.closed = true
  }
}

class FakeStillDecoder {
  static isTypeSupported = vi.fn(async () => true)
  tracks = { ready: Promise.resolve(), selectedTrack: { animated: false, frameCount: 1 } }
  completed = Promise.resolve()
  constructor(_init: { data: ArrayBuffer; type: string }) {}
  async decode() {
    throw new Error('should not decode a non-animated image')
  }
  close() {}
}

function fakeBlob(bytes = 10): Blob {
  return {
    arrayBuffer: async () => new ArrayBuffer(bytes),
    type: 'image/gif',
  } as unknown as Blob
}

describe('probeAnimatedImage', () => {
  it('reads frame count/fps/size from an animated decoder and closes every frame', async () => {
    FakeAnimatedDecoder.closedFrames = 0
    const env: DecodeEnv = {
      ImageDecoder: FakeAnimatedDecoder as unknown as typeof ImageDecoder,
      createImageBitmap: vi.fn(),
    }
    const result = await probeAnimatedImage(fakeBlob(), 'image/gif', env)
    expect(result).toEqual({ frameCount: 3, fps: 12, width: 64, height: 64 })
    expect(FakeAnimatedDecoder.closedFrames).toBe(3)
  })

  it('returns null for a non-animated decode', async () => {
    const env: DecodeEnv = {
      ImageDecoder: FakeStillDecoder as unknown as typeof ImageDecoder,
      createImageBitmap: vi.fn(),
    }
    const result = await probeAnimatedImage(fakeBlob(), 'image/gif', env)
    expect(result).toBeNull()
  })
})

describe('probeAnimatedImageSrc', () => {
  it('returns null without fetching when the env has no ImageDecoder', async () => {
    const resolveBlob = vi.fn(async () => fakeBlob())
    const env: DecodeEnv = { createImageBitmap: vi.fn() }
    const result = await probeAnimatedImageSrc('blob:x', 'a.gif', env, resolveBlob)
    expect(result).toBeNull()
    expect(resolveBlob).not.toHaveBeenCalled()
  })

  it('returns null without fetching for a non-animatable extension', async () => {
    const resolveBlob = vi.fn(async () => fakeBlob())
    const env: DecodeEnv = {
      ImageDecoder: FakeAnimatedDecoder as unknown as typeof ImageDecoder,
      createImageBitmap: vi.fn(),
    }
    const result = await probeAnimatedImageSrc('blob:x', 'x.jpg', env, resolveBlob)
    expect(result).toBeNull()
    expect(resolveBlob).not.toHaveBeenCalled()
  })
})
