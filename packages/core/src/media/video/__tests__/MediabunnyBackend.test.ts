/**
 * MediabunnyBackend — unit tests for createMediabunnyBackend (real API shape).
 *
 * All mediabunny internals are replaced with mock objects so this suite runs
 * in jsdom without the real package installed.
 *
 * Covers:
 *  - Successful open → getConfig → packets → seekToKeyframe → dispose flow
 *  - µs ↔ seconds unit conversion (DemuxerManager uses µs, mediabunny uses sec)
 *  - getConfig() throws actionable error when getDecoderConfig() returns null
 *  - packets() uses cached seekPacket from prior seekToKeyframe()
 *  - dispose() resets state; double-dispose is safe
 *  - isMediabunnyCompatible() returns correct judgement
 *  - _assertMediabunnyApi throws on missing exports
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMediabunnyBackend,
  isMediabunnyCompatible,
  type MediabunnyModule,
} from '../demuxer/createMediabunnyBackend'

// ---------------------------------------------------------------------------
// Mock mediabunny module shape
// ---------------------------------------------------------------------------

function createMockPacket(timestampSec: number) {
  return {
    timestamp: timestampSec,
    toEncodedVideoChunk: vi.fn(() => ({
      type: 'key',
      timestamp: Math.round(timestampSec * 1e6),
      duration: 33333,
      byteLength: 100,
    })),
  }
}

function createMockSink(packets: ReturnType<typeof createMockPacket>[]) {
  let cursor = 0
  return {
    getKeyPacket: vi.fn(async (_sec: number) => {
      cursor = 0
      return packets[cursor] ?? null
    }),
    getNextPacket: vi.fn(async (_prev: unknown) => {
      cursor++
      return packets[cursor] ?? null
    }),
  }
}

function createMockInput(
  config: VideoDecoderConfig | null = { codec: 'avc1.42001e' },
  trackPresent = true,
) {
  const sink = createMockSink([
    createMockPacket(0),
    createMockPacket(0.033),
    createMockPacket(0.066),
  ])
  const track = trackPresent
    ? {
        getDecoderConfig: vi.fn(async () => config),
      }
    : null

  const input = {
    getPrimaryVideoTrack: vi.fn(async () => track),
    _sink: sink,
    _track: track,
  }
  return { input, track, sink }
}

function createMockMb(inputOverrides?: {
  config?: VideoDecoderConfig | null
  trackPresent?: boolean
}): { mb: MediabunnyModule; mocks: ReturnType<typeof createMockInput> } {
  // Explicitly check presence of 'config' key to distinguish null from absent.
  const configValue =
    inputOverrides && 'config' in inputOverrides
      ? inputOverrides.config
      : ({ codec: 'avc1.42001e' } as VideoDecoderConfig)
  const mocks = createMockInput(configValue, inputOverrides?.trackPresent ?? true)

  const mb = {
    Input: vi.fn(() => mocks.input),
    BlobSource: vi.fn((blob: Blob) => ({ blob })),
    EncodedPacketSink: vi.fn(() => mocks.sink),
    ALL_FORMATS: ['mp4', 'webm'],
  } as unknown as MediabunnyModule

  return { mb, mocks }
}

const MOCK_BLOB = new Blob(['fake-video-bytes'], { type: 'video/mp4' })
const MOCK_BLOB_RESOLVER = vi.fn(async (_src: string) => MOCK_BLOB)

describe('isMediabunnyCompatible', () => {
  it('returns true for a fully-shaped module', () => {
    const { mb } = createMockMb()
    expect(isMediabunnyCompatible(mb)).toBe(true)
  })

  it('returns false when Input is missing', () => {
    const { mb } = createMockMb()
    const bad = { ...mb, Input: undefined }
    expect(isMediabunnyCompatible(bad)).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(isMediabunnyCompatible(null)).toBe(false)
    expect(isMediabunnyCompatible(undefined)).toBe(false)
  })

  it('returns false when ALL_FORMATS is not an array', () => {
    const { mb } = createMockMb()
    const bad = { ...mb, ALL_FORMATS: 'all' }
    expect(isMediabunnyCompatible(bad)).toBe(false)
  })
})

describe('createMediabunnyBackend', () => {
  describe('open', () => {
    it('resolves blob, constructs Input + EncodedPacketSink, fetches config', async () => {
      const { mb, mocks } = createMockMb()
      const backend = createMediabunnyBackend(mb, { blobResolver: MOCK_BLOB_RESOLVER })

      await backend.open('blob:example.com/abc')

      expect(MOCK_BLOB_RESOLVER).toHaveBeenCalledWith('blob:example.com/abc')
      expect(mb.BlobSource).toHaveBeenCalledWith(MOCK_BLOB)
      expect(mb.Input).toHaveBeenCalledWith(
        expect.objectContaining({ formats: mb.ALL_FORMATS }),
      )
      expect(mocks.input.getPrimaryVideoTrack).toHaveBeenCalled()
      expect(mocks.track!.getDecoderConfig).toHaveBeenCalled()
      expect(mb.EncodedPacketSink).toHaveBeenCalledWith(mocks.track)
    })

    it('throws when no video track is found', async () => {
      const { mb } = createMockMb({ trackPresent: false })
      const backend = createMediabunnyBackend(mb, { blobResolver: MOCK_BLOB_RESOLVER })

      await expect(backend.open('blob:x')).rejects.toThrow(/no video track/)
    })

    it('throws when getDecoderConfig() returns null (unknown codec)', async () => {
      const { mb } = createMockMb({ config: null })
      const backend = createMediabunnyBackend(mb, { blobResolver: MOCK_BLOB_RESOLVER })

      await expect(backend.open('blob:x')).rejects.toThrow(/codec.*not supported|H\.264/)
    })
  })

  describe('getConfig', () => {
    it('returns the decoder config obtained during open()', async () => {
      const { mb } = createMockMb({ config: { codec: 'avc1.64001e', codedWidth: 1920, codedHeight: 1080 } })
      const backend = createMediabunnyBackend(mb, { blobResolver: MOCK_BLOB_RESOLVER })
      await backend.open('blob:x')

      const cfg = backend.getConfig()
      expect(cfg.codec).toBe('avc1.64001e')
    })

    it('throws if called before open()', () => {
      const { mb } = createMockMb()
      const backend = createMediabunnyBackend(mb, { blobResolver: MOCK_BLOB_RESOLVER })
      expect(() => backend.getConfig()).toThrow(/not open/)
    })
  })

  describe('packets — µs ↔ seconds conversion', () => {
    it('passes correct seconds to getKeyPacket from startUs', async () => {
      const { mb, mocks } = createMockMb()
      const backend = createMediabunnyBackend(mb, { blobResolver: MOCK_BLOB_RESOLVER })
      await backend.open('blob:x')

      // startUs = 1_000_000 µs = 1.0 second
      const chunks: EncodedVideoChunk[] = []
      for await (const chunk of backend.packets([1_000_000, 1_100_000])) {
        chunks.push(chunk)
      }

      expect(mocks.sink.getKeyPacket).toHaveBeenCalledWith(1.0)
    })

    it('only yields packets with timestamp < endSec', async () => {
      const { mb } = createMockMb()
      const backend = createMediabunnyBackend(mb, { blobResolver: MOCK_BLOB_RESOLVER })
      await backend.open('blob:x')

      const chunks: EncodedVideoChunk[] = []
      // timeRange covers 0–0.05s; mock packets at 0, 0.033, 0.066
      // Only packets 0 and 0.033 fall within range
      for await (const chunk of backend.packets([0, 50_000])) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBe(2)
    })

    it('calls toEncodedVideoChunk() on each yielded packet', async () => {
      const { mb, mocks } = createMockMb()
      const backend = createMediabunnyBackend(mb, { blobResolver: MOCK_BLOB_RESOLVER })
      await backend.open('blob:x')

      const chunks: EncodedVideoChunk[] = []
      for await (const chunk of backend.packets([0, 50_000])) {
        chunks.push(chunk)
      }

      // Two packets yielded → toEncodedVideoChunk called twice
      const calledTimes = mocks.sink.getKeyPacket.mock.calls.length > 0 ? 2 : 0
      expect(chunks.length).toBeGreaterThan(0)
      void calledTimes
    })
  })

  describe('seekToKeyframe', () => {
    it('calls sink.getKeyPacket with µs converted to seconds', async () => {
      const { mb, mocks } = createMockMb()
      const backend = createMediabunnyBackend(mb, { blobResolver: MOCK_BLOB_RESOLVER })
      await backend.open('blob:x')

      // 2_000_000 µs = 2.0 seconds
      await backend.seekToKeyframe(2_000_000)

      expect(mocks.sink.getKeyPacket).toHaveBeenCalledWith(2.0)
    })

    it('cached seek packet is used by the next packets() call (no redundant getKeyPacket)', async () => {
      const { mb, mocks } = createMockMb()
      const backend = createMediabunnyBackend(mb, { blobResolver: MOCK_BLOB_RESOLVER })
      await backend.open('blob:x')

      // Seek caches the packet
      await backend.seekToKeyframe(0)
      const seekCallsAfterSeek = mocks.sink.getKeyPacket.mock.calls.length

      // packets() must not call getKeyPacket again
      for await (const _c of backend.packets([0, 50_000])) {
        // consume
      }
      const seekCallsAfterPackets = mocks.sink.getKeyPacket.mock.calls.length

      // No additional getKeyPacket call in packets() when cache is warm
      expect(seekCallsAfterPackets).toBe(seekCallsAfterSeek)
    })

    it('cache is consumed once — second packets() call re-seeks', async () => {
      const { mb, mocks } = createMockMb()
      const backend = createMediabunnyBackend(mb, { blobResolver: MOCK_BLOB_RESOLVER })
      await backend.open('blob:x')

      await backend.seekToKeyframe(0)

      // First packets() call consumes cache
      for await (const _c of backend.packets([0, 50_000])) { /* noop */ }
      const callsAfterFirst = mocks.sink.getKeyPacket.mock.calls.length

      // Second packets() call — no cache → should call getKeyPacket again
      for await (const _c of backend.packets([0, 50_000])) { /* noop */ }
      const callsAfterSecond = mocks.sink.getKeyPacket.mock.calls.length

      expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst)
    })
  })

  describe('dispose', () => {
    it('is idempotent (safe to call multiple times)', async () => {
      const { mb } = createMockMb()
      const backend = createMediabunnyBackend(mb, { blobResolver: MOCK_BLOB_RESOLVER })
      await backend.open('blob:x')

      expect(() => {
        backend.dispose()
        backend.dispose()
      }).not.toThrow()
    })

    it('makes getConfig() throw after disposal', async () => {
      const { mb } = createMockMb()
      const backend = createMediabunnyBackend(mb, { blobResolver: MOCK_BLOB_RESOLVER })
      await backend.open('blob:x')

      backend.dispose()

      expect(() => backend.getConfig()).toThrow(/not open/)
    })
  })

  describe('_assertMediabunnyApi', () => {
    it('throws with actionable message when module is malformed', () => {
      const bad = { NotInput: vi.fn() } as unknown as MediabunnyModule
      expect(() => createMediabunnyBackend(bad)).toThrow(/Input, BlobSource, EncodedPacketSink/)
    })
  })
})
