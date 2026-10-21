/**
 * shapePaint — the ONE shape rasterizer, shared by the GPU preview layer and
 * the 2D export worker.
 *
 * Before this module `ShapeLayer.paintShape` and `ExportWorker.drawShape` were
 * verbatim copies of each other, so every new variant had to be written twice
 * and any drift showed up as "the export looks different from the preview".
 * The file sits beside `drawRect.ts` and `textLayout.ts` because those are
 * already proven worker-reachable — `ExportWorker` imports both relatively.
 *
 * Contract with the two callers, mirroring the `TextLayer` / `drawText` split:
 *   - `paintShape` does NOT clear the canvas. `ShapeLayer` clears its shared
 *     scratch canvas first; the export worker is painting into a composited
 *     frame and must not.
 *   - `paintShape` does NOT touch `globalAlpha`. Opacity is a GL uniform in the
 *     preview and is set by the export worker before it calls in.
 *
 * Geometry lives here too (`resolveShapeRect`) so the preview overlay's
 * selection box is derived from the same numbers the painter uses, instead of
 * re-deriving them a third time.
 */

import type {
  TextShadow,
  ShapeArrowHead,
  ShapeFillRule,
  ShapeViewBox,
  ShapeStrokeCap,
  ShapeStrokeJoin,
  ShapeStrokeAlign,
  Transform,
} from '../../../types'
import type { ActiveShapeClip } from '../../../resolver/scene'
import { applyShear, rectShear, skewFields, skewShear, type DrawRect } from './drawRect'
import { estimatePathLength } from './pathLength'
import { isPaint, toCanvasPaint, paintSignature, usableShadow, applyShadow, clearShadow, paintingAtOutputScale, type PaintBox } from './paint'

/**
 * The 2D context type both callers can satisfy. `CanvasRenderingContext2D` and
 * `OffscreenCanvasRenderingContext2D` are built from the same mixin interfaces,
 * so every method used below is present on the union.
 */
export type Shape2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Bounds the painter enforces on the numeric shape fields. */
export const SHAPE_LIMITS = {
  minSides: 3,
  maxSides: 12,
  defaultSides: 5,
  minInnerRatio: 0.05,
  maxInnerRatio: 0.95,
  /** Arrowhead length as a multiple of the stroke width. */
  arrowHeadStrokeMultiple: 4,
  /** `shapeStrokeDash` (PV-P6a): a longer array is treated as absent. */
  maxDashEntries: 32,
} as const

/** The user space a `path` shape falls back to when it carries no viewBox. */
export const DEFAULT_SHAPE_VIEWBOX: ShapeViewBox = { x: 0, y: 0, width: 100, height: 100 }

/**
 * `shapeStrokeAlign: 'outside'` (PV-P6a) clips a doubled-width stroke to "big
 * rect minus the shape" with an even-odd fill rule. The "big rect" pads the
 * shape's own box by a multiple of the stroke width (covers miter spikes,
 * whose reach is bounded by the canvas default `miterLimit` of 10) plus a
 * small fixed pixel margin (covers rounding at very small stroke widths).
 */
const OUTSIDE_CLIP_PAD_STROKES = 12
const OUTSIDE_CLIP_PAD_PX = 2

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * The pixel box a shape is painted inside, in stage space.
 *
 * The base side is `scale × min(stageW, stageH)` — a SQUARE whose size is a
 * fraction of the stage's short side, which is what `DEFAULT_SHAPE_TRANSFORM`'s
 * `scale: 0.5` has always meant — then stretched per axis by `scaleX`/`scaleY`.
 * That is unchanged from the original painter and is why old documents come out
 * pixel-identical.
 *
 * What is new is that `anchor` and `rotation` are read:
 *   - `anchor` offsets the box from (x, y), so (x, y) names the anchor point
 *     rather than always the centre. At the default 0.5/0.5 this reduces to
 *     `cx - halfW`, the old expression.
 *   - `rotation` is carried on the rect and applied by the painter about the
 *     box CENTRE, matching `buildTransformMatrixFromRect` (drawRect.ts), the
 *     export worker's `ctx.rotate`, and the overlay's CSS `rotate()`. The
 *     anchor is a placement/scale origin, not the pivot — the same split media
 *     clips already use, so the three paths cannot disagree.
 */
export function resolveShapeRect(
  transform: Transform | undefined,
  stage: { width: number; height: number },
): DrawRect {
  const shortSide = Math.min(stage.width, stage.height)
  const side = finiteOr(transform?.scale, 0.5) * shortSide
  const width = side * finiteOr(transform?.scaleX, 1)
  const height = side * finiteOr(transform?.scaleY, 1)

  const anchorX = finiteOr(transform?.anchor?.x, 0.5)
  const anchorY = finiteOr(transform?.anchor?.y, 0.5)

  return {
    x: finiteOr(transform?.x, 0.5) * stage.width - anchorX * width,
    y: finiteOr(transform?.y, 0.5) * stage.height - anchorY * height,
    width,
    height,
    rotation: finiteOr(transform?.rotation, 0),
    // MOT-8: present only when skewed, so an unskewed rect is the object it always was.
    ...skewFields(transform),
  }
}

