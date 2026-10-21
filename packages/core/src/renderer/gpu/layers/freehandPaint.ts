/**
 * The freehand painter, shared by preview and export (PV-P2b, principle 8).
 *
 * There were two copies of this - one in `FreehandLayer` for the preview and one
 * in `ExportWorker` - and they differed only in whether they cleared the canvas
 * first. Now there is one, and the caller owns the clear.
 *
 * A v2 clip's `transform` places, scales, stretches and rotates the drawing's
 * own box exactly as an image's transform places an image: the box is the path's
 * geometry bounds, and the matrix is translate(box centre) · rotate · scale ·
 * translate(−path centre). Strokes scale with it, deliberately: a v2 drawing
 * behaves like a picture of itself, and holding the stroke width constant under
 * a non-uniform stretch would need per-segment re-stroking, which no canvas path
 * offers.
 *
 * DOM-free apart from `Path2D`, which workers have.
 */

import type { ActiveFreehandClip } from '../../../resolver/scene'
import type { Transform } from '../../../types'
import { skewFields, skewShear, type DrawRect } from './drawRect'
import { pathBounds, type PathBox } from './pathBounds'

/** The 2D surface both HTML and Offscreen canvases provide. */
export type Freehand2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface FreehandPlacement {
  bounds: PathBox
  /** The drawn box in stage px, rotated about its centre (what masks and layout read). */
  rect: DrawRect
  /** Canvas `transform(a, b, c, d, e, f)` taking path coordinates to stage px. */
  matrix: [number, number, number, number, number, number]
}

/** A number, or the fallback when the stored value is not one. */
function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * v2 only. `undefined` for a legacy clip, for a v2 clip with no transform (it
 * draws where it was drawn) and for a path with no bounds.
 */
export function freehandPlacement(
  item: ActiveFreehandClip,
  stage: { width: number; height: number },
): FreehandPlacement | undefined {
  if (item.transformModel !== 'v2' || !item.transform) return undefined
  const bounds = item.pathData ? pathBounds(item.pathData) : null
  if (!bounds) return undefined
  return place(item.transform, bounds, stage)
}

/** The transform that reproduces the native placement: the path box centre, scale 1. */
export function freehandRestTransform(
  bounds: PathBox,
  stage: { width: number; height: number },
): Transform {
  return {
    x: (bounds.x + bounds.width / 2) / stage.width,
    y: (bounds.y + bounds.height / 2) / stage.height,
    scale: 1,
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
  }
}

/** The image placement rule (`resolveTransformRect`), with the path box as the content box. */
function place(
  t: Transform,
  bounds: PathBox,
  stage: { width: number; height: number },
): FreehandPlacement {
  // scaleX/scaleY are the stretch, and they MULTIPLY the scale exactly as they do
  // for an image rather than replacing it.
  const s = finite(t.scale, 1)
  const kx = s * finite(t.scaleX, 1)
  const ky = s * finite(t.scaleY, 1)
  const w = bounds.width * kx
  const h = bounds.height * ky
  const ax = finite(t.anchor?.x, 0.5)
  const ay = finite(t.anchor?.y, 0.5)
  const rotation = finite(t.rotation, 0)
  const rect: DrawRect = {
    x: finite(t.x, 0.5) * stage.width - ax * w,
    y: finite(t.y, 0.5) * stage.height - ay * h,
    width: w,
    height: h,
    rotation,
    ...skewFields(t),
  }
  // Where the placed box's centre is, and where the path's centre is before the
  // transform: the matrix carries one to the other.
  const rcx = rect.x + w / 2
  const rcy = rect.y + h / 2
  const bcx = bounds.x + bounds.width / 2
  const bcy = bounds.y + bounds.height / 2
  const c = Math.cos(rotation)
  const sin = Math.sin(rotation)
  let a = kx * c
  let b = kx * sin
  let cc = -ky * sin
  let dd = ky * c
  // MOT-8: M = R * K * S. The box is stretched, then sheared, then rotated, about the box centre.
  const shear = skewShear(t.skewX, t.skewY)
  if (shear) {
    a = kx * (c - shear.ky * sin)
    b = kx * (sin + shear.ky * c)
    cc = ky * (shear.kx * c - sin)
    dd = ky * (shear.kx * sin + c)
  }
  return {
    bounds,
    rect,
    matrix: [a, b, cc, dd, rcx - (a * bcx + cc * bcy), rcy - (b * bcx + dd * bcy)],
  }
}

/**
 * Stringified key of everything that changes the painted pixels. A legacy clip
 * contributes `null` for the model, which changes nothing painted - the
 * signature is change detection, not a render instruction.
 */
export function freehandPaintSignature(
  item: ActiveFreehandClip,
  stage: { width: number; height: number },
): string {
  const t = item.transform
  return JSON.stringify([
    item.pathData,
    item.strokeColor,
    item.strokeWidth,
    stage.width,
    stage.height,
    item.transformModel === 'v2' && t
      ? ['v2', t.x, t.y, t.scale, t.scaleX, t.scaleY, t.rotation, t.anchor?.x, t.anchor?.y, ...(skewShear(t.skewX, t.skewY) ? [t.skewX ?? 0, t.skewY ?? 0] : [])]
      : null,
  ])
}

/**
 * Paint `item` onto `ctx` in stage units.
 *
 * Does not clear and does not touch `globalAlpha`: the preview owns the clear
 * because it reuses one scratch canvas, and the exporter owns the alpha because
 * it composites. `ctx.transform` MULTIPLIES onto whatever matrix is current,
 * which is what makes this correct under the exporter's stage-to-output scale -
 * `setTransform` here would throw that away.
 */
export function paintFreehand(
  ctx: Freehand2DContext,
  item: ActiveFreehandClip,
  stage: { width: number; height: number },
): void {
  if (!item.pathData) return
  ctx.strokeStyle = item.strokeColor
  ctx.lineWidth = item.strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const placed = item.transformModel === 'v2' ? freehandPlacement(item, stage) : undefined
  if (placed) {
    ctx.save()
    ctx.transform(...placed.matrix)
  }
  try {
    ctx.stroke(new Path2D(item.pathData))
  } catch {
    // Invalid pathData — render nothing.
  }
  if (placed) ctx.restore()
}
