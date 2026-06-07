/**
 * VideoLayer — GPU layer for ActiveVideoClip items.
 *
 * Architecture:
 *  - One VideoFrameProvider per unique src (shared across clips)
 *  - One VideoTexture per clip id
 *  - Synchronous draw(); async frame scheduling via provider.setPlayhead()
 *
 * VideoLayer talks ONLY to VideoFrameProvider, TexturePool/VideoTexture,
 * and ShaderProgram. No decoder, PlaybackEngine, TimelineEngine, or React.
 */

import type { ActiveVideoClip } from '../../../resolver/scene'
import { ShaderProgram } from '../ShaderProgram'
import { QUAD_FRAG_SRC } from '../shaders/quad.frag'
import { QUAD_VERT_SRC } from '../shaders/quad.vert'
import type { TexturePool } from '../TexturePool'
import { VideoTexture } from '../VideoTexture'
import {
  createVideoFrameProvider,
  type VideoFrameProvider,
  type VideoFrameProviderDeps,
} from '../../../media/video'
import { buildDrawTransformMatrix, type DrawRect } from './drawRect'
import type { Layer, LayerContext } from './types'

// Placement math now lives in ./drawRect (shared with ImageLayer). Re-exported
// here for back-compat with existing importers (e.g. FrameProbeLayer, tests).
export {
  buildTransformMatrixFromRect,
  resolveTransformRect,
  resolveDrawRect,
  buildDrawTransformMatrix,
} from './drawRect'
export type { DrawRect } from './drawRect'
/** @deprecated use DrawRect from ./drawRect */
export type VideoDrawRect = DrawRect

/** Per-src provider entry with reference counting. */
interface ProviderEntry {
  provider: VideoFrameProvider
  refCount: number
}

/**
 * Build the clip-space transform matrix for an ActiveVideoClip.
 *
 * Thin adapter over the shared `buildDrawTransformMatrix` — keeps the
 * `ActiveVideoClip`-typed signature FrameProbeLayer relies on.
 */
export function buildVideoTransformMatrix(
  item: ActiveVideoClip,
  stageWidth: number,
  stageHeight: number,
  contentWidth?: number,
  contentHeight?: number,
): Float32Array {
  return buildDrawTransformMatrix(
    item.transform,
    stageWidth,
    stageHeight,
    contentWidth,
    contentHeight,
  )
}

export type VideoFrameProviderFactory = (src: string) => VideoFrameProvider

export class VideoLayer implements Layer<ActiveVideoClip> {
  private readonly _pool: TexturePool
  private readonly _providerFactory: VideoFrameProviderFactory
  /** Decode deps forwarded to createVideoFrameProvider when no providerFactory override. */
  private readonly _deps: VideoFrameProviderDeps | undefined

  private _program: ShaderProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _gl: WebGL2RenderingContext | null = null

  private readonly _providers = new Map<string, ProviderEntry>()
  private readonly _textures = new Map<string, VideoTexture>()
  private readonly _srcByItemId = new Map<string, string>()
  private readonly _contentSizeByItemId = new Map<string, { width: number; height: number }>()
  /** Last sourceFrame logged per clip — prevents flooding at 60 fps on a frozen playhead. */
  private readonly _lastLoggedSourceFrameByItemId = new Map<string, number>()
  /**
   * Last clip texture that had real GPU content, kept alive after its clip
   * exits the scene. Used as a single-frame fallback when the incoming clip's
   * texture has not received its first decoded frame yet — prevents the 1-2
   * tick black flash at clip boundaries while async decode catches up.
   * Disposed as soon as the new clip uploads its first frame.
   */
  private _holdoverTexture: VideoTexture | null = null

  constructor(
    pool: TexturePool,
    providerFactoryOrDeps?: VideoFrameProviderFactory | VideoFrameProviderDeps,
  ) {
    this._pool = pool
    if (typeof providerFactoryOrDeps === 'function') {
      this._providerFactory = providerFactoryOrDeps
      this._deps = undefined
    } else {
      this._deps = providerFactoryOrDeps
      this._providerFactory = (src: string) => createVideoFrameProvider(src, this._deps)
    }
  }

  acquire(item: ActiveVideoClip, ctx: LayerContext): void {
    const { gl } = ctx
    this._gl = gl
    this._ensurePipeline(gl)

    this._textures.set(item.id, new VideoTexture(this._pool))
    this._srcByItemId.set(item.id, item.src)

    // Keyed by clip ID, not src: each clip owns an independent
    // StreamingFrameProducer so that copy-pasted clips (same src, different
    // startFrame) never share a playhead and cause backwards-seek stalls.
    let entry = this._providers.get(item.id)
    if (!entry) {
      const provider = this._deps
        ? createVideoFrameProvider(item.src, { ...this._deps, fps: ctx.fps })
        : this._providerFactory(item.src)
      entry = { provider, refCount: 0 }
      this._providers.set(item.id, entry)
    }

    entry.refCount++
    entry.provider.markActive()
  }

  release(itemId: string): void {
    const src = this._srcByItemId.get(itemId)
    if (!src) return

    const texture = this._textures.get(itemId)
    if (texture?.hasContent) {
      // Transfer to holdover so the next clip can borrow this frame for its
      // first tick while its own decode is in flight.
      this._holdoverTexture?.dispose()
      this._holdoverTexture = texture
    } else {
      texture?.dispose()
    }
    this._textures.delete(itemId)
    this._srcByItemId.delete(itemId)
    this._contentSizeByItemId.delete(itemId)
    this._lastLoggedSourceFrameByItemId.delete(itemId)

    const entry = this._providers.get(itemId)
    if (!entry) return

    entry.refCount--
    if (entry.refCount <= 0) {
      entry.refCount = 0
      entry.provider.markIdle()
    }
  }