/**
 * Stringified key of everything that changes the painted pixels — NOT opacity,
 * which is a uniform in the preview and `globalAlpha` in export.
 *
 * Every field the painter reads must appear here. A field that is read but not
 * listed produces the worst kind of bug: the export is correct and the preview
 * keeps showing a stale texture, because `ShapeLayer` skips the re-upload.
 */
/**
 * True when the clip sets any PV-P6a field. Only then does the vector painter
 * run; only then does the signature carry a 26th entry. Checks `!== undefined`
 * rather than `in`, so a field the UI explicitly cleared back to `undefined`
 * (still a key on the object) reads as absent, same as a field never set.
 */
export function hasVectorStyle(item: ActiveShapeClip): boolean {
  return (
    item.shapeFillPaint !== undefined ||
    item.shapeStrokePaint !== undefined ||
    item.shapeStrokeDash !== undefined ||
    item.shapeStrokeDashOffset !== undefined ||
    item.shapeStrokeCap !== undefined ||
    item.shapeStrokeJoin !== undefined ||
    item.shapeStrokeAlign !== undefined ||
    // MC-1d: a fill shadow and per-corner radii are drawn by the vector painter
    // only, so the legacy painter's op sequence stays untouched.
    item.shadow !== undefined ||
    item.cornerRadii !== undefined
  )
}

/** A shadow plus the rotation its offset must follow (see `applyShadow`). */
interface ShadowPlan {
  shadow: TextShadow
  rotation: number
}

function shadowPlan(item: ActiveShapeClip, rect: DrawRect): ShadowPlan | undefined {
  const shadow = usableShadow(item.shadow)
  return shadow ? { shadow, rotation: rect.rotation } : undefined
}

/** One fill with the shadow on for exactly that fill. */
function fillWithShadow(ctx: Shape2DContext, plan: ShadowPlan | undefined, fill: () => void): void {
  if (!plan) {
    fill()
    return
  }
  applyShadow(ctx, plan.shadow, plan.rotation)
  fill()
  clearShadow(ctx)
}

/**
 * The four radii of a `rect`, in px [tl, tr, br, bl], or `undefined` when the
 * clip carries no usable `cornerRadii` (then `cornerRadius` rules). Each is a
 * fraction of the shorter side, clamped to half of it like the uniform radius.
 */
export function resolveCornerRadii(
  radii: unknown,
  width: number,
  height: number,
): [number, number, number, number] | undefined {
  if (!Array.isArray(radii) || radii.length !== 4) return undefined
  if (!radii.every((r) => typeof r === 'number' && Number.isFinite(r))) return undefined
  const short = Math.min(width, height)
  const out = radii.map((r: number) => Math.max(0, Math.min(r * short, short / 2)))
  return out as [number, number, number, number]
}

/**
 * A dash list the painter will use, or `undefined` for a solid stroke.
 * `undefined` unless `dash` is an array of 1..`SHAPE_LIMITS.maxDashEntries`
 * finite, non-negative numbers that are not all zero — a hostile or malformed
 * document falls back to a solid stroke rather than throwing inside
 * `setLineDash`.
 */
export function usableDash(dash: unknown): number[] | undefined {
  if (!Array.isArray(dash)) return undefined
  if (dash.length < 1 || dash.length > SHAPE_LIMITS.maxDashEntries) return undefined
  let allZero = true
  for (const entry of dash) {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0) return undefined
    if (entry !== 0) allZero = false
  }
  return allZero ? undefined : (dash as number[])
}

export function shapePaintSignature(
  item: ActiveShapeClip,
  stage: { width: number; height: number },
): string {
  const parts: unknown[] = [
    item.shapeKind,
    item.shapeFill,
    item.shapeStroke,
    item.shapeStrokeWidth,
    item.transform?.x,
    item.transform?.y,
    item.transform?.scale,
    item.transform?.scaleX,
    item.transform?.scaleY,
    item.transform?.rotation,
    item.transform?.anchor?.x,
    item.transform?.anchor?.y,
    item.cornerRadius,
    item.shapeSides,
    item.shapeInnerRatio,
    item.shapeArrowHead,
    item.shapePath,
    item.shapeViewBox?.x,
    item.shapeViewBox?.y,
    item.shapeViewBox?.width,
    item.shapeViewBox?.height,
    item.shapeFillRule,
    stage.width,
    stage.height,
    // Draw-on (EDX-P9). Absent for ordinary shapes, so their signature is
    // unchanged apart from one trailing null.
    item.shapeDraw ? [item.shapeDraw.start, item.shapeDraw.end] : null,
  ]
  if (hasVectorStyle(item)) {
    parts.push([
      paintSignature(item.shapeFillPaint),
      paintSignature(item.shapeStrokePaint),
      item.shapeStrokeDash ?? null,
      item.shapeStrokeDashOffset ?? null,
      item.shapeStrokeCap ?? null,
      item.shapeStrokeJoin ?? null,
      item.shapeStrokeAlign ?? null,
      // MC-1d: object / array fields, as JSON like the dash list above.
      item.shadow ?? null,
      item.cornerRadii ?? null,
    ])
  }
  // MOT-8: skew. Appended only while skewed, so every other shape keeps its key.
  if (skewShear(item.transform?.skewX, item.transform?.skewY)) parts.push(['skew', item.transform?.skewX ?? 0, item.transform?.skewY ?? 0])
  return JSON.stringify(parts)
}

