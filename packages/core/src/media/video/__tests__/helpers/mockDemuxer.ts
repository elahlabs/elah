import { vi } from 'vitest'
import type { DemuxerBackend } from '../../demuxer/MediabunnyDemuxer'
import type { VideoDecoderLike, VideoDecoderFactory } from '../../VideoDecoderManager'

export interface MockDemuxerOptions {
  src?: string
  config?: VideoDecoderConfig
  openError?: Error
  seekError?: Error
  packetsError?: Error
  chunks?: EncodedVideoChunk[]
}

export function createMockDemuxerBackend(options: MockDemuxerOptions = {}): DemuxerBackend {
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
  /**
   * When true (default), the mock decoder synchronously emits a mock VideoFrame
   * for each decoded chunk via the output callback.  Set to false when you
   * want to suppress frame emission (e.g. testing the no-output error path).
   */
  emitFrames?: boolean
}

/**
 * Creates a VideoDecoderFactory that returns a spy-based mock decoder.
 *
 * The returned factory object exposes a `lastDecoder` property so tests can
 * inspect call counts after the VDM has created the decoder via open().
 *
 * Usage:
 *   const { factory, get: lastDecoder } = createMockDecoder()
 *   const manager = new VideoDecoderManager({ decoderFactory: factory, ... })
 *   await manager.open(...)
 *   expect(lastDecoder.configure).toHaveBeenCalled()
 */
export function createMockDecoder(options: MockDecoderOptions = {}): {
  factory: VideoDecoderFactory
  /** The decoder instance created on the most recent factory call. */
  get lastDecoder(): VideoDecoderLike
} {
  let _last: VideoDecoderLike | null = null
  const emitFrames = options.emitFrames ?? true

  const factory: VideoDecoderFactory = vi.fn(
    (output: (frame: VideoFrame) => void, _error: (e: DOMException) => void) => {
      const decoder: VideoDecoderLike = {
        state: 'unconfigured',
        configure: vi.fn(() => {
          if (options.configureError) throw options.configureError
        }),
        decode: vi.fn((chunk: EncodedVideoChunk) => {
          if (emitFrames) {
            output(createMockVideoFrame(chunk.timestamp))
          }
        }),
        flush: vi.fn(async () => {
          if (options.flushError) throw options.flushError
        }),
        close: vi.fn(),
        reset: vi.fn(),
      }
      _last = decoder
      return decoder
    },
  )

  return {
    factory,
    get lastDecoder(): VideoDecoderLike {
      if (!_last) throw new Error('createMockDecoder: factory not yet called — open() first')
      return _last
    },
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

/** Creates a minimal VideoFrame stub with the given timestamp. */
export function createMockVideoFrame(timestamp: number): VideoFrame {
  return {
    timestamp,
    displayWidth: 640,
    displayHeight: 360,
    close: vi.fn(),
    clone: vi.fn(function (this: VideoFrame) {
      return createMockVideoFrame(this.timestamp)
    }),
  } as unknown as VideoFrame
}
