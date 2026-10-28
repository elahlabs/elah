/**
 * Turn "this box, mapped by this matrix" into an Elah `Transform` — the seam
 * between a parsed vector document's own coordinate space and the stage
 * placement every clip already uses (PV-P6b-2/3 build the importer on top of
 * this).
 */

import type { Transform } from '../types'
import type { Affine } from './pathOps'
import { applyToPoint, isSimilarity, rotationOf, uniformScale } from './pathOps'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The Elah transform that draws content whose local box `box` is mapped to
 * the stage by `m` (a similarity: translate · rotate · uniform scale).
 *   'shape'    — a path shape clip whose shapeViewBox is `box`: its painted box
 *                is `s·box.width × s·box.height`, so the viewBox fit is exact.
 *   'compound' — image-like placement of content that is `box.width × box.height`
 *                native px (a compound clip's child stage).
 * `exact` is false when `m` is not a similarity; then s = uniformScale(m) and
 * the rotation is rotationOf(m) (an approximation the caller reports).
 */
export function transformForBox(
  m: Affine,
  box: Box,
  stage: { width: number; height: number },
  kind: 'shape' | 'compound',
): { transform: Transform; exact: boolean } {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const [px, py] = applyToPoint(m, cx, cy)
  const s = uniformScale(m)
  const rot = rotationOf(m)
  const x = px / stage.width
  const y = py / stage.height
  const exact = isSimilarity(m)
  const anchor = { x: 0.5, y: 0.5 }

  if (kind === 'shape') {
    const short = Math.min(stage.width, stage.height)
    const ref = Math.max(box.width, box.height)
    const scale = ref === 0 || short === 0 ? 0 : (s * ref) / short
    const scaleX = ref === 0 ? 1 : box.width / ref
    const scaleY = ref === 0 ? 1 : box.height / ref
    return { transform: { x, y, scale, rotation: rot, anchor, scaleX, scaleY }, exact }
  }

  return { transform: { x, y, scale: s, rotation: rot, anchor }, exact }
}

/** The fit fraction `fitTransform` uses when nothing else is specified. */
export const VECTOR_IMPORT_FIT = 0.5

/** Centre content of `content` size in `parent`, its long edge = fit × the parent's short side (image-like placement). */
export function fitTransform(
  content: { width: number; height: number },
  parent: { width: number; height: number },
  fit: number = VECTOR_IMPORT_FIT,
): Transform {
  const longest = Math.max(content.width, content.height)
  const scale = longest === 0 ? 0 : (fit * Math.min(parent.width, parent.height)) / longest
  return { x: 0.5, y: 0.5, rotation: 0, anchor: { x: 0.5, y: 0.5 }, scale }
}