// ---------------------------------------------------------------------------
// Draw-on (EDX-P9)
// ---------------------------------------------------------------------------

type DrawWindow = { start: number; end: number }

/** A draw-on that actually hides something (a full window draws normally). */
function activeDraw(item: ActiveShapeClip): DrawWindow | undefined {
  const d = item.shapeDraw
  if (!d) return undefined
  return d.start > 0 || d.end < 1 ? d : undefined
}

/**
 * Fill then stroke for a drawing-on shape. The outline is dashed to show only
 * `[start, end]` of its `length`; the fill fades in over the last 40% of the
 * draw, so an outline appears first and the shape "fills" as it completes.
 */
function fillStrokeDrawing(ctx: Shape2DContext, draw: DrawWindow, length: number, strokeWidth: number, path?: Path2D, fillRule?: ShapeFillRule, shadow?: ShadowPlan): void {
  const reveal = Math.max(0, Math.min(1, (draw.end - 0.6) / 0.4))
  if (reveal > 0) {
    ctx.save()
    ctx.globalAlpha *= reveal
    fillWithShadow(ctx, shadow, () => {
      if (path) ctx.fill(path, fillRule ?? 'nonzero')
      else ctx.fill()
    })
    ctx.restore()
  }
  if (strokeWidth > 0 && draw.end > draw.start && length > 0) {
    ctx.save()
    const a = draw.start * length
    const visible = Math.max(0.0001, (draw.end - draw.start) * length)
    ctx.setLineDash([visible, length * 2])
    ctx.lineDashOffset = -a
    if (path) ctx.stroke(path)
    else ctx.stroke()
    ctx.restore()
  }
}

/** Perimeter of the regular polygon / star `polygonPath` traces. */
function polygonPerimeter(halfW: number, halfH: number, sides: number, innerRatio: number | undefined): number {
  const n = Math.round(Math.min(SHAPE_LIMITS.maxSides, Math.max(SHAPE_LIMITS.minSides, finiteOr(sides, SHAPE_LIMITS.defaultSides))))
  const star =
    innerRatio !== undefined && Number.isFinite(innerRatio)
      ? Math.min(SHAPE_LIMITS.maxInnerRatio, Math.max(SHAPE_LIMITS.minInnerRatio, innerRatio))
      : undefined
  const count = star === undefined ? n : n * 2
  let total = 0
  let px = 0
  let py = 0
  for (let i = 0; i <= count; i++) {
    const angle = -Math.PI / 2 + ((i % count) * Math.PI * 2) / count
    const r = star !== undefined && (i % count) % 2 === 1 ? star : 1
    const x = Math.cos(angle) * halfW * r
    const y = Math.sin(angle) * halfH * r
    if (i > 0) total += Math.hypot(x - px, y - py)
    px = x
    py = y
  }
  return total
}

/** Ellipse perimeter (Ramanujan). */
function ellipsePerimeter(a: number, b: number): number {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
}

/**
 * Trace a rounded rectangle without `ctx.roundRect`, which older OffscreenCanvas
 * implementations do not have. Same tracing as `TextLayer.roundRectPath`.
 */
