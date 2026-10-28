/**
 * Curve editor geometry (EDX-P6). Pure: frame/value ↔ pixel mapping, the
 * sampled path of a channel, bezier handle positions and their inverse. The
 * drawer component only wires pointer events to these.
 *
 * Coordinates: x is the TIMELINE's pixel space (frame × zoom − scrollLeft,
 * absolute frames, so the drawer lines up with the clips above it); y grows
 * downward from the top of the plot.
 */

import {
  allKeyedChannels,
  approxBezierFor,
  channelExpression,
  expressionChannels,
  formatColor,
  getEffectDefinition,
  isValidSpring,
  parseEffectChannel,
  sampleChannel,
  sampleChannelExpression,
  sampleColorChannel,
  type AnyKeyframeChannel,
  type Clip,
  type Keyframe,
  type Project,
} from '@elah/core'

export interface CurveView {
  /** Pixels per frame (the timeline zoom). */
  zoom: number
  /** Horizontal scroll of the lanes, in px. */
  scrollLeft: number
  /** Plot height in px. */
  height: number
  /** Padding above and below the value range, in px. */
  pad: number
  /** Value range drawn from the bottom (min) to the top (max). */
  min: number
  max: number
}

export interface Pt {
  x: number
  y: number
}

const BUILTIN_LABELS: Record<string, string> = {
  x: 'Position X',
  y: 'Position Y',
  scale: 'Scale',
  scaleX: 'Width',
  scaleY: 'Height',
  rotation: 'Rotation',
  opacity: 'Opacity',
  volume: 'Volume',
  cornerRadius: 'Corner radius',
  time: 'Time remap',
}

/** A human label for any channel: builtins, `fx.<id>.<param>`, `mask.<field>`. */
export function channelLabel(clip: Clip, channel: AnyKeyframeChannel): string {
  if (BUILTIN_LABELS[channel]) return BUILTIN_LABELS[channel]!
  const fx = parseEffectChannel(channel)
  if (fx) {
    const effect = clip.effects?.find((e) => e.id === fx.effectId)
    const def = effect ? getEffectDefinition(effect.kind) : undefined
    const param = def?.params[fx.param]?.label ?? fx.param
    return `${def?.label ?? 'Effect'} · ${param}`
  }
  if (channel.startsWith('mask.')) return `Mask ${channel.slice(5)}`
  return channel
}

export function frameToX(frame: number, v: Pick<CurveView, 'zoom' | 'scrollLeft'>): number {
  return frame * v.zoom - v.scrollLeft}

export function xToFrame(x: number, v: Pick<CurveView, 'zoom' | 'scrollLeft'>): number {
  return (x + v.scrollLeft) / v.zoom
}

export function valueToY(value: number, v: CurveView): number {
  const span = v.max - v.min || 1
  const usable = Math.max(1, v.height - v.pad * 2)
  return v.pad + (1 - (value - v.min) / span) * usable
}

export function yToValue(y: number, v: CurveView): number {
  const span = v.max - v.min || 1
  const usable = Math.max(1, v.height - v.pad * 2)
  return v.min + (1 - (y - v.pad) / usable) * span
}

/**
 * The value range to draw for a channel: every key plus the sampled curve
 * (so an overshoot stays in view), padded 10%. A flat channel gets a unit
 * window around its value so the line sits in the middle.
 */
export function valueRange(keys: ReadonlyArray<Keyframe>): { min: number; max: number } {
  if (keys.length === 0) return { min: 0, max: 1 }
  let min = Infinity
  let max = -Infinity
  const first = keys[0]!.frame
  const last = keys[keys.length - 1]!.frame
  const steps = Math.max(1, Math.min(400, last - first))
  for (let i = 0; i <= steps; i++) {
    const v = sampleChannel(keys, first + ((last - first) * i) / steps)
    if (v === undefined) continue
    min = Math.min(min, v)
    max = Math.max(max, v)
  }
  for (const k of keys) {
    min = Math.min(min, k.value)
    max = Math.max(max, k.value)
  }
  return paddedRange(min, max)
}

/**
 * The padding rule, shared with `samplesRange` so an expression curve and a
 * keyed curve are framed identically: a flat channel gets a unit-ish window so
 * the line sits in the middle, anything else is padded 10%.
 */
