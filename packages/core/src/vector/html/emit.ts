/**
 * Measured scene → ONE compound clip (MC-1a; plan section 5, step 4). Pure: the
 * browser has already done layout (`measureScene` in the host application), so every input
 * here is an absolute box in stage px, a pre-broken text line list, or a
 * resolved style string.
 *
 * Shape of the output: the scene compound holds the scene's own layers
 * bottom-to-top; a node with children becomes a nested compound whose child
 * stage is the node's box, so the clip tree mirrors the HTML tree. Z-order is
 * track order (later = higher), with `z-index` sorting siblings.
 */

import type { Clip, ClipMask, BlendMode, FontWeight, Paint, Project, TextBox, Transform, TextShadow, TextOutline } from '../../types'
import { createTextClip } from '../../elements/text'
import { createShapeClip } from '../../elements/shape'
import { createImageClip } from '../../elements/image'
import { getFont } from '../../fonts/registry'
import { parseCssColor } from '../color'
import { projectFromClips, compoundClipFor } from '../importClip'
import { svgToProject } from '../svg/svgToProject'
import { resolveShapeRect } from '../../renderer/gpu/layers/shapePaint'
import { cssGradientToPaint } from './cssGradient'
import { motionPatch, parseMotion, resolveLabels, staggerSpec, type MotionClause } from './motion'
import { nearestFontId, resolveFontId } from './validate'
import type { MeasuredBox, MeasuredNode, MeasuredScene, MeasuredStyle, SceneReport, SceneViolation } from './types'

export interface FontLookup {
  /** The bundled id for a family name or id, or undefined. */
  resolve(family: string): string | undefined
  /** The nearest bundled id, by role. */
  nearest(family: string): string
  /** The weights the family ships. */
  weights(id: string): number[]
}

export const bundledFonts: FontLookup = {
  resolve: resolveFontId,
  nearest: nearestFontId,
  weights: (id) => [...new Set(getFont(id)?.files.map((f) => f.weight) ?? [400])].sort((a, b) => a - b),
}

export interface EmitOptions {
  fps: number
  /** Default: the bundled registry. */
  fonts?: FontLookup
}

interface Size {
  width: number
  height: number
}
interface Point {
  x: number
  y: number
}

/**
 * A container at depth d (children of the scene are depth 1) opens a project at level d + 1; the engine's
 * cap is `MAX_COMPOUND_DEPTH` (4) and an inline svg may still need levels of its own below it.
 */
const MAX_NESTED_CONTAINERS = 2

