/**
 * Masks and blend modes on the GPU (EDX-P7).
 *
 * MASK: one extra pass in the EffectChain, after the effect passes (Premiere's
 * order: effects, then the opacity mask). The mask lives in the clip's own
 * box, top-left origin, as `ClipMask` defines it. Feather is measured in
 * pixels of the mask's shorter side, so it looks the same at any size.
 *
 * BLEND: the separable modes of the W3C Compositing spec, evaluated on
 * unpremultiplied colour and composited source-over — the same formulas
 * Canvas2D's `globalCompositeOperation` uses, which is what the exporter
 * blends with (`CANVAS_COMPOSITE_OP`). `add` is plus-lighter (Canvas2D's
 * `lighter`).
 */

import type { BlendMode, ClipMask } from '../../types'

/**
 * Whether a scene item needs the EffectChain at all: any effect, a drawable
 * mask or a non-normal blend. Everything else takes the layer's plain draw,
 * which is what keeps GoldenFrameHash unchanged.
 */
export function needsChain(item: {
  effects?: ReadonlyArray<unknown>
  mask?: ClipMask
  blend?: BlendMode
  matte?: unknown
}): boolean {
  return (
    Boolean(item.effects?.length) ||
    isDrawableMask(item.mask) ||
    (!!item.blend && item.blend !== 'normal') ||
    Boolean(item.matte)
  )
}

/** Matte modes as the placement shader numbers them. */
export const MATTE_MODE_INDEX = { none: 0, alpha: 1, luma: 2 } as const

// ---------------------------------------------------------------------------
// Mask
// ---------------------------------------------------------------------------

export const MASK_KIND_INDEX: Record<string, number> = { rect: 0, ellipse: 1, gradient: 2, path: 3 }

/**
 * Whether the GPU draws this mask. Path masks need path data; the others
 * are analytic.
 */
export function isDrawableMask(mask: ClipMask | undefined): mask is ClipMask {
  if (!mask || !(mask.kind in MASK_KIND_INDEX)) return false
  return mask.kind !== 'path' || (typeof mask.path === 'string' && mask.path.trim().length > 0)
}

export type { MaskFrame } from './compositingGpu'

/** The Canvas2D operation the exporter composites a blended clip with. */
export const CANVAS_COMPOSITE_OP: Readonly<Record<BlendMode, GlobalCompositeOperation>> = {
  normal: 'source-over',
  add: 'lighter',
  screen: 'screen',
  multiply: 'multiply',
  overlay: 'overlay',
  softLight: 'soft-light',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
}