function paddedRange(min: number, max: number): { min: number; max: number } {
  if (!(max - min > 1e-9)) {
    const half = Math.max(0.5, Math.abs(min) * 0.25)
    return { min: min - half, max: max + half }
  }
  const pad = (max - min) * 0.1
  return { min: min - pad, max: max + pad }
}

/**
 * SVG path `d` for a channel between absolute frames `from`..`to`. Keys are
 * clip-relative; `clipStart` puts them on the timeline. Sampled every ~2px.
 */
export function curvePath(
  keys: ReadonlyArray<Keyframe>,
  clipStart: number,
  from: number,
  to: number,
  view: CurveView,
): string {
  if (keys.length === 0 || to <= from) return ''
  const pxSpan = (to - from) * view.zoom
  const steps = Math.max(2, Math.min(2000, Math.ceil(pxSpan / 2)))
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const f = from + ((to - from) * i) / steps
    const v = sampleChannel(keys, f - clipStart)
    if (v === undefined) continue
    const x = frameToX(f, view)
    const y = valueToY(v, view)
    d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
  }
  return d
}

/** The bezier driving the segment INTO `key` (its own, or an approximation of its named easing). */
export function segmentBezier(key: Keyframe): [number, number, number, number] {
  return key.easingBezier ? [...key.easingBezier] : approxBezierFor(key.easing)
}

/**
 * Handle points (frame, value) for the segment `a` → `b`, or null when the
 * segment cannot show handles (a hold, a spring (PV-P5a), or a flat segment
 * where y handles would change nothing).
 *
 * A spring has no bezier behind it — it is a damped oscillator, not four
 * control points — so there is nothing to drag. Returning null makes the drawer
 * draw the curve with no handles, and stops a drag from writing a bezier that
 * the sampler would ignore anyway.
 */
export function segmentHandles(a: Keyframe, b: Keyframe): { h1: { frame: number; value: number }; h2: { frame: number; value: number } } | null {
  if (a.hold) return null
  if (isValidSpring(b.spring)) return null
  const span = b.frame - a.frame
  const dv = b.value - a.value
  if (span <= 0 || Math.abs(dv) < 1e-9) return null
  const [x1, y1, x2, y2] = segmentBezier(b)
  return {
    h1: { frame: a.frame + x1 * span, value: a.value + y1 * dv },
    h2: { frame: a.frame + x2 * span, value: a.value + y2 * dv },
  }
}

/**
 * The bezier for segment `a` → `b` after one handle moved to (frame, value).
 * x is clamped to 0..1; y is free (overshoot). Returns null for a segment
 * without handles — including a spring segment, for the same reason as
 * `segmentHandles`: moving a handle there would silently replace the spring's
 * curve with a bezier the author never drew.
 */
export function bezierFromHandle(
  a: Keyframe,
  b: Keyframe,
  which: 1 | 2,
  frame: number,
  value: number,
): [number, number, number, number] | null {
  if (isValidSpring(b.spring)) return null
  const span = b.frame - a.frame
  const dv = b.value - a.value
  if (span <= 0 || Math.abs(dv) < 1e-9) return null
  const cur = segmentBezier(b)
  const x = Math.min(1, Math.max(0, (frame - a.frame) / span))
  const y = Math.min(4, Math.max(-3, (value - a.value) / dv))
  const round = (n: number) => Math.round(n * 1000) / 1000
  return which === 1 ? [round(x), round(y), cur[2], cur[3]] : [cur[0], cur[1], round(x), round(y)]
}

/** Snap a dragged key's frame to integers and its value to a step fitting the range. */
export function snapValue(value: number, range: { min: number; max: number }): number {
  const span = range.max - range.min
  const step = span > 100 ? 1 : span > 10 ? 0.1 : span > 1 ? 0.01 : 0.001
  return Math.round(value / step) * step
}

// ---------------------------------------------------------------------------
// Expression curves (PV-P5b-3)
// ---------------------------------------------------------------------------

/** One point of an expression's output, at an absolute timeline frame. */
export interface CurveSample {
  /** Absolute timeline frame. */
  frame: number
  value: number
}

/**
 * The channels the drawer lists: every channel with keys, in
 * `allKeyedChannels` order, then the expression-only ones.
 *
 * An expression channel may hold no keys at all, so `allKeyedChannels` alone
 * would hide a channel the author is actively driving — the drawer would look
 * broken for exactly the case it exists to explain.
 */
