/**
 * EffectChain — runs a clip's effect stack on the GPU (EDX-P2).
 *
 * A layer that finds `item.effects` on a clip hands the chain its already
 * bound source texture and its usual placement. The chain then:
 *
 *   1. CAPTURE — draws the (cropped, corner-rounded) source into a render
 *      target sized to the clip's content, plus padding for effects that
 *      bleed (blur, splits). It uses the layer's own quad program, so crop and
 *      corner radius behave exactly as they do without effects.
 *   2. PASSES — ping-pongs through each enabled effect with blending off.
 *   3. PLACE — draws the result with the layer's quad program at the clip's
 *      rect grown by the padding, applying opacity. Transform, rotation and
 *      zIndex are therefore untouched by effects.
 *
 * Order is Premiere's: crop → effects (stack order) → transform / opacity.
 * The corner mask runs at capture (before effects), so a blur softens the
 * rounded edge instead of being cut by it.
 *
 * A clip with no effects never reaches this class, which is why the GL call
 * stream for such clips is byte-identical to before (GoldenFrameHash).
 *
 * Resolution: the chain works at min(source size, on-stage size), capped at
 * `MAX_CHAIN_SIDE` on the long edge; stage-pixel params (blur radius, grain
 * size) are converted with `pxPerStagePx`, so the look does not change with
 * the source's resolution.
 */

import type { ResolvedEffect } from '../../effects/resolveEffects'
import { GPU_EFFECTS } from './effects'
import type { EffectEnv, GpuEffect, UniformValue } from './effects/types'
import { FramebufferPool, type RenderTarget } from './FramebufferPool'
import { buildTransformMatrixFromRect, normalizeCrop, type CropRect, type DrawRect } from './layers/drawRect'
import type { LayerContext, TransitionSpec } from './layers/types'
import { ShaderProgram } from './ShaderProgram'
import { EFFECT_VERT_SRC } from './shaders/effect.vert'
import { QUAD_VERT_SRC } from './shaders/quad.vert'
import { MATTE_MODE_INDEX, isDrawableMask } from './compositing'
import {
  BLEND_FRAG_SRC,
  BLEND_MODE_INDEX,
  MASK_FRAG,
  maskUniforms,
  rasterisePathMask,
  type MaskFrame,
} from './compositingGpu'
import type { BlendMode, ClipMask } from '../../types'
import type { ResolvedMatte } from '../../effects/resolveEffects'
import { TRANSITION_FRAG_SRC, TRANSITION_KIND_INDEX, transitionDirection } from './transitions'

/** Long-edge cap for chain targets, in pixels. */
export const MAX_CHAIN_SIDE = 2048
/** Cap on the summed bleed padding, in stage pixels. */
export const MAX_CHAIN_PADDING = 256

export interface ChainDrawRequest {
  /** The layer's quad program (quad.vert + quad.frag). */
  program: ShaderProgram
  /** The layer's VAO for that program. */
  vao: WebGLVertexArrayObject
  /** Texture unit the source texture is bound to. */
  unit: number
  /** Natural size of the source texture. */
  contentWidth: number
  contentHeight: number
  crop?: CropRect
  /** Source rotation of the bound texture (quad.vert `uRotation`); default 0. */
  rotation?: number
  cornerRadius?: number
  /** Stage-space placement of the cropped content, exactly as the layer would draw it. */
  rect: DrawRect
  opacity: number
  effects: ReadonlyArray<ResolvedEffect>
  /** Mask in the clip's box (EDX-P7); applied after the effects. */
  mask?: ClipMask
  /**
   * The element's own box in STAGE px (text block, shape), when the clip's
   * texture is the whole stage. The mask is measured in it instead of the
   * stage (EDX-P7c).
   */
  maskFrame?: DrawRect
  /**
   * Non-normal blend against what is already drawn (EDX-P7). Preview only:
   * the exporter composites blends with Canvas2D and leaves this unset.
   */
  blend?: BlendMode
  /**
   * Track matte (EDX-P7). The source clip must have been rendered with
   * `renderMatte` (preview) or `setMatteSource` (export) this frame; if it
   * was not, an alpha/luma matte hides the clip and an inverted one ignores
   * the matte — Premiere's behaviour for an empty matte track.
   */
  matte?: ResolvedMatte
}

