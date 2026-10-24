/**
 * GPU effects in export (EDX-P3).
 *
 * The export worker composites frames with Canvas2D, which cannot run the
 * effect shaders. Rather than implement every effect twice, the worker opens
 * ONE WebGL2 context on an OffscreenCanvas and draws each clip that carries
 * effects through the very same `EffectChain` the preview uses — capture,
 * passes, placement, opacity — then copies the result onto the 2D frame.
 * Clips without effects never touch the GPU, so their export output is
 * exactly what it was before this file existed.
 *
 * Coordinates follow the preview: draw rects are in the project's logical
 * stage units and the viewport maps them onto the output canvas, so
 * stage-pixel params (blur radius, grain size) look the same at 720p as at
 * 1080p.
 */

import { MAX_COMPOUND_DEPTH, type Project } from '../types'
import type { ResolvedEffect, ResolvedMatte } from '../effects/resolveEffects'
import { EffectChain } from '../renderer/gpu/EffectChain'
import { GPU_EFFECTS } from '../renderer/gpu/effects'
import { buildTransformMatrixFromRect, resolveDrawRect, rectTilt, tiltOf, type CropRect, type DrawRect } from '../renderer/gpu/layers/drawRect'
import type { LayerContext, TransitionSpec } from '../renderer/gpu/layers/types'
import { ShaderProgram } from '../renderer/gpu/ShaderProgram'
import { QUAD_FRAG_SRC } from '../renderer/gpu/shaders/quad.frag'
import { QUAD_VERT_SRC } from '../renderer/gpu/shaders/quad.vert'
import type { Transform } from '../types'
import { ExportCapabilityError, WEBGL2_EXPORT_MESSAGE } from './exportErrors'
import { isDrawableMask } from '../renderer/gpu/compositing'
import type { ClipMask } from '../types'
import { getTransitionDefinition } from '../transitions/registry'

export { ExportCapabilityError, WEBGL2_EXPORT_MESSAGE } from './exportErrors'

/**
 * Whether any clip needs the GPU in export: an enabled effect the GPU can
 * draw, or a drawable mask. Blend modes do not — Canvas2D composites them.
 *
 * PV-P1b-1: this RECURSES into compound clips. A compound's child scene is
 * materialised by the resolver and painted by the export worker exactly like a
 * top-level clip, so an effect on a child needs the GPU just as much. Without
 * the descent a project whose only effect lives inside a compound exports down
 * the Canvas2D path with that effect silently missing.
 *
 * Each level also has its own `transitions`, checked on the way in, because a
 * nested transition is composited by the same worker code.
 */
export function projectNeedsGpu(project: Pick<Project, 'clips'> & { transitions?: Project['transitions'] }): boolean {
  return levelNeedsGpu(project, 0)
}

/**
 * One nesting level.
 *
 * The bound is `depth > MAX_COMPOUND_DEPTH`, not `>=`, and the difference
 * matters: the resolver collects compounds at depths 0..3 and resolves their
 * children at 1..4, so a masked shape at depth 4 IS materialised and DOES need
 * the GPU. Stopping at `>=` would skip exactly the deepest real level.
 */
function levelNeedsGpu(project: Pick<Project, 'clips'> & { transitions?: Project['transitions'] }, depth: number): boolean {
  if (depth > MAX_COMPOUND_DEPTH) return false
  // Transitions the Canvas2D fallback cannot draw (EDX-P9c) need the GPU.
  if (project.transitions?.some((t) => !getTransitionDefinition(t.kind)?.canvas2d)) return true
  for (const list of Object.values(project.clips)) {
    for (const clip of list) {
      if (clip.effects?.some((e) => e && e.enabled !== false && GPU_EFFECTS.has(e.kind))) return true
      if (isDrawableMask(clip.mask)) return true
      // MOT-8 phase B: a 3D tilt is a projective quad; only the worker's WebGL2 path draws one.
      if (clipTilts(clip)) return true
      // Mattes and adjustment clips are GPU-only (EDX-P7).
      if (clip.matte || clip.type === 'adjustment') return true
      if (clip.type === 'compound' && clip.compound && levelNeedsGpu(clip.compound.project, depth + 1)) return true
    }
  }
  return false
}

