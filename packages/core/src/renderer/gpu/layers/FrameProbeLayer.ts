/**
 * FrameProbeLayer — synthetic bisection layer for the GPU renderer.
 *
 * Drop-in replacement for VideoLayer that draws NO decoded media. Instead each
 * active video clip is painted with a colour derived from its sourceFrame plus
 * the literal text "frame N", rendered to a 2D canvas and uploaded as a texture
 * through the same quad shader pipeline VideoLayer uses.
 *
 * Purpose: isolate the clock → RAF → resolveTimeline → render → draw → canvas
 * path from the decode/cache pipeline. If playback freezes with VideoLayer but
 * the probe keeps advancing, the bug is downstream in decode/cache, not the
 * render path. Wired in via the GpuRenderer `probeLayer` option.
 *
 * Uses item.sourceFrame as the frame signal — the exact value VideoLayer feeds
 * the decoder — so nothing outside this file (no shared types) needs to change.
 */

import type { ActiveVideoClip } from '../../../resolver/scene'
import { ShaderProgram } from '../ShaderProgram'
import { QUAD_FRAG_SRC } from '../shaders/quad.frag'
import { QUAD_VERT_SRC } from '../shaders/quad.vert'
import type { Layer, LayerContext } from './types'
import { buildVideoTransformMatrix } from './VideoLayer'

/** Per-clip resources: GL texture + the 2D canvas we repaint each frame. */
interface ItemResources {
  texture: WebGLTexture
  canvas: HTMLCanvasElement
  ctx2d: CanvasRenderingContext2D
  /** Last frame painted into the texture — skips re-upload on a frozen playhead. */
  lastPaintedFrame: number
}

const PROBE_WIDTH = 640
const PROBE_HEIGHT = 360

/** Map a frame number to a distinct, smoothly-cycling RGB fill via HSL. */
function frameColor(frame: number): string {
  const hue = (frame * 37) % 360
  return `hsl(${hue}, 70%, 45%)`
}

export class FrameProbeLayer implements Layer<ActiveVideoClip> {
  private _program: ShaderProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _gl: WebGL2RenderingContext | null = null
  private readonly _resources = new Map<string, ItemResources>()

  acquire(item: ActiveVideoClip, ctx: LayerContext): void {
    const { gl } = ctx
    this._gl = gl
    this._ensurePipeline(gl)

    const texture = gl.createTexture()
    if (!texture) {
      throw new Error('FrameProbeLayer: gl.createTexture() returned null')
    }

    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)

    const canvas = document.createElement('canvas')
    canvas.width = PROBE_WIDTH
    canvas.height = PROBE_HEIGHT
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) {
      throw new Error('FrameProbeLayer: 2D context unavailable')
    }

    this._resources.set(item.id, {
      texture,
      canvas,
      ctx2d,
      lastPaintedFrame: -1,
    })

    console.log(`[PROBE-ACQUIRE] clip=${item.id} sourceFrame=${item.sourceFrame}`)
  }

  release(itemId: string): void {
    const res = this._resources.get(itemId)
    if (!res) return
    if (this._gl) {
      this._gl.deleteTexture(res.texture)
    }
    this._resources.delete(itemId)
    console.log(`[PROBE-RELEASE] clip=${itemId}`)
  }

  draw(item: ActiveVideoClip, ctx: LayerContext): void {
    this._gl = ctx.gl
    const res = this._resources.get(item.id)
    if (!res || !this._program || !this._vao) return

    const { gl } = ctx
    const frame = item.sourceFrame

    if (res.lastPaintedFrame !== frame) {
      this._paint(res, frame)
      gl.bindTexture(gl.TEXTURE_2D, res.texture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        res.canvas as TexImageSource,
      )
      gl.bindTexture(gl.TEXTURE_2D, null)
      res.lastPaintedFrame = frame
      console.log(`[PROBE-UPLOAD] clip=${item.id} frame=${frame}`)
    }

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
      buildVideoTransformMatrix(item, ctx.stage.width, ctx.stage.height),
    )

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    console.log(`[PROBE-DRAW] clip=${item.id} frame=${frame}`)

    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindVertexArray(null)
  }

  dispose(): void {
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

  private _paint(res: ItemResources, frame: number): void {
    const { ctx2d } = res
    ctx2d.fillStyle = frameColor(frame)
    ctx2d.fillRect(0, 0, PROBE_WIDTH, PROBE_HEIGHT)

    ctx2d.fillStyle = '#ffffff'
    ctx2d.font = 'bold 96px monospace'
    ctx2d.textAlign = 'center'
    ctx2d.textBaseline = 'middle'
    ctx2d.fillText(`frame ${frame}`, PROBE_WIDTH / 2, PROBE_HEIGHT / 2)
  }

  private _ensurePipeline(gl: WebGL2RenderingContext): void {
    if (this._program && this._vao) return

    this._program = ShaderProgram.create(gl, QUAD_VERT_SRC, QUAD_FRAG_SRC)

    const vao = gl.createVertexArray()
    if (!vao) {
      throw new Error('FrameProbeLayer: gl.createVertexArray() returned null')
    }
    this._vao = vao
  }
}
