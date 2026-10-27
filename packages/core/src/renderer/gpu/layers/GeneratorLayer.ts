/**
 * GeneratorLayer — GPU layer for ActiveGeneratorClip items (EDX-P9).
 *
 * The same pipeline as ShapeLayer: paint onto ONE shared full-stage scratch
 * canvas with the shared painter (`generatorPaint`, also used by export),
 * upload into the item's texture, draw an identity full-stage quad — or hand
 * the texture to the effect chain when the clip has effects, a mask, a blend
 * or a matte. Generators animate, so the paint signature includes the frame
 * and most generators repaint every frame; a still gradient paints once.
 */

import type { ActiveGeneratorClip } from '../../../resolver/scene'
import { ShaderProgram } from '../ShaderProgram'
import { QUAD_FRAG_SRC } from '../shaders/quad.frag'
import { QUAD_VERT_SRC } from '../shaders/quad.vert'
import { generatorPaintSignature, paintGenerator } from './generatorPaint'
import type { Layer, LayerContext } from './types'
import { drawFullStageEffects } from './fullStageEffects'

const FULL_STAGE_MAT3 = new Float32Array([2, 0, 0, 0, 2, 0, -1, -1, 1])

export type GeneratorCanvasFactory = () => HTMLCanvasElement

interface ItemResources {
  texture: WebGLTexture
  width: number
  height: number
  lastSignature: string
}

export class GeneratorLayer implements Layer<ActiveGeneratorClip> {
  private _program: ShaderProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _gl: WebGL2RenderingContext | null = null
  private readonly _resources = new Map<string, ItemResources>()
  private _scratchCanvas: HTMLCanvasElement | null = null
  private _scratchCtx: CanvasRenderingContext2D | null = null
  private readonly _createCanvas: GeneratorCanvasFactory

  constructor(createCanvas?: GeneratorCanvasFactory) {
    this._createCanvas = createCanvas ?? (() => document.createElement('canvas'))
  }

  acquire(item: ActiveGeneratorClip, ctx: LayerContext): void {
    const { gl } = ctx
    this._gl = gl
    this._ensurePipeline(gl)
    const texture = gl.createTexture()
    if (!texture) throw new Error('GeneratorLayer: gl.createTexture() returned null')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this._resources.set(item.id, { texture, width: ctx.stage.width, height: ctx.stage.height, lastSignature: '' })
  }

  release(itemId: string): void {
    const res = this._resources.get(itemId)
    if (!res) return
    if (this._gl) this._gl.deleteTexture(res.texture)
    this._resources.delete(itemId)
  }

  draw(item: ActiveGeneratorClip, ctx: LayerContext): void {
    this._gl = ctx.gl
    const res = this._resources.get(item.id)
    if (!res || !this._program || !this._vao) return
    const { gl } = ctx

    if (res.width !== ctx.stage.width || res.height !== ctx.stage.height) {
      res.width = ctx.stage.width
      res.height = ctx.stage.height
      res.lastSignature = ''
    }

    const sig = generatorPaintSignature(item, ctx.stage)
    if (res.lastSignature !== sig) {
      if (!this._scratchCanvas) {
        this._scratchCanvas = this._createCanvas()
        const ctx2d = this._scratchCanvas.getContext('2d')
        if (!ctx2d) throw new Error('GeneratorLayer: 2D context unavailable')
        this._scratchCtx = ctx2d
      }
      const canvas = this._scratchCanvas
      if (canvas.width !== ctx.stage.width || canvas.height !== ctx.stage.height) {
        canvas.width = ctx.stage.width
        canvas.height = ctx.stage.height
      }
      this._scratchCtx!.clearRect(0, 0, ctx.stage.width, ctx.stage.height)
      paintGenerator(this._scratchCtx!, item, ctx.stage)
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
    if (drawFullStageEffects(ctx, item, this._program, this._vao, res.texture)) {
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
  }

  private _ensurePipeline(gl: WebGL2RenderingContext): void {
    if (this._program && this._vao) return
    this._program = ShaderProgram.create(gl, QUAD_VERT_SRC, QUAD_FRAG_SRC)
    const vao = gl.createVertexArray()
    if (!vao) throw new Error('GeneratorLayer: gl.createVertexArray() returned null')
    this._vao = vao
  }
}