/** Geometry of one chain run. Pure; exported for tests. */
export interface ChainPlan {
  /** Content size inside the target, px. */
  contentWidth: number
  contentHeight: number
  /** Padding each side, px. */
  padX: number
  padY: number
  /** Target size, px. */
  width: number
  height: number
  pxPerStagePx: [number, number]
  /** Where the chain output is drawn on the stage. */
  outRect: DrawRect
}

/**
 * Size the chain for one clip. Returns null when there is nothing drawable
 * (zero-size rect or content).
 */
export function planChain(
  rect: DrawRect,
  sourceWidth: number,
  sourceHeight: number,
  crop: CropRect | undefined,
  effects: ReadonlyArray<{ gpu: GpuEffect; params: ResolvedEffect['params'] }>,
): ChainPlan | null {
  const rw = Math.abs(rect.width)
  const rh = Math.abs(rect.height)
  if (!(rw > 0) || !(rh > 0)) return null
  const c = crop ? normalizeCrop(crop) : null
  const srcW = (sourceWidth > 0 ? sourceWidth : rw) * (c ? c.width : 1)
  const srcH = (sourceHeight > 0 ? sourceHeight : rh) * (c ? c.height : 1)

  let cw = Math.min(srcW, rw)
  let ch = Math.min(srcH, rh)
  const long = Math.max(cw, ch)
  if (long > MAX_CHAIN_SIDE) {
    const s = MAX_CHAIN_SIDE / long
    cw *= s
    ch *= s
  }
  cw = Math.max(1, Math.round(cw))
  ch = Math.max(1, Math.round(ch))
  const kx = cw / rw
  const ky = ch / rh

  let pad = 0
  for (const e of effects) pad += Math.max(0, e.gpu.padding?.(e.params, { width: rw, height: rh }) ?? 0)
  pad = Math.min(MAX_CHAIN_PADDING, pad)
  const padX = Math.ceil(pad * kx)
  const padY = Math.ceil(pad * ky)

  const stagePadX = padX / kx
  const stagePadY = padY / ky
  return {
    contentWidth: cw,
    contentHeight: ch,
    padX,
    padY,
    width: cw + 2 * padX,
    height: ch + 2 * padY,
    pxPerStagePx: [kx, ky],
    outRect: {
      x: rect.x - stagePadX,
      y: rect.y - stagePadY,
      width: rect.width + 2 * stagePadX,
      height: rect.height + 2 * stagePadY,
      rotation: rect.rotation,
      // MOT-8: carry the clip's shear, or an effected clip draws unskewed in preview and export.
      ...(rect.skewX ? { skewX: rect.skewX } : {}),
      ...(rect.skewY ? { skewY: rect.skewY } : {}),
      // MOT-8 phase B: and its 3D tilt, for the same reason.
      ...(rect.rotateX ? { rotateX: rect.rotateX } : {}),
      ...(rect.rotateY ? { rotateY: rect.rotateY } : {}),
      ...(rect.perspective ? { perspective: rect.perspective } : {}),
    },
  }
}

export class EffectChain {
  private readonly _pool: FramebufferPool
  private readonly _programs = new Map<string, ShaderProgram>()
  /** Kinds whose shader failed to compile on this GPU; skipped, warned once. */
  private readonly _broken = new Set<string>()
  private _vao: WebGLVertexArrayObject | null = null
  private _gl: WebGL2RenderingContext | null = null
  private _runs = 0

  constructor(pool: FramebufferPool = new FramebufferPool()) {
    this._pool = pool
  }

