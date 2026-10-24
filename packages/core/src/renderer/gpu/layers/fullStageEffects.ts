/**
 * Effect-chain hand-off for the layers that paint a full-stage canvas (text,
 * shape, freehand). Their texture already holds the content at its stage
 * position, so the chain's "clip box" is the whole stage.
 */

import type { ResolvedEffect, ResolvedMatte } from '../../../effects/resolveEffects'
import type { ShaderProgram } from '../ShaderProgram'
import type { BlendMode, ClipMask } from '../../../types'
import { needsChain } from '../compositing'
import type { LayerContext } from './types'
import type { DrawRect } from './drawRect'

/**
 * Draw a full-stage texture (bound on unit 0) through the item's effects.
 * True when the chain drew it; false means "draw it plainly" — the layer's
 * program, VAO and texture are rebound for that case.
 */
export function drawFullStageEffects(
  ctx: LayerContext,
  item: { effects?: ResolvedEffect[]; opacity?: number; mask?: ClipMask; blend?: BlendMode; matte?: ResolvedMatte },
  program: ShaderProgram,
  vao: WebGLVertexArrayObject,
  texture: WebGLTexture,
  /** The element's own box, so a mask is measured in it (EDX-P7c). */
  maskFrame?: DrawRect,
): boolean {
  if (!needsChain(item) || !ctx.effectChain) return false
  const { width, height } = ctx.stage
  const drawn = ctx.effectChain.draw(ctx, {
    program,
    vao,
    unit: 0,
    contentWidth: width,
    contentHeight: height,
    rect: { x: 0, y: 0, width, height, rotation: 0 },
    opacity: item.opacity ?? 1,
    effects: item.effects ?? [],
    ...(item.mask ? { mask: item.mask } : {}),
    ...(item.mask && maskFrame ? { maskFrame } : {}),
    ...(item.blend ? { blend: item.blend } : {}),
    ...(item.matte ? { matte: item.matte } : {}),
  })
  if (!drawn) {
    const { gl } = ctx
    program.use(gl)
    gl.bindVertexArray(vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
  }
  return drawn
}