/**
 * MOT-8 phase B: clip kinds that draw a rotateX / rotateY tilt: the ones placed as one textured
 * quad. Text, shape, freehand and generator clips paint onto a full-stage 2D canvas, which a
 * projective quad cannot place without flattening them to a texture first; they ignore the tilt,
 * in preview and export alike, so the two agree.
 */
const TILT_KINDS: ReadonlySet<string> = new Set(['video', 'image', 'sequence', 'compound'])

/** Whether a clip kind draws a 3D tilt at all. */
export function kindDrawsTilt(kind: string): boolean {
  return TILT_KINDS.has(kind)
}

/** Whether a clip tilts in 3D at some point: a static tilt, or keys on rotateX / rotateY. */
function clipTilts(clip: Project['clips'][string][number]): boolean {
  if (!kindDrawsTilt(clip.type)) return false
  const t = clip.transform
  if (t && tiltOf(t.rotateX, t.rotateY, t.perspective)) return true
  const ch = clip.keyframes?.channels
  return !!ch && ((ch.rotateX?.keys.length ?? 0) > 0 || (ch.rotateY?.keys.length ?? 0) > 0)
}

/** A drawable the GPU can upload: canvas, bitmap or video frame, with its size. */
export type ExportSource = TexImageSource & { width: number; height: number }

export interface ExportClipDraw {
  source: ExportSource
  /** Clip transform; undefined = contained in the stage, as in preview. */
  transform?: Transform
  crop?: CropRect
  cornerRadius?: number
  opacity: number
  effects: ReadonlyArray<ResolvedEffect>
  /** Mask in the clip's box (EDX-P7). */
  mask?: ClipMask
  /** Track matte (EDX-P7); its source must be set with `setMatte` this frame. */
  matte?: ResolvedMatte
  /** The element's own box in stage px, for masks on painted kinds (EDX-P7c). */
  maskFrame?: DrawRect
  /**
   * The source already holds the clip at its stage position (text, shape,
   * freehand painted onto a stage-sized canvas) — place it full-stage.
   */
  fullStage?: boolean
  /**
   * The size the element is placed at, when that is not the source's pixel size:
   * a compound's picture may be a capped copy of its content (EXP-1), but the
   * preview places it by the content size.
   */
  contentSize?: { width: number; height: number }
}

/**
 * Where a draw happens, when it is not the root of the frame (EXP-1). A nested
 * scene has its own stage, fps and frame; the preview runs its graph with
 * exactly those (`CompoundLayer`), so a draw inside a compound must too.
 */
export interface GpuView {
  /** Stage the draw rect is measured in; default the project's. */
  stage?: { width: number; height: number }
  /** Frame rate effects time against; default the project's. */
  fps?: number
  /** Namespace of the matte keys this draw reads (see `LayerContext.keyPrefix`). */
  keyPrefix?: string
  /**
   * Pixel size of the target being drawn into, when it is not the output
   * frame: the renderer sizes its canvas to it for this draw and back after.
   */
  output?: { width: number; height: number }
}

export type Gl2Factory = (width: number, height: number) => {
  canvas: OffscreenCanvas | HTMLCanvasElement
  gl: WebGL2RenderingContext
} | null

const defaultFactory: Gl2Factory = (width, height) => {
  if (typeof OffscreenCanvas === 'undefined') return null
  const canvas = new OffscreenCanvas(width, height)
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    antialias: false,
  }) as WebGL2RenderingContext | null
  return gl ? { canvas, gl } : null
}

/**
 * One GL context for the whole export. `draw()` renders a single clip onto a
 * transparent canvas the size of the output frame and returns that canvas
 * for `ctx2d.drawImage(canvas, 0, 0)`, or null when the chain could not run
 * (the caller then draws the clip the 2D way).
 */
export class WorkerEffectRenderer {
  readonly canvas: OffscreenCanvas | HTMLCanvasElement
  private readonly _gl: WebGL2RenderingContext
  private readonly _chain = new EffectChain()
  private readonly _program: ShaderProgram
  private readonly _vao: WebGLVertexArrayObject
  private readonly _texture: WebGLTexture
  private readonly _stage: { width: number; height: number }
  private readonly _fps: number
  /** The output frame's size: what the canvas is whenever no view says otherwise. */
  private readonly _output: { width: number; height: number }

