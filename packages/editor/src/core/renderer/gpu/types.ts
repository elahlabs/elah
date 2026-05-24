/**
 * Internal GPU renderer types.
 *
 * Not exported from the package root — these are implementation details
 * shared between GpuRenderer, RenderGraph, and future layer modules.
 */

import type { VideoFrameProviderFactory } from './layers/VideoLayer'
import type { DemuxerFactory } from './demuxer/MediabunnyDemuxer'
import type { VideoDecoderFactory } from './VideoDecoderManager'

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
