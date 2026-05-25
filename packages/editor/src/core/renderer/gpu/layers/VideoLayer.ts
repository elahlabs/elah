/**
 * VideoLayer — GPU layer for ActiveVideoClip items.
 *
 * Architecture:
 *  - One VideoFrameProvider per unique src (shared across clips)
 *  - One VideoTexture per clip id
 *  - Synchronous draw(); async frame scheduling via provider.requestFrame()
 *
 * VideoLayer talks ONLY to VideoFrameProvider, TexturePool/VideoTexture,
 * and ShaderProgram. No decoder, PlaybackEngine, TimelineEngine, or React.
 */

import type { ActiveVideoClip } from '../../../resolver/scene'
import type { Transform } from '../../../types'
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
import type { Layer, LayerContext } from './types'

/** Per-src provider entry with reference counting. */
interface ProviderEntry {
  provider: VideoFrameProvider
  refCount: number
}

/** Pixel rect used to build the transform matrix. */
export interface VideoDrawRect {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

/**
 * Build a column-major 3×3 transform matrix mapping the unit quad (0..1,
 * origin top-left) to clip space for a rect at pixel (x,y,w,h) on a stage
 * of size (sw, sh), with optional rotation about the rect centre.
 */
export function buildTransformMatrixFromRect(
  rect: VideoDrawRect,
  stageWidth: number,
  stageHeight: number,
): Float32Array {
  const xs = rect.x / stageWidth
  const ys = rect.y / stageHeight
  const ws = rect.width / stageWidth
  const hs = rect.height / stageHeight
  const rotation = rect.rotation
  const sc = Math.cos(rotation)
  const ss = Math.sin(rotation)

  const tx = 2 * (xs + ws / 2 - 0.5 * sc * ws + 0.5 * ss * hs) - 1
  const ty = 2 * (ys + hs / 2 - 0.5 * ss * ws - 0.5 * sc * hs) - 1

  return new Float32Array([
    2 * sc * ws, 2 * ss * ws, 0,
    -2 * ss * hs, 2 * sc * hs, 0,
    tx, ty, 1,
  ])
}

/**
 * Resolve the pixel draw rect for a video clip.
 *
 * When transform is undefined the quad fills the entire stage.
 * When transform is defined, normalized x/y/scale/anchor/rotation are applied
 * relative to the video's native dimensions (or stage dimensions as fallback).
 */
export function resolveVideoDrawRect(
  item: ActiveVideoClip,
  stageWidth: number,
  stageHeight: number,
  contentWidth?: number,
  contentHeight?: number,
): VideoDrawRect {
  if (!item.transform) {
    return {
      x: 0,
      y: 0,
      width: stageWidth,
      height: stageHeight,
      rotation: 0,
    }
  }

  return resolveTransformRect(
    item.transform,
    stageWidth,
    stageHeight,
    contentWidth ?? stageWidth,
    contentHeight ?? stageHeight,
  )
}

/** Convert a normalized Transform + content size into a pixel draw rect. */
export function resolveTransformRect(
  transform: Transform,
  stageWidth: number,
  stageHeight: number,
  contentWidth: number,
  contentHeight: number,
): VideoDrawRect {
  const width = contentWidth * transform.scale
  const height = contentHeight * transform.scale

  const anchorPxX = transform.anchor.x * width
  const anchorPxY = transform.anchor.y * height

  const x = transform.x * stageWidth - anchorPxX
  const y = transform.y * stageHeight - anchorPxY

  return {
    x,
    y,
    width,
    height,
    rotation: transform.rotation,
  }
}

/**
 * Build the clip-space transform matrix for an ActiveVideoClip.
 */
export function buildVideoTransformMatrix(
  item: ActiveVideoClip,
  stageWidth: number,
  stageHeight: number,
  contentWidth?: number,
  contentHeight?: number,
): Float32Array {
  const rect = resolveVideoDrawRect(
    item,
    stageWidth,
    stageHeight,
    contentWidth,
    contentHeight,
  )
  return buildTransformMatrixFromRect(rect, stageWidth, stageHeight)
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

    let entry = this._providers.get(item.src)
    if (!entry) {
      // When real decode deps are available, merge the scene fps so the
      // decoder computes frame timestamps correctly for any project frame rate.
      // Custom providerFactory overrides (tests) are used as-is.
      const provider = this._deps
        ? createVideoFrameProvider(item.src, { ...this._deps, fps: ctx.fps })
        : this._providerFactory(item.src)
      entry = { provider, refCount: 0 }
      this._providers.set(item.src, entry)
    }

    entry.refCount++
    entry.provider.markActive()
  }