function roundRectPath(
  ctx: Shape2DContext,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/**
 * Vertices of a regular polygon (or a star) inscribed in the box's ellipse.
 *
 * Starts at −π/2 so vertex 0 points UP, which puts a 3-gon's apex where the
 * legacy `triangle` variant puts it and makes a 5-gon read as the expected
 * pentagon rather than a rotated one. A star alternates the full radius with
 * `innerRatio` of it, so `sides: 5, innerRatio: 0.5` is the familiar 5-point
 * star drawn with 10 vertices.
 */
function polygonPath(
  ctx: Shape2DContext,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  sides: number,
  innerRatio: number | undefined,
): void {
  const n = Math.round(
    Math.min(SHAPE_LIMITS.maxSides, Math.max(SHAPE_LIMITS.minSides, finiteOr(sides, SHAPE_LIMITS.defaultSides))),
  )
  const star =
    innerRatio !== undefined && Number.isFinite(innerRatio)
      ? Math.min(SHAPE_LIMITS.maxInnerRatio, Math.max(SHAPE_LIMITS.minInnerRatio, innerRatio))
      : undefined
  const count = star === undefined ? n : n * 2

  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / count
    const r = star !== undefined && i % 2 === 1 ? star : 1
    const px = cx + Math.cos(angle) * halfW * r
    const py = cy + Math.sin(angle) * halfH * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

/** One filled arrowhead, pointing along +x (`dir` 1) or −x (`dir` −1). */
function arrowHead(ctx: Shape2DContext, tipX: number, cy: number, dir: 1 | -1, length: number): void {
  ctx.beginPath()
  ctx.moveTo(tipX, cy)
  ctx.lineTo(tipX - dir * length, cy - length / 2)
  ctx.lineTo(tipX - dir * length, cy + length / 2)
  ctx.closePath()
  ctx.fill()
}

/**
 * Paint one shape into a 2D context, in stage pixel coordinates.
 *
 * Legacy variants at `rotation: 0` with the default anchor emit exactly the op
 * sequence the original painter did — same order, same count, same numbers —
 * which is what keeps existing projects byte-identical. The rotation wrapper is
 * skipped entirely at 0 rather than emitting an identity transform, for the
 * same reason.
 */
export function paintShape(
  ctx: Shape2DContext,
  item: ActiveShapeClip,
  stage: { width: number; height: number },
): void {
  // Shadows are in device pixels; see `paintingAtOutputScale`.
  paintingAtOutputScale(ctx, () => paintShapeAt(ctx, item, stage))
}

function paintShapeAt(
  ctx: Shape2DContext,
  item: ActiveShapeClip,
  stage: { width: number; height: number },
): void {
  if (hasVectorStyle(item)) {
    paintVectorShape(ctx, item, stage)
    return
  }

  const rect = resolveShapeRect(item.transform, stage)
  const { x, y, width, height } = rect
  const halfW = width / 2
  const halfH = height / 2
  const cx = x + halfW
  const cy = y + halfH
  const strokeWidth = finiteOr(item.shapeStrokeWidth, 0)

  ctx.fillStyle = item.shapeFill
  ctx.strokeStyle = item.shapeStroke
  ctx.lineWidth = strokeWidth

  // Draw-on (EDX-P9) takes its own path; without it every op below is the
  // original sequence, byte for byte.
  const draw = activeDraw(item)
  const finish = (length: () => number) => {
    if (!draw) {
      ctx.fill()
      if (strokeWidth > 0) ctx.stroke()
    } else fillStrokeDrawing(ctx, draw, length(), strokeWidth)
  }

  // MOT-8: the shear joins the rotation wrapper (rotate, then shear: CSS "rotate() skew()"). Absent, the calls are unchanged.
  const shear = rectShear(rect)
  const rotated = rect.rotation !== 0 || shear !== undefined
  if (rotated) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rect.rotation)
    applyShear(ctx, shear)
    ctx.translate(-cx, -cy)
  }

  if (item.shapeKind === 'rect') {
    const radius = finiteOr(item.cornerRadius, 0)
    if (radius > 0) {
      roundRectPath(ctx, x, y, width, height, radius * Math.min(width, height))
    } else {
      ctx.beginPath()
      ctx.rect(x, y, width, height)
    }
    finish(() => {
      const r = Math.min(radius * Math.min(width, height), Math.min(width, height) / 2)
      return 2 * (width + height) - (8 - 2 * Math.PI) * r
    })
  } else if (item.shapeKind === 'circle') {
    ctx.beginPath()
    ctx.ellipse(cx, cy, halfW, halfH, 0, 0, Math.PI * 2)
    finish(() => ellipsePerimeter(halfW, halfH))
  } else if (item.shapeKind === 'triangle') {
    ctx.beginPath()
    ctx.moveTo(cx, cy - halfH)
    ctx.lineTo(cx + halfW, cy + halfH)
    ctx.lineTo(cx - halfW, cy + halfH)
    ctx.closePath()
    finish(() => 2 * Math.hypot(halfW, 2 * halfH) + 2 * halfW)
  } else if (item.shapeKind === 'polygon') {
    polygonPath(ctx, cx, cy, halfW, halfH, finiteOr(item.shapeSides, SHAPE_LIMITS.defaultSides), item.shapeInnerRatio)
    finish(() => polygonPerimeter(halfW, halfH, finiteOr(item.shapeSides, SHAPE_LIMITS.defaultSides), item.shapeInnerRatio))
  } else if (item.shapeKind === 'line') {
    paintLine(ctx, x, cy, width, strokeWidth, item.shapeStroke, item.shapeArrowHead, draw)
  } else if (item.shapeKind === 'path') {
    paintPath(ctx, rect, item, strokeWidth, draw)
  }

  if (rotated) ctx.restore()
}

/**
 * A horizontal rule across the box, optionally arrow-tipped. Self-contained in
 * a save/restore because it is the only variant that changes `lineCap`, and the
 * preview's scratch canvas is shared by every shape on the stage — a leaked cap
 * would round the corners of the next clip's stroke.
 *
 * Fill is deliberately ignored: a line has no interior, and the arrowheads are
 * painted in the STROKE colour so a line and its head read as one object.
 */
function paintLine(
  ctx: Shape2DContext,
  x: number,
  cy: number,
  width: number,
  strokeWidth: number,
  stroke: string,
  head: ShapeArrowHead | undefined,
  draw?: DrawWindow,
): void {
  if (strokeWidth <= 0) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.beginPath()
  if (draw) {
    // Draw-on: the rule grows from start to end; heads appear once it lands.
    if (draw.end <= draw.start) {
      ctx.restore()
      return
    }
    ctx.moveTo(x + width * draw.start, cy)
    ctx.lineTo(x + width * draw.end, cy)
  } else {
    ctx.moveTo(x, cy)
    ctx.lineTo(x + width, cy)
  }
  ctx.stroke()

  if ((head === 'end' || head === 'both') && (!draw || draw.end >= 0.999)) {
    const length = Math.min(SHAPE_LIMITS.arrowHeadStrokeMultiple * strokeWidth, width / 2)
    ctx.fillStyle = stroke
    arrowHead(ctx, x + width, cy, 1, length)
    if (head === 'both') arrowHead(ctx, x, cy, -1, length)
  }
  ctx.restore()
}

