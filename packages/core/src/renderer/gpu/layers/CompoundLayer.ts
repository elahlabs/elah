/**
 * PV-P1: GPU layer for compound clips.
 *
 * A compound is a nested project. Its layer draws no geometry of its own: it
 * renders the nested Scene into an offscreen target, then places that target on
 * the stage exactly as ImageLayer places a picture, so the compound's own
 * effects, mask, blend, matte, crop and opacity apply to the whole nested
 * image at once.
 *
 * Two things make this correct rather than merely working:
 *
 *  - The nested Scene is drawn by a *second* RenderGraph with its own layers
 *    (see `createLayerSet`). It cannot share the parent's VideoLayer, because
 *    two copies of one compound hold the same nested clip ids and would share
 *    one decoder per id.
 *  - Every target either graph renders is keyed `<parent><compoundId>/...`, so
 *    two copies of the same compound never share a matte or a transition
 *    target, and one compound can be released without touching its siblings.
 *
 * Needs `ctx.effectChain.renderTarget`; without it (tests, probe mode) there is
 * nowhere to render the nested scene and the compound draws nothing, leaving
 * the picture as if the clip were absent.
 */

import type { ActiveCompoundClip } from '../../../resolver/scene'
import { ShaderProgram } from '../ShaderProgram'
import { QUAD_FRAG_SRC } from '../shaders/quad.frag'
import { QUAD_VERT_SRC } from '../shaders/quad.vert'
import { compoundRenderScale, compoundTargetSize } from './compoundTarget'
import { buildDrawTransformMatrix, normalizeCrop, resolveDrawRect } from './drawRect'
import { needsChain } from '../compositing'
import type { LayerSet } from './createLayerSet'
import type { Layer, LayerContext } from './types'

/**
 * Deepest nesting this layer will render. The document reader already refuses
 * projects nested deeper (`MAX_COMPOUND_DEPTH`), but a hand-built Scene can
 * still nest forever and rendering one would recurse until the stack gives
 * out. Past this depth no child set is built and the compound draws nothing.
 */
export const MAX_COMPOUND_RENDER_DEPTH = 4

/** Builds the layer set for one compound instance; prefix and depth are baked in. */
export type CompoundChildFactory = (compoundId: string) => LayerSet

export class CompoundLayer implements Layer<ActiveCompoundClip> {
  private readonly _makeChild: CompoundChildFactory
  private readonly _children = new Map<string, LayerSet>()
  private _program: ShaderProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _gl: WebGL2RenderingContext | null = null
  /** Nesting level of the set that owns this layer; a child's set is one deeper. */
  private readonly _depth: number

  constructor(makeChild: CompoundChildFactory, depth = 0) {
    this._makeChild = makeChild
    this._depth = depth
  }

  acquire(item: ActiveCompoundClip, ctx: LayerContext): void {
    this._gl = ctx.gl
    this._ensurePipeline(ctx.gl)
    if (this._children.has(item.id)) return
    // Refuse the level BEFORE building a set: a set is nine layers, and a
    // document that nests past the limit must not cost anything per frame.
    if (this._depth + 1 > MAX_COMPOUND_RENDER_DEPTH) {
      warnOnce('[CompoundLayer] deeper than MAX_COMPOUND_RENDER_DEPTH; nothing drawn')
      return
    }
    this._children.set(item.id, this._makeChild(item.id))
  }

  release(itemId: string): void {
    // The whole child set goes with the clip. Its TARGETS were already freed
    // when it was drawn (see draw), so this only tears down the layers, the
    // decoders and the GL handles; a compound that leaves the scene and comes
    // back rebuilds them, which is the same cold start any other clip has.
    const child = this._children.get(itemId)
    if (!child) return
    this._children.delete(itemId)
    child.graph.dispose()
  }

