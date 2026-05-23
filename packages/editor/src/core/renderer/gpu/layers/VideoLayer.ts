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
} from '../VideoFrameProvider'
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

  private _program: ShaderProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _gl: WebGL2RenderingContext | null = null

  private readonly _providers = new Map<string, ProviderEntry>()
  private readonly _textures = new Map<string, VideoTexture>()
  private readonly _srcByItemId = new Map<string, string>()
  private readonly _contentSizeByItemId = new Map<string, { width: number; height: number }>()

  constructor(
    pool: TexturePool,
    providerFactory: VideoFrameProviderFactory = createVideoFrameProvider,
  ) {
    this._pool = pool
    this._providerFactory = providerFactory
  }

  acquire(item: ActiveVideoClip, ctx: LayerContext): void {
    const { gl } = ctx
    this._gl = gl
    this._ensurePipeline(gl)

    this._textures.set(item.id, new VideoTexture(this._pool))
    this._srcByItemId.set(item.id, item.src)

    let entry = this._providers.get(item.src)
    if (!entry) {
      entry = {
        provider: this._providerFactory(item.src),
        refCount: 0,
      }
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

    if (frame !== null) {
      const uploaded = texture.upload(ctx.gl, frame)
      if (uploaded) {
        this._contentSizeByItemId.set(item.id, {
          width: frame.displayWidth,
          height: frame.displayHeight,
        })
      }
    } else {
      provider.requestFrame(item.sourceFrame)
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