/**
 * Vector art authored as an SVG `d` string, fitted into the clip's box.
 *
 * The viewBox is CONTAINED (aspect preserved) rather than stretched, so a
 * non-square box letterboxes the art instead of skewing it — a stretched arrow
 * or logo reads as a mistake, where a letterboxed one reads as a placement.
 * Because the fit is uniform, dividing `lineWidth` by the scale keeps the
 * stroke exactly `shapeStrokeWidth` stage pixels wide, which is the same unit
 * every other variant uses.
 *
 * `Path2D` exists in browsers and in workers but not in Node, so this is a
 * no-op under the unit tests unless they provide a stub. Invalid path data
 * throws in the constructor and renders nothing, exactly as `FreehandLayer`
 * has always handled it.
 */
function paintPath(
  ctx: Shape2DContext,
  rect: DrawRect,
  item: ActiveShapeClip,
  strokeWidth: number,
  draw?: DrawWindow,
): void {
  const d = item.shapePath
  if (!d || typeof Path2D === 'undefined') return

  const vb = item.shapeViewBox ?? DEFAULT_SHAPE_VIEWBOX
  const vbW = finiteOr(vb.width, 0)
  const vbH = finiteOr(vb.height, 0)
  if (vbW <= 0 || vbH <= 0) return

  const scale = Math.min(rect.width / vbW, rect.height / vbH)
  if (!Number.isFinite(scale) || scale <= 0) return

  ctx.save()
  ctx.translate(rect.x + (rect.width - vbW * scale) / 2, rect.y + (rect.height - vbH * scale) / 2)
  ctx.scale(scale, scale)
  ctx.translate(-finiteOr(vb.x, 0), -finiteOr(vb.y, 0))
  ctx.lineWidth = strokeWidth / scale

  try {
    const path = new Path2D(d)
    if (draw) {
      fillStrokeDrawing(ctx, draw, estimatePathLength(d), strokeWidth / scale, path, (item.shapeFillRule ?? 'nonzero') as ShapeFillRule)
    } else {
      ctx.fill(path, (item.shapeFillRule ?? 'nonzero') as ShapeFillRule)
      if (strokeWidth > 0) ctx.stroke(path)
    }
  } catch {
    // Invalid path data — render nothing, same as FreehandLayer.
  }

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Vector painter (PV-P6a): gradient/solid paint, dash, cap, join, stroke align
// ---------------------------------------------------------------------------

function resolveCap(cap: unknown): ShapeStrokeCap | undefined {
  return cap === 'butt' || cap === 'round' || cap === 'square' ? cap : undefined
}

function resolveJoin(join: unknown): ShapeStrokeJoin | undefined {
  return join === 'miter' || join === 'round' || join === 'bevel' ? join : undefined
}

function resolveAlign(align: unknown): ShapeStrokeAlign {
  return align === 'inside' || align === 'outside' ? align : 'center'
}

/** Perimeter of the shape a closed variant traces, for the draw-on dash. */
function closedPerimeter(item: ActiveShapeClip, rect: DrawRect): number {
  const halfW = rect.width / 2
  const halfH = rect.height / 2
  if (item.shapeKind === 'rect') {
    const four = resolveCornerRadii(item.cornerRadii, rect.width, rect.height)
    if (four) {
      // Each rounded corner swaps 2r of straight edge for a quarter arc, pi r / 2.
      return 2 * (rect.width + rect.height) - four.reduce((sum, r) => sum + (2 - Math.PI / 2) * r, 0)
    }
    const radius = finiteOr(item.cornerRadius, 0)
    const r = Math.min(radius * Math.min(rect.width, rect.height), Math.min(rect.width, rect.height) / 2)
    return 2 * (rect.width + rect.height) - (8 - 2 * Math.PI) * r
  }
  if (item.shapeKind === 'circle') return ellipsePerimeter(halfW, halfH)
  if (item.shapeKind === 'triangle') return 2 * Math.hypot(halfW, 2 * halfH) + 2 * halfW
  if (item.shapeKind === 'polygon') {
    return polygonPerimeter(halfW, halfH, finiteOr(item.shapeSides, SHAPE_LIMITS.defaultSides), item.shapeInnerRatio)
  }
  return 0
}

/** Rounded-rect trace onto a standalone `Path2D`, not the ctx's current path. */
function roundRectOnPath(p: Path2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  p.moveTo(x + radius, y)
  p.arcTo(x + w, y, x + w, y + h, radius)
  p.arcTo(x + w, y + h, x, y + h, radius)
  p.arcTo(x, y + h, x, y, radius)
  p.arcTo(x, y, x + w, y, radius)
  p.closePath()
}

/**
 * Rounded rect with a radius per corner [tl, tr, br, bl], px, onto a standalone
 * `Path2D`. Uses `Path2D.roundRect` where the platform has it and the same
 * corners traced with `arcTo` where it does not (older OffscreenCanvas).
 */
function roundRect4OnPath(p: Path2D, x: number, y: number, w: number, h: number, r: [number, number, number, number]): void {
  const [tl, tr, br, bl] = r
  if (typeof (p as Path2D & { roundRect?: unknown }).roundRect === 'function') {
    ;(p as Path2D & { roundRect(x: number, y: number, w: number, h: number, radii: number[]): void }).roundRect(x, y, w, h, [tl, tr, br, bl])
    return
  }
  p.moveTo(x + tl, y)
  p.lineTo(x + w - tr, y)
  p.arcTo(x + w, y, x + w, y + tr, tr)
  p.lineTo(x + w, y + h - br)
  p.arcTo(x + w, y + h, x + w - br, y + h, br)
  p.lineTo(x + bl, y + h)
  p.arcTo(x, y + h, x, y + h - bl, bl)
  p.lineTo(x, y + tl)
  p.arcTo(x, y, x + tl, y, tl)
  p.closePath()
}

/** Regular polygon / star trace onto a standalone `Path2D`. Mirrors `polygonPath`. */
function polygonOnPath(
  p: Path2D,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  sides: number | undefined,
  innerRatio: number | undefined,
): void {
  const n = Math.round(
    Math.min(SHAPE_LIMITS.maxSides, Math.max(SHAPE_LIMITS.minSides, finiteOr(sides, SHAPE_LIMITS.defaultSides))),
  )
  const star =
    innerRatio !== undefined && Number.isFinite(innerRatio)
      ? Math.min(SHAPE_LIMITS.maxInnerRatio, Math.max(SHAPE_LIMITS.minInnerRatio, innerRatio))
      : undefined
  const count = star === undefined ? n : n * 2
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / count
    const r = star !== undefined && i % 2 === 1 ? star : 1
    const px = cx + Math.cos(angle) * halfW * r
    const py = cy + Math.sin(angle) * halfH * r
    if (i === 0) p.moveTo(px, py)
    else p.lineTo(px, py)
  }
  p.closePath()
}