  draw(item: ActiveVideoClip, ctx: LayerContext): void {
    this._gl = ctx.gl

    const texture = this._textures.get(item.id)
    const entry = this._providers.get(item.id)
    if (!texture || !entry) return

    const { provider } = entry

    // Push the playhead before reading the cache so the producer can fill
    // the lookahead window for this tick and upcoming ticks.
    provider.setPlayhead(item.sourceFrame)
    const frame = provider.getCurrent(item.sourceFrame)

    if (frame !== null) {
      // Single-owner rule: the FrameCache owns this frame and closes it on
      // eviction. We only BORROW it here — VideoTexture.upload() never closes it,
      // so there is no clone and no double-owner. (The cache holds an ImageBitmap
      // copy on the real decode path; a VideoFrame on the synthetic dev path.)
      const uploaded = texture.upload(ctx.gl, frame)
      if (uploaded) {
        const width = 'displayWidth' in frame ? frame.displayWidth : frame.width
        const height = 'displayHeight' in frame ? frame.displayHeight : frame.height
        this._contentSizeByItemId.set(item.id, { width, height })
        // First real frame for this clip — holdover is no longer needed.
        this._holdoverTexture?.dispose()
        this._holdoverTexture = null
      }
    }
    // On cache miss: setPlayhead() already triggered decode for this frame.
    // The provider keeps the last uploaded texture content — no flicker.

    if (!this._program || !this._vao) return

    const contentSize = this._contentSizeByItemId.get(item.id)
    const opacity = item.opacity ?? 1

    this._program.use(ctx.gl)
    ctx.gl.bindVertexArray(this._vao)

    // Prefer the clip's own texture; fall back to the holdover for the first
    // tick(s) while async decode delivers the initial frame — avoids the black
    // flash at clip boundaries.
    let unit = texture.bind(ctx.gl, 0)
    if (unit < 0 && this._holdoverTexture !== null) {
      unit = this._holdoverTexture.bind(ctx.gl, 0)
    }
    if (unit < 0) return

    this._program.setUniform1i(ctx.gl, 'uTexture', unit)
    this._program.setUniform1f(ctx.gl, 'uOpacity', opacity)
    this._program.setUniformMatrix3fv(
      ctx.gl,
      'uTransform',
      false,
      buildVideoTransformMatrix(
        item,
        ctx.stage.width,
        ctx.stage.height,
        contentSize?.width,
        contentSize?.height,
      ),
    )

    ctx.gl.drawArrays(ctx.gl.TRIANGLE_STRIP, 0, 4)

    ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, null)
    ctx.gl.bindVertexArray(null)
  }

  dispose(): void {
    for (const texture of this._textures.values()) {
      texture.dispose()
    }
    this._textures.clear()
    this._srcByItemId.clear()
    this._contentSizeByItemId.clear()
    this._holdoverTexture?.dispose()
    this._holdoverTexture = null

    for (const entry of this._providers.values()) {
      entry.provider.dispose()
    }
    this._providers.clear()

    if (this._gl) {
      if (this._vao) this._gl.deleteVertexArray(this._vao)
      if (this._program) this._program.dispose(this._gl)
    }

    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Drop GL object references after a context loss. */
  notifyContextLost(): void {
    for (const texture of this._textures.values()) {
      texture.handleContextLost()
    }
    // Holdover GL handle is also invalid after context loss.
    this._holdoverTexture?.handleContextLost()
    this._holdoverTexture = null
    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Delete GL objects while the context is still valid. */
  disposeGL(gl: WebGL2RenderingContext): void {
    for (const texture of this._textures.values()) {
      texture.dispose()
    }
    if (this._vao) gl.deleteVertexArray(this._vao)
    if (this._program) this._program.dispose(gl)
    this.dispose()
  }

  /** Exposed for testing: provider instance for a clip item ID. */
  getProviderForItemId(itemId: string): VideoFrameProvider | undefined {
    return this._providers.get(itemId)?.provider
  }

  /** Exposed for testing: first provider whose src matches (for single-clip test scenarios). */
  getProviderForSrc(src: string): VideoFrameProvider | undefined {
    for (const [itemId, itemSrc] of this._srcByItemId) {
      if (itemSrc === src) return this._providers.get(itemId)?.provider
    }
    return undefined
  }

  /** Exposed for testing: ref count for a clip item ID. */
  getProviderRefCount(itemId: string): number {
    return this._providers.get(itemId)?.refCount ?? 0
  }

  /** Exposed for testing: number of per-clip texture handles. */
  getTextureCount(): number {
    return this._textures.size
  }

  /** Number of unique src providers currently alive (including idle). */
  getProviderCount(): number {
    return this._providers.size
  }

  /**
   * Snapshot of `src → decoderState` for all live providers.
   * Used by the debug panel. Returns `{}` when no providers are alive.
   */
  getDecoderStates(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [src, entry] of this._providers) {
      const provider = entry.provider as VideoFrameProvider & { decoderState?: string }
      if (typeof provider.decoderState === 'string') {
        out[src] = provider.decoderState
      }
    }
    return out
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _ensurePipeline(gl: WebGL2RenderingContext): void {
    if (this._program && this._vao) return

    this._program = ShaderProgram.create(gl, QUAD_VERT_SRC, QUAD_FRAG_SRC)

    const vao = gl.createVertexArray()
    if (!vao) {
      throw new Error('VideoLayer: gl.createVertexArray() returned null')
    }
    this._vao = vao
  }

}
