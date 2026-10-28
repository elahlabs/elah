/**
 * RotoMaskLayer — GPU layer for `Scene.rotoMasks` (roto review masks).
 *
 * One RotoMaskFrameProvider and one texture per active mask item. Placement
 * reuses `buildDrawTransformMatrix` with the mask's own pixel size, which
 * equals the source media's display size, so the mask sits exactly on the
 * video's draw rect (transform and crop included).
 *
 * Renderer invariants:
 *  - I1/I4: draw() is synchronous. A miss keeps drawing the last uploaded
 *    frame and fires `requestFrame` out-of-band; nothing is drawn before the
 *    first frame arrives.
 *  - I2/I8: imports only scene.ts, the mask provider, GL helpers and browser
 *    APIs. The loader is injected via RendererOptions.rotoMaskLoader.
 *  - I9: notifyContextLost() drops every GL handle without GL calls.
 */

import type { ActiveRotoMask } from '../../../resolver/scene'
import {
  RotoMaskFrameProvider,
  type RotoMaskDecoder,
  type RotoMaskLoader,
} from '../../../media/masks/RotoMaskFrameProvider'
import { ShaderProgram } from '../ShaderProgram'
import { QUAD_VERT_SRC } from '../shaders/quad.vert'
import { ROTO_MASK_FRAG_SRC } from '../shaders/rotoMask.frag'
import { buildDrawTransformMatrix } from './drawRect'
import type { Layer, LayerContext } from './types'

