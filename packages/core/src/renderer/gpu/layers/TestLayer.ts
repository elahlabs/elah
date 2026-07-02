/**
 * TestLayer — GPU debug layer for renderer validation.
 *
 * Draws solid-colour quads via the existing quad shader pipeline. Each item
 * gets a 1×1 RGBA texture uploaded at acquire time; draw() sets uTransform
 * and uOpacity and issues a TRIANGLE_STRIP draw call.
 *
 * Exists ONLY for validating render graph orchestration, zIndex ordering,
 * transforms, opacity blending, and shader stability. Replaced by real layer
 * implementations once media decoding is wired in.
 */

import type { DebugRenderItem } from '../debug/types'
import { ShaderProgram } from '../ShaderProgram'
import { QUAD_FRAG_SRC } from '../shaders/quad.frag'
import { QUAD_VERT_SRC } from '../shaders/quad.vert'
import type { Layer, LayerContext } from './types'

/** Per-item GPU resources allocated at acquire time. */
interface ItemResources {
  texture: WebGLTexture
  color: [number, number, number, number]
}

/**
 * Build a column-major 3×3 transform matrix mapping the unit quad (0..1,
 * origin top-left) to clip space for a rect at pixel (x,y,w,h) on a stage
 * of size (sw, sh), with optional rotation about the rect centre.
 */
export function buildTransformMatrix(
  item: DebugRenderItem,
  stageWidth: number,
  stageHeight: number,
): Float32Array {
  const xs = item.x / stageWidth
  const ys = item.y / stageHeight
  const ws = item.width / stageWidth
  const hs = item.height / stageHeight
  const rotation = item.rotation ?? 0
  const sc = Math.cos(rotation)
  const ss = Math.sin(rotation)

  const tx = 2 * (xs + ws / 2 - 0.5 * sc * ws + 0.5 * ss * hs) - 1
  const ty = 2 * (ys + hs / 2 - 0.5 * ss * ws - 0.5 * sc * hs) - 1

  // Column-major mat3: [col0, col1, col2]
  return new Float32Array([2 * sc * ws, 2 * ss * ws, 0, -2 * ss * hs, 2 * sc * hs, 0, tx, ty, 1])
}

export class TestLayer implements Layer<DebugRenderItem> {
  private _program: ShaderProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _gl: WebGL2RenderingContext | null = null
  private readonly _resources = new Map<string, ItemResources>()

  acquire(item: DebugRenderItem, ctx: LayerContext): void {
    const { gl } = ctx
    this._gl = gl
    this._ensurePipeline(gl)

    const texture = gl.createTexture()
    if (!texture) {
      throw new Error('TestLayer: gl.createTexture() returned null')
    }

    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    const [r, g, b, a] = item.color
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([
        Math.round(r * 255),
        Math.round(g * 255),
        Math.round(b * 255),
        Math.round(a * 255),
      ]),
    )
    gl.bindTexture(gl.TEXTURE_2D, null)

    this._resources.set(item.id, { texture, color: item.color })
  }

  release(itemId: string): void {
    const res = this._resources.get(itemId)
    if (!res) return
    if (this._gl) {
      this._gl.deleteTexture(res.texture)
    }
    this._resources.delete(itemId)
  }

  draw(item: DebugRenderItem, ctx: LayerContext): void {
    this._gl = ctx.gl
    const res = this._resources.get(item.id)
    if (!res || !this._program || !this._vao) return

    const { gl } = ctx
    const opacity = item.opacity ?? 1

    this._program.use(gl)
    gl.bindVertexArray(this._vao)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, res.texture)

    this._program.setUniform1i(gl, 'uTexture', 0)
    this._program.setUniform1f(gl, 'uOpacity', opacity)
    this._program.setUniformMatrix3fv(
      gl,
      'uTransform',
      false,
      buildTransformMatrix(item, ctx.stage.width, ctx.stage.height),
    )

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    this._resources.clear()
    this._program = null
    this._vao = null
    this._gl = null
  }

  /**
   * Drop all GL object references after a context loss.
   * The next acquire() will re-create the shader pipeline.
   */
  notifyContextLost(): void {
    this._resources.clear()
    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Delete GL objects while the context is still valid. */
  disposeGL(gl: WebGL2RenderingContext): void {
    for (const res of this._resources.values()) {
      gl.deleteTexture(res.texture)
    }
    if (this._vao) gl.deleteVertexArray(this._vao)
    if (this._program) this._program.dispose(gl)
    this.dispose()
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _ensurePipeline(gl: WebGL2RenderingContext): void {
    if (this._program && this._vao) return

    this._program = ShaderProgram.create(gl, QUAD_VERT_SRC, QUAD_FRAG_SRC)

    const vao = gl.createVertexArray()
    if (!vao) {
      throw new Error('TestLayer: gl.createVertexArray() returned null')
    }
    this._vao = vao
  }
}
