/**
 * FreehandLayer — GPU layer for ActiveFreehandClip items.
 *
 * Renders an SVG path string (the `pathData` field) onto a full-stage 2D
 * canvas using the browser's Path2D API, then uploads it as a WebGL texture
 * through the same quad pipeline as TextLayer and ShapeLayer.
 *
 * The painting itself lives in `freehandPaint`, shared with the export worker
 * (PV-P2b), so the preview and an exported video cannot drift. This layer keeps
 * the `clearRect`, because it reuses one scratch canvas for every drawing; the
 * exporter does not, because it composites onto a fresh one.
 *
 * An empty or missing pathData produces a transparent frame (no-op paint).
 */

import type { ActiveFreehandClip } from '../../../resolver/scene'
import { ShaderProgram } from '../ShaderProgram'
import { QUAD_FRAG_SRC } from '../shaders/quad.frag'
import { QUAD_VERT_SRC } from '../shaders/quad.vert'
import type { Layer, LayerContext } from './types'
import { drawFullStageEffects } from './fullStageEffects'
import { freehandFrame } from './elementFrame'
import { freehandPaintSignature, paintFreehand } from './freehandPaint'

const FULL_STAGE_MAT3 = new Float32Array([2, 0, 0, 0, 2, 0, -1, -1, 1])

/**
 * Per-clip resources: the GL texture holding the last painted content.
 * Rasterization goes through ONE class-level scratch canvas shared by all
 * freehand strokes (see TextLayer.ts for the full rationale — per-clip
 * full-stage canvases were an unbounded memory sink).
 */
interface ItemResources {
  texture: WebGLTexture
  width: number
  height: number
  lastSignature: string
}

export class FreehandLayer implements Layer<ActiveFreehandClip> {
  private _program: ShaderProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _gl: WebGL2RenderingContext | null = null
  private readonly _resources = new Map<string, ItemResources>()
  /** Shared rasterization canvas — see ItemResources doc. */
  private _scratchCanvas: HTMLCanvasElement | null = null
  private _scratchCtx: CanvasRenderingContext2D | null = null

  acquire(item: ActiveFreehandClip, ctx: LayerContext): void {
    const { gl } = ctx
    this._gl = gl
    this._ensurePipeline(gl)

    const texture = gl.createTexture()
    if (!texture) throw new Error('FreehandLayer: gl.createTexture() returned null')

    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)

    this._resources.set(item.id, {
      texture,
      width: ctx.stage.width,
      height: ctx.stage.height,
      lastSignature: '',
    })
  }

  release(itemId: string): void {
    const res = this._resources.get(itemId)
    if (!res) return
    if (this._gl) this._gl.deleteTexture(res.texture)
    this._resources.delete(itemId)
  }

  draw(item: ActiveFreehandClip, ctx: LayerContext): void {
    this._gl = ctx.gl
    const res = this._resources.get(item.id)
    if (!res || !this._program || !this._vao) return

    const { gl } = ctx

    if (res.width !== ctx.stage.width || res.height !== ctx.stage.height) {
      res.width = ctx.stage.width
      res.height = ctx.stage.height
      res.lastSignature = ''
    }

    const sig = freehandPaintSignature(item, ctx.stage)
    if (res.lastSignature !== sig) {
      if (!this._scratchCanvas) {
        this._scratchCanvas = document.createElement('canvas')
        const ctx2d = this._scratchCanvas.getContext('2d')
        if (!ctx2d) throw new Error('FreehandLayer: 2D context unavailable')
        this._scratchCtx = ctx2d
      }
      const canvas = this._scratchCanvas
      if (canvas.width !== ctx.stage.width || canvas.height !== ctx.stage.height) {
        canvas.width = ctx.stage.width
        canvas.height = ctx.stage.height
      }
      // The clear is HERE, not in the shared painter: this canvas is reused for
      // every drawing, so a stale stroke would otherwise show through.
      this._scratchCtx!.clearRect(0, 0, ctx.stage.width, ctx.stage.height)
      paintFreehand(this._scratchCtx!, item, ctx.stage)
      gl.bindTexture(gl.TEXTURE_2D, res.texture)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas as TexImageSource)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.bindTexture(gl.TEXTURE_2D, null)
      res.lastSignature = sig
    }

    this._program.use(gl)
    gl.bindVertexArray(this._vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, res.texture)
    // Effect stack (EDX-P2): the chain draws the clip itself when it runs. A
    // mask on a v2 drawing is measured in the drawing's own box; a legacy one has
    // no box to measure, so its mask stays full-stage (PV-P2b).
    const maskFrame = item.mask && item.transformModel === 'v2' ? freehandFrame(item, ctx.stage) : undefined
    if (drawFullStageEffects(ctx, item, this._program, this._vao, res.texture, maskFrame)) {
      gl.bindTexture(gl.TEXTURE_2D, null)
      gl.bindVertexArray(null)
      return
    }
    this._program.setUniform1i(gl, 'uTexture', 0)
    this._program.setUniform1f(gl, 'uOpacity', item.opacity ?? 1)
    this._program.setUniformMatrix3fv(gl, 'uTransform', false, FULL_STAGE_MAT3)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    if (this._gl) {
      for (const res of this._resources.values()) this._gl.deleteTexture(res.texture)
      if (this._vao) this._gl.deleteVertexArray(this._vao)
      if (this._program) this._program.dispose(this._gl)
    }
    this._resources.clear()
    this._program = null
    this._vao = null
    this._gl = null
    this._scratchCanvas = null
    this._scratchCtx = null
  }

  notifyContextLost(): void {
    this._resources.clear()
    this._program = null
    this._vao = null
    this._gl = null
    // Scratch canvas is plain 2D-canvas state, not a GL object — kept across
    // context loss; _ensurePipeline rebuilds the GL side.
  }

  private _ensurePipeline(gl: WebGL2RenderingContext): void {
    if (this._program && this._vao) return
    this._program = ShaderProgram.create(gl, QUAD_VERT_SRC, QUAD_FRAG_SRC)
    const vao = gl.createVertexArray()
    if (!vao) throw new Error('FreehandLayer: gl.createVertexArray() returned null')
    this._vao = vao
  }
}