  private constructor(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    stage: { width: number; height: number },
    fps: number,
    output: { width: number; height: number },
  ) {
    this.canvas = canvas
    this._gl = gl
    this._stage = stage
    this._fps = fps
    this._output = output
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    this._program = ShaderProgram.create(gl, QUAD_VERT_SRC, QUAD_FRAG_SRC)
    const vao = gl.createVertexArray()
    const texture = gl.createTexture()
    if (!vao || !texture) throw new ExportCapabilityError(WEBGL2_EXPORT_MESSAGE)
    this._vao = vao
    this._texture = texture
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  /**
   * Open the renderer, or throw `ExportCapabilityError` when this
   * environment has no WebGL2 (or the shaders do not compile).
   */
  static create(
    output: { width: number; height: number },
    stage: { width: number; height: number },
    fps: number,
    factory: Gl2Factory = defaultFactory,
  ): WorkerEffectRenderer {
    let made: ReturnType<Gl2Factory> = null
    try {
      made = factory(output.width, output.height)
    } catch {
      made = null
    }
    if (!made) throw new ExportCapabilityError(WEBGL2_EXPORT_MESSAGE)
    try {
      return new WorkerEffectRenderer(made.canvas, made.gl, stage, fps, { width: output.width, height: output.height })
    } catch (err) {
      if (err instanceof ExportCapabilityError) throw err
      throw new ExportCapabilityError(`${WEBGL2_EXPORT_MESSAGE} (${(err as Error).message})`)
    }
  }

  /** Chain runs so far; for logs and tests. */
  get runs(): number {
    return this._chain.runs
  }

  draw(item: ExportClipDraw, frame: number, view?: GpuView): OffscreenCanvas | HTMLCanvasElement | null {
    const gl = this._gl
    const stage = view?.stage ?? this._stage
    const { width: sw, height: sh } = stage
    this._fit(view?.output)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this._texture)
    // Premultiply on upload, as ImageLayer/TextLayer do, so edges of
    // transparent sources blend correctly; opaque video is unaffected.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._uploadable(item.source))
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)

    const contentW = item.contentSize?.width ?? item.source.width
    const contentH = item.contentSize?.height ?? item.source.height
    const rect = item.fullStage
      ? { x: 0, y: 0, width: sw, height: sh, rotation: 0 }
      : resolveDrawRect(item.transform, sw, sh, contentW, contentH, item.crop)

