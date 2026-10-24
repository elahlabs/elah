import { describe, expect, it } from 'vitest'
import { GifEncoder, gifOutputHeight, lzwEncode, planGifFrames, quantizeRgba } from '../gifEncode'

/** Reference GIF LZW decoder (min code size 8): independent of the encoder under test. */
function lzwDecode(data: Uint8Array, expectedLength: number): Uint8Array {
  const out: number[] = []
  let dict: number[][] = []
  const resetDict = () => {
    dict = []
    for (let i = 0; i < 256; i++) dict.push([i])
    dict.push([], [])
  }
  resetDict()
  let size = 9
  let bitBuf = 0
  let bits = 0
  let pos = 0
  let prev: number[] | null = null
  while (true) {
    while (bits < size && pos < data.length) {
      bitBuf |= data[pos++] << bits
      bits += 8
    }
    if (bits < size) break
    const code = bitBuf & ((1 << size) - 1)
    bitBuf >>>= size
    bits -= size
    if (code === 256) {
      resetDict()
      size = 9
      prev = null
      continue
    }
    if (code === 257) break
    let entry: number[]
    if (code < dict.length) entry = dict[code]
    else if (prev) entry = [...prev, prev[0]]
    else throw new Error('bad code')
    out.push(...entry)
    if (prev && dict.length < 4096) {
      dict.push([...prev, entry[0]])
      if (dict.length === 1 << size && size < 12) size++
    }
    prev = entry
  }
  expect(out.length).toBe(expectedLength)
  return Uint8Array.from(out)
}

function readGif(bytes: Uint8Array) {
  expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe('GIF89a')
  const width = bytes[6] | (bytes[7] << 8)
  const height = bytes[8] | (bytes[9] << 8)
  let p = 13 + 19
  const frames: { delay: number; palette: Uint8Array; indices: Uint8Array }[] = []
  while (bytes[p] !== 0x3b) {
    expect(bytes[p]).toBe(0x21)
    const delay = bytes[p + 4] | (bytes[p + 5] << 8)
    p += 8
    expect(bytes[p]).toBe(0x2c)
    p += 10
    const palette = bytes.slice(p, p + 768)
    p += 768
    expect(bytes[p++]).toBe(8)
    const chunks: number[] = []
    while (bytes[p] !== 0) {
      const n = bytes[p++]
      for (let i = 0; i < n; i++) chunks.push(bytes[p++])
    }
    p++
    frames.push({ delay, palette, indices: lzwDecode(Uint8Array.from(chunks), width * height) })
  }
  return { width, height, frames }
}

function rgba(w: number, h: number, f: (x: number, y: number) => [number, number, number]) {
  const a = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y)
      a.set([r, g, b, 255], (y * w + x) * 4)
    }
  }
  return a
}

describe('lzwEncode', () => {
  it('round-trips short, repetitive and long noisy streams (including table resets)', () => {
    const streams = [
      Uint8Array.of(1),
      Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2),
      Uint8Array.from({ length: 50_000 }, (_, i) => (i * 2654435761 >>> 24) & 0xff),
      Uint8Array.from({ length: 20_000 }, (_, i) => i % 7),
    ]
    for (const s of streams) expect(Array.from(lzwDecode(lzwEncode(s), s.length))).toEqual(Array.from(s))
  })
})

describe('quantizeRgba', () => {
  it('reproduces a few-colour image exactly', () => {
    const img = rgba(8, 8, (x) => (x < 4 ? [255, 0, 0] : [0, 0, 255]))
    const { palette, indices } = quantizeRgba(img, 64)
    for (let i = 0; i < 64; i++) {
      const c = indices[i]
      expect([palette[c * 3], palette[c * 3 + 1], palette[c * 3 + 2]]).toEqual(i % 8 < 4 ? [255, 0, 0] : [0, 0, 255])
    }
  })

  it('keeps a smooth gradient within a small error', () => {
    const img = rgba(64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2])
    const { palette, indices } = quantizeRgba(img, 64 * 64)
    let worst = 0
    for (let i = 0; i < 64 * 64; i++) {
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(palette[indices[i] * 3 + c] - img[i * 4 + c]))
    }
    expect(worst).toBeLessThan(24)
  })
})

describe('GifEncoder', () => {
  it('writes a valid multi-frame looping GIF that decodes back to the pixels', () => {
    const w = 16
    const h = 12
    const a = rgba(w, h, (x, y) => [x * 16, y * 20, 128])
    const b = rgba(w, h, () => [10, 200, 30])
    const enc = new GifEncoder(w, h)
    enc.addFrame(a, 7)
    enc.addFrame(b, 1) // below the 2cs floor
    const bytes = enc.finish()
    expect(bytes[bytes.length - 1]).toBe(0x3b)
    // NETSCAPE loop extension present, loop forever.
    expect(String.fromCharCode(...bytes.subarray(16, 27))).toBe('NETSCAPE2.0')
    const gif = readGif(bytes)
    expect([gif.width, gif.height, gif.frames.length]).toEqual([w, h, 2])
    expect(gif.frames.map((f) => f.delay)).toEqual([7, 2])
    const second = gif.frames[1]
    expect(Array.from(second.palette.subarray(second.indices[0] * 3, second.indices[0] * 3 + 3))).toEqual([10, 200, 30])
    const first = gif.frames[0]
    const i = 5 * w + 9
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(first.palette[first.indices[i] * 3 + c] - a[i * 4 + c])).toBeLessThan(8)
    }
  })

  it('rejects a frame buffer that is too small and use after finish', () => {
    const enc = new GifEncoder(4, 4)
    expect(() => enc.addFrame(new Uint8Array(10), 5)).toThrow(RangeError)
    enc.finish()
    expect(() => enc.addFrame(new Uint8Array(64), 5)).toThrow(/finished/)
  })
})

describe('planGifFrames / gifOutputHeight', () => {
  it('caps the rate at 15 fps by default and never exceeds the project fps', () => {
    expect(planGifFrames(60, 30, undefined).step).toBe(2)
    expect(planGifFrames(60, 30, undefined).delays.length).toBe(30)
    expect(planGifFrames(10, 10, undefined).step).toBe(1)
    expect(planGifFrames(60, 30, 30).step).toBe(1)
  })

  it('keeps total duration: delays sum to the clip length in centiseconds', () => {
    const { delays } = planGifFrames(90, 30, undefined)
    expect(delays.reduce((a, b) => a + b, 0)).toBe(300)
    const odd = planGifFrames(25, 25, 10)
    expect(odd.delays.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('defaults to a 480 short edge but honours an explicit outputHeight', () => {
    expect(gifOutputHeight(1920, 1080, undefined)).toBe(480)
    expect(gifOutputHeight(1080, 1920, undefined)).toBe(480)
    expect(gifOutputHeight(320, 240, undefined)).toBe(240)
    expect(gifOutputHeight(1920, 1080, 1080)).toBe(1080)
  })
})