  /**
   * Draw one clip through its effect stack. Returns false when nothing was
   * drawn (no runnable effect, no target available) — the layer then draws
   * the clip normally, so effects can fail soft but never hide a clip.
   */
  draw(ctx: LayerContext, req: ChainDrawRequest): boolean {
    const { gl } = ctx
    this._gl = gl

    const runnable: { gpu: GpuEffect; program: ShaderProgram; params: ResolvedEffect['params'] }[] = []
    const stageBox = { width: Math.abs(req.rect.width), height: Math.abs(req.rect.height) }
    for (const effect of req.effects) {
      const gpu = GPU_EFFECTS.get(effect.kind)
      if (!gpu) continue
      // MI-P8: an effect that would change nothing this frame (a resting clip
      // under motion blur) costs nothing: no pass, no padding, no compile.
      if (gpu.skip?.(effect.params, stageBox)) continue
      const program = this._program(gl, gpu)
      if (!program) continue
      runnable.push({ gpu, program, params: effect.params })
    }
    const mask = isDrawableMask(req.mask) ? req.mask : undefined
    const blend = req.blend && req.blend !== 'normal' ? req.blend : undefined
    let matte: { texture: WebGLTexture; mode: number; invert: boolean } | undefined
    if (req.matte) {
      const target = this._mattes.get((ctx.keyPrefix ?? '') + req.matte.sourceClipId)
      if (target) {
        matte = { texture: target.texture, mode: MATTE_MODE_INDEX[req.matte.kind], invert: req.matte.invert }
      } else if (!req.matte.invert) {
        return true // empty matte: the clip is fully matted out
      }
    }
    if (runnable.length === 0 && !mask && !blend && !matte) return false
    const maskProgram = mask ? this._named(gl, '__mask', EFFECT_VERT_SRC, MASK_FRAG) : null
    const blendProgram = blend || matte ? this._named(gl, '__blend', QUAD_VERT_SRC, BLEND_FRAG_SRC) : null
    if (runnable.length === 0 && !maskProgram && !blendProgram) return false

    const plan = planChain(req.rect, req.contentWidth, req.contentHeight, req.crop, runnable)
    if (!plan) return false
    if (!this._vao) {
      this._vao = gl.createVertexArray()
      if (!this._vao) return false
    }

    let src = this._pool.acquire(gl, plan.width, plan.height)
    let dst = this._pool.acquire(gl, plan.width, plan.height)
    if (!src || !dst) {
      if (src) this._pool.release(gl, src)
      if (dst) this._pool.release(gl, dst)
      return false
    }

    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
    const prevViewport = Array.from(gl.getParameter(gl.VIEWPORT) as ArrayLike<number>)
    const prevClear = Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE) as ArrayLike<number>)

    // 1. Capture the cropped, corner-rounded source into `src`.
    gl.bindFramebuffer(gl.FRAMEBUFFER, src.fbo)
    gl.viewport(0, 0, plan.width, plan.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const crop = req.crop
    req.program.use(gl)
    gl.bindVertexArray(req.vao)
    req.program.setUniform1i(gl, 'uTexture', req.unit)
    req.program.setUniform1f(gl, 'uOpacity', 1)
    req.program.setUniform2f(gl, 'uRadius', req.cornerRadius ?? 0, req.cornerRadius ?? 0)
    req.program.setUniform4f(gl, 'uCrop', crop?.x ?? 0, crop?.y ?? 0, crop?.width ?? 0, crop?.height ?? 0)
    req.program.setUniform1i(gl, 'uRotation', req.rotation ?? 0)
    req.program.setUniformMatrix3fv(
      gl,
      'uTransform',
      false,
      buildTransformMatrixFromRect(
        { x: plan.padX, y: plan.padY, width: plan.contentWidth, height: plan.contentHeight, rotation: 0 },
        plan.width,
        plan.height,
      ),
    )
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // 2. Effect passes, blending off so each pass replaces the target.
    const inner: [number, number, number, number] = [
      plan.padX / plan.width,
      plan.padY / plan.height,
      plan.contentWidth / plan.width,
      plan.contentHeight / plan.height,
    ]
    const time = ctx.fps > 0 ? ctx.frame / ctx.fps : 0
    gl.disable(gl.BLEND)
    gl.bindVertexArray(this._vao)
    gl.activeTexture(gl.TEXTURE0)
    for (const { gpu, program, params } of runnable) {
      const passes = Math.max(1, Math.floor(gpu.passes(params)))
      for (let pass = 0; pass < passes; pass++) {
        const env: EffectEnv = {
          pass,
          size: [plan.width, plan.height],
          inner,
          pxPerStagePx: plan.pxPerStagePx,
          frame: ctx.frame,
          time,
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
        program.use(gl)
        gl.bindTexture(gl.TEXTURE_2D, src.texture)
        program.setUniform1i(gl, 'uTex', 0)
        program.setUniform2f(gl, 'uTexel', 1 / plan.width, 1 / plan.height)
        program.setUniform4f(gl, 'uInner', inner[0], inner[1], inner[2], inner[3])
        program.setUniform1f(gl, 'uTime', time)
        setUniforms(gl, program, gpu.uniforms(params, env))
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        const t: RenderTarget = src
        src = dst
        dst = t
      }
    }
    // Mask pass: after the effects, before placement (Premiere's order).
    if (mask && maskProgram) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
      maskProgram.use(gl)
      gl.bindTexture(gl.TEXTURE_2D, src.texture)
      maskProgram.setUniform1i(gl, 'uTex', 0)
      maskProgram.setUniform2f(gl, 'uTexel', 1 / plan.width, 1 / plan.height)
      maskProgram.setUniform4f(gl, 'uInner', inner[0], inner[1], inner[2], inner[3])
      let frame: MaskFrame | undefined
      if (req.maskFrame) {
        const [kx, ky] = plan.pxPerStagePx
        frame = {
          x: (req.maskFrame.x - req.rect.x) * kx,
          y: (req.maskFrame.y - req.rect.y) * ky,
          width: req.maskFrame.width * kx,
          height: req.maskFrame.height * ky,
          rotation: req.maskFrame.rotation,
        }
      }
      const { uKind, ...rest } = maskUniforms(mask, inner, [plan.width, plan.height], frame)
      maskProgram.setUniform1i(gl, 'uKind', uKind as number)
      setUniforms(gl, maskProgram, rest)
      if (mask.kind === 'path') {
        const half = rest.uHalf as number[]
        const pathTex = this._pathTexture(gl, mask, 2 * (half[0] ?? 1), 2 * (half[1] ?? 1))
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, pathTex)
        maskProgram.setUniform1i(gl, 'uPath', 1)
        gl.activeTexture(gl.TEXTURE0)
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      const t: RenderTarget = src
      src = dst
      dst = t
    }
    gl.enable(gl.BLEND)

    // Back to whatever the renderer was drawing into.
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo ?? null)
    gl.viewport(prevViewport[0] ?? 0, prevViewport[1] ?? 0, prevViewport[2] ?? 0, prevViewport[3] ?? 0)
    gl.clearColor(prevClear[0] ?? 0, prevClear[1] ?? 0, prevClear[2] ?? 0, prevClear[3] ?? 1)

    // 3b. Blended placement: copy the backdrop under the stage viewport, then
    // write the composite directly with GL blending off.
    if (
      (blend || matte) &&
      blendProgram &&
      this._placeBlended(gl, ctx, blendProgram, src.texture, plan.outRect, req.opacity, blend ?? 'normal', prevViewport, matte)
    ) {
      this._pool.release(gl, src)
      this._pool.release(gl, dst)
      this._runs++
      return true
    }

    // 3. Place the result with the layer's program; corners/crop already applied.
    req.program.use(gl)
    gl.bindVertexArray(req.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src.texture)
    req.program.setUniform1i(gl, 'uTexture', 0)
    req.program.setUniform1f(gl, 'uOpacity', req.opacity)
    req.program.setUniform2f(gl, 'uRadius', 0, 0)
    req.program.setUniform4f(gl, 'uCrop', 0, 0, 0, 0)
    // The captured result is already upright; the shared program must not
    // keep the source rotation for this placement pass.
    req.program.setUniform1i(gl, 'uRotation', 0)
    req.program.setUniformMatrix3fv(
      gl,
      'uTransform',
      false,
      buildTransformMatrixFromRect(plan.outRect, ctx.stage.width, ctx.stage.height),
    )
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    this._pool.release(gl, src)
    this._pool.release(gl, dst)
    this._runs++
    return true
  }

  /** Chain runs since construction; for the debug panel and tests. */
  get runs(): number {
    return this._runs
  }

  get pool(): FramebufferPool {
    return this._pool
  }

  dispose(): void {
    const gl = this._gl
    if (gl) {
      for (const p of this._programs.values()) p.dispose(gl)
      if (this._vao) gl.deleteVertexArray(this._vao)
      if (this._backdrop) gl.deleteTexture(this._backdrop)
      for (const t of this._uploaded.values()) gl.deleteTexture(t)
      for (const t of this._paths.values()) gl.deleteTexture(t)
      this._pool.dispose(gl)
    }
    this._programs.clear()
    this._vao = null
    this._backdrop = null
    this._backdropSize = [0, 0]
    this._mattes.clear()
    this._uploaded.clear()
    this._paths.clear()
    this._gl = null
  }

  /** Drop every GL handle after a context loss (no GL calls). */
  notifyContextLost(): void {
    this._programs.clear()
    this._vao = null
    this._backdrop = null
    this._backdropSize = [0, 0]
    this._mattes.clear()
    this._uploaded.clear()
    this._paths.clear()
    this._pool.notifyContextLost()
  }

  /** Backdrop copy for blend modes, resized to the stage viewport. */
  private _backdrop: WebGLTexture | null = null
  private _backdropSize: [number, number] = [0, 0]
  private _backdropFormat = 0

  private _placeBlended(
    gl: WebGL2RenderingContext,
    ctx: LayerContext,
    program: ShaderProgram,
    clipTexture: WebGLTexture,
    outRect: DrawRect,
    opacity: number,
    blend: BlendMode,
    viewport: number[],
    matte?: { texture: WebGLTexture; mode: number; invert: boolean },
  ): boolean {
    const [vx = 0, vy = 0, vw = 0, vh = 0] = viewport
    if (vw <= 0 || vh <= 0) return false
    if (!this._backdrop) {
      this._backdrop = gl.createTexture()
      if (!this._backdrop) return false
      gl.bindTexture(gl.TEXTURE_2D, this._backdrop)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    // The copy's format must match the framebuffer it reads: the preview
    // canvas is opaque (alpha: false → RGB), and copying RGB into an RGBA
    // texture is an INVALID_OPERATION that fails silently — the backdrop
    // would read as empty and every blend would collapse to normal.
    const readsDefault = gl.getParameter(gl.FRAMEBUFFER_BINDING) === null
    const format = readsDefault && gl.getContextAttributes()?.alpha === false ? gl.RGB : gl.RGBA
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this._backdrop)
    if (this._backdropSize[0] !== vw || this._backdropSize[1] !== vh || this._backdropFormat !== format) {
      gl.texImage2D(gl.TEXTURE_2D, 0, format, vw, vh, 0, format, gl.UNSIGNED_BYTE, null)
      this._backdropSize = [vw, vh]
      this._backdropFormat = format
    }
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, vx, vy, vw, vh)

    program.use(gl)
    gl.bindVertexArray(this._vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, clipTexture)
    program.setUniform1i(gl, 'uTexture', 0)
    program.setUniform1i(gl, 'uBackdrop', 1)
    program.setUniform1f(gl, 'uOpacity', opacity)
    program.setUniform4f(gl, 'uViewport', vx, vy, vw, vh)
    program.setUniform1i(gl, 'uMode', BLEND_MODE_INDEX[blend])
    program.setUniform1i(gl, 'uMatteMode', matte?.mode ?? 0)
    program.setUniform1f(gl, 'uMatteInvert', matte?.invert ? 1 : 0)
    program.setUniform1i(gl, 'uMatte', 2)
    if (matte) {
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, matte.texture)
    }
    program.setUniform4f(gl, 'uCrop', 0, 0, 0, 0)
    program.setUniformMatrix3fv(
      gl,
      'uTransform',
      false,
      buildTransformMatrixFromRect(outRect, ctx.stage.width, ctx.stage.height),
    )
    gl.disable(gl.BLEND)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.enable(gl.BLEND)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, null)
    if (matte) {
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
    gl.activeTexture(gl.TEXTURE0)
    return true
  }

  // ---------------------------------------------------------------------------
  // Track mattes (EDX-P7)
  // ---------------------------------------------------------------------------

  /** Matte sources rendered this frame, by clip id; released by `endFrame`. */
  private readonly _mattes = new Map<string, RenderTarget>()
  /** Mattes uploaded from a canvas (export), by clip id. */
  private readonly _uploaded = new Map<string, WebGLTexture>()

  /**
   * Render `draw` into a pooled target instead of the current framebuffer and
   * keep it under `key` until `endFrame` or `releaseTargets` (PV-P1). Without
   * `size` the target matches the current viewport (a matte, a transition
   * side); with `size` it is exactly that big and the viewport is set to it
   * while `draw` runs. Restores the framebuffer, viewport and clear colour.
   * Returns the target, or null when there is no viewport or the pool is
   * exhausted.
   */
  renderTarget(ctx: LayerContext, key: string, draw: () => void, size?: { width: number; height: number }): RenderTarget | null {
    const { gl } = ctx
    this._gl = gl
    const vp = Array.from(gl.getParameter(gl.VIEWPORT) as ArrayLike<number>)
    const [vx = 0, vy = 0, vw = 0, vh = 0] = vp
    // A compound asks for its own size; a matte or a transition side follows
    // the viewport it is drawn into. The viewport is still read (and still
    // restored) either way, so the no-size path is unchanged.
    const tw = size ? Math.max(1, Math.round(size.width)) : vw
    const th = size ? Math.max(1, Math.round(size.height)) : vh
    if (tw <= 0 || th <= 0) return null
    const target = this._pool.acquire(gl, tw, th)
    if (!target) return null
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
    const prevClear = Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE) as ArrayLike<number>)
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
    gl.viewport(0, 0, tw, th)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    try {
      draw()
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo ?? null)
      gl.viewport(vx, vy, vw, vh)
      gl.clearColor(prevClear[0] ?? 0, prevClear[1] ?? 0, prevClear[2] ?? 0, prevClear[3] ?? 1)
    }
    const previous = this._mattes.get(key)
    if (previous) this._pool.release(gl, previous)
    this._mattes.set(key, target)
    return target
  }

  /**
   * Unchanged behaviour and GL calls: `renderTarget` without a size.
   */
  renderMatte(ctx: LayerContext, clipId: string, draw: () => void): boolean {
    return this.renderTarget(ctx, clipId, draw) !== null
  }

  /**
   * Release every target whose key starts with `prefix` (a compound's own
   * target and its nested graph's). A nested graph must not call `endFrame`,
   * because that would free the parent frame's mattes too.
   */
  releaseTargets(gl: WebGL2RenderingContext, prefix: string): void {
    for (const [id, target] of this._mattes) {
      if (!id.startsWith(prefix)) continue
      if (!this._uploaded.has(id)) this._pool.release(gl, target)
      this._mattes.delete(id)
    }
  }

  /**
   * Export: use a painted canvas (the matte clip drawn at output size) as the
   * matte for `clipId` this frame. Uploaded with the same orientation as a
   * framebuffer copy, so the placement shader samples it the same way.
   */
  setMatteSource(gl: WebGL2RenderingContext, clipId: string, source: TexImageSource): boolean {
    this._gl = gl
    let texture = this._uploaded.get(clipId)
    if (!texture) {
      texture = gl.createTexture() ?? undefined
      if (!texture) return false
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this._uploaded.set(clipId, texture)
    }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.bindTexture(gl.TEXTURE_2D, null)
    // Present it through the same lookup renderMatte fills.
    this._mattes.set(clipId, { fbo: null as unknown as WebGLFramebuffer, texture, width: 0, height: 0 })
    return true
  }

  /**
   * Transitions (EDX-P9c): composite the targets rendered under `fromKey`
   * and `toKey` (via `renderMatte`) with the transition shader, over the
   * current framebuffer, at full viewport. False when either target or the
   * shader is missing — the caller then draws the clips plainly.
   */
  drawTransition(ctx: LayerContext, fromKey: string, toKey: string, spec: TransitionSpec): boolean {
    const { gl } = ctx
    const from = this._mattes.get(fromKey)
    const to = this._mattes.get(toKey)
    if (!from || !to) return false
    const program = this._named(gl, '__transition', EFFECT_VERT_SRC, TRANSITION_FRAG_SRC)
    if (!program) return false
    if (!this._vao) {
      this._vao = gl.createVertexArray()
      if (!this._vao) return false
    }
    const vp = Array.from(gl.getParameter(gl.VIEWPORT) as ArrayLike<number>)
    const vw = vp[2] ?? 0
    const vh = vp[3] ?? 0
    const dir = transitionDirection(spec.direction)
    program.use(gl)
    gl.bindVertexArray(this._vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, from.texture)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, to.texture)
    program.setUniform1i(gl, 'uFrom', 0)
    program.setUniform1i(gl, 'uTo', 1)
    program.setUniform1f(gl, 'uT', spec.t)
    program.setUniform1i(gl, 'uKind', TRANSITION_KIND_INDEX[spec.kind] ?? 0)
    program.setUniform2f(gl, 'uDir', dir[0], dir[1])
    program.setUniform1f(gl, 'uAspect', vh > 0 ? vw / vh : 1)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindVertexArray(null)
    this._runs++
    return true
  }

  /** Whether a matte for `clipId` exists this frame. */
  hasMatte(clipId: string): boolean {
    return this._mattes.has(clipId)
  }

  /** Release this frame's matte targets. Call once per rendered frame. */
  endFrame(gl: WebGL2RenderingContext): void {
    for (const [id, target] of this._mattes) {
      if (!this._uploaded.has(id)) this._pool.release(gl, target)
    }
    this._mattes.clear()
  }

  /** Rasterised path masks, by path + viewBox + size; a few kept. */
  private readonly _paths = new Map<string, WebGLTexture>()

  private _pathTexture(gl: WebGL2RenderingContext, mask: ClipMask, w: number, h: number): WebGLTexture | null {
    const key = `${mask.path}|${JSON.stringify(mask.viewBox ?? null)}|${Math.round(w)}x${Math.round(h)}`
    const hit = this._paths.get(key)
    if (hit) return hit
    const canvas = rasterisePathMask(mask, w, h)
    if (!canvas) return null
    const texture = gl.createTexture()
    if (!texture) return null
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas as TexImageSource)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.activeTexture(gl.TEXTURE0)
    if (this._paths.size >= 8) {
      const [oldKey, oldTex] = this._paths.entries().next().value as [string, WebGLTexture]
      gl.deleteTexture(oldTex)
      this._paths.delete(oldKey)
    }
    this._paths.set(key, texture)
    return texture
  }

  /** A built-in program (mask, blend), compiled once; null if this GPU refuses it. */
  private _named(gl: WebGL2RenderingContext, key: string, vert: string, frag: string): ShaderProgram | null {
    const cached = this._programs.get(key)
    if (cached) return cached
    if (this._broken.has(key)) return null
    try {
      const program = ShaderProgram.create(gl, vert, frag)
      this._programs.set(key, program)
      return program
    } catch (err) {
      this._broken.add(key)
      console.warn(`[EffectChain] ${key} disabled: ${(err as Error).message}`)
      return null
    }
  }

  private _program(gl: WebGL2RenderingContext, gpu: GpuEffect): ShaderProgram | null {
    const cached = this._programs.get(gpu.kind)
    if (cached) return cached
    if (this._broken.has(gpu.kind)) return null
    try {
      const program = ShaderProgram.create(gl, EFFECT_VERT_SRC, gpu.frag)
      this._programs.set(gpu.kind, program)
      return program
    } catch (err) {
      this._broken.add(gpu.kind)
      console.warn(`[EffectChain] ${gpu.kind} disabled: ${(err as Error).message}`)
      return null
    }
  }
}

function setUniforms(
  gl: WebGL2RenderingContext,
  program: ShaderProgram,
  uniforms: Record<string, UniformValue>,
): void {
  for (const [name, value] of Object.entries(uniforms)) {
    if (typeof value === 'number') {
      program.setUniform1f(gl, name, value)
    } else if (value.length === 2) {
      program.setUniform2f(gl, name, value[0]!, value[1]!)
    } else if (value.length === 3) {
      program.setUniform3f(gl, name, value[0]!, value[1]!, value[2]!)
    } else if (value.length === 4) {
      program.setUniform4f(gl, name, value[0]!, value[1]!, value[2]!, value[3]!)
    }
  }
}