/** The one `Path2D` for a closed variant (rect/circle/triangle/polygon), or `undefined` for anything else. */
function buildClosedPath(item: ActiveShapeClip, rect: DrawRect): Path2D | undefined {
  const { x, y, width, height } = rect
  const halfW = width / 2
  const halfH = height / 2
  const cx = x + halfW
  const cy = y + halfH
  const p = new Path2D()
  if (item.shapeKind === 'rect') {
    const four = resolveCornerRadii(item.cornerRadii, width, height)
    const radius = finiteOr(item.cornerRadius, 0)
    if (four) roundRect4OnPath(p, x, y, width, height, four)
    else if (radius > 0) roundRectOnPath(p, x, y, width, height, radius * Math.min(width, height))
    else p.rect(x, y, width, height)
  } else if (item.shapeKind === 'circle') {
    p.ellipse(cx, cy, halfW, halfH, 0, 0, Math.PI * 2)
  } else if (item.shapeKind === 'triangle') {
    p.moveTo(cx, cy - halfH)
    p.lineTo(cx + halfW, cy + halfH)
    p.lineTo(cx - halfW, cy + halfH)
    p.closePath()
  } else if (item.shapeKind === 'polygon') {
    polygonOnPath(p, cx, cy, halfW, halfH, item.shapeSides, item.shapeInnerRatio)
  } else {
    return undefined
  }
  return p
}

/**
 * Fill then, per `align`, stroke a closed `Path2D` — shared by the closed
 * variants and by `path`. `align: 'inside'`/`'outside'` draw a doubled-width
 * stroke clipped to one half of it: clipping to the fill region (nonzero)
 * keeps the inner half, clipping to "outer rect minus the shape" (evenodd)
 * keeps the outer half. `outer` is built by the caller because its padding
 * unit differs (stage px for the closed variants, viewBox units for `path`).
 */
function fillAndAlignedStroke(
  ctx: Shape2DContext,
  path: Path2D,
  rule: ShapeFillRule,
  sw: number,
  align: ShapeStrokeAlign,
  buildOuter: () => Path2D,
  shadow?: ShadowPlan,
): void {
  fillWithShadow(ctx, shadow, () => ctx.fill(path, rule))
  if (sw <= 0) return
  if (align === 'center') {
    ctx.lineWidth = sw
    ctx.stroke(path)
  } else if (align === 'inside') {
    ctx.save()
    ctx.clip(path, rule)
    ctx.lineWidth = 2 * sw
    ctx.stroke(path)
    ctx.restore()
  } else {
    ctx.save()
    ctx.clip(buildOuter(), 'evenodd')
    ctx.lineWidth = 2 * sw
    ctx.stroke(path)
    ctx.restore()
  }
}

