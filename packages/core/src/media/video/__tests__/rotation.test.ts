/**
 * Source rotation (iPhone portrait .MOV = landscape pixels + 90 in the
 * container). Covers the pure mapping, the mediabunny adapter, and that the
 * rotation reaches the provider that VideoLayer reads.
 */
import { describe, expect, it, vi } from 'vitest'
import { displaySizeFor, displayToSourceUv, normalizeRotation, type VideoRotation } from '../rotation'
import { createMediabunnyBackend, type MediabunnyModule } from '../demuxer/createMediabunnyBackend'
import { MediabunnyDemuxer } from '../demuxer/MediabunnyDemuxer'
import { StreamingFrameProducer } from '../StreamingFrameProducer'
import { createMockChunk, createMockDecoder, createMockDemuxerBackend } from './helpers/mockDemuxer'

const ANGLES: VideoRotation[] = [0, 90, 180, 270]

describe('displaySizeFor', () => {
  it('keeps w/h for 0 and 180, swaps for 90 and 270', () => {
    expect(displaySizeFor(1920, 1080, 0)).toEqual({ width: 1920, height: 1080 })
    expect(displaySizeFor(1920, 1080, 180)).toEqual({ width: 1920, height: 1080 })
    expect(displaySizeFor(1920, 1080, 90)).toEqual({ width: 1080, height: 1920 })
    expect(displaySizeFor(1920, 1080, 270)).toEqual({ width: 1080, height: 1920 })
  })
})

describe('normalizeRotation', () => {
  it('passes valid angles and zeroes anything else', () => {
    for (const a of ANGLES) expect(normalizeRotation(a)).toBe(a)
    expect(normalizeRotation(45)).toBe(0)
    expect(normalizeRotation(undefined)).toBe(0)
  })
})

describe('displayToSourceUv', () => {
  // Rotate a raw pixel grid clockwise by `angle` the textbook way and check
  // that sampling it through displayToSourceUv reproduces that picture.
  function rotateCw(grid: number[][], angle: VideoRotation): number[][] {
    let g = grid
    for (let i = 0; i < angle / 90; i++) {
      const h = g.length
      const w = g[0].length
      const out = Array.from({ length: w }, () => new Array<number>(h).fill(0))
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x][h - 1 - y] = g[y][x]
      g = out
    }
    return g
  }

  it.each(ANGLES)('samples the raw frame as an upright image at %i deg', (angle) => {
    // 4 wide x 2 tall raw image, every pixel distinct (landscape coded pixels).
    const raw = [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]
    const upright = rotateCw(raw, angle)
    const dh = upright.length
    const dw = upright[0].length
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const s = displayToSourceUv(angle, (x + 0.5) / dw, (y + 0.5) / dh)
        const rx = Math.floor(s.x * 4)
        const ry = Math.floor(s.y * 2)
        expect(raw[ry][rx]).toBe(upright[y][x])
      }
    }
  })

  it('iPhone portrait (90): display top-left shows the raw bottom-left', () => {
    expect(displayToSourceUv(90, 0, 0)).toEqual({ x: 0, y: 1 })
    expect(displayToSourceUv(90, 1, 0)).toEqual({ x: 0, y: 0 })
    expect(displayToSourceUv(90, 0, 1)).toEqual({ x: 1, y: 1 })
    expect(displayToSourceUv(90, 1, 1)).toEqual({ x: 1, y: 0 })
  })
})

describe('createMediabunnyBackend rotation', () => {
  function mbWith(rotation: number | undefined): MediabunnyModule {
    const track: Record<string, unknown> = {
      getDecoderConfig: vi.fn(async () => ({ codec: 'avc1.42001e' })),
    }
    if (rotation !== undefined) track.getRotation = vi.fn(async () => rotation)
    return {
      Input: vi.fn(() => ({ getPrimaryVideoTrack: vi.fn(async () => track) })),
      BlobSource: vi.fn(() => ({})),
      EncodedPacketSink: vi.fn(() => ({})),
      ALL_FORMATS: [],
    } as unknown as MediabunnyModule
  }

  it.each(ANGLES)('reports the track rotation %i after open()', async (angle) => {
    const backend = createMediabunnyBackend(mbWith(angle), { blobResolver: async () => new Blob(['x']) })
    await backend.open('blob:x')
    expect(backend.getRotation?.()).toBe(angle)
  })

  it('defaults to 0 when the track exposes no rotation', async () => {
    const backend = createMediabunnyBackend(mbWith(undefined), { blobResolver: async () => new Blob(['x']) })
    await backend.open('blob:x')
    expect(backend.getRotation?.()).toBe(0)
  })
})

describe('rotation through the provider', () => {
  it('MediabunnyDemuxer defaults to 0 for a backend without getRotation', async () => {
    const d = new MediabunnyDemuxer(() => createMockDemuxerBackend({ chunks: [] }))
    await d.open('x')
    expect(d.getRotation()).toBe(0)
  })

  it.each(ANGLES)('StreamingFrameProducer exposes the source rotation %i', async (angle) => {
    const backend = { ...createMockDemuxerBackend({ chunks: [createMockChunk(0)] }), getRotation: () => angle }
    const producer = new StreamingFrameProducer({
      src: 'video://rot.mov',
      fps: 30,
      demuxerFactory: () => backend,
      decoderFactory: createMockDecoder().factory,
    })
    expect(producer.rotation).toBe(0) // not opened yet
    await producer.openPromise
    expect(producer.rotation).toBe(angle)
    producer.dispose()
  })
})
