/**
 * elements/shape.ts — a `shape` spec element -> a `Clip` literal (AV-1).
 *
 * Lowers the spec's two conveniences the engine does not know:
 *   - `ellipse` -> `circle`. No extra work needed: the box this file builds
 *     already carries `scaleX`/`scaleY` from `w`/`h`, and a non-square circle
 *     IS an ellipse (`ShapeVariant`'s own doc comment).
 *   - `arc` -> `circle`, forced transparent fill, and rotated -90 degrees so
 *     the `draw` sweep starts at twelve o'clock instead of three. The sweep
 *     itself is the element's own `draw` field, handled identically to any
 *     other shape's.
 */

import type { Clip, Paint, ShapeViewBox } from '../../types'
import { setKeyframe, type BaselineContext } from '../../elements/keyframes'
import { resolveCurve } from '../curves'
import { clampIssue, toFrames } from '../units'
import type { SpecElement, SpecPaint, SpecShape } from '../types'
import { applyEffectsAndBlend, applyMotionAndKeyframes, baseClip, buildLayout, buildTransform, resolveColor, type BuildContext } from './common'

const SIDES_RANGE: readonly [number, number] = [3, 12]
/** SVG `d` user space the spec's `path` shape defaults to — the icon convention, not the engine's own `0 0 100 100`. */
const DEFAULT_PATH_VIEWBOX: ShapeViewBox = { x: 0, y: 0, width: 24, height: 24 }
const ARC_ROTATION_RAD = -Math.PI / 2

function baselineCtx(ctx: BuildContext): BaselineContext {
  return { stage: ctx.stage }
}

/** A colour or gradient -> the legacy solid string plus the typed `Paint`, so both the swatch and the gradient painter agree. */
function resolvePaintField(
  value: string | SpecPaint | undefined,
  ctx: BuildContext,
  path: string,
): { legacy?: string; paint?: Paint } {
  if (value === undefined) return {}
  if (typeof value === 'string') {
    const color = resolveColor(value, ctx, path)
    return color === undefined ? {} : { legacy: color, paint: { type: 'solid', color } }
  }
  if (value.type === 'linear') {
    return { paint: { type: 'linear', angle: value.angle, stops: value.stops.map((s) => ({ offset: s.offset, color: s.color })) } }
  }
  return { paint: { type: 'radial', cx: value.cx, cy: value.cy, r: value.r, stops: value.stops.map((s) => ({ offset: s.offset, color: s.color })) } }
}

function shapeKindFor(shape: SpecShape): Clip['shapeKind'] {
  if (shape === 'ellipse') return 'circle'
  if (shape === 'arc') return 'circle'
  return shape as Clip['shapeKind']
}

/** `SpecDraw` -> `shapeDraw` (static, always `{0,1}` per `applyDrawOn`'s own convention) plus animated `draw` channel keys. */
function applyDraw(clip: Clip, el: SpecElement, ctx: BuildContext, path: string): Clip {
  const draw = el.draw
  if (!draw) return clip
  const from = draw.from ?? 0
  const to = draw.to ?? 1
  const atFrame = Math.max(0, toFrames(draw.at ?? 0, ctx.fps))
  const last = Math.max(0, clip.durationFrames - 1)
  const endFrame = Math.min(
    last,
    Math.max(atFrame, draw.duration === undefined ? last : atFrame + toFrames(draw.duration, ctx.fps)),
  )
  const curve = resolveCurve(draw.curve, `${path}.draw.curve`, ctx.issues)
  const bCtx = baselineCtx(ctx)
  let working = clip
  working = { ...working, ...setKeyframe(working, 'draw', atFrame, bCtx, from, { easing: 'linear' }) }
  working = {
    ...working,
    ...setKeyframe(working, 'draw', endFrame, bCtx, to, {
      easing: curve.easing,
      ...(curve.easingBezier ? { easingBezier: [...curve.easingBezier] as [number, number, number, number] } : {}),
      ...(curve.spring ? { spring: curve.spring } : {}),
    }),
  }
  working.shapeDraw = { start: 0, end: 1 }
  return working
}

export function buildShapeClip(
  el: SpecElement,
  input: { id: string; trackId: string; startFrame: number; durationFrames: number },
  ctx: BuildContext,
  path: string,
): Clip {
  const shape = el.shape ?? 'rect'
  const isArc = shape === 'arc'
  const w = el.w ?? 100
  const h = el.h ?? 100
  const transform = buildTransform(el, ctx, path, { w, h })
  if (isArc) transform.rotation += ARC_ROTATION_RAD

  let clip: Clip = {
    ...baseClip({ ...input, type: 'shape', name: el.name ?? shape, transform }, el, ctx, path),
    shapeKind: shapeKindFor(shape),
  }

  if (isArc) {
    clip.shapeFill = 'transparent'
    const stroke = resolvePaintField(el.stroke, ctx, `${path}.stroke`)
    if (stroke.legacy) clip.shapeStroke = stroke.legacy
    if (stroke.paint) clip.shapeStrokePaint = stroke.paint
  } else {
    const fill = resolvePaintField(el.fill, ctx, `${path}.fill`)
    if (fill.legacy) clip.shapeFill = fill.legacy
    if (fill.paint) clip.shapeFillPaint = fill.paint
    const stroke = resolvePaintField(el.stroke, ctx, `${path}.stroke`)
    if (stroke.legacy) clip.shapeStroke = stroke.legacy
    if (stroke.paint) clip.shapeStrokePaint = stroke.paint
  }
  if (el.strokeWidth !== undefined) clip.shapeStrokeWidth = el.strokeWidth
  if (el.dash) clip.shapeStrokeDash = el.dash
  if (el.cap) clip.shapeStrokeCap = el.cap as Clip['shapeStrokeCap']
  if (el.join) clip.shapeStrokeJoin = el.join as Clip['shapeStrokeJoin']

  if (shape === 'polygon') {
    clip.shapeSides = Math.round(clampIssue(el.sides ?? 5, SIDES_RANGE[0], SIDES_RANGE[1], `${path}.sides`, ctx.issues))
    if (el.innerRatio !== undefined) clip.shapeInnerRatio = el.innerRatio
  }

  if (shape === 'rect' && el.radius !== undefined) {
    const shortSide = Math.max(1, Math.min(w, h))
    clip.cornerRadius = clampIssue(el.radius / shortSide, 0, 0.5, `${path}.radius`, ctx.issues)
  }

  if (shape === 'path') {
    if (el.path) clip.shapePath = el.path
    clip.shapeViewBox = el.viewBox ?? DEFAULT_PATH_VIEWBOX
  }

  const layout = buildLayout(el.layout, ctx, path)
  if (layout) clip.layout = layout

  clip = applyDraw(clip, el, ctx, path)
  clip = applyMotionAndKeyframes(clip, el, ctx, path)
  clip = applyEffectsAndBlend(clip, el, ctx, path)
  return clip
}
