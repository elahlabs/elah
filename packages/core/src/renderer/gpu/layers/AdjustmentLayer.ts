/**
 * AdjustmentLayer — GPU layer for adjustment clips (EDX-P7).
 *
 * An adjustment clip has no picture. When its turn comes in zIndex order it
 * copies the composite drawn so far (the stage viewport of the current
 * framebuffer), runs that copy through the clip's EffectChain as a full-stage
 * source, and places the result back over the stage. So its effects apply to
 * everything below it; its opacity mixes the adjusted image with the
 * original; its mask limits where it applies; its blend composites it.
 *
 * Needs `ctx.effectChain`; without one (tests, probe mode) it draws nothing,
 * which leaves the picture as if the clip were absent.
 */

import type { ActiveAdjustmentClip } from '../../../resolver/scene'
import { ShaderProgram } from '../ShaderProgram'
import { QUAD_FRAG_SRC } from '../shaders/quad.frag'
import { QUAD_VERT_SRC } from '../shaders/quad.vert'
import type { Layer, LayerContext } from './types'

export class AdjustmentLayer implements Layer<ActiveAdjustmentClip> {
  private _program: ShaderProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _texture: WebGLTexture | null = null
  private _size: [number, number, number] = [0, 0, 0]
  private _gl: WebGL2RenderingContext | null = null

  acquire(_item: ActiveAdjustmentClip, ctx: LayerContext): void {
    this._gl = ctx.gl
    this._ensure(ctx.gl)
  }

  release(_itemId: string): void {
    // One shared copy texture for every adjustment clip; freed in dispose().
  }

  draw(item: ActiveAdjustmentClip, ctx: LayerContext): void {
    const { gl } = ctx
    this._gl = gl
    if (!ctx.effectChain) return
    this._ensure(gl)
    if (!this._program || !this._vao || !this._texture) return

    const vp = Array.from(gl.getParameter(gl.VIEWPORT) as ArrayLike<number>)
    const [vx = 0, vy = 0, vw = 0, vh = 0] = vp
    if (vw <= 0 || vh <= 0) return

    // Copy what is drawn so far. The format must match the framebuffer being
    // read: the preview canvas is opaque (RGB); an effect target is RGBA.
    const readsDefault = gl.getParameter(gl.FRAMEBUFFER_BINDING) === null
    const format = readsDefault && gl.getContextAttributes()?.alpha === false ? gl.RGB : gl.RGBA
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this._texture)
    if (this._size[0] !== vw || this._size[1] !== vh || this._size[2] !== format) {
      gl.texImage2D(gl.TEXTURE_2D, 0, format, vw, vh, 0, format, gl.UNSIGNED_BYTE, null)
      this._size = [vw, vh, format]
    }
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, vx, vy, vw, vh)

    this._program.use(gl)
    gl.bindVertexArray(this._vao)
    const { width, height } = ctx.stage
    ctx.effectChain.draw(ctx, {
      program: this._program,
      vao: this._vao,
      unit: 0,
      contentWidth: vw,
      contentHeight: vh,
      rect: { x: 0, y: 0, width, height, rotation: 0 },
      opacity: item.opacity ?? 1,
      effects: item.effects ?? [],
      ...(item.mask ? { mask: item.mask } : {}),
      ...(item.blend ? { blend: item.blend } : {}),
      ...(item.matte ? { matte: item.matte } : {}),
    })
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    const gl = this._gl
    if (gl) {
      if (this._texture) gl.deleteTexture(this._texture)
      if (this._vao) gl.deleteVertexArray(this._vao)
      if (this._program) this._program.dispose(gl)
    }
    this.notifyContextLost()
  }

  notifyContextLost(): void {
    this._program = null
    this._vao = null
    this._texture = null
    this._size = [0, 0, 0]
    this._gl = null
  }

  private _ensure(gl: WebGL2RenderingContext): void {
    if (this._program && this._vao && this._texture) return
    this._program = ShaderProgram.create(gl, QUAD_VERT_SRC, QUAD_FRAG_SRC)
    this._vao = gl.createVertexArray()
    this._texture = gl.createTexture()
    if (!this._texture) return
    gl.bindTexture(gl.TEXTURE_2D, this._texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }
}
