/**
 * TextLayer — GPU layer for ActiveTextClip items.
 *
 * Each active text clip is painted onto a per-item 2D canvas (sized to the
 * stage) and uploaded as a texture through the same quad shader pipeline
 * VideoLayer uses. Because positioning happens in 2D-canvas space, the quad is
 * drawn with an identity transform that fills the whole stage — no transform
 * matrix math needed here.
 *
 * Structurally this mirrors FrameProbeLayer (canvas → texImage2D → quad). The
 * one extra concern is alpha: text has transparent pixels around the glyphs, so
 * the texture must be uploaded with UNPACK_PREMULTIPLY_ALPHA so it composites
 * correctly against the premultiplied blend func set in WebGLContext
 * (gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA)). Video frames are opaque so they
 * never needed this.
 */

import type { ActiveTextClip } from '../../../resolver/scene'
import { ShaderProgram } from '../ShaderProgram'
import { QUAD_FRAG_SRC } from '../shaders/quad.frag'
import { QUAD_VERT_SRC } from '../shaders/quad.vert'
import { computeTextLayout } from './textLayout'
import type { Layer, LayerContext } from './types'

/**
 * Full-stage column-major 3×3 — maps normalized stage coords (0..1) to clip
 * space (-1..1). Equivalent to buildTransformMatrixFromRect with a rect that
 * covers the whole stage. The text canvas is always full-stage-sized; text
 * positioning is done inside the 2D canvas, not by the shader.
 *
 * Derivation: scale x2, translate -1 in both axes:
 *   [2, 0, 0, 0, 2, 0, -1, -1, 1]  (column-major)
 */
const FULL_STAGE_MAT3 = new Float32Array([2, 0, 0, 0, 2, 0, -1, -1, 1])

/** Factory for the offscreen paint canvas; injectable so tests can mock the DOM. */
export type TextCanvasFactory = () => HTMLCanvasElement

/** Per-clip resources: GL texture + the 2D canvas we repaint when text/style changes. */
interface ItemResources {
  texture: WebGLTexture
  canvas: HTMLCanvasElement
  ctx2d: CanvasRenderingContext2D
  /** Canvas dimensions currently allocated — repaint forced when the stage resizes. */
  width: number
  height: number
  /** Signature of the last painted content+style; skips re-upload when unchanged. */
  lastSignature: string
}

/** Stringified key of everything that affects the painted pixels (not opacity — that's a uniform). */
function paintSignature(item: ActiveTextClip, stage: { width: number; height: number }): string {
  return JSON.stringify([
    item.content,
    item.fontSize,
    item.color,
    item.fontFamily,
    item.fontWeight,
    item.textAlign,
    item.transform?.x,
    item.transform?.y,
    stage.width,
    stage.height,
  ])
}

export class TextLayer implements Layer<ActiveTextClip> {
  private _program: ShaderProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _gl: WebGL2RenderingContext | null = null
  private readonly _resources = new Map<string, ItemResources>()
  private readonly _createCanvas: TextCanvasFactory

  constructor(createCanvas?: TextCanvasFactory) {
    this._createCanvas = createCanvas ?? (() => document.createElement('canvas'))
  }

  acquire(item: ActiveTextClip, ctx: LayerContext): void {
    const { gl } = ctx
    this._gl = gl
    this._ensurePipeline(gl)

    const texture = gl.createTexture()
    if (!texture) {
      throw new Error('TextLayer: gl.createTexture() returned null')
    }

    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)

    const canvas = this._createCanvas()
    canvas.width = ctx.stage.width
    canvas.height = ctx.stage.height
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) {
      throw new Error('TextLayer: 2D context unavailable')
    }

    this._resources.set(item.id, {
      texture,
      canvas,
      ctx2d,
      width: canvas.width,
      height: canvas.height,
      lastSignature: '',
    })
  }

  release(itemId: string): void {
    const res = this._resources.get(itemId)
    if (!res) return
    if (this._gl) {
      this._gl.deleteTexture(res.texture)
    }
    this._resources.delete(itemId)
  }

  draw(item: ActiveTextClip, ctx: LayerContext): void {
    this._gl = ctx.gl
    const res = this._resources.get(item.id)
    if (!res || !this._program || !this._vao) return

    const { gl } = ctx

    // The stage can change (e.g. project aspect edit / resize). Resize the paint
    // canvas to match and force a repaint.
    if (res.width !== ctx.stage.width || res.height !== ctx.stage.height) {
      res.canvas.width = ctx.stage.width
      res.canvas.height = ctx.stage.height
      res.width = ctx.stage.width
      res.height = ctx.stage.height
      res.lastSignature = ''
    }

    const sig = paintSignature(item, ctx.stage)
    if (res.lastSignature !== sig) {
      this._paint(res, item, ctx.stage)
      gl.bindTexture(gl.TEXTURE_2D, res.texture)
      // Premultiply on upload so antialiased glyph edges blend correctly against
      // the premultiplied blend func; restore the default immediately so the
      // opaque video upload path is unaffected regardless of draw order.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        res.canvas as TexImageSource,
      )
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.bindTexture(gl.TEXTURE_2D, null)
      res.lastSignature = sig
    }

    const opacity = item.opacity ?? 1

    this._program.use(gl)
    gl.bindVertexArray(this._vao)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, res.texture)

    this._program.setUniform1i(gl, 'uTexture', 0)
    this._program.setUniform1f(gl, 'uOpacity', opacity)
    this._program.setUniformMatrix3fv(gl, 'uTransform', false, FULL_STAGE_MAT3)

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    if (this._gl) {
      for (const res of this._resources.values()) {
        this._gl.deleteTexture(res.texture)
      }
      if (this._vao) this._gl.deleteVertexArray(this._vao)
      if (this._program) this._program.dispose(this._gl)
    }
    this._resources.clear()
    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Drop GL object references after a context loss (no GL calls — context is gone). */
  notifyContextLost(): void {
    this._resources.clear()
    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Exposed for testing: number of per-clip texture handles. */
  getTextureCount(): number {
    return this._resources.size
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _paint(
    res: ItemResources,
    item: ActiveTextClip,
    stage: { width: number; height: number },
  ): void {
    const { ctx2d } = res

    ctx2d.clearRect(0, 0, stage.width, stage.height)

    // computeTextLayout sets ctx2d.font as a side effect, so the metrics it used
    // to place the lines are exactly the ones we paint with. The same call backs
    // the editor overlay's selection box, keeping handles glued to the glyphs.
    const layout = computeTextLayout(ctx2d, item, stage)

    ctx2d.fillStyle = layout.style.color
    ctx2d.textBaseline = 'middle'
    ctx2d.textAlign = layout.style.textAlign

    layout.lines.forEach((line, i) => {
      ctx2d.fillText(line, layout.anchorX, layout.firstLineY + i * layout.lineAdvance)
    })
  }

  private _ensurePipeline(gl: WebGL2RenderingContext): void {
    if (this._program && this._vao) return

    this._program = ShaderProgram.create(gl, QUAD_VERT_SRC, QUAD_FRAG_SRC)

    const vao = gl.createVertexArray()
    if (!vao) {
      throw new Error('TextLayer: gl.createVertexArray() returned null')
    }
    this._vao = vao
  }
}
