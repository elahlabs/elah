/**
 * The one paint helper (PV-P4c): a `Paint` in, a canvas fill out.
 *
 * DOM-free and shared by the preview and the export worker, exactly as
 * `textPaint` is. Nothing here mutates the paint it is given: the document's
 * stops are sorted into a COPY, so painting a clip can never reorder the rows a
 * user is dragging in the Style tab.
 *
 * The geometry is CSS `linear-gradient` geometry, not a hand-rolled guess. That
 * matters because a gradient that does not reach both corners shows a band of the
 * end colour outside the glyphs, which reads as a mistake in the artwork rather
 * than in the maths.
 */
import type { Paint, PaintStop, TextShadow } from '../../../types'

/** The 2D surface both HTML and Offscreen canvases provide. */
export type PaintContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** The box a gradient spans, in the caller's current coordinate space. */
export interface PaintBox {
  x: number
  y: number
  width: number
  height: number
}

const TRANSPARENT = 'rgba(0,0,0,0)'

/**
 * True for a well-formed Paint.
 *
 * Documents are DATA: a hand-edited, truncated or AI-authored project can put
 * anything in `textFill`, and a painter that destructures without checking turns
 * a bad document into a thrown exception mid-frame — which in the export worker
 * is a failed video, not a warning. Every painter checks first.
 */
export function isPaint(value: unknown): value is Paint {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  if (p.type === 'solid') return typeof p.color === 'string'
  if (p.type === 'linear') return Number.isFinite(p.angle) && Array.isArray(p.stops)
  if (p.type === 'radial') {
    return [p.cx, p.cy, p.r].every((n) => Number.isFinite(n)) && Array.isArray(p.stops)
  }
  if (p.type === 'conic') {
    return [p.angle, p.cx, p.cy].every((n) => Number.isFinite(n)) && Array.isArray(p.stops)
  }
  return false
}

/**
 * Valid stops, offsets clamped to 0..1, sorted by offset — a COPY.
 *
 * Sorting a copy is the whole design of this function. `addColorStop` requires
 * non-decreasing offsets and THROWS otherwise, so an unsorted document would
 * otherwise throw mid-paint; and the caller's array is left exactly as it was,
 * because the Style tab's stop rows are bound to it by index.
 */
function sortedStops(stops: readonly PaintStop[]): PaintStop[] {
  return stops
    .filter((s) => s && typeof s.color === 'string' && Number.isFinite(s.offset))
    .map((s) => ({ offset: Math.min(1, Math.max(0, s.offset)), color: s.color }))
    .sort((a, b) => a.offset - b.offset)
}

/**
 * The gradient line `toCanvasPaint` uses for a linear Paint in `box` — CSS
 * `linear-gradient` geometry: the line through the box centre, long enough
 * that the box's extreme corner lands exactly on offset 0 and the opposite
 * one on offset 1. Exported (PV-P6b-3) so the SVG/Lottie importers can invert
 * this same construction to recover an angle from two gradient-space points.
 */
export function linearGradientPoints(
  angleDeg: number,
  box: PaintBox,
): { x0: number; y0: number; x1: number; y1: number } {
  const a = (angleDeg * Math.PI) / 180
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  const half = (Math.abs(box.width * dx) + Math.abs(box.height * dy)) / 2
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  return { x0: cx - dx * half, y0: cy - dy * half, x1: cx + dx * half, y1: cy + dy * half }
}

/**
 * A canvas fill for `paint` over `box`.
 *
 * The caller's current transform applies, so a gradient created inside a rotated
 * `save()` turns WITH the content — which is the behaviour a rotated title needs
 * and the reason this must be called at the point `fillStyle` is assigned rather
 * than earlier.
 *
 * Degenerate cases return a plain colour instead of a gradient, because
 * `createLinearGradient` with coincident points and `createRadialGradient` with a
 * zero radius both throw `IndexSizeError`:
 *   - fewer than two stops: nothing to interpolate between, so the last stop's
 *     colour is the honest answer (zero stops: transparent, since there is no
 *     colour at all to fall back to).
 *   - a zero-area box: the gradient line would have zero length.
 */
export function toCanvasPaint(ctx: PaintContext, paint: Paint, box: PaintBox): string | CanvasGradient {
  if (paint.type === 'solid') return paint.color

  const stops = sortedStops(paint.stops)
  if (stops.length === 0) return TRANSPARENT
  const last = stops[stops.length - 1]!.color
  if (stops.length === 1) return last

  let gradient: CanvasGradient
  if (paint.type === 'linear') {
    const { x0, y0, x1, y1 } = linearGradientPoints(paint.angle, box)
    const half = Math.hypot(x1 - x0, y1 - y0) / 2
    if (!(half > 1e-6)) return last
    gradient = ctx.createLinearGradient(x0, y0, x1, y1)
  } else if (paint.type === 'conic') {
    // A context without `createConicGradient` (older Offscreen implementations,
    // test doubles) gets the honest degenerate answer rather than a throw.
    if (typeof ctx.createConicGradient !== 'function') return last
    // CSS `from <angle>` counts clockwise from 12 o'clock; Canvas counts
    // clockwise from 3 o'clock. Same direction, quarter-turn apart.
    const start = ((paint.angle - 90) * Math.PI) / 180
    gradient = ctx.createConicGradient(start, box.x + paint.cx * box.width, box.y + paint.cy * box.height)
  } else {
    const radius = (paint.r * Math.hypot(box.width, box.height)) / 2
    if (!(radius > 1e-6)) return last
    const px = box.x + paint.cx * box.width
    const py = box.y + paint.cy * box.height
    gradient = ctx.createRadialGradient(px, py, 0, px, py, radius)
  }

  for (const stop of stops) {
    try {
      gradient.addColorStop(stop.offset, stop.color)
    } catch {
      // An unparsable colour throws SyntaxError. Skipping that ONE stop keeps the
      // rest of the gradient; letting it propagate would blank the whole title.
    }
  }
  return gradient
}

