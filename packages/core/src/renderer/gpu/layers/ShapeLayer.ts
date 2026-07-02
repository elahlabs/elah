/**
 * ShapeLayer — GPU layer for ActiveShapeClip items.
 *
 * Each shape is painted onto a per-item full-stage 2D canvas and uploaded as a
 * WebGL texture through the same quad pipeline TextLayer uses. The shape is
 * drawn centered on the canvas using the clip's transform (x/y = normalized
 * center, scale = fraction of the stage's short side).
 *
 * Defaults when no transform is provided:
 *   center: (0.5, 0.5), scale: 0.5 → shape occupies half the short side.
 */

import type { ActiveShapeClip } from '../../../resolver/scene'
import { ShaderProgram } from '../ShaderProgram'
import { QUAD_FRAG_SRC } from '../shaders/quad.frag'
import { QUAD_VERT_SRC } from '../shaders/quad.vert'
import type { Layer, LayerContext } from './types'

const FULL_STAGE_MAT3 = new Float32Array([2, 0, 0, 0, 2, 0, -1, -1, 1])

interface ItemResources {
  texture: WebGLTexture
  canvas: HTMLCanvasElement
  ctx2d: CanvasRenderingContext2D
  width: number
  height: number
  lastSignature: string
}

function paintSignature(item: ActiveShapeClip, stage: { width: number; height: number }): string {
  return JSON.stringify([
    item.shapeKind,
    item.shapeFill,
    item.shapeStroke,
    item.shapeStrokeWidth,
    item.transform?.x,
    item.transform?.y,
    item.transform?.scale,
    stage.width,
    stage.height,
  ])
}

function paintShape(
  ctx2d: CanvasRenderingContext2D,
  item: ActiveShapeClip,
  stage: { width: number; height: number },
): void {
  ctx2d.clearRect(0, 0, stage.width, stage.height)

  const cx = (item.transform?.x ?? 0.5) * stage.width
  const cy = (item.transform?.y ?? 0.5) * stage.height
  const shortSide = Math.min(stage.width, stage.height)
  const half = (item.transform?.scale ?? 0.5) * shortSide * 0.5

  ctx2d.fillStyle = item.shapeFill
  ctx2d.strokeStyle = item.shapeStroke
  ctx2d.lineWidth = item.shapeStrokeWidth

  if (item.shapeKind === 'rect') {
    ctx2d.beginPath()
    ctx2d.rect(cx - half, cy - half, half * 2, half * 2)
    ctx2d.fill()
    if (item.shapeStrokeWidth > 0) ctx2d.stroke()
  } else if (item.shapeKind === 'circle') {
    ctx2d.beginPath()
    ctx2d.arc(cx, cy, half, 0, Math.PI * 2)
    ctx2d.fill()
    if (item.shapeStrokeWidth > 0) ctx2d.stroke()
  } else if (item.shapeKind === 'triangle') {
    ctx2d.beginPath()
    ctx2d.moveTo(cx, cy - half)
    ctx2d.lineTo(cx + half, cy + half)
    ctx2d.lineTo(cx - half, cy + half)
    ctx2d.closePath()
    ctx2d.fill()
    if (item.shapeStrokeWidth > 0) ctx2d.stroke()
  }
}

export class ShapeLayer implements Layer<ActiveShapeClip> {
  private _program: ShaderProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _gl: WebGL2RenderingContext | null = null
  private readonly _resources = new Map<string, ItemResources>()

  acquire(item: ActiveShapeClip, ctx: LayerContext): void {
    const { gl } = ctx
    this._gl = gl
    this._ensurePipeline(gl)

    const texture = gl.createTexture()
    if (!texture) throw new Error('ShapeLayer: gl.createTexture() returned null')

    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)

    const canvas = document.createElement('canvas')
    canvas.width = ctx.stage.width
    canvas.height = ctx.stage.height
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) throw new Error('ShapeLayer: 2D context unavailable')

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
    if (this._gl) this._gl.deleteTexture(res.texture)
    this._resources.delete(itemId)
  }

  draw(item: ActiveShapeClip, ctx: LayerContext): void {
    this._gl = ctx.gl
    const res = this._resources.get(item.id)
    if (!res || !this._program || !this._vao) return

    const { gl } = ctx

    if (res.width !== ctx.stage.width || res.height !== ctx.stage.height) {
      res.canvas.width = ctx.stage.width
      res.canvas.height = ctx.stage.height
      res.width = ctx.stage.width
      res.height = ctx.stage.height
      res.lastSignature = ''
    }

    const sig = paintSignature(item, ctx.stage)
    if (res.lastSignature !== sig) {
      paintShape(res.ctx2d, item, ctx.stage)
      gl.bindTexture(gl.TEXTURE_2D, res.texture)
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

    this._program.use(gl)
    gl.bindVertexArray(this._vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, res.texture)
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
    if (!vao) throw new Error('ShapeLayer: gl.createVertexArray() returned null')
    this._vao = vao
  }
}
