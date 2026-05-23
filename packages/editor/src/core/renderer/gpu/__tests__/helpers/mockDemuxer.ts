import { vi } from 'vitest'
import type { DemuxerBackend } from '../../demuxer/MediabunnyDemuxer'
import type { VideoDecoderLike } from '../../VideoDecoderManager'

export interface MockDemuxerOptions {
  src?: string
  config?: VideoDecoderConfig
  openError?: Error
  seekError?: Error
  packetsError?: Error
  chunks?: EncodedVideoChunk[]
}

export function createMockDemuxerBackend(
  options: MockDemuxerOptions = {},
): DemuxerBackend {
  const config: VideoDecoderConfig = options.config ?? {
    codec: 'vp8',
    codedWidth: 640,
    codedHeight: 360,
  }

  return {
    open: vi.fn(async (src: string) => {
      if (options.openError) throw options.openError
      options.src = src
    }),
    getConfig: vi.fn(() => config),
    packets: vi.fn(async function* (_timeRange: [number, number]) {
      if (options.packetsError) throw options.packetsError
      for (const chunk of options.chunks ?? []) {
        yield chunk
      }
    }),
    seekToKeyframe: vi.fn(async () => {
      if (options.seekError) throw options.seekError
    }),
    dispose: vi.fn(),
  }
}

export interface MockDecoderOptions {
  configureError?: Error
  flushError?: Error
}

export function createMockDecoder(
  options: MockDecoderOptions = {},
): VideoDecoderLike {
  return {
    state: 'unconfigured',
    configure: vi.fn(() => {
      if (options.configureError) throw options.configureError
    }),
    decode: vi.fn(),
    flush: vi.fn(async () => {
      if (options.flushError) throw options.flushError
    }),
    close: vi.fn(),
    reset: vi.fn(),
  }
}

export function createMockChunk(timestamp = 0): EncodedVideoChunk {
  return {
    timestamp,
    type: 'key',
    byteLength: 4,
    duration: 33333,
    copyTo: vi.fn(),
  } as unknown as EncodedVideoChunk
}
