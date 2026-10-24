/**
 * Internal GPU renderer types.
 *
 * Not exported from the package root — these are implementation details
 * shared between GpuRenderer, RenderGraph, and future layer modules.
 */

import type { VideoFrameProviderFactory } from './layers/VideoLayer'
import type { DemuxerFactory } from '../../media/video/demuxer/MediabunnyDemuxer'
import type { VideoDecoderFactory } from '../../media/video/VideoDecoderManager'
import type { RotoMaskLoader } from '../../media/masks/RotoMaskFrameProvider'

/** Physical canvas backing-store dimensions in pixels (after DPR scaling). */
export interface Viewport {
  width: number
  height: number
}

/** Options passed to the GpuRenderer constructor. */
export interface RendererOptions {
  /** Hard cap on live GL textures. Default 16. */
  maxTextures?: number
  /** Clear colour as [r, g, b, a] in 0..1 range. Defaults to opaque black. */
  clearColor?: [number, number, number, number]
  /**
   * Override frame provider factory entirely (tests / custom decode backends).
   * When provided, demuxerFactory/decoderFactory/maxOutstandingDecodes are ignored.
   */
  providerFactory?: VideoFrameProviderFactory
  /**
   * Injected demuxer factory. Enables real WebCodecs decode pipeline via
   * DecoderBackedVideoFrameProvider. When absent, SyntheticVideoFrameProvider
   * is used (visual dev / no mediabunny dependency).
   *
   * Usage:
   *   new GpuRenderer({ demuxerFactory: () => createMediabunnyBackend(mediabunny) })
   */
  demuxerFactory?: DemuxerFactory
  /**
   * Longest edge, in pixels, of the decoded-frame bitmaps cached for preview.
   * Default 1920 (1080p). 0 or Infinity = full resolution. Export does not use
   * this renderer's providers (mediabunny CanvasSink), so it is unaffected.
   */
  maxVideoLongEdge?: number
  /** Optional decoder factory override (tests). Forwarded to VideoDecoderManager. */
  decoderFactory?: VideoDecoderFactory
  /**
   * Maximum concurrent in-flight decode requests per provider.
   * Requests beyond this limit are silently dropped (back-pressure).
   * Default 4.
   */
  maxOutstandingDecodes?: number
  /**
   * Forwarded to the WebGL context attributes. When true, the drawing buffer
   * is retained between compositing operations, which lets host code call
   * `gl.readPixels()` after a render tick has yielded (the default WebGL
   * behaviour clears the buffer post-composite, which makes readbacks return
   * zeros). Enable for dev tools, golden-pixel tests, and recording. Costs
   * one extra buffer copy per frame — leave `false` for production playback.
   * Default false.
   */
  preserveDrawingBuffer?: boolean
  /**
   * Debug bisection: replace VideoLayer with FrameProbeLayer, which paints a
   * synthetic colour + "frame N" text per clip instead of decoded media. Used
   * to isolate the clock/render/draw path from the decode/cache pipeline.
   * Default false.
   */
  probeLayer?: boolean
  /** Notified when the WebGL context is lost (rendering pauses). */
  onContextLost?: () => void
  /** Notified when the WebGL context has been restored (rendering resumes). */
  onContextRestored?: () => void
  /**
   * Notified when the context stayed lost past the recovery watchdog — the
   * host should remount the renderer and/or surface recovery UI.
   */
  onContextUnrecoverable?: () => void
  /**
   * Notified when a video clip starts loading (`'loading'`), fails to open
   * (`'error'`), or becomes drawable (`null`).
   *
   * Fires at clip-boundary events only — acquire, first successful upload,
   * open failure, release — never per frame, so a host can drive a spinner from
   * it without re-rendering on the render loop.
   */
  onClipLoad?: (clipId: string, state: 'loading' | 'error' | null) => void
  /**
   * Fetches roto mask frames (`Scene.rotoMasks`). Hosts whose mask URLs need
   * auth pass one that adds the token. Default: plain `fetch`.
   */
  rotoMaskLoader?: RotoMaskLoader
  /**
   * A roto mask frame arrived after the last draw. Hosts that skip redraws
   * while paused must mark themselves dirty here or the mask never appears.
   */
  onRotoMaskFrame?: () => void
  /**
   * Fetches frames of `frames` sequences (`Scene.sequences`). Pass one that
   * adds auth for private URLs. Default: plain `fetch`.
   */
  sequenceFrameLoader?: (url: string, signal?: AbortSignal) => Promise<Blob>
  /**
   * A sequence frame arrived after the last draw. Hosts that skip redraws
   * while paused must mark themselves dirty here or the frame never appears.
   */
  onSequenceFrame?: () => void
}

/**
 * Result of diffing a layer's active items against the current Scene slice.
 * Used internally by RenderGraph on every execute() call.
 */
export interface SceneDiff<TItem> {
  /** Items present in the current Scene but not yet acquired. */
  entering: TItem[]
  /** Item ids present in the active set but absent from the current Scene. */
  leaving: string[]
}
