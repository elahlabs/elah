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

    const backend = this._factory
      ? this._factory()
      : await createDefaultBackend()

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
  // Lazy import keeps mediabunny out of the main bundle until playback.
  // Module is optional at build time; inject DemuxerFactory in tests/production wiring.
  const moduleName = 'mediabunny'
  const mediabunny = await import(/* @vite-ignore */ moduleName)
  return createBackendFromModule(mediabunny)
}

function createBackendFromModule(
  _mediabunny: unknown,
): DemuxerBackend {
  throw new Error(
    'MediabunnyDemuxer: real mediabunny backend not yet implemented. Inject a DemuxerFactory for tests.',
  )
}