/** rect/circle/triangle/polygon, with gradient paint, dash, cap, join and stroke alignment. */
function paintVectorClosed(
  ctx: Shape2DContext,
  item: ActiveShapeClip,
  rect: DrawRect,
  sw: number,
  draw: DrawWindow | undefined,
  align: ShapeStrokeAlign,
  cap: ShapeStrokeCap | undefined,
  join: ShapeStrokeJoin | undefined,
  dash: number[] | undefined,
): void {
  const path = buildClosedPath(item, rect)
  if (!path) return

  ctx.save()
  // MOT-8: the shear joins the rotation wrapper (rotate, then shear: CSS "rotate() skew()"). Absent, the calls are unchanged.
  const shear = rectShear(rect)
  const rotated = rect.rotation !== 0 || shear !== undefined
  if (rotated) {
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    ctx.translate(cx, cy)
    ctx.rotate(rect.rotation)
    applyShear(ctx, shear)
    ctx.translate(-cx, -cy)
  }

  const box: PaintBox = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  ctx.fillStyle = isPaint(item.shapeFillPaint) ? toCanvasPaint(ctx, item.shapeFillPaint, box) : item.shapeFill
  ctx.strokeStyle = isPaint(item.shapeStrokePaint) ? toCanvasPaint(ctx, item.shapeStrokePaint, box) : item.shapeStroke
  if (cap) ctx.lineCap = cap
  if (join) ctx.lineJoin = join
  if (dash) {
    ctx.setLineDash(dash)
    if (Number.isFinite(item.shapeStrokeDashOffset)) ctx.lineDashOffset = item.shapeStrokeDashOffset as number
  }

  if (draw) {
    ctx.lineWidth = sw
    fillStrokeDrawing(ctx, draw, closedPerimeter(item, rect), sw, path, 'nonzero', shadowPlan(item, rect))
  } else {
    fillAndAlignedStroke(ctx, path, 'nonzero', sw, align, () => {
      const pad = OUTSIDE_CLIP_PAD_STROKES * sw + OUTSIDE_CLIP_PAD_PX
      const outer = new Path2D()
      outer.rect(rect.x - pad, rect.y - pad, rect.width + 2 * pad, rect.height + 2 * pad)
      outer.addPath(path)
      return outer
    }, shadowPlan(item, rect))
  }

  ctx.restore()
}

/** `line`: paint is ignored for fill (a line has no interior) and alignment is ignored. */
function paintVectorLine(
  ctx: Shape2DContext,
  item: ActiveShapeClip,
  rect: DrawRect,
  sw: number,
  draw: DrawWindow | undefined,
  cap: ShapeStrokeCap | undefined,
  join: ShapeStrokeJoin | undefined,
  dash: number[] | undefined,
): void {
  if (sw <= 0) return
  const { x, y, width, height } = rect
  const cy = y + height / 2

  ctx.save()
  // MOT-8: the shear joins the rotation wrapper (rotate, then shear: CSS "rotate() skew()"). Absent, the calls are unchanged.
  const shear = rectShear(rect)
  const rotated = rect.rotation !== 0 || shear !== undefined
  if (rotated) {
    const cx = x + width / 2
    const rcy = y + height / 2
    ctx.translate(cx, rcy)
    ctx.rotate(rect.rotation)
    applyShear(ctx, shear)
    ctx.translate(-cx, -rcy)
  }

  const box: PaintBox = { x, y, width, height }
  const strokeStyle = isPaint(item.shapeStrokePaint) ? toCanvasPaint(ctx, item.shapeStrokePaint, box) : item.shapeStroke
  ctx.strokeStyle = strokeStyle
  // Written every time, even at the legacy default: this painter shares a
  // scratch canvas across every shape on the stage, and a cap left over from
  // a previous shape must not leak into a plain line's rounded ends.
  ctx.lineCap = resolveCap(item.shapeStrokeCap) ?? 'round'
  if (join) ctx.lineJoin = join
  if (dash) {
    ctx.setLineDash(dash)
    if (Number.isFinite(item.shapeStrokeDashOffset)) ctx.lineDashOffset = item.shapeStrokeDashOffset as number
  }

  if (draw && draw.end <= draw.start) {
    ctx.restore()
    return
  }

  const x0 = draw ? x + width * draw.start : x
  const x1 = draw ? x + width * draw.end : x + width
  const line = new Path2D()
  line.moveTo(x0, cy)
  line.lineTo(x1, cy)
  ctx.lineWidth = sw
  ctx.stroke(line)

  const head = item.shapeArrowHead
  if ((head === 'end' || head === 'both') && (!draw || draw.end >= 0.999)) {
    const length = Math.min(SHAPE_LIMITS.arrowHeadStrokeMultiple * sw, width / 2)
    ctx.fillStyle = strokeStyle
    const end = new Path2D()
    end.moveTo(x + width, cy)
    end.lineTo(x + width - length, cy - length / 2)
    end.lineTo(x + width - length, cy + length / 2)
    end.closePath()
    ctx.fill(end)
    if (head === 'both') {
      const start = new Path2D()
      start.moveTo(x, cy)
      start.lineTo(x + length, cy - length / 2)
      start.lineTo(x + length, cy + length / 2)
      start.closePath()
      ctx.fill(start)
    }
  }

  ctx.restore()
}

