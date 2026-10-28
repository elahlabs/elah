/**
 * The box a text block or shape actually occupies, for masks (EDX-P7c).
 *
 * Text, shape and freehand clips are painted onto a full-stage canvas, so
 * without this a mask on them would be measured against the whole stage.
 * These helpers give the element's own box — the same one the preview's
 * selection handles show — in stage px, rotated about its centre, so
 * "Left 50%" means half of the title, not half of the frame.
 *
 * Shared by the preview layers and the exporter, so both measure alike.
 */

import type { ActiveFreehandClip, ActiveShapeClip, ActiveTextClip } from '../../../resolver/scene'
import type { DrawRect } from './drawRect'
import { resolveShapeRect } from './shapePaint'
import { computeTextLayout } from './textLayout'
import { measureContextFor, type MeasureContext, type TextMeasurer } from './textMeasure'
import { freehandPlacement } from './freehandPaint'
import { pathBounds } from './pathBounds'

/**
 * One measurer name, at last (PV-P2b). `computeTextLayout` takes the 2D-context
 * shape; callers hold the interface, and `measureContextFor` adapts. The
 * duplicate `TextMeasurer` type that used to be exported from `textLayout` is
 * gone, so a caller can no longer pick up the wrong one by accident.
 */

/** The painted glyph block of a text clip, rotated as it is drawn. */
export function textMaskFrame(
  measure: MeasureContext,
  item: ActiveTextClip,
  stage: { width: number; height: number },
): DrawRect {
  const layout = computeTextLayout(measure, item, stage)
  const rotation = item.transform?.rotation ?? 0
  const { box } = layout
  // Text rotates about the layout centre; carry the box centre round it.
  const px = layout.center.x * stage.width
  const py = layout.center.y * stage.height
  const dx = box.x + box.width / 2 - px
  const dy = box.y + box.height / 2 - py
  const c = Math.cos(rotation)
  const s = Math.sin(rotation)
  const cx = px + dx * c - dy * s
  const cy = py + dx * s + dy * c
  // The painter scales the box about `center`, so the box the element occupies is
  // the stretched one. `?? 1` keeps a legacy frame bit-for-bit what it was.
  const w = box.width * (layout.stretch?.x ?? 1)
  const h = box.height * (layout.stretch?.y ?? 1)
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rotation }
}

/** The shape's box, exactly as the painter places it. */
export function shapeMaskFrame(item: ActiveShapeClip, stage: { width: number; height: number }): DrawRect {
  return resolveShapeRect(item.transform, stage)
}

/**
 * A freehand clip's box: v2 with a transform gives the placed rect, and anything
 * else gives the path's own geometry bounds — which is where a legacy drawing
 * actually is, since it ignores its transform. The stroke is not included, so
 * the box is the path's centreline, not its ink.
 */
export function freehandFrame(
  item: ActiveFreehandClip,
  stage: { width: number; height: number },
): DrawRect | undefined {
  if (item.transformModel === 'v2') {
    const placed = freehandPlacement(item, stage)
    if (placed) return placed.rect
  }
  if (!item.pathData) return undefined
  const box = pathBounds(item.pathData)
  if (!box) return undefined
  // The native placement, so a legacy drawing's box is where it is drawn and
  // carries no rotation: a transform it does not read must not tilt its box.
  return { x: box.x, y: box.y, width: box.width, height: box.height, rotation: 0 }
}

export type FramedItem = ActiveTextClip | ActiveShapeClip | ActiveFreehandClip

/**
 * The box an element occupies in stage px, rotated about its centre — what the
 * selection handles, masks and layout (PV-P3b) measure against. Text needs a
 * measurer; without one it has no frame (never estimated).
 */
export function elementFrameFor(
  item: FramedItem,
  stage: { width: number; height: number },
  measure?: TextMeasurer,
): DrawRect | undefined {
  if (item.type === 'text') {
    return measure ? textMaskFrame(measureContextFor(measure), item, stage) : undefined
  }
  if (item.type === 'freehand') return freehandFrame(item, stage)
  return shapeMaskFrame(item, stage)
}