  release(itemId: string): void {
    const src = this._srcByItemId.get(itemId)
    if (!src) return

    const texture = this._textures.get(itemId)
    texture?.dispose()
    this._textures.delete(itemId)
    this._srcByItemId.delete(itemId)
    this._contentSizeByItemId.delete(itemId)
    this._lastLoggedSourceFrameByItemId.delete(itemId)

    const entry = this._providers.get(src)
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
    const entry = this._providers.get(item.src)
    if (!texture || !entry) return

    const { provider } = entry
    const frame = provider.getCurrent(item.sourceFrame)

    const pendingCount = provider.pendingCount ?? 0
    const cacheSize = (provider as { _cache?: { size: number } })._cache?.size ?? '?'

    if (this._lastLoggedSourceFrameByItemId.get(item.id) !== item.sourceFrame) {
      this._lastLoggedSourceFrameByItemId.set(item.id, item.sourceFrame)
      console.log(
        `[GPU-TRACE] VideoLayer.draw  clipId=${item.id}  sourceFrame=${item.sourceFrame}  gotFrame=${frame !== null}  pendingCount=${pendingCount}  cacheSize=${cacheSize}`,
      )
    }

    if (frame !== null) {
      // provider.getCurrent() returns a borrowed reference — the FrameCache
      // retains ownership and is responsible for closing it on eviction.
      // VideoTexture.upload() consumes (closes) its argument, so we hand it
      // a cheap reference-clone. Both the cache's original and our clone must
      // be closed independently; the cache will close on evict/dispose, the
      // clone is closed in VideoTexture.upload()'s finally block.
      // Without this clone the cached frame is closed after the first upload
      // and every subsequent texImage2D fails with
      //   INVALID_OPERATION: can't texture a closed VideoFrame
      // leaving the canvas black.
      const uploadFrame = frame.clone()
      const uploaded = texture.upload(ctx.gl, uploadFrame)
      if (uploaded) {
        this._contentSizeByItemId.set(item.id, {
          width: frame.displayWidth,
          height: frame.displayHeight,
        })
      }
    } else {
      provider.requestFrame(item.sourceFrame)
      // Prefetch only if the request queue has room. When the queue is already
      // saturated (e.g. mid-seek burst), skip prefetch so the seek-target slot
      // is never pushed out by prefetch siblings.
      const maxPrefetch = Math.min(Math.max(1, Math.ceil(ctx.fps / 6)), 5)
      if (pendingCount < this._getMaxOutstanding(provider) - 1) {
        provider.prefetch(item.sourceFrame + 1, maxPrefetch)
      }
    }

    if (!texture.hasContent || !this._program || !this._vao) {
      return
    }

    const contentSize = this._contentSizeByItemId.get(item.id)
    const opacity = item.opacity ?? 1

    this._program.use(ctx.gl)
    ctx.gl.bindVertexArray(this._vao)

    const unit = texture.bind(ctx.gl, 0)
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

  /** Exposed for testing: provider instance for a src. */
  getProviderForSrc(src: string): VideoFrameProvider | undefined {
    return this._providers.get(src)?.provider
  }

  /** Exposed for testing: ref count for a src. */
  getProviderRefCount(src: string): number {
    return this._providers.get(src)?.refCount ?? 0
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

  private _getMaxOutstanding(provider: VideoFrameProvider): number {
    // DecoderBackedVideoFrameProvider exposes _maxOutstanding; access via
    // duck-typing since the interface doesn't mandate it.
    return (provider as { _maxOutstanding?: number })._maxOutstanding ?? 4
  }
}