export function drawerChannels(clip: Clip): AnyKeyframeChannel[] {
  const out: AnyKeyframeChannel[] = [...allKeyedChannels(clip)]
  for (const c of expressionChannels(clip)) if (!out.includes(c)) out.push(c)
  return out
}

/**
 * The expression's output at integer absolute frames across `[from, to]`.
 *
 * Capped at `maxSamples` because the drawer redraws on every pointer move, and
 * an expression on a 3,000-frame clip is 3,000 evaluations per frame. Frames
 * whose evaluation fails are SKIPPED rather than plotted as gaps: a bad segment
 * should not punch a hole in the curve, and the error is already reported by the
 * resolver and the panel row.
 */
export function expressionSamples(
  project: Project,
  clip: Clip,
  channel: AnyKeyframeChannel,
  from: number,
  to: number,
  maxSamples = 600,
): CurveSample[] {
  const source = channelExpression(clip, channel)
  if (!source) return []
  const first = Math.ceil(from)
  const last = Math.floor(to)
  if (!(last >= first)) return []
  const step = Math.max(1, Math.ceil((to - from) / Math.max(1, maxSamples)))
  const out: CurveSample[] = []
  for (let f = first; f <= last; f += step) {
    const r = sampleChannelExpression(project, clip, channel, f - clip.startFrame)
    if (r.value === undefined) continue
    out.push({ frame: f, value: r.value })
  }
  return out
}

/** min/max of the samples, with `valueRange`'s padding rules; null when empty. */
export function samplesRange(samples: ReadonlyArray<CurveSample>): { min: number; max: number } | null {
  if (samples.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const s of samples) {
    if (s.value < min) min = s.value
    if (s.value > max) max = s.value
  }
  return paddedRange(min, max)
}

/** Union of two ranges; `{0, 1}` when neither exists — a unit window to plot into. */
export function unionRange(
  a: { min: number; max: number } | null,
  b: { min: number; max: number } | null,
): { min: number; max: number } {
  if (!a && !b) return { min: 0, max: 1 }
  if (!a) return b!
  if (!b) return a
  return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) }
}

/** `M x,y L x,y …` through the samples, in the same number format as `curvePath`. */
export function samplesPath(samples: ReadonlyArray<CurveSample>, view: CurveView): string {
  if (samples.length === 0) return ''
  let d = ''
  for (const s of samples) {
    d += `${d ? 'L' : 'M'}${frameToX(s.frame, view).toFixed(1)},${valueToY(s.value, view).toFixed(1)}`
  }
  return d
}

// ---------------------------------------------------------------------------
// Typed (colour/path) channels — PV-P5c-2
// ---------------------------------------------------------------------------

/** One sampled swatch of a colour strip: a pixel span and its CSS colour. */
export interface ColorStripCell {
  x: number
  width: number
  color: string
}

/**
 * The drawer's colour strip for a `vec`-keyed channel (`color`, `shape.fill`,
 * `shape.stroke`): the channel's colour sampled every `cellPx` across the
 * visible `[from, to]` window (absolute frames; keys are clip-relative
 * against `clipStart`), as discrete cells rather than a CSS gradient string —
 * a strip is drawn the same way the drawer already draws everything else,
 * with plain positioned rects.
 *
 * `keys` must already be `vec`-only (`normalizeVecKeys`'d); this stays a thin
 * sampling/layout function, not a filter.
 */
export function colorStripCells(
  keys: ReadonlyArray<Keyframe>,
  clipStart: number,
  from: number,
  to: number,
  view: Pick<CurveView, 'zoom' | 'scrollLeft'>,
  cellPx = 4,
): ColorStripCell[] {
  if (keys.length === 0 || to <= from || cellPx <= 0) return []
  const x0 = frameToX(from, view)
  const x1 = frameToX(to, view)
  const widthPx = x1 - x0
  if (widthPx <= 0) return []
  const count = Math.max(1, Math.ceil(widthPx / cellPx))
  const cells: ColorStripCell[] = []
  for (let i = 0; i < count; i++) {
    const cellX = x0 + i * cellPx
    const cellW = Math.min(cellPx, x1 - cellX)
    if (cellW <= 0) break
    const centerFrame = xToFrame(cellX + cellW / 2, view)
    const vec = sampleColorChannel(keys, centerFrame - clipStart)
    if (!vec) continue
    cells.push({ x: cellX, width: cellW, color: formatColor(vec) })
  }
  return cells
}