const ENGINE_BLEND: Record<string, BlendMode> = {
  normal: 'normal',
  screen: 'screen',
  multiply: 'multiply',
  overlay: 'overlay',
  'soft-light': 'softLight',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  'plus-lighter': 'add',
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface Ctx {
  fps: number
  fonts: FontLookup
  durationFrames: number
  native: number
  skipped: Map<string, number>
  substitutions: Map<string, string>
  parts: Array<{ id: string; name: string }>
  violations: SceneViolation[]
  /** MOT-6: scene-wide label positions in seconds. */
  labels: ReadonlyMap<string, number>
}

function skip(ctx: Ctx, feature: string, n = 1): void {
  ctx.skipped.set(feature, (ctx.skipped.get(feature) ?? 0) + n)
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

const NUM = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)'

function px(s: string | undefined, ref = 0): number | null {
  if (s === undefined) return null
  const m = new RegExp(`^(${NUM})(px|%)?$`).exec(s.trim())
  if (!m) return null
  const n = parseFloat(m[1])
  return m[2] === '%' ? (n / 100) * ref : n
}

function isTransparent(color: string | undefined): boolean {
  if (color === undefined) return true
  const c = parseCssColor(color)
  return c !== null && c.a === 0
}

function isGradient(s: string | undefined): s is string {
  return s !== undefined && /gradient\(/i.test(s)
}

function parseTranslate(s: string | undefined): Point {
  if (!s || s === 'none') return { x: 0, y: 0 }
  const parts = s.trim().split(/\s+/)
  return { x: px(parts[0]) ?? 0, y: px(parts[1]) ?? 0 }
}

function parseRotate(s: string | undefined): number {
  if (!s || s === 'none') return 0
  const m = new RegExp(`^(${NUM})(deg|rad|turn|grad)?$`).exec(s.trim())
  if (!m) return 0
  const n = parseFloat(m[1])
  switch (m[2]) {
    case 'rad':
      return n
    case 'turn':
      return n * 2 * Math.PI
    case 'grad':
      return (n * Math.PI) / 200
    default:
      return (n * Math.PI) / 180
  }
}

function parseScale(s: string | undefined): { x: number; y: number } {
  if (!s || s === 'none') return { x: 1, y: 1 }
  const parts = s.trim().split(/\s+/).map(parseFloat)
  const x = Number.isFinite(parts[0]) ? parts[0] : 1
  const y = parts[1] !== undefined && Number.isFinite(parts[1]) ? parts[1] : x
  return { x, y }
}

function parseOrigin(s: string | undefined, w: number, h: number): Point {
  const centre = { x: w / 2, y: h / 2 }
  if (!s) return centre
  const parts = s.trim().split(/\s+/)
  const axis = (t: string | undefined, size: number, lo: string, hi: string): number | null => {
    if (t === undefined || t === 'center') return size / 2
    if (t === lo) return 0
    if (t === hi) return size
    return px(t, size)
  }
  return { x: axis(parts[0], w, 'left', 'right') ?? centre.x, y: axis(parts[1], h, 'top', 'bottom') ?? centre.y }
}

function hasStaticXform(st: MeasuredStyle): boolean {
  return (
    (st.translate !== undefined && st.translate !== 'none') ||
    (st.rotate !== undefined && st.rotate !== 'none') ||
    (st.scale !== undefined && st.scale !== 'none')
  )
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

interface Placement {
  x: number
  y: number
  anchor: Point
  rotation: number
  sx: number
  sy: number
}

/** Position of the node's box in its parent's stage, with the static translate/rotate/scale folded in. */
function place(box: MeasuredBox, st: MeasuredStyle, origin: Point, parent: Size): Placement {
  const o = parseOrigin(st.transformOrigin, box.width, box.height)
  const t = parseTranslate(st.translate)
  const s = parseScale(st.scale)
  return {
    x: (box.x - origin.x + o.x + t.x) / parent.width,
    y: (box.y - origin.y + o.y + t.y) / parent.height,
    anchor: { x: box.width === 0 ? 0.5 : o.x / box.width, y: box.height === 0 ? 0.5 : o.y / box.height },
    rotation: parseRotate(st.rotate),
    sx: s.x,
    sy: s.y,
  }
}

/** The placement re-expressed about the box centre (clips that always rotate and scale about their middle). */
function aboutCentre(p: Placement, box: MeasuredBox, parent: Size): Placement {
  return {
    ...p,
    x: p.x - ((p.anchor.x - 0.5) * box.width) / parent.width,
    y: p.y - ((p.anchor.y - 0.5) * box.height) / parent.height,
    anchor: { x: 0.5, y: 0.5 },
  }
}

/** Transform for clips whose size is in native px (text, compound, natural-size image): scale 1 = their own size. */
function nativeTransform(p: Placement): Transform {
  return {
    x: p.x,
    y: p.y,
    scale: p.sx,
    rotation: p.rotation,
    anchor: p.anchor,
    ...(p.sy !== p.sx ? { scaleY: p.sy / p.sx } : {}),
  }
}

/** Transform for a shape clip: it is `scale × short side × scaleX/Y` wide. */
function shapeTransform(p: Placement, w: number, h: number, parent: Size): Transform {
  const short = Math.min(parent.width, parent.height)
  const ref = Math.max(w, h)
  const scale = ref === 0 || short === 0 ? 0 : (ref / short) * p.sx
  return {
    x: p.x,
    y: p.y,
    scale,
    rotation: p.rotation,
    anchor: p.anchor,
    scaleX: ref === 0 ? 1 : w / ref,
    scaleY: ref === 0 || p.sx === 0 ? 1 : (p.sy * h) / (p.sx * ref),
  }
}

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------

function roundedRectPath(w: number, h: number, r: number | readonly [number, number, number, number]): string {
  const clamp = (v: number): number => Math.max(0, Math.min(v, w / 2, h / 2))
  const [tl, tr, br, bl] = typeof r === 'number' ? [clamp(r), clamp(r), clamp(r), clamp(r)] : (r.map(clamp) as [number, number, number, number])
  const f = (n: number): string => String(Math.round(n * 1000) / 1000)
  return [
    `M ${f(tl)} 0`,
    `H ${f(w - tr)}`,
    `A ${f(tr)} ${f(tr)} 0 0 1 ${f(w)} ${f(tr)}`,
    `V ${f(h - br)}`,
    `A ${f(br)} ${f(br)} 0 0 1 ${f(w - br)} ${f(h)}`,
    `H ${f(bl)}`,
    `A ${f(bl)} ${f(bl)} 0 0 1 0 ${f(h - bl)}`,
    `V ${f(tl)}`,
    `A ${f(tl)} ${f(tl)} 0 0 1 ${f(tl)} 0`,
    'Z',
  ].join(' ')
}

function anyRadius(r: number | readonly number[]): boolean {
  return typeof r === 'number' ? r > 0 : r.some((n) => n > 0)
}

/** A rect mask over a sub-rect (px, relative to the clip's draw box `w × h`), rounded when `radius` > 0. */
function rectMask(sub: MeasuredBox, w: number, h: number, radius: number | readonly [number, number, number, number]): ClipMask {
  if (anyRadius(radius)) {
    return {
      kind: 'path',
      x: sub.x / w,
      y: sub.y / h,
      width: sub.width / w,
      height: sub.height / h,
      path: roundedRectPath(sub.width, sub.height, radius),
      viewBox: { x: 0, y: 0, width: sub.width, height: sub.height },
    }
  }
  return { kind: 'rect', x: sub.x / w, y: sub.y / h, width: sub.width / w, height: sub.height / h }
}

function splitArgs(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean)
}

/** `clip-path` → a mask over the box `w × h`, or null (unparseable). */
function clipPathMask(css: string, w: number, h: number): ClipMask | null {
  const m = /^([a-z-]+)\(([\s\S]*)\)$/i.exec(css.trim())
  if (!m) return null
  const fn = m[1].toLowerCase()
  const body = m[2]
  if (fn === 'inset') {
    const [lens, round] = body.split(/\sround\s/i)
    const v = splitArgs(lens)
    const get = (i: number, ref: number): number | null => px(v[i], ref)
    const t = get(0, h)
    const r = v.length > 1 ? get(1, w) : t
    const b = v.length > 2 ? get(2, h) : t
    const l = v.length > 3 ? get(3, w) : r
    if (t === null || r === null || b === null || l === null) return null
    const radius = round ? (px(splitArgs(round)[0], Math.min(w, h)) ?? 0) : 0
    return rectMask({ x: l, y: t, width: w - l - r, height: h - t - b }, w, h, radius)
  }
  if (fn === 'circle' || fn === 'ellipse') {
    const [shape, at] = body.split(/\sat\s/i)
    const v = splitArgs(shape ?? '')
    let rx: number | null
    let ry: number | null
    if (fn === 'circle') {
      rx = v.length === 0 ? Math.min(w, h) / 2 : px(v[0], Math.sqrt((w * w + h * h) / 2))
      ry = rx
    } else {
      rx = v.length === 0 ? w / 2 : px(v[0], w)
      ry = v.length === 0 ? h / 2 : px(v[1], h)
    }
    if (rx === null || ry === null) return null
    const c = splitArgs(at ?? '')
    const pos = (t: string | undefined, size: number): number | null =>
      t === undefined || t === 'center' ? size / 2 : t === 'left' || t === 'top' ? 0 : t === 'right' || t === 'bottom' ? size : px(t, size)
    const cx = pos(c[0], w)
    const cy = pos(c[1], h)
    if (cx === null || cy === null) return null
    return { kind: 'ellipse', x: (cx - rx) / w, y: (cy - ry) / h, width: (2 * rx) / w, height: (2 * ry) / h }
  }
  if (fn === 'path') {
    const d = /["']([^"']+)["']/.exec(body)
    if (!d) return null
    return { kind: 'path', x: 0, y: 0, width: 1, height: 1, path: d[1], viewBox: { x: 0, y: 0, width: w, height: h } }
  }
  return null
}

/** The mask a node's `clip-path` / `overflow:hidden` asks for over its own box, if any. */
function boxMask(ctx: Ctx, node: MeasuredNode): ClipMask | undefined {
  const st = node.style
  const { width: w, height: h } = node.box
  if (w <= 0 || h <= 0) return undefined
  if (st.clipPath && st.clipPath !== 'none') {
    const m = clipPathMask(st.clipPath, w, h)
    if (m) return m
    skip(ctx, `clip-path:${st.clipPath.split('(')[0]}`)
  }
  if (st.overflowHidden) {
    const radii = cornerRadii(st)
    return rectMask({ x: 0, y: 0, width: w, height: h }, w, h, radii.four ?? radii.uniform)
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Clip assembly
// ---------------------------------------------------------------------------

function nodeName(node: MeasuredNode, index: number): string {
  if (node.id && node.id !== '') return node.id
  if (node.children.length > 0) {
    // An unnamed container reads as a group in the report, never as a tag and an index (MC-1f).
    const named = node.children.find((c) => c.id && c.id !== '')
    return named ? `${named.id}-group` : `group-${index}`
  }
  return `${node.tag}${index}`
}

/** Opacity, blend and mask: the properties every node kind shares. */
function commonProps(ctx: Ctx, node: MeasuredNode, clip: Clip, withMask: boolean): Clip {
  const st = node.style
  let out = clip
  if (st.opacity !== undefined && st.opacity !== 1) out = { ...out, opacity: Math.min(1, Math.max(0, st.opacity)) }
  if (st.mixBlendMode && st.mixBlendMode !== 'normal') {
    const mode = ENGINE_BLEND[st.mixBlendMode]
    if (mode) out = { ...out, blend: mode }
    else skip(ctx, `mix-blend-mode:${st.mixBlendMode}`)
  }
  if (withMask) {
    const mask = boxMask(ctx, node)
    if (mask) out = { ...out, mask }
  }
  return out
}

function snapWeight(weights: number[], want: number): number {
  let best = weights[0] ?? 400
  for (const w of weights) if (Math.abs(w - want) < Math.abs(best - want) || (Math.abs(w - want) === Math.abs(best - want) && w > best)) best = w
  return best
}

function parseShadow(ctx: Ctx, s: string | undefined, feature = 'text-shadow'): TextShadow | undefined {
  if (!s || s === 'none') return undefined
  const layers: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      layers.push(cur)
      cur = ''
    } else cur += ch
  }
  layers.push(cur)
  if (layers.length > 1) skip(ctx, `${feature}-layers`, layers.length - 1)
  const tokens: string[] = []
  depth = 0
  cur = ''
  for (const ch of layers[0].trim()) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (/\s/.test(ch) && depth === 0) {
      if (cur) tokens.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) tokens.push(cur)
  if (tokens.some((t) => t.toLowerCase() === 'inset')) {
    skip(ctx, `${feature}-inset`)
    return undefined
  }
  const colorTok = tokens.find((t) => parseCssColor(t) !== null)
  const lens = tokens.filter((t) => t !== colorTok).map((t) => px(t))
  if (!colorTok || lens.length < 2 || lens.some((n) => n === null)) {
    skip(ctx, feature)
    return undefined
  }
  // A fourth length is a spread; the painter has none (the validator only lets 0 through).
  if (feature === 'box-shadow' && lens.length > 3 && lens[3] !== 0) skip(ctx, 'box-shadow-spread')
  return { color: colorTok, offsetX: lens[0] as number, offsetY: lens[1] as number, blur: (lens[2] as number | null | undefined) ?? 0 }
}

function parseStroke(s: string | undefined): TextOutline | undefined {
  if (!s || s === 'none') return undefined
  const toks = s.trim().split(/\s+/)
  const width = px(toks[0])
  const color = toks.slice(1).join(' ')
  if (width === null || width <= 0 || parseCssColor(color) === null) return undefined
  return { width, color }
}

function backgroundPaint(ctx: Ctx, st: MeasuredStyle, box: MeasuredBox): Paint | undefined {
  if (!isGradient(st.backgroundImage)) return undefined
  const r = cssGradientToPaint(st.backgroundImage, box)
  if (!r.ok) {
    skip(ctx, 'unreadable-gradient')
    return undefined
  }
  for (const a of r.approximations) skip(ctx, a)
  return r.paint
}

/** The node's corner radii: the uniform value, plus the four when they differ (MC-1d). */
function cornerRadii(st: MeasuredStyle): { uniform: number; four?: [number, number, number, number] } {
  const r = st.borderRadii
  if (r && r.length === 4 && r.every((n) => Number.isFinite(n))) {
    if (r.every((n) => n === r[0])) return { uniform: st.borderRadius ?? r[0] }
    return { uniform: st.borderRadius ?? Math.max(...r), four: r }
  }
  return { uniform: st.borderRadius ?? 0 }
}

/** The node's four paddings [top, right, bottom, left] in px (MC-1f). */
function paddingsOf(node: MeasuredNode): [number, number, number, number] {
  const st = node.style
  if (st.paddings && st.paddings.length === 4 && st.paddings.every((n) => Number.isFinite(n))) return st.paddings
  const h = st.padding ?? 0
  const lines = node.text?.lines.length ?? 0
  if (lines > 0 && st.lineHeight && st.lineHeight > 0) {
    const border = (st.borderWidth ?? 0) > 0 && !isTransparent(st.borderColor) ? (st.borderWidth ?? 0) : 0
    const v = (node.box.height - lines * st.lineHeight) / 2 - border
    // A box whose height is not text plus padding gives a negative v: only a plausible vertical padding is believed.
    if (v >= 0 && Math.abs(v - h) > 1) return [v, h, v, h]
  }
  return [h, h, h, h]
}

function equalPaddings(node: MeasuredNode): boolean {
  const p = paddingsOf(node)
  return p.every((n) => Math.abs(n - p[0]) <= 1)
}

/** The box the text sits in once the border and the four paddings are taken off the measured box. */
function contentBoxOf(node: MeasuredNode): MeasuredBox {
  const st = node.style
  const border = (st.borderWidth ?? 0) > 0 && !isTransparent(st.borderColor) ? (st.borderWidth ?? 0) : 0
  const [t, r, b, l] = paddingsOf(node)
  const box = node.box
  return {
    x: box.x + border + l,
    y: box.y + border + t,
    width: Math.max(1, box.width - 2 * border - l - r),
    height: Math.max(1, box.height - 2 * border - t - b),
  }
}

/**
 * True when a text node's own background can ride on the text clip's box fields: a solid fill, one corner radius and
 * the same padding on all four sides (the engine has one `padding`). Otherwise a rect carries the look (MC-1d, MC-1f).
 */
function textBoxInline(node: MeasuredNode): boolean {
  return !isGradient(node.style.backgroundImage) && cornerRadii(node.style).four === undefined && equalPaddings(node)
}

function hasBoxShadow(st: MeasuredStyle): boolean {
  return st.boxShadow !== undefined && st.boxShadow !== '' && st.boxShadow !== 'none'
}

function hasBackground(st: MeasuredStyle): boolean {
  return !isTransparent(st.backgroundColor) || isGradient(st.backgroundImage) || ((st.borderWidth ?? 0) > 0 && !isTransparent(st.borderColor))
}

/** `text-decoration-line` → the engine's one decoration; both at once keep the underline. */
function parseDecoration(ctx: Ctx, s: string | undefined): 'underline' | 'line-through' | undefined {
  if (!s || s === 'none') return undefined
  const under = /\bunderline\b/.test(s)
  const through = /\bline-through\b/.test(s)
  if (/\boverline\b/.test(s)) skip(ctx, 'text-decoration:overline')
  if (under && through) skip(ctx, 'text-decoration:both')
  return under ? 'underline' : through ? 'line-through' : undefined
}

function emitText(ctx: Ctx, node: MeasuredNode, name: string, origin: Point, parent: Size, withBox: boolean): Clip {
  const st = node.style
  const lines = node.text?.lines ?? []
  const fontSize = st.fontSize ?? 16
  const family = (st.fontFamily ?? '').split(',')[0]?.replace(/["']/g, '').trim() ?? ''
  let fontId = ctx.fonts.resolve(family)
  if (!fontId) {
    fontId = ctx.fonts.nearest(family)
    ctx.substitutions.set(`font:${family || 'default'}`, fontId)
  }
  const weight = snapWeight(ctx.fonts.weights(fontId), st.fontWeight ?? 400)
  const align = st.textAlign === 'center' ? 'center' : st.textAlign === 'right' || st.textAlign === 'end' ? 'right' : 'left'
  const padding = withBox ? (st.padding ?? 0) : 0
  const box = node.box

  // MC-1g: the lines are already broken (explicit `\n`), so the engine must never wrap them again. Its glyph advances
  // can be a hair wider than Chromium's, which would push the last word of an exactly-fitting line onto a new row.
  const contentWidth = Math.max(1, box.width - 2 * padding)
  const paintsBox =
    withBox && (!isTransparent(st.backgroundColor) || ((st.borderWidth ?? 0) > 0 && !isTransparent(st.borderColor)) || hasBoxShadow(st))
  const slack = paintsBox ? 0 : textSlack(contentWidth)
  const wrapGuard: Pick<TextBox, 'overflow' | 'width' | 'maxLines'> = paintsBox
    ? // This clip paints the box, so the box cannot grow. 'shrink' at the measured line count never adds a row: it only
      // trims the size if the engine would otherwise wrap, and is inert when the text fits.
      { overflow: 'shrink', width: contentWidth, maxLines: Math.max(1, lines.length) }
    : { overflow: 'wrap', width: contentWidth + slack }

  const clip = createTextClip({
    trackId: '',
    name,
    startFrame: 0,
    durationFrames: ctx.durationFrames,
    text: {
      content: lines.map((l) => l.text).join('\n'),
      fontSize,
      color: st.color ?? '#ffffff',
      fontWeight: weight as FontWeight,
      textAlign: align,
    },
  })

  const extra: Partial<Clip> = {
    fontId,
    ...(st.fontStyle === 'italic' || st.fontStyle === 'oblique' ? { fontStyle: 'italic' as const } : {}),
    textBox: {
      ...wrapGuard,
      ...(st.letterSpacing ? { letterSpacing: st.letterSpacing } : {}),
      ...(st.lineHeight && fontSize > 0 ? { lineHeight: st.lineHeight / fontSize } : {}),
    },
  }
  if (st.backgroundClipText && isGradient(st.backgroundImage)) {
    const paint = backgroundPaint(ctx, st, box)
    if (paint) extra.textFill = paint
  }
  const outline = parseStroke(st.webkitTextStroke)
  if (outline) extra.textOutline = outline
  const shadow = parseShadow(ctx, st.textShadow)
  if (shadow) extra.textShadow = shadow
  const decoration = parseDecoration(ctx, st.textDecoration)
  if (decoration) extra.textDecoration = decoration
  if (withBox) {
    if (!isTransparent(st.backgroundColor)) extra.backgroundColor = st.backgroundColor
    if (padding) extra.padding = padding
    const radius = cornerRadii(st).uniform
    if (radius) extra.borderRadius = radius
    const boxShadow = hasBoxShadow(st) ? parseShadow(ctx, st.boxShadow, 'box-shadow') : undefined
    if (boxShadow) extra.shadow = boxShadow
    if ((st.borderWidth ?? 0) > 0 && !isTransparent(st.borderColor)) {
      extra.borderWidth = st.borderWidth
      extra.borderColor = st.borderColor
    }
  }
  const p = place(box, st, origin, parent)
  if (slack > 0) {
    // The box grew by `slack` px on the right. Keep the glyphs where they were (left-aligned text hugs the left edge,
    // centred text the middle, right-aligned the right edge) by moving the anchor, not `transform.x`, so the pivot of a
    // later scale or rotation stays at the same stage point.
    const edge = align === 'left' ? 0 : align === 'center' ? slack / 2 : slack
    p.anchor = { x: (p.anchor.x * box.width + edge) / (box.width + slack), y: p.anchor.y }
  }
  return { ...clip, ...extra, transform: nativeTransform(p) }
}

/** Room added to a converted text box so the engine cannot wrap a line the browser fitted exactly (MC-1g). */
export function textSlack(width: number): number {
  return Math.max(4, 0.03 * width)
}

function emitRect(ctx: Ctx, node: MeasuredNode, name: string, origin: Point, parent: Size): Clip {
  const st = node.style
  const box = node.box
  const paint = backgroundPaint(ctx, st, box)
  const short = Math.min(box.width, box.height)
  const radii = cornerRadii(st)
  const shadow = hasBoxShadow(st) ? parseShadow(ctx, st.boxShadow, 'box-shadow') : undefined
  const clip = createShapeClip({
    trackId: '',
    name,
    startFrame: 0,
    durationFrames: ctx.durationFrames,
    shape: {
      shapeKind: 'rect',
      shapeFill: isTransparent(st.backgroundColor) ? 'transparent' : st.backgroundColor,
      ...(paint ? { shapeFillPaint: paint } : {}),
      ...(short > 0 && radii.uniform && !radii.four ? { cornerRadius: Math.min(0.5, radii.uniform / short) } : {}),
      // No CSS border means no stroke at all: an unset width would fall back to the engine's default outline (MC-1e).
      ...((st.borderWidth ?? 0) > 0 && !isTransparent(st.borderColor)
        ? { shapeStroke: st.borderColor, shapeStrokeWidth: st.borderWidth, shapeStrokeAlign: 'inside' as const }
        : { shapeStroke: 'transparent', shapeStrokeWidth: 0 }),
    },
  })
  return {
    ...clip,
    // MC-1d: per-corner radii and the outer shadow ride on the rect itself.
    ...(short > 0 && radii.four ? { cornerRadii: radii.four.map((r) => Math.min(0.5, r / short)) as [number, number, number, number] } : {}),
    ...(shadow ? { shadow } : {}),
    transform: shapeTransform(place(box, st, origin, parent), box.width, box.height, parent),
  }
}

function emitImage(ctx: Ctx, node: MeasuredNode, name: string, origin: Point, parent: Size): Clip {
  const st = node.style
  const box = node.box
  const img = node.img as NonNullable<MeasuredNode['img']>
  const p = place(box, st, origin, parent)
  const clip = createImageClip({ trackId: '', name, startFrame: 0, durationFrames: ctx.durationFrames, src: img.src })
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (!nw || !nh || box.width <= 0 || box.height <= 0) {
    // Natural size unknown: the engine contains an untransformed image in its stage, so give it a box-sized one.
    skip(ctx, 'image-natural-size')
    const inner = projectFromClips([{ ...clip, name }], { fps: ctx.fps, stage: { width: Math.max(1, box.width), height: Math.max(1, box.height) } })
    const wrapped = compoundClipFor(inner, { name, startFrame: 0, durationFrames: ctx.durationFrames, transform: nativeTransform(p) })
    const mask = boxMask(ctx, node)
    return mask ? { ...wrapped, mask } : wrapped
  }
  const fit = img.objectFit ?? 'fill'
  let sx: number
  let sy: number
  if (fit === 'contain' || fit === 'scale-down') {
    sx = sy = Math.min(box.width / nw, box.height / nh)
  } else if (fit === 'cover') {
    sx = sy = Math.max(box.width / nw, box.height / nh)
  } else if (fit === 'none') {
    sx = sy = 1
  } else {
    sx = box.width / nw
    sy = box.height / nh
  }
  const dw = nw * sx
  const dh = nh * sy
  const transform: Transform = {
    x: p.x,
    y: p.y,
    scale: sx * p.sx,
    rotation: p.rotation,
    anchor: p.anchor,
    ...(sy !== sx || p.sy !== p.sx ? { scaleY: (sy * p.sy) / (sx * p.sx) } : {}),
  }
  let out: Clip = { ...clip, transform }
  // The part of the drawn image inside the box, and its rounded corners.
  const radii = cornerRadii(st)
  const radius = radii.four ?? radii.uniform
  const cropped = dw > box.width + 0.5 || dh > box.height + 0.5
  if (st.clipPath && st.clipPath !== 'none') {
    const m = clipPathMask(st.clipPath, box.width, box.height)
    if (m) out = { ...out, mask: m }
    else skip(ctx, `clip-path:${st.clipPath.split('(')[0]}`)
  } else if (cropped || anyRadius(radius) || st.overflowHidden) {
    const sub = { x: (dw - Math.min(dw, box.width)) / 2, y: (dh - Math.min(dh, box.height)) / 2, width: Math.min(dw, box.width), height: Math.min(dh, box.height) }
    out = { ...out, mask: rectMask(sub, dw, dh, radius) }
  }
  return out
}

function emitSvg(ctx: Ctx, node: MeasuredNode, name: string, origin: Point, parent: Size): Clip {
  const box = node.box
  const result = svgToProject(node.svg as NonNullable<MeasuredNode['svg']>, { fps: ctx.fps, durationFrames: ctx.durationFrames })
  for (const s of result.skipped) skip(ctx, `svg:${s.feature}`, s.count)
  const child = result.project
  const p = aboutCentre(place(box, node.style, origin, parent), box, parent)
  const s = Math.min(box.width / child.stage.width, box.height / child.stage.height)
  const all = Object.values(child.clips).flat()
  const sole = all.length === 1 && all[0].type === 'shape' && all[0].keyframes === undefined ? all[0] : null
  if (sole !== null) {
    // One shape: keep it a shape (so `draw` and fill keys address it directly).
    // A path is placed by the svg's VIEWBOX (CSS `meet`), not by its own bounds: the clip spans the whole
    // viewBox area and the path is drawn in that frame, so a stroke that pokes past the path's bounds (a
    // horizontal line 8 wide has bounds 0 high) is neither clipped nor misplaced (MC-1e).
    const byViewBox = sole.shapeKind === 'path'
    const rect = byViewBox ? { x: 0, y: 0, width: child.stage.width, height: child.stage.height, rotation: 0 } : resolveShapeRect(sole.transform, child.stage)
    const cx = rect.x + rect.width / 2 - child.stage.width / 2
    const cy = rect.y + rect.height / 2 - child.stage.height / 2
    const q: Placement = { ...p, x: p.x + (cx * s) / parent.width, y: p.y + (cy * s) / parent.height }
    const w = rect.width * s
    const h = rect.height * s
    return {
      ...sole,
      ...(byViewBox ? { shapeViewBox: { x: 0, y: 0, width: child.stage.width, height: child.stage.height } } : {}),
      id: sole.id,
      trackId: '',
      name,
      startFrame: 0,
      durationFrames: ctx.durationFrames,
      sourceStartFrame: 0,
      sourceDurationFrames: ctx.durationFrames,
      transform: { ...shapeTransform(q, w, h, parent), rotation: rect.rotation + p.rotation },
      ...(sole.shapeStrokeWidth !== undefined ? { shapeStrokeWidth: sole.shapeStrokeWidth * s } : {}),
      ...(sole.shapeStrokeDash !== undefined ? { shapeStrokeDash: sole.shapeStrokeDash.map((d) => d * s) } : {}),
      ...(sole.shapeStrokeDashOffset !== undefined ? { shapeStrokeDashOffset: sole.shapeStrokeDashOffset * s } : {}),
    }
  }
  return compoundClipFor(child, {
    name,
    startFrame: 0,
    durationFrames: ctx.durationFrames,
    transform: nativeTransform({ ...p, sx: s * p.sx, sy: s * p.sy }),
  })
}

// ---------------------------------------------------------------------------
// Tree walk
// ---------------------------------------------------------------------------

/** Channels only a shape clip takes; written on a wrapper they are applied to its shape children (MC-1e). */
const SHAPE_ONLY_CHANNELS = new Set(['draw', 'draw.start', 'shape.fill', 'shape.stroke', 'shape.path'])

function shapeOnly(c: MotionClause): boolean {
  return (c.kind === 'channel' || c.kind === 'hold') && SHAPE_ONLY_CHANNELS.has(c.channel)
}

/**
 * Split a compound's shape-only clauses off and key them onto each of its shape children. Returns null when
 * there is nothing to forward (not a compound, no such clause, or no shape child: the clause then fails on the
 * wrapper with the usual violation).
 */
function forwardToShapes(ctx: Ctx, element: string, clip: Clip, clauses: MotionClause[], shiftFrames: number): { clip: Clip; rest: MotionClause[] } | null {
  const project = clip.compound?.project as Project | undefined
  if (clip.type !== 'compound' || !project) return null
  const forward = clauses.filter(shapeOnly)
  if (forward.length === 0) return null
  const targets = Object.values(project.clips).flat().filter((c) => c.type === 'shape')
  if (targets.length === 0) return null
  const patches = new Map<string, Partial<Clip>>()
  for (const target of targets) {
    const { patch, violations } = motionPatch(target, forward, {
      fps: ctx.fps,
      sceneDurationFrames: ctx.durationFrames,
      clipStartFrameInScene: 0,
      stage: project.stage,
      baseline: { stage: project.stage },
      shiftFrames,
      labels: ctx.labels,
    })
    ctx.violations.push(...violations.map((v) => ({ ...v, element })))
    patches.set(target.id, patch)
  }
  const channels = [...new Set(forward.map((c) => (c as { channel: string }).channel))]
  const names = targets.map((t) => t.name).join(', ')
  for (const ch of channels) ctx.substitutions.set(`data-motion:${element}:${ch}`, `${ch} forwarded to ${names}`)
  const clips: Record<string, Clip[]> = {}
  for (const [trackId, list] of Object.entries(project.clips)) clips[trackId] = list.map((c) => (patches.has(c.id) ? { ...c, ...patches.get(c.id) } : c))
  return { clip: { ...clip, compound: { ...clip.compound, project: { ...project, clips } } } as Clip, rest: clauses.filter((c) => !shapeOnly(c)) }
}

/** The node's `data-motion` written onto its clip as native keys. A bad clause is reported and skipped, never fatal. */
function animate(ctx: Ctx, node: MeasuredNode, name: string, clip: Clip, parent: Size, shiftFrames: number): Clip {
  if (!node.motion) return clip
  const parsed = parseMotion(node.motion)
  let clauses = parsed.clauses
  const errors = parsed.errors
  const element = node.id ?? name
  ctx.violations.push(...errors.map((e) => ({ ...e, element })))
  if (clauses.length === 0) return clip
  const forwarded = forwardToShapes(ctx, element, clip, clauses, shiftFrames)
  if (forwarded) {
    clip = forwarded.clip
    clauses = forwarded.rest
    if (clauses.length === 0) return clip
  }
  const { patch, violations } = motionPatch(clip, clauses, {
    fps: ctx.fps,
    sceneDurationFrames: ctx.durationFrames,
    clipStartFrameInScene: 0,
    stage: parent,
    baseline: { stage: parent },
    shiftFrames,
    labels: ctx.labels,
  })
  ctx.violations.push(...violations.map((v) => ({ ...v, element })))
  return { ...clip, ...patch }
}

function hasOwnLook(node: MeasuredNode): boolean {
  const st = node.style
  return (
    hasBackground(st) ||
    (node.text?.lines.length ?? 0) > 0 ||
    node.svg !== undefined ||
    node.img !== undefined ||
    st.overflowHidden === true ||
    (st.clipPath !== undefined && st.clipPath !== 'none') ||
    (st.opacity !== undefined && st.opacity !== 1) ||
    (st.mixBlendMode !== undefined && st.mixBlendMode !== 'normal') ||
    hasStaticXform(st)
  )
}

/** A bare wrapper around one child lends its id and motion to that child instead of nesting a compound. */
function collapsed(node: MeasuredNode): MeasuredNode | null {
  if (node.children.length !== 1 || hasOwnLook(node)) return null
  const only = node.children[0]
  const motion = [node.motion, only.motion].filter((m): m is string => !!m).join('; ')
  const merged: MeasuredNode = { ...only, id: node.id ?? only.id, ...(motion ? { motion } : {}) }
  return collapsed(merged) ?? merged
}

function ordered(children: MeasuredNode[]): Array<{ node: MeasuredNode; index: number }> {
  return children
    .map((node, index) => ({ node, index }))
    .sort((a, b) => (a.node.style.zIndex ?? 0) - (b.node.style.zIndex ?? 0) || a.index - b.index)
}

/** Everything one node adds to its parent's layer list, bottom to top, plus the parts it names. */
function emitNode(
  ctx: Ctx,
  rawNode: MeasuredNode,
  index: number,
  origin: Point,
  parent: Size,
  depth: number,
  shiftFrames = 0,
): { clips: Clip[]; parts: Array<{ id: string; name: string }> } {
  const node = collapsed(rawNode) ?? rawNode
  const name = nodeName(node, index)
  const parts: Array<{ id: string; name: string }> = []
  const note = (clip: Clip): Clip => {
    ctx.native++
    if (node.id) parts.push({ id: clip.id, name: clip.name })
    return clip
  }

  // A box-shadow belongs to a painted box: with no background, border or text box the engine has nothing to cast it.
  if (hasBoxShadow(node.style)) {
    if (node.svg) skip(ctx, 'box-shadow:svg')
    else if (node.img) skip(ctx, 'box-shadow:img')
    else if (!hasBackground(node.style)) skip(ctx, 'box-shadow-without-fill')
  }

  if (node.svg) return { clips: [note(animate(ctx, node, name, commonProps(ctx, node, emitSvg(ctx, node, name, origin, parent), false), parent, shiftFrames))], parts }
  if (node.img) return { clips: [note(animate(ctx, node, name, commonProps(ctx, node, emitImage(ctx, node, name, origin, parent), false), parent, shiftFrames))], parts }

  const st = node.style
  const hasText = (node.text?.lines.length ?? 0) > 0
  const hasKids = node.children.length > 0
  const bg = hasBackground(st)

  // A leaf is one clip.
  if (!hasKids) {
    if (hasText) {
      const solidBg = textBoxInline(node)
      if (bg && !solidBg && !st.backgroundClipText) {
        // Gradient behind text: a rect shape and a plain text clip, in one nested compound.
      } else {
        return { clips: [note(animate(ctx, node, name, commonProps(ctx, node, emitText(ctx, node, name, origin, parent, bg && !st.backgroundClipText), true), parent, shiftFrames))], parts }
      }
    } else if (bg) {
      return { clips: [note(animate(ctx, node, name, commonProps(ctx, node, emitRect(ctx, node, name, origin, parent), true), parent, shiftFrames))], parts }
    } else {
      return { clips: [], parts }
    }
  }

  // A container: its own look first (bottom), then its children, in a compound sized to the node's box.
  // Past MAX_NESTED_CONTAINERS the engine's compound depth cap (and svg imports' own nesting) would be
  // exceeded, so the children go flat into the parent and the node's own placement is dropped.
  if (depth > MAX_NESTED_CONTAINERS) {
    skip(ctx, 'nesting-depth')
    const flatLayers: Clip[] = []
    const flatParts: Array<{ id: string; name: string }> = []
    for (const { node: child, index: ci } of ordered(node.children)) {
      const r = emitNode(ctx, child, ci, origin, parent, depth, shiftFrames)
      flatLayers.push(...r.clips)
      flatParts.push(...r.parts)
    }
    return { clips: flatLayers, parts: flatParts }
  }
  const box = node.box
  const inner: Point = { x: box.x, y: box.y }
  const innerStage: Size = { width: Math.max(1, box.width), height: Math.max(1, box.height) }
  const layers: Clip[] = []
  const innerParts: Array<{ id: string; name: string }> = []
  const selfBox: MeasuredNode = { ...node, children: [], box: { x: box.x, y: box.y, width: box.width, height: box.height } }
  const at0: Point = { x: box.x, y: box.y }
  const plainStyle: MeasuredStyle = { ...st, translate: undefined, rotate: undefined, scale: undefined, opacity: undefined, mixBlendMode: undefined, clipPath: undefined, overflowHidden: undefined, transformOrigin: undefined }
  if (bg && !(hasText && textBoxInline(node) && !st.backgroundClipText)) {
    layers.push(note(emitRect(ctx, { ...selfBox, style: plainStyle, id: undefined }, `${name}-bg`, at0, innerStage)))
  }
  if (hasText) {
    const withBox = bg && textBoxInline(node)
    // Behind a rect the text sits in the content box (border and padding off), not the whole box (MC-1f).
    const textNode: MeasuredNode = { ...selfBox, style: plainStyle, id: undefined }
    if (bg && !withBox && !st.backgroundClipText) {
      const c = contentBoxOf(node)
      layers.push(note(emitText(ctx, { ...textNode, box: c }, `${name}-text`, at0, innerStage, false)))
    } else {
      layers.push(note(emitText(ctx, textNode, `${name}-text`, at0, innerStage, withBox)))
    }
  }

  const staggers = node.motion ? staggerSpec(parseMotion(node.motion).clauses, ctx.fps, node.children.length) : null
  for (const { node: child, index: ci } of ordered(node.children)) {
    const r = emitNode(ctx, child, ci, inner, innerStage, depth + 1, staggers?.[ci] ?? 0)
    layers.push(...r.clips)
    innerParts.push(...r.parts)
  }
  if (layers.length === 0) return { clips: [], parts }

  const project = projectFromClips(layers, { fps: ctx.fps, stage: innerStage })
  const p = place(box, st, origin, parent)
  const compound = compoundClipFor(project, { name, startFrame: 0, durationFrames: ctx.durationFrames, transform: nativeTransform(p) })
  const done = animate(ctx, node, name, commonProps(ctx, node, compound, true), parent, shiftFrames)
  ctx.native++
  if (node.id) parts.push({ id: done.id, name: done.name })
  for (const ip of innerParts) parts.push({ id: `${done.id}/${ip.id}`, name: ip.name })
  return { clips: [done], parts }
}

/**
 * MOT-6: every label the scene declares, resolved before any clip is emitted so a clause may use a label that is
 * declared later or on another element. Walks the tree the way emitNode does (a collapsed wrapper merges its
 * motion; a container hands its children their stagger offsets).
 */
function collectLabels(root: MeasuredNode, ctx: Ctx): { labels: Map<string, number>; violations: SceneViolation[] } {
  const nodes: Array<{ element: string; clauses: MotionClause[]; shiftFrames: number }> = []
  const visit = (raw: MeasuredNode, shiftFrames: number, isRoot: boolean): void => {
    const node = isRoot ? raw : collapsed(raw) ?? raw
    if (node.motion) {
      const clauses = parseMotion(node.motion).clauses
      if (clauses.some((c) => c.kind === 'label' || ((c.kind === 'preset' || c.kind === 'channel' || c.kind === 'hold') && c.ref !== undefined))) nodes.push({ element: node.id ?? 'data-motion', clauses, shiftFrames })
      const staggers = staggerSpec(clauses, ctx.fps, node.children.length)
      for (const { node: child, index } of ordered(node.children)) visit(child, staggers?.[index] ?? 0, false)
      return
    }
    for (const { node: child } of ordered(node.children)) visit(child, 0, false)
  }
  visit(root, 0, true)
  return resolveLabels(nodes, { fps: ctx.fps, sceneDurationFrames: ctx.durationFrames })
}

/**
 * Turn a measured scene into one compound clip and a report. The clip starts at
 * `round(at × fps)` and lasts `round(duration × fps)`; its children span the
 * whole scene.
 */
export function emitScene(scene: MeasuredScene, opts: EmitOptions): { clip: Clip; report: SceneReport } {
  const durationFrames = Math.max(1, Math.round(scene.duration * opts.fps))
  const ctx: Ctx = {
    fps: opts.fps,
    fonts: opts.fonts ?? bundledFonts,
    durationFrames,
    native: 0,
    skipped: new Map(),
    substitutions: new Map(),
    parts: [],
    violations: [],
    labels: new Map(),
  }
  const root = scene.root
  const table = collectLabels(root, ctx)
  ctx.labels = table.labels
  ctx.violations.push(...table.violations)
  // The scene compound IS the root node: its own look and children are the scene's layers, in stage px.
  const stage = scene.stage
  const origin: Point = { x: 0, y: 0 }
  const layers: Clip[] = []
  const rootBox: MeasuredNode = { ...root, children: [] }
  const rootStyle: MeasuredStyle = { ...root.style, translate: undefined, rotate: undefined, scale: undefined, opacity: undefined, mixBlendMode: undefined, clipPath: undefined, overflowHidden: undefined, transformOrigin: undefined }
  const rootHasText = (root.text?.lines.length ?? 0) > 0
  const rootBg = hasBackground(rootStyle)
  if (rootBg && !(rootHasText && textBoxInline({ ...rootBox, style: rootStyle }) && !rootStyle.backgroundClipText)) {
    ctx.native++
    layers.push(emitRect(ctx, { ...rootBox, style: rootStyle, id: undefined }, `${root.id ?? 'root'}-bg`, origin, stage))
  }
  if (rootHasText) {
    ctx.native++
    layers.push(emitText(ctx, { ...rootBox, style: rootStyle, id: undefined }, `${root.id ?? 'root'}-text`, origin, stage, rootBg && textBoxInline({ ...rootBox, style: rootStyle })))
  }
  const parts: Array<{ id: string; name: string }> = []
  const rootStaggers = root.motion ? staggerSpec(parseMotion(root.motion).clauses, ctx.fps, root.children.length) : null
  for (const { node, index } of ordered(root.children)) {
    const r = emitNode(ctx, node, index, origin, stage, 1, rootStaggers?.[index] ?? 0)
    layers.push(...r.clips)
    parts.push(...r.parts)
  }
  const project = projectFromClips(layers, { fps: opts.fps, stage })
  const clip = compoundClipFor(project, {
    name: scene.name,
    startFrame: Math.round(scene.at * opts.fps),
    durationFrames,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
  })
  const report: SceneReport = {
    native: ctx.native,
    skipped: [...ctx.skipped].map(([feature, count]) => ({ feature, count })).sort((a, b) => a.feature.localeCompare(b.feature)),
    substitutions: [...ctx.substitutions].map(([feature, used]) => ({ feature, used })),
    parts,
    ...(ctx.violations.length > 0 ? { violations: ctx.violations } : {}),
  }
  return { clip, report }
}
