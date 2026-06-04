/**
 * drawRect — clip→stage placement math shared by every quad-based layer
 * (video, image). Pure functions: a clip's optional `Transform` + its content
 * size in, a pixel draw rect and a clip-space matrix out.
 *
 * The single behaviour worth calling out: with NO explicit transform the clip is
 * *contained* within the stage (object-fit: contain), never stretched. An
 * explicit transform is taken as the author's intent and applied verbatim.
 */

import type { Transform } from '../../../types'
import { computeContainRect } from './objectFit'

/** Pixel rect (stage space, origin top-left) plus a rotation about its centre. */
export interface DrawRect {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

/**
 * Build a column-major 3×3 transform matrix mapping the unit quad (0..1,
 * origin top-left) to clip space for a rect at pixel (x,y,w,h) on a stage
 * of size (sw, sh), with optional rotation about the rect centre.
 */
export function buildTransformMatrixFromRect(
  rect: DrawRect,
  stageWidth: number,
  stageHeight: number,
): Float32Array {
  const xs = rect.x / stageWidth
  const ys = rect.y / stageHeight
  const ws = rect.width / stageWidth
  const hs = rect.height / stageHeight
  const rotation = rect.rotation
  const sc = Math.cos(rotation)
  const ss = Math.sin(rotation)

  const tx = 2 * (xs + ws / 2 - 0.5 * sc * ws + 0.5 * ss * hs) - 1
  const ty = 2 * (ys + hs / 2 - 0.5 * ss * ws - 0.5 * sc * hs) - 1

  return new Float32Array([
    2 * sc * ws, 2 * ss * ws, 0,
    -2 * ss * hs, 2 * sc * hs, 0,
    tx, ty, 1,
  ])
}

/** Convert a normalized Transform + content size into a pixel draw rect. */
export function resolveTransformRect(
  transform: Transform,
  stageWidth: number,
  stageHeight: number,
  contentWidth: number,
  contentHeight: number,
): DrawRect {
  const width = contentWidth * transform.scale
  const height = contentHeight * transform.scale

  const anchorPxX = transform.anchor.x * width
  const anchorPxY = transform.anchor.y * height

  const x = transform.x * stageWidth - anchorPxX
  const y = transform.y * stageHeight - anchorPxY

  return {
    x,
    y,
    width,
    height,
    rotation: transform.rotation,
  }
}

/**
 * Resolve the pixel draw rect for any clip with an optional transform.
 *
 * - No transform + known content size → contain the content within the stage
 *   (letterbox/pillarbox inside the project frame; never stretched).
 * - No transform + unknown content size (first frame not yet uploaded) → fill
 *   the stage for that one tick.
 * - Explicit transform → applied verbatim relative to the content size.
 */
export function resolveDrawRect(
  transform: Transform | undefined,
  stageWidth: number,
  stageHeight: number,
  contentWidth?: number,
  contentHeight?: number,
): DrawRect {
  if (!transform) {
    if (contentWidth && contentHeight) {
      const fit = computeContainRect(contentWidth, contentHeight, stageWidth, stageHeight)
      return { x: fit.x, y: fit.y, width: fit.width, height: fit.height, rotation: 0 }
    }
    return { x: 0, y: 0, width: stageWidth, height: stageHeight, rotation: 0 }
  }

  return resolveTransformRect(
    transform,
    stageWidth,
    stageHeight,
    contentWidth ?? stageWidth,
    contentHeight ?? stageHeight,
  )
}

/** Build the clip-space transform matrix for a clip with an optional transform. */
export function buildDrawTransformMatrix(
  transform: Transform | undefined,
  stageWidth: number,
  stageHeight: number,
  contentWidth?: number,
  contentHeight?: number,
): Float32Array {
  return buildTransformMatrixFromRect(
    resolveDrawRect(transform, stageWidth, stageHeight, contentWidth, contentHeight),
    stageWidth,
    stageHeight,
  )
}