  draw(item: ActiveCompoundClip, ctx: LayerContext): void {
    const { gl } = ctx
    this._gl = gl
    // renderTarget is what makes a compound possible at all: without it there is
    // nowhere to render the nested scene, so draw nothing (as without a chain).
    const chain = ctx.effectChain
    if (!chain?.renderTarget || !chain.releaseTargets) return
    this._ensurePipeline(gl)
    const child = this._children.get(item.id)
    if (!child || !this._program || !this._vao) return
    const content = item.contentSize
    if (!(content.width > 0) || !(content.height > 0)) return
    if (item.opacity !== undefined && item.opacity <= 0) return

    // Everything this compound owns is keyed under this prefix: its own target
    // and, one level down, every target its nested graph renders. So a nested
    // matte can never be confused with the parent's, and the release below
    // cannot touch a sibling compound.
    const prefix = `${ctx.keyPrefix ?? ''}${item.id}/`
    const crop = normalizeCrop(item.crop)
    const rect = resolveDrawRect(
      item.transform,
      ctx.stage.width,
      ctx.stage.height,
      content.width,
      content.height,
      item.crop,
    )
    // Device pixels per stage unit, for whatever we are drawing into: the
    // canvas at the top level, an enclosing compound's target below it. The GL
    // viewport is the letterboxed stage rect, which `ctx.viewport` is not.
    const vp = Array.from(gl.getParameter(gl.VIEWPORT) as ArrayLike<number>)
    const pxPerStage = ctx.stage.width > 0 ? (vp[2] ?? 0) / ctx.stage.width : 1
    // The crop is a window onto the content, so the window is what is compared
    // with the on-screen size; the target itself holds the WHOLE content,
    // because the crop is applied when it is sampled.
    const scale = compoundRenderScale(
      content,
      { width: Math.abs(rect.width) / crop.width, height: Math.abs(rect.height) / crop.height },
      pxPerStage,
    )
    const size = compoundTargetSize(content, scale)

    // The nested scene draws into a viewport of the target's own size, in the
    // compound's own stage units. It must not call endFrame: those targets are
    // ours to release, and ending the frame would free the parent's mattes too.
    const target = chain.renderTarget(
      ctx,
      `${prefix}\u0000compound`,
      () => {
        child.graph.execute(item.scene, {
          ...ctx,
          frame: item.scene.frame,
          fps: item.scene.fps,
          stage: content,
          viewport: size,
          keyPrefix: prefix,
        })
      },
      size,
    )
    if (!target) {
      // The pool is exhausted, or the viewport was empty. Free whatever the
      // nested graph managed to render before giving up on this frame, or a
      // scene that keeps asking would starve the pool for the rest of it.
      chain.releaseTargets(gl, prefix)
      warnOnce('[CompoundLayer] no render target available; compound skipped this frame')
      return
    }

    const opacity = item.opacity ?? 1
    const cornerRadius = item.cornerRadius ?? 0

    this._program.use(gl)
    gl.bindVertexArray(this._vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, target.texture)

    // Effect stack: the chain draws the compound itself, or returns false and
    // the plain draw below runs. Compounds without effects never get here.
    if (needsChain(item)) {
      const drawn = chain.draw(ctx, {
        program: this._program,
        vao: this._vao,
        unit: 0,
        contentWidth: content.width,
        contentHeight: content.height,
        ...(item.crop ? { crop: item.crop } : {}),
        cornerRadius,
        rect,
        opacity,
        effects: item.effects ?? [],
        ...(item.mask ? { mask: item.mask } : {}),
        ...(item.blend ? { blend: item.blend } : {}),
        ...(item.matte ? { matte: item.matte } : {}),
      })
      if (drawn) {
        gl.bindTexture(gl.TEXTURE_2D, null)
        gl.bindVertexArray(null)
        chain.releaseTargets(gl, prefix)
        return
      }
      this._program.use(gl)
      gl.bindVertexArray(this._vao)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, target.texture)
    }

    this._program.setUniform1i(gl, 'uTexture', 0)
    this._program.setUniform1f(gl, 'uOpacity', opacity)
    // Always set uRadius and uCrop, 0 when unset: the uniform persists in the
    // GL program between draws, so a compound with neither must still clear
    // whatever the previously drawn compound left behind.
    this._program.setUniform2f(gl, 'uRadius', cornerRadius, cornerRadius)
    this._program.setUniform4f(gl, 'uCrop', crop.x, crop.y, crop.width, crop.height)
    this._program.setUniformMatrix3fv(
      gl,
      'uTransform',
      false,
      buildDrawTransformMatrix(
        item.transform,
        ctx.stage.width,
        ctx.stage.height,
        content.width,
        content.height,
        item.crop,
      ),
    )

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindVertexArray(null)
    // This frame's work is done with the compound's target and every target its
    // nested graph rendered. They go back to the pool here, not at endFrame, so
    // that four-deep nesting holds four targets rather than one per compound
    // per frame.
    chain.releaseTargets(gl, prefix)
  }

  dispose(): void {
    const gl = this._gl
    for (const child of this._children.values()) child.graph.dispose()
    this._children.clear()
    if (gl) {
      if (this._vao) gl.deleteVertexArray(this._vao)
      if (this._program) this._program.dispose(gl)
    }
    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Drop every GL handle after a context loss; the child sets are rebuilt. */
  notifyContextLost(): void {
    for (const child of this._children.values()) child.notifyContextLost()
    this._children.clear()
    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Exposed for tests: child sets alive, i.e. compounds currently in the scene. */
  get childCount(): number {
    return this._children.size
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** The quad program and its VAO, built on first use (ImageLayer's pattern). */
  private _ensurePipeline(gl: WebGL2RenderingContext): void {
    if (this._program && this._vao) return
    this._program = ShaderProgram.create(gl, QUAD_VERT_SRC, QUAD_FRAG_SRC)
    const vao = gl.createVertexArray()
    if (!vao) {
      throw new Error('CompoundLayer: gl.createVertexArray() returned null')
    }
    this._vao = vao
  }
}

/** Messages already logged this session, so a per-frame condition is not spam. */
const warned = new Set<string>()

function warnOnce(message: string): void {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(message)
}