/** `path`: SVG art fitted (contained) into the box; paint spans the viewBox, not the box. */
function paintVectorPath(
  ctx: Shape2DContext,
  item: ActiveShapeClip,
  rect: DrawRect,
  sw: number,
  draw: DrawWindow | undefined,
  align: ShapeStrokeAlign,
  cap: ShapeStrokeCap | undefined,
  join: ShapeStrokeJoin | undefined,
  dash: number[] | undefined,
): void {
  const d = item.shapePath
  if (!d) return

  const vb = item.shapeViewBox ?? DEFAULT_SHAPE_VIEWBOX
  const vbX = finiteOr(vb.x, 0)
  const vbY = finiteOr(vb.y, 0)
  const vbW = finiteOr(vb.width, 0)
  const vbH = finiteOr(vb.height, 0)
  if (vbW <= 0 || vbH <= 0) return

  const fit = Math.min(rect.width / vbW, rect.height / vbH)
  if (!Number.isFinite(fit) || fit <= 0) return

  ctx.save()
  // MOT-8: the shear joins the rotation wrapper (rotate, then shear: CSS "rotate() skew()"). Absent, the calls are unchanged.
  const shear = rectShear(rect)
  const rotated = rect.rotation !== 0 || shear !== undefined
  if (rotated) {
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    ctx.translate(cx, cy)
    ctx.rotate(rect.rotation)
    applyShear(ctx, shear)
    ctx.translate(-cx, -cy)
  }
  ctx.translate(rect.x + (rect.width - vbW * fit) / 2, rect.y + (rect.height - vbH * fit) / 2)
  ctx.scale(fit, fit)
  ctx.translate(-vbX, -vbY)

  const box: PaintBox = { x: vbX, y: vbY, width: vbW, height: vbH }
  ctx.fillStyle = isPaint(item.shapeFillPaint) ? toCanvasPaint(ctx, item.shapeFillPaint, box) : item.shapeFill
  ctx.strokeStyle = isPaint(item.shapeStrokePaint) ? toCanvasPaint(ctx, item.shapeStrokePaint, box) : item.shapeStroke
  if (cap) ctx.lineCap = cap
  if (join) ctx.lineJoin = join
  if (dash) {
    ctx.setLineDash(dash.map((v) => v / fit))
    if (Number.isFinite(item.shapeStrokeDashOffset)) ctx.lineDashOffset = (item.shapeStrokeDashOffset as number) / fit
  }

  let path: Path2D
  try {
    path = new Path2D(d)
  } catch {
    // Invalid path data — render nothing, same as the legacy `paintPath`.
    ctx.restore()
    return
  }

  const rule = (item.shapeFillRule ?? 'nonzero') as ShapeFillRule
  const w = sw / fit

  if (draw) {
    ctx.lineWidth = w
    fillStrokeDrawing(ctx, draw, estimatePathLength(d), w, path, rule, shadowPlan(item, rect))
  } else {
    fillAndAlignedStroke(ctx, path, rule, w, align, () => {
      const pad = (OUTSIDE_CLIP_PAD_STROKES * sw + OUTSIDE_CLIP_PAD_PX) / fit
      const outer = new Path2D()
      outer.rect(box.x - pad, box.y - pad, box.width + 2 * pad, box.height + 2 * pad)
      outer.addPath(path)
      return outer
    }, shadowPlan(item, rect))
  }

  ctx.restore()
}

/**
 * The vector shape painter (PV-P6a): gradient/solid paint on fill and stroke,
 * dash, cap, join and stroke alignment. Only reached when `hasVectorStyle`
 * finds at least one of the seven new fields — a clip that sets none of them
 * never enters this function, which is what keeps every existing document
 * byte-identical.
 *
 * Every state write below sits inside this function's own `save`/`restore`,
 * because `ShapeLayer` paints every shape on one shared scratch canvas with
 * no `save`/`restore` of its own: a cap, join or dash left on the context
 * would otherwise leak into the next shape drawn on it.
 */
function paintVectorShape(
  ctx: Shape2DContext,
  item: ActiveShapeClip,
  stage: { width: number; height: number },
): void {
  if (typeof Path2D === 'undefined') return

  const rect = resolveShapeRect(item.transform, stage)
  const sw = finiteOr(item.shapeStrokeWidth, 0)
  const draw = activeDraw(item)
  // A draw-on owns the dash (it paints its own reveal pattern) and forces a
  // centred stroke (the doubled-width align strokes are not meaningful while
  // only part of the outline is visible).
  const dash = draw ? undefined : usableDash(item.shapeStrokeDash)
  const align = draw ? 'center' : resolveAlign(item.shapeStrokeAlign)
  const cap = resolveCap(item.shapeStrokeCap)
  const join = resolveJoin(item.shapeStrokeJoin)

  if (item.shapeKind === 'line') {
    paintVectorLine(ctx, item, rect, sw, draw, cap, join, dash)
  } else if (item.shapeKind === 'path') {
    paintVectorPath(ctx, item, rect, sw, draw, align, cap, join, dash)
  } else {
    paintVectorClosed(ctx, item, rect, sw, draw, align, cap, join, dash)
  }
}
