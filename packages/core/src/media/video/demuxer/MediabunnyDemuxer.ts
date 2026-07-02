/**
 * MediabunnyDemuxer — thin adapter isolating lazy `import('mediabunny')`.
 *
 * Tests inject a `DemuxerFactory` to avoid loading the real package.
 * Holds no GL objects.
 */

export interface DemuxerBackend {
  open(src: string): Promise<void>
  getConfig(): VideoDecoderConfig
  packets(timeRange: [number, number]): AsyncIterable<EncodedVideoChunk>
  seekToKeyframe(time: number): Promise<void>
  dispose(): void
}

export type DemuxerFactory = () => DemuxerBackend

export class MediabunnyDemuxer {
  private readonly _factory: DemuxerFactory | null
  private _backend: DemuxerBackend | null = null
  private _src: string | null = null
  private _disposed = false

  constructor(factory?: DemuxerFactory) {
    this._factory = factory ?? null
  }

  get src(): string | null {
    return this._src
  }

  get isOpen(): boolean {
    return this._src !== null && !this._disposed
  }

  /** Open a media source. Lazy-imports mediabunny when no factory is injected. */
  async open(src: string): Promise<void> {
    if (this._disposed) {
      throw new Error('MediabunnyDemuxer: disposed')
    }
    if (this._src !== null) {
      throw new Error('MediabunnyDemuxer: already open')
    }

    const backend = this._factory ? this._factory() : await createDefaultBackend()

    await backend.open(src)
    this._backend = backend
    this._src = src
  }

  getConfig(): VideoDecoderConfig {
    this._assertOpen()
    return this._backend!.getConfig()
  }

  packets(timeRange: [number, number]): AsyncIterable<EncodedVideoChunk> {
    this._assertOpen()
    return this._backend!.packets(timeRange)
  }

  async seekToKeyframe(time: number): Promise<void> {
    this._assertOpen()
    await this._backend!.seekToKeyframe(time)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._backend?.dispose()
    this._backend = null
    this._src = null
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _assertOpen(): void {
    if (this._disposed) {
      throw new Error('MediabunnyDemuxer: disposed')
    }
    if (!this._backend || this._src === null) {
      throw new Error('MediabunnyDemuxer: not open')
    }
  }
}

async function createDefaultBackend(): Promise<DemuxerBackend> {
  // The lazy-import path is a last resort. Prefer injecting a DemuxerFactory
  // via GpuRenderer options so the factory owns blobResolver and mediabunny imports.
  let mediabunny: unknown
  try {
    const moduleName = 'mediabunny'
    mediabunny = await import(/* @vite-ignore */ moduleName)
  } catch {
    throw new Error(
      [
        'MediabunnyDemuxer: mediabunny could not be loaded automatically.',
        '',
        'To enable real video decode, inject a DemuxerFactory into GpuRenderer:',
        '',
        '  // In your app (e.g. apps/playground/src/createPlaygroundDemuxerFactory.ts):',
        '  import * as mediabunny from "mediabunny"',
        '  import { createMediabunnyBackend } from "@elah/editor"',
        '',
        '  const renderer = new GpuRenderer({',
        '    demuxerFactory: () => createMediabunnyBackend(mediabunny),',
        '  })',
        '',
        'Without this, the renderer falls back to SyntheticVideoFrameProvider (dev mode).',
        'See: apps/playground/src/createPlaygroundDemuxerFactory.ts',
      ].join('\n'),
    )
  }

  const { createMediabunnyBackend, isMediabunnyCompatible } =
    await import('./createMediabunnyBackend')
  if (!isMediabunnyCompatible(mediabunny)) {
    throw new Error(
      'MediabunnyDemuxer: mediabunny module does not expose the expected API ' +
        '(needs Input, BlobSource, EncodedPacketSink, ALL_FORMATS). ' +
        'See createMediabunnyBackend.ts.',
    )
  }
  return createMediabunnyBackend(mediabunny as Parameters<typeof createMediabunnyBackend>[0])
}