/** Plain `fetch`, for masks served without auth (dev harness, public URLs). */
export const fetchRotoMask: RotoMaskLoader = async (url, signal) => {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Mask frame ${url} → HTTP ${res.status}`)
  return res.blob()
}

export type RotoMaskProviderFactory = (template: string, frameCount: number) => RotoMaskFrameProvider

export interface RotoMaskLayerOptions {
  loader?: RotoMaskLoader
  decode?: RotoMaskDecoder
  /** Overrides loader/decode entirely (tests). */
  providerFactory?: RotoMaskProviderFactory
  /**
   * Frames fetched ahead of the playhead. This is the playback runway: at 24 fps
   * the old default of 3 was an eighth of a second, so the mask trailed the video
   * and caught up late. The provider holds these as encoded bytes, not decoded
   * frames, so a long runway is cheap (see RotoMaskFrameProvider).
   */
  lookahead?: number
  /** A mask frame finished loading — the host should redraw (see RendererOptions). */
  onFrameReady?: () => void
}

interface ItemResources {
  texture: WebGLTexture
  provider: RotoMaskFrameProvider
  template: string
  /** Source frame currently in the texture; -1 = nothing uploaded yet. */
  uploadedFrame: number
}

export class RotoMaskLayer implements Layer<ActiveRotoMask> {
  private _program: ShaderProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _gl: WebGL2RenderingContext | null = null
  private readonly _resources = new Map<string, ItemResources>()
  private readonly _makeProvider: RotoMaskProviderFactory
  private readonly _lookahead: number

  constructor(options: RotoMaskLayerOptions = {}) {
    const loader = options.loader ?? fetchRotoMask
    this._makeProvider =
      options.providerFactory ??
      ((template, frameCount) =>
        new RotoMaskFrameProvider(template, frameCount, {
          loader,
          ...(options.decode ? { decode: options.decode } : {}),
          ...(options.onFrameReady ? { onFrameReady: () => options.onFrameReady?.() } : {}),
        }))
    this._lookahead = Math.max(0, options.lookahead ?? 48)
  }

  acquire(item: ActiveRotoMask, ctx: LayerContext): void {
    const { gl } = ctx
    this._gl = gl
    this._ensurePipeline(gl)

    const texture = gl.createTexture()
    if (!texture) throw new Error('RotoMaskLayer: gl.createTexture() returned null')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)

    const provider = this._makeProvider(item.frameUrlTemplate, item.frameCount)
    provider.prewarm(item.sourceFrame, 1 + this._lookahead)
    this._resources.set(item.id, {
      texture,
      provider,
      template: item.frameUrlTemplate,
      uploadedFrame: -1,
    })
  }

  release(itemId: string): void {
    const res = this._resources.get(itemId)
    if (!res) return
    res.provider.dispose()
    if (this._gl) this._gl.deleteTexture(res.texture)
    this._resources.delete(itemId)
  }

  /** Fetch ahead for items already acquired. Never draws or uploads. */
  prewarm(items: ReadonlyArray<ActiveRotoMask>, _ctx: LayerContext): void {
    for (const item of items) {
      const res = this._resources.get(item.id)
      if (res && res.template === item.frameUrlTemplate) {
        res.provider.prewarm(item.sourceFrame, 1 + this._lookahead)
      }
    }
  }

  draw(item: ActiveRotoMask, ctx: LayerContext): void {
    this._gl = ctx.gl
    const res = this._resources.get(item.id)
    if (!res || !this._program || !this._vao) return
    const { gl } = ctx

    // A new run attached to the same clip: start over rather than show the
    // previous run's mask as if it were the new one.
    if (res.template !== item.frameUrlTemplate) {
      res.provider.dispose()
      res.provider = this._makeProvider(item.frameUrlTemplate, item.frameCount)
      res.template = item.frameUrlTemplate
      res.uploadedFrame = -1
    }

    const frame = item.sourceFrame
    if (res.uploadedFrame !== frame) {
      const img = res.provider.getCurrent(frame)
      if (img) {
        gl.bindTexture(gl.TEXTURE_2D, res.texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img.source)
        gl.bindTexture(gl.TEXTURE_2D, null)
        res.uploadedFrame = frame
      }
    }
    // Out-of-band: the current frame if missing, then the lookahead.
    res.provider.prewarm(frame, 1 + this._lookahead)

    if (res.uploadedFrame < 0) return
    // A frame the provider knows is absent (404 on an uncovered frame) must
    // draw nothing. Keeping the last upload here is what made an uncovered
    // frame show the PREVIOUS frame's mask. A frame that is merely still
    // loading is not "known missing", so I4 (keep the last upload) stands.
    if (res.uploadedFrame !== frame && res.provider.isKnownMissing(frame)) return

    this._program.use(gl)
    gl.bindVertexArray(this._vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, res.texture)

    this._program.setUniform1i(gl, 'uTexture', 0)
    this._program.setUniform1i(gl, 'uMode', item.mode === 'matte' ? 1 : 0)
    this._program.setUniform4f(gl, 'uColor', item.color[0], item.color[1], item.color[2], 1)
    this._program.setUniform1f(gl, 'uOpacity', item.opacity)
    const crop = item.crop
    this._program.setUniform4f(gl, 'uCrop', crop?.x ?? 0, crop?.y ?? 0, crop?.width ?? 0, crop?.height ?? 0)
    this._program.setUniformMatrix3fv(
      gl,
      'uTransform',
      false,
      buildDrawTransformMatrix(item.transform, ctx.stage.width, ctx.stage.height, item.width, item.height, crop),
    )

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    for (const res of this._resources.values()) {
      res.provider.dispose()
      if (this._gl) this._gl.deleteTexture(res.texture)
    }
    if (this._gl) {
      if (this._vao) this._gl.deleteVertexArray(this._vao)
      if (this._program) this._program.dispose(this._gl)
    }
    this._resources.clear()
    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Drop GL handles after a context loss (no GL calls). Providers go too; they refetch cheaply. */
  notifyContextLost(): void {
    for (const res of this._resources.values()) res.provider.dispose()
    this._resources.clear()
    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Exposed for testing. */
  getTextureCount(): number {
    return this._resources.size
  }

  private _ensurePipeline(gl: WebGL2RenderingContext): void {
    if (this._program && this._vao) return
    this._program = ShaderProgram.create(gl, QUAD_VERT_SRC, ROTO_MASK_FRAG_SRC)
    const vao = gl.createVertexArray()
    if (!vao) throw new Error('RotoMaskLayer: gl.createVertexArray() returned null')
    this._vao = vao
  }
}