/**
 * A shadow the canvas can use, or `undefined`. Documents are data: a hand-edited
 * or AI-authored clip can carry anything under `shadow`, and a non-string colour
 * or a NaN offset must read as "no shadow", not as a throw mid-frame.
 */
export function usableShadow(value: unknown): TextShadow | undefined {
  if (!value || typeof value !== 'object') return undefined
  const s = value as Record<string, unknown>
  if (typeof s.color !== 'string') return undefined
  if (![s.blur, s.offsetX, s.offsetY].every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined
  return value as TextShadow
}

/**
 * Turn the context's shadow on for the NEXT fill (MC-1d). Canvas shadow offsets
 * are device-space and ignore the current transform, so for a clip painted
 * rotated the offset is rotated by `rotation` here, which is what CSS does for
 * a transformed element's `box-shadow`. Pair with `clearShadow` right after the
 * fill: the shadow is state, and the scratch canvas is shared by every clip.
 */
export function applyShadow(ctx: PaintContext, shadow: TextShadow, rotation = 0): void {
  const cos = rotation === 0 ? 1 : Math.cos(rotation)
  const sin = rotation === 0 ? 0 : Math.sin(rotation)
  // The element's rotation turns the offset first; the output scale then sizes it.
  const { x: kx, y: ky } = outputScale
  ctx.shadowColor = shadow.color
  ctx.shadowBlur = scaledBlur(Math.max(0, shadow.blur))
  ctx.shadowOffsetX = (shadow.offsetX * cos - shadow.offsetY * sin) * kx
  ctx.shadowOffsetY = (shadow.offsetX * sin + shadow.offsetY * cos) * ky
}

/**
 * The scale the caller drew under when it handed the context to a painter
 * (EXP-2). Canvas `shadowBlur` and `shadowOffset*` are in device pixels and
 * ignore the current transform, so the export, which paints in stage units under
 * one output-scale transform, would otherwise shadow at stage size while
 * everything else scales. The preview paints at an identity transform, where
 * this is 1 and every value is exactly what it was.
 *
 * It is read ONCE, at the painter's entry (`paintingAtOutputScale`), not at the
 * shadow: painters apply their own `ctx.scale` (a path fitted to its box, a
 * stretched text block) and those must not leak into a shadow that ignores them.
 */
let outputScale: { x: number; y: number } = { x: 1, y: 1 }
const IDENTITY_SCALE = outputScale

function scaledBlur(blur: number): number {
  return outputScale === IDENTITY_SCALE ? blur : blur * ((outputScale.x + outputScale.y) / 2)
}

/** Blur for a shadow a painter writes itself (see `applyShadow` for the rest). */
export function shadowBlurAtScale(blur: number): number {
  return scaledBlur(Math.max(0, blur))
}

/** Offset for a shadow a painter writes itself. */
export function shadowOffsetAtScale(offsetX: number, offsetY: number): { x: number; y: number } {
  return outputScale === IDENTITY_SCALE ? { x: offsetX, y: offsetY } : { x: offsetX * outputScale.x, y: offsetY * outputScale.y }
}

/**
 * Run `paint` with the context's current scale taken as the output scale for
 * its shadows. A context without `getTransform` (a test double), a skewed or
 * degenerate one, or a scale of exactly 1 is the identity.
 */
export function paintingAtOutputScale<T>(ctx: PaintContext, paint: () => T): T {
  const previous = outputScale
  outputScale = readScale(ctx)
  try {
    return paint()
  } finally {
    outputScale = previous
  }
}

function readScale(ctx: PaintContext): { x: number; y: number } {
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : undefined
  if (!t) return IDENTITY_SCALE
  const x = Math.hypot(t.a, t.b)
  const y = Math.hypot(t.c, t.d)
  if (!(x > 0) || !(y > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return IDENTITY_SCALE
  return x === 1 && y === 1 ? IDENTITY_SCALE : { x, y }
}

/** Undo `applyShadow`. */
export function clearShadow(ctx: PaintContext): void {
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

/** Stable cache key for a paint; `''` when absent, so it can be appended to a signature unconditionally. */
export function paintSignature(paint: Paint | undefined): string {
  if (!paint) return ''
  const stops = (list: readonly PaintStop[]): string => list.map((s) => `${s.offset}@${s.color}`).join(',')
  switch (paint.type) {
    case 'solid':
      return `s:${paint.color}`
    case 'linear':
      return `l:${paint.angle}:${stops(paint.stops)}`
    case 'radial':
      return `r:${paint.cx}:${paint.cy}:${paint.r}:${stops(paint.stops)}`
    case 'conic':
      return `c:${paint.angle}:${paint.cx}:${paint.cy}:${stops(paint.stops)}`
  }
}