    const ctx = this._context(frame, view)
    this._program.use(gl)
    gl.bindVertexArray(this._vao)
    const drawn = this._chain.draw(ctx, {
      program: this._program,
      vao: this._vao,
      unit: 0,
      contentWidth: item.fullStage ? sw : contentW,
      contentHeight: item.fullStage ? sh : contentH,
      ...(item.crop && !item.fullStage ? { crop: item.crop } : {}),
      cornerRadius: item.fullStage ? 0 : (item.cornerRadius ?? 0),
      rect,
      opacity: item.opacity,
      effects: item.effects,
      ...(item.mask ? { mask: item.mask } : {}),
      ...(item.matte ? { matte: item.matte } : {}),
      ...(item.mask && item.maskFrame ? { maskFrame: item.maskFrame } : {}),
    })
    if (!drawn && !item.fullStage && rectTilt(rect)) {
      // MOT-8 phase B: a tilted clip with nothing for the chain to do (no effect, mask or matte)
      // still needs this path: the 2D canvas cannot draw it. Same program, uniforms and matrix
      // as the preview layers, straight onto the cleared frame.
      this._program.use(gl)
      gl.bindVertexArray(this._vao)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this._texture)
      this._drawQuad(item, rect, sw, sh)
      gl.bindTexture(gl.TEXTURE_2D, null)
      gl.bindVertexArray(null)
      return this.canvas
    }
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindVertexArray(null)
    return drawn ? this.canvas : null
  }

  /** One textured quad, placed by the rect's matrix: the body of every preview media layer's plain draw. */
  private _drawQuad(item: ExportClipDraw, rect: DrawRect, sw: number, sh: number): void {
    const gl = this._gl
    const radius = item.cornerRadius ?? 0
    const crop = item.crop
    this._program.setUniform1i(gl, 'uTexture', 0)
    this._program.setUniform1f(gl, 'uOpacity', item.opacity)
    this._program.setUniform2f(gl, 'uRadius', radius, radius)
    this._program.setUniform4f(gl, 'uCrop', crop?.x ?? 0, crop?.y ?? 0, crop?.width ?? 0, crop?.height ?? 0)
    this._program.setUniform1i(gl, 'uRotation', 0)
    this._program.setUniformMatrix3fv(gl, 'uTransform', false, buildTransformMatrixFromRect(rect, sw, sh))
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /** The layer context for a draw: the project's stage and fps unless `view` says otherwise. */
  private _context(frame: number, view?: GpuView): LayerContext {
    return {
      gl: this._gl,
      frame,
      stage: view?.stage ?? this._stage,
      viewport: { width: this.canvas.width, height: this.canvas.height },
      fps: view?.fps ?? this._fps,
      ...(view?.keyPrefix ? { keyPrefix: view.keyPrefix } : {}),
    }
  }

  /** Size the canvas for this draw; a no-op (no write) at the output size. */
  private _fit(output?: { width: number; height: number }): void {
    const want = output ?? this._output
    if (this.canvas.width !== want.width) this.canvas.width = want.width
    if (this.canvas.height !== want.height) this.canvas.height = want.height
  }

  /**
   * WebGL ignores UNPACK_FLIP_Y for an `ImageBitmap` (the spec leaves
   * orientation to the bitmap), while every other source — the preview's
   * `<img>`, decoded video canvases, painted text — IS flipped. Uploading the
   * worker's image bitmaps as-is drew exported image clips upside down inside
   * their box whenever they went through the chain. Copy each bitmap into a
   * canvas once (cached per bitmap) so it uploads like everything else.
   */
  private readonly _bitmapCanvases = new WeakMap<object, OffscreenCanvas | HTMLCanvasElement>()
  private _uploadable(source: ExportSource): TexImageSource {
    if (typeof ImageBitmap === 'undefined' || !(source instanceof ImageBitmap)) return source
    let canvas = this._bitmapCanvases.get(source)
    if (!canvas) {
      canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(source.width, source.height)
          : Object.assign(document.createElement('canvas'), { width: source.width, height: source.height })
      ;(canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null)?.drawImage(source, 0, 0)
      this._bitmapCanvases.set(source, canvas)
    }
    return canvas
  }

  /**
   * Transitions (EDX-P9c): composite two clips, each already painted alone
   * onto an output-sized canvas (effects included), with the same shader the
   * preview uses. Returns the output canvas (transparent where neither clip
   * is), or null when the shader cannot run.
   */
  drawTransition(
    fromCanvas: TexImageSource,
    toCanvas: TexImageSource,
    spec: TransitionSpec,
    frame: number,
    view?: GpuView,
  ): OffscreenCanvas | HTMLCanvasElement | null {
    const gl = this._gl
    this._fit(view?.output)
    const fromKey = '\u0000tr:from'
    const toKey = '\u0000tr:to'
    if (!this._chain.setMatteSource(gl, fromKey, fromCanvas)) return null
    if (!this._chain.setMatteSource(gl, toKey, toCanvas)) return null
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const ctx = this._context(frame, view)
    const drawn = this._chain.drawTransition(ctx, fromKey, toKey, spec)
    // Consumed: free the pair now, so a transition inside a compound leaves
    // nothing behind for a frame end that only the top level performs.
    this._chain.releaseTargets(gl, '\u0000tr:')
    return drawn ? this.canvas : null
  }

  /**
   * Use a painted canvas as the matte for `clipId` this frame (EDX-P7). Inside
   * a compound the key is namespaced by `keyPrefix`, as the preview's is, so two
   * clips with one id at different levels never share a matte.
   */
  setMatte(clipId: string, source: TexImageSource, keyPrefix = ''): boolean {
    return this._chain.setMatteSource(this._gl, keyPrefix + clipId, source)
  }

  /** Forget the mattes under `prefix` (one compound's), leaving the parent's alone. */
  releaseKeys(prefix: string): void {
    this._chain.releaseTargets(this._gl, prefix)
  }

  /** Forget this frame's mattes. */
  endFrame(): void {
    this._chain.endFrame(this._gl)
  }

  dispose(): void {
    const gl = this._gl
    this._chain.dispose()
    this._program.dispose(gl)
    gl.deleteVertexArray(this._vao)
    gl.deleteTexture(this._texture)
  }
}
