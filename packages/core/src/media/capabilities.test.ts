import { describe, expect, it } from 'vitest'
import { probeImageDecode, probeWebmAlpha } from './capabilities'

describe('probeImageDecode', () => {
  it('reports no support with an empty scope', async () => {
    const result = await probeImageDecode({})
    expect(result.imageDecoder).toBe(false)
    expect(result.types).toEqual({
      'image/gif': false,
      'image/webp': false,
      'image/png': false,
      'image/avif': false,
    })
  })

  it('reports per-type support from a scope that has ImageDecoder', async () => {
    const result = await probeImageDecode({
      ImageDecoder: { isTypeSupported: async (t) => t === 'image/gif' },
    })
    expect(result.imageDecoder).toBe(true)
    expect(result.types).toEqual({
      'image/gif': true,
      'image/webp': false,
      'image/png': false,
      'image/avif': false,
    })
  })

  it('treats a throwing isTypeSupported as false for only that type', async () => {
    const result = await probeImageDecode({
      ImageDecoder: {
        isTypeSupported: async (t) => {
          if (t === 'image/webp') throw new Error('boom')
          return t === 'image/png'
        },
      },
    })
    expect(result.imageDecoder).toBe(true)
    expect(result.types).toEqual({
      'image/gif': false,
      'image/webp': false,
      'image/png': true,
      'image/avif': false,
    })
  })
})

describe('probeWebmAlpha', () => {
  it('resolves as skipped under node, without importing mediabunny', async () => {
    const start = performance.now()
    const result = await probeWebmAlpha()
    const elapsed = performance.now() - start
    expect(result).toEqual({
      videoEncoder: false,
      rawAlphaKeep: false,
      mediabunnyAlphaKeep: false,
      roundTrip: 'skipped',
      canBeTransparent: null,
    })
    // Importing mediabunny (a real demuxer/encoder library) would be far
    // slower than this; a fast resolve is itself evidence the early return
    // fired before any `import('mediabunny')`.
    expect(elapsed).toBeLessThan(1000)
  })
})
