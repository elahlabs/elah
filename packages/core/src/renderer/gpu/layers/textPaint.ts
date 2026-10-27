/**
 * The ONE text painter (EDX-P8), shared by the preview's TextLayer and the
 * exporter, the way `shapePaint` is shared for shapes. Before this the two
 * kept near-identical copies, so every text feature had to be written twice
 * and could drift.
 *
 * Paints onto a 2D context in stage units: background panel, border, then
 * the glyphs — plainly, or unit by unit when a text animator or timed
 * captions change the text over time. With none of the EDX-P8 fields set it
 * issues exactly the draw calls the two copies did.
 */

import type { ActiveTextClip } from '../../../resolver/scene'
import type { CaptionWord, TextAnimatorUnit } from '../../../types'
import { evaluateEasing } from '../../../resolver/textAnimation'
import { staggerOffsets } from '../../../elements/stagger'
import { scrambleText } from '../../../elements/scramble'
import { trackedWidth } from './textMeasure'
import { computeTextLayout, type TextLayout } from './textLayout'
import { applyShear, skewShear } from './drawRect'
import { isPaint, paintSignature, toCanvasPaint, usableShadow, applyShadow, clearShadow, paintingAtOutputScale, shadowBlurAtScale, shadowOffsetAtScale } from './paint'

/**
 * The box a glyph gradient spans: the layout box WITHOUT its padding.
 *
 * Padding is the space between the glyphs and the background/border box, so a
 * gradient taken over the padded box would start and end in the margin and read
 * as washed out at both ends.
 */
function glyphBox(layout: TextLayout): { x: number; y: number; width: number; height: number } {
  const p = layout.style.padding
  return {
    x: layout.box.x + p,
    y: layout.box.y + p,
    width: Math.max(0, layout.box.width - 2 * p),
    height: Math.max(0, layout.box.height - 2 * p),
  }
}

/** The 2D surface both HTML and Offscreen canvases provide. */
export type TextPaintContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * PV-P3a probe result: true = use `ctx.letterSpacing` wherever the context has
 * it. Set false only if the probe found the window and the worker disagree, so
 * both threads take the per-glyph path.
 *
 * **PROBE NOT RUN** — no browser was available, so the ticket's step 1 produced
 * no measurement and the decision rule's fallback applies: Chromium has shipped
 * `letterSpacing` on both `CanvasRenderingContext2D` and
 * `OffscreenCanvasRenderingContext2D` since v99, and `fillTracked` still checks
 * `'letterSpacing' in ctx` at paint time, so a context without it falls back
 * anyway. Safari and Firefox are NOT measured. Do not read `true` here as a
 * measurement: it is a default, and the probe row in the Result is owed.
 */
export const NATIVE_LETTER_SPACING = true

/**
 * Draw `text` with its LEFT edge at `x`, tracked by `ls` px (PV-P3a).
 *
 * Two paths, one geometry. Both put glyph i at `left + width(prefix_i) + i·ls`:
 * the native one asks the context to do it (which keeps kerning), the fallback
 * measures each prefix and draws glyph by glyph (which keeps most of it, and is
 * the only option on a context without the property). The fallback's
 * `Array.from` is what makes the arithmetic right for anything outside the BMP.
 *
 * `ls` is only ever set inside this `save`/`restore` pair. `letterSpacing` is
 * canvas DRAWING STATE, and the scratch context is shared by every text clip in
 * the preview and by every frame in export: leaking it would make the NEXT
 * clip's measurements include this one's tracking.
 *
 * Layout never depends on which path runs — widths come from `trackedWidth` over
 * an untracked measurement — which is exactly why the property can be confined
 * to the draw call.
 */
function fillTracked(
  ctx: TextPaintContext,
  text: string,
  x: number,
  y: number,
  ls: number,
  draw: (t: string, x: number, y: number) => void,
): void {
  if (NATIVE_LETTER_SPACING && 'letterSpacing' in ctx) {
    ctx.save()
    ;(ctx as TextPaintContext & { letterSpacing: string }).letterSpacing = `${ls}px`
    draw(text, x, y)
    ctx.restore()
    return
  }
  let prefix = ''
  Array.from(text).forEach((ch, i) => {
    draw(ch, x + ctx.measureText(prefix).width + i * ls, y)
    prefix += ch
  })
}

/** Rounded rect tracing (radius clamped to half the shorter side). */
export function roundRectPath(ctx: TextPaintContext, x: number, y: number, w: number, h: number, r: number): void {
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
 * Stringified key of everything that changes the painted pixels (not
 * opacity — a uniform in preview, `globalAlpha` in export). The clip-local
 * frame is part of it only while the text is animating, so static text
 * still paints once.
 */
export function textPaintSignature(item: ActiveTextClip, stage: { width: number; height: number }): string {
  const parts: unknown[] = [
    item.content,
    item.fontSize,
    item.color,
    item.fontFamily,
    item.fontWeight,
    item.textAlign,
    item.backgroundColor,
    item.backgroundOpacity,
    item.padding,
    item.borderRadius,
    item.borderWidth,
    item.borderColor,
    item.transform?.x,
    item.transform?.y,
    item.transform?.scale,
    item.transform?.rotation,
    stage.width,
    stage.height,
    item.textOutline ?? null,
    item.textShadow ?? null,
    item.textAnimator ?? null,
    item.captionMode ?? null,
    item.captionHighlight ?? null,
    item.words ?? null,
    item.localFrame ?? null,
    // PV-P2: the model and the anchor it reads. A legacy clip contributes
    // `null`, which changes nothing painted - the signature is change detection,
    // not a render instruction.
    item.transformModel === 'v2'
      ? ['v2', item.transform?.anchor?.x, item.transform?.anchor?.y, item.transform?.scaleX, item.transform?.scaleY]
      : null,
    // PV-P3a: the whole box, as one value. Every field in it changes painted
    // pixels, and a clip without one contributes `null` exactly as the fields
    // above do.
    item.textBox ?? null,
    // PV-P4a: the bundled font id. `fontFamily` above cannot carry this — two ids
    // map to different faces while `fontFamily` holds only the resolved CSS
    // family string, and an unknown id resolves to the *same* fallback family as
    // a clip with no id at all.
    item.fontId ?? null,
    // PV-P4b: italic, last for the same reason `fontId` is. It is a style slot
    // that changes glyph rasterisation, so a clip that turns it on must repaint.
    item.fontStyle ?? null,
    // PV-P4c-1: the glyph fill, last. A gradient is an OBJECT, so it cannot go
    // in the array raw — two structurally equal gradients must produce the same
    // key or the layer repaints every frame, and two different ones must not
    // collide or an edit goes unnoticed.
    item.textFill ? paintSignature(item.textFill) : null,
    // PV-P4c-2: spans. An object array, so it cannot go in raw for the same
    // reason `textFill` could not.
    item.spans ?? null,
  ]
  // MC-1d: the box shadow and the decoration. Appended only when set, so a clip
  // with neither keeps the exact key it always had.
  if (item.shadow || item.textDecoration) parts.push([item.shadow ?? null, item.textDecoration ?? null])
  // MOT-5: scramble state (progress, pool, seed). Appended only while scrambling, so every other clip keeps its key.
  if (isScrambling(item)) parts.push(['scramble', item.scramble])
  // MOT-8: skew. Appended only while the clip is skewed, so every other clip keeps its key.
  if (skewShear(item.transform?.skewX, item.transform?.skewY)) parts.push(['skew', item.transform?.skewX ?? 0, item.transform?.skewY ?? 0])
  return JSON.stringify(parts)
}

// ---------------------------------------------------------------------------
// Per-unit state
// ---------------------------------------------------------------------------

interface UnitState {
  alpha: number
  dy: number
  scale: number
  color?: string
  /** MOT-3 tween channels; absent on the presets and captions. */
  dx?: number
  rotation?: number
  blur?: number
}

const VISIBLE: UnitState = { alpha: 1, dy: 0, scale: 1 }

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const easeOutBack = (t: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

/** Animator state of unit `index` at `localFrame`. Pure; exported for tests. */
export function animatorUnitState(
  animator: NonNullable<ActiveTextClip['textAnimator']>,
  index: number,
  localFrame: number,
  fontSize: number,
  /** MOT-3: per-unit start frames from `animatorOffsets`; absent = `index * staggerFrames` as before. */
  offsets?: number[],
): UnitState {
  const start = offsets ? (offsets[index] ?? 0) : index * Math.max(0, animator.staggerFrames)
  const t = clamp01((localFrame - start) / Math.max(1, animator.durationFrames))
  if (animator.tween) {
    const e = evaluateEasing(animator.ease ?? 'linear', t)
    const lerp = (pair: [number, number] | undefined, rest: number) => (pair ? pair[0] + (pair[1] - pair[0]) * e : rest)
    const tw = animator.tween
    return {
      alpha: clamp01(lerp(tw.opacity, 1)),
      dy: lerp(tw.dy, 0) * fontSize,
      scale: lerp(tw.scale, 1),
      dx: lerp(tw.dx, 0) * fontSize,
      rotation: lerp(tw.rotation, 0),
      blur: Math.max(0, lerp(tw.blur, 0)),
    }
  }
  switch (animator.preset) {
    case 'typewriter':
      return { alpha: localFrame >= start ? 1 : 0, dy: 0, scale: 1 }
    case 'fade':
      return { alpha: easeOutCubic(t), dy: 0, scale: 1 }
    case 'rise': {
      const e = easeOutCubic(t)
      return { alpha: e, dy: (1 - e) * 0.6 * fontSize, scale: 1 }
    }
    case 'pop':
      return { alpha: clamp01(t * 3), dy: 0, scale: 0.5 + 0.5 * easeOutBack(t) }
  }
}

/** The unit pieces of one line, shared by the painter's tokeniser and the unit count. */
function piecesOf(line: string, unit: TextAnimatorUnit): string[] {
  return unit === 'line' ? [line] : unit === 'word' ? line.split(/(\s+)/).filter((p) => p.length > 0) : Array.from(line)
}

/**
 * MOT-3: start frame of every unit, or undefined when the animator sets neither `from` nor `staggerEase` (then
 * the legacy `index * staggerFrames` stands, bit for bit). Counts units exactly as `tokensOf` numbers them.
 */
export function animatorOffsets(animator: NonNullable<ActiveTextClip['textAnimator']>, lines: readonly string[]): number[] | undefined {
  if (!animator.from && !animator.staggerEase) return undefined
  let count = 0
  for (const line of lines) for (const p of piecesOf(line, animator.unit)) if (!/^\s+$/.test(p)) count++
  return staggerOffsets(count, { each: Math.max(0, animator.staggerFrames), from: animator.from, ease: animator.staggerEase })
}

/** Caption state of word `index` at `localFrame`. Pure; exported for tests. */
export function captionWordState(
  mode: NonNullable<ActiveTextClip['captionMode']>,
  word: CaptionWord | undefined,
  localFrame: number,
  highlight: string,
): UnitState {
  if (!word || mode === 'static') return VISIBLE
  const spoken = localFrame >= word.start
  const speaking = spoken && localFrame < word.end
  switch (mode) {
    case 'karaoke':
      return spoken ? { ...VISIBLE, color: highlight } : VISIBLE
    case 'highlight':
      return speaking ? { ...VISIBLE, color: highlight } : VISIBLE
    case 'reveal': {
      if (!spoken) return { alpha: 0, dy: 0, scale: 1 }
      const t = clamp01((localFrame - word.start) / 4)
      return { alpha: 1, dy: 0, scale: 0.85 + 0.15 * easeOutBack(t) }
    }
  }
}

// ---------------------------------------------------------------------------
// Painter
// ---------------------------------------------------------------------------

/**
 * Paint `item` onto `ctx` (stage units, caller's globalAlpha respected).
 * Returns the layout, which callers use for selection boxes and mask frames.
 */
export function paintText(
  ctx: TextPaintContext,
  item: ActiveTextClip,
  stage: { width: number; height: number },
): TextLayout {
  // Shadows are in device pixels; see `paintingAtOutputScale`.
  return paintingAtOutputScale(ctx, () => paintTextAt(ctx, item, stage))
}

function paintTextAt(
  ctx: TextPaintContext,
  item: ActiveTextClip,
  stage: { width: number; height: number },
): TextLayout {
  // computeTextLayout sets ctx.font as a side effect, so the metrics it used
  // to place the lines are exactly the ones we paint with.
  const layout = computeTextLayout(ctx as CanvasRenderingContext2D, item, stage)
  const { backgroundColor, backgroundOpacity, borderWidth, borderColor, borderRadius } = layout.style

  // Pixel-space rotation and stretch about the block centre: the painted canvas
  // IS the transformed result, so glyphs clip only at the true stage bounds.
  // Both are inside one `if`, because a legacy clip - and a v2 clip with no
  // stretch - must issue exactly the calls it always did, and `TextLayer`'s
  // test context has no `scale` method at all.
  const rotation = item.transform?.rotation ?? 0
  const stretch = layout.stretch
  // MOT-8: shear about the same centre, after the stretch and before the rotation (CSS "rotate() skew()").
  const shear = skewShear(item.transform?.skewX, item.transform?.skewY)
  ctx.save()
  if (rotation !== 0 || stretch || shear) {
    const cx = layout.center.x * stage.width
    const cy = layout.center.y * stage.height
    ctx.translate(cx, cy)
    if (rotation !== 0) ctx.rotate(rotation)
    applyShear(ctx, shear)
    if (stretch) ctx.scale(stretch.x, stretch.y)
    ctx.translate(-cx, -cy)
  }

  if (backgroundColor) {
    ctx.save()
    ctx.globalAlpha *= backgroundOpacity
    ctx.fillStyle = backgroundColor
    roundRectPath(ctx, layout.box.x, layout.box.y, layout.box.width, layout.box.height, borderRadius)
    // MC-1d: the box casts the shadow; the border and the glyphs do not.
    const boxShadow = usableShadow(item.shadow)
    if (boxShadow) applyShadow(ctx, boxShadow, rotation)
    ctx.fill()
    if (boxShadow) clearShadow(ctx)
    ctx.restore()
  }

  if (borderWidth > 0) {
    ctx.save()
    ctx.strokeStyle = borderColor
    ctx.lineWidth = borderWidth
    const inset = borderWidth / 2
    roundRectPath(
      ctx,
      layout.box.x + inset,
      layout.box.y + inset,
      layout.box.width - borderWidth,
      layout.box.height - borderWidth,
      Math.max(0, borderRadius - inset),
    )
    ctx.stroke()
    ctx.restore()
  }

  // PV-P3a: a clipped box clips its GLYPHS to the content area, not the padded
  // box the background paints. Inside the border block, before the fill colour,
  // so the clip covers every glyph path below and nothing above it.
  const clipRect = layout.clipRect
  if (clipRect) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(clipRect.x, clipRect.y, clipRect.width, clipRect.height)
    ctx.clip()
  }

  // PV-P4c-1: the glyph fill. Built HERE, inside the save/rotate above, because
  // a canvas gradient is resolved against the transform in force when it is
  // CREATED — created one line earlier it would be pinned to the stage and a
  // rotated title would carry a gradient that does not turn with it.
  //
  // A clip with no `textFill` takes the same single assignment of the same
  // string it always did: `isPaint(undefined)` is false, so `fill` IS
  // `layout.style.color`, and no gradient object is created.
  const fill: string | CanvasGradient = isPaint(item.textFill)
    ? toCanvasPaint(ctx, item.textFill, glyphBox(layout))
    : layout.style.color
  ctx.fillStyle = fill
  ctx.textBaseline = 'middle'

  const ls = layout.letterSpacing ?? 0
  const animated = Boolean(item.textAnimator) || isTimedCaption(item) || isScrambling(item)
  if (layout.pieces && !animated) {
    // PV-P4c-2: a run layout. Drawn left to right from a computed left, because
    // `ctx.textAlign` would align each PIECE rather than the line, and a line of
    // mixed weights is not the width of any one of its pieces.
    paintPieces(ctx, item, layout, fill)
  } else if (ls && !animated) {
    // Tracked lines are drawn left-aligned at a computed left, because tracking
    // changes where a line's own centre is: `ctx.textAlign` would align the
    // UNTRACKED width and leave the line drifting off its anchor.
    paintTrackedLines(ctx, item, layout, ls, fill)
  } else if (!animated && !item.textOutline && !item.textShadow) {
    // The pre-EDX-P8 draw, call for call.
    ctx.textAlign = layout.style.textAlign
    layout.lines.forEach((line, i) => {
      ctx.fillText(line, layout.anchorX, layout.firstLineY + i * layout.lineAdvance)
    })
  } else if (!animated) {
    ctx.textAlign = layout.style.textAlign
    layout.lines.forEach((line, i) => {
      drawGlyphs(ctx, item, line, layout.anchorX, layout.firstLineY + i * layout.lineAdvance, fill)
    })
  } else {
    paintUnits(ctx, item, layout, fill)
  }

  if (item.textDecoration) paintDecoration(ctx, item, layout, fill)

  if (clipRect) ctx.restore()
  ctx.restore()
  return layout
}

/**
 * Underline or line-through on every laid-out line (MC-1d), in the glyph fill.
 *
 * Geometry comes from what the layout already holds: each line's left edge and
 * width follow the same alignment arithmetic the glyph draws use, and the
 * vertical position is derived from `firstLineY`, which is the MIDDLE of the em
 * square (`textBaseline = 'middle'`), so the baseline is half the ascent-descent
 * difference below it. Thickness is `max(1, fontSize / 14)`; an underline's top
 * edge sits one thickness under the baseline and a line-through is centred half
 * an x-height above it. Metrics the context cannot report (test doubles, old
 * Offscreen contexts) fall back to a 0.8 / 0.2 em split and a 0.5 em x-height.
 *
 * Drawn as plain rectangles so it needs no stroke state to leak, and after the
 * glyphs so a text shadow, which lives only inside `drawGlyphs`, never doubles
 * it. A text animator or timed caption still gets the full-width line; the line
 * is a property of the box, not of the unit being revealed.
 */
function paintDecoration(
  ctx: TextPaintContext,
  item: ActiveTextClip,
  layout: TextLayout,
  fill: string | CanvasGradient,
): void {
  const kind = item.textDecoration
  if (kind !== 'underline' && kind !== 'line-through') return
  const fontSize = layout.style.fontSize
  const thickness = Math.max(1, fontSize / 14)
  const ls = layout.letterSpacing ?? 0

  const probe = ctx.measureText('x') as TextMetrics
  const ascent = Number.isFinite(probe.emHeightAscent) ? probe.emHeightAscent : fontSize * 0.8
  const descent = Number.isFinite(probe.emHeightDescent) ? probe.emHeightDescent : fontSize * 0.2
  const xHeight =
    Number.isFinite(probe.actualBoundingBoxAscent) && probe.actualBoundingBoxAscent > 0
      ? probe.actualBoundingBoxAscent
      : fontSize * 0.5
  const baselineShift = (ascent - descent) / 2

  ctx.fillStyle = fill
  layout.lines.forEach((line, i) => {
    const width = layout.pieces
      ? layout.pieces[i]!.reduce((w, piece) => w + piece.width, 0)
      : ls
        ? trackedWidth(ctx.measureText(line).width, line, ls)
        : ctx.measureText(line).width
    if (!(width > 0)) return
    const align = layout.style.textAlign
    const left = align === 'center' ? layout.anchorX - width / 2 : align === 'right' ? layout.anchorX - width : layout.anchorX
    const baseline = layout.firstLineY + i * layout.lineAdvance + baselineShift
    const top = kind === 'underline' ? baseline + thickness : baseline - xHeight / 2 - thickness / 2
    ctx.fillRect(left, top, width, thickness)
  })
}

/**
 * Tracked, static text: one draw per line through `fillTracked` (PV-P3a).
 *
 * The `plain` split exists for the same reason the main branch has one: an
 * outline or a shadow needs `drawGlyphs`, and a plain line must not pay for a
 * `save`/`restore` pair per line that it would not otherwise take.
 */
function paintTrackedLines(
  ctx: TextPaintContext,
  item: ActiveTextClip,
  layout: TextLayout,
  ls: number,
  fill: string | CanvasGradient,
): void {
  const plain = !item.textOutline && !item.textShadow
  ctx.textAlign = 'left'
  layout.lines.forEach((line, i) => {
    const y = layout.firstLineY + i * layout.lineAdvance
    const width = trackedWidth(ctx.measureText(line).width, line, ls)
    const align = layout.style.textAlign
    const left = align === 'center' ? layout.anchorX - width / 2 : align === 'right' ? layout.anchorX - width : layout.anchorX
    fillTracked(ctx, line, left, y, ls, plain
      ? (t, x, y2) => ctx.fillText(t, x, y2)
      : (t, x, y2) => drawGlyphs(ctx, item, t, x, y2, fill))
  })
}

/**
 * Draw a run layout piece by piece (PV-P4c-2).
 *
 * `textAlign = 'left'` for the whole line, with the line's own left computed from
 * its ALIGNED total width, because a line of mixed weights is not the width of
 * any single piece: `ctx.textAlign = 'center'` would centre each piece on the
 * same x and the line would come apart.
 *
 * Kerning across a style boundary is lost — each piece is measured and drawn
 * alone — which is inherent to painting styled runs and is recorded as an
 * accepted limitation in the ticket's Result.
 */
function paintPieces(
  ctx: TextPaintContext,
  item: ActiveTextClip,
  layout: TextLayout,
  fill: string | CanvasGradient,
): void {
  const plain = !item.textOutline && !item.textShadow
  ctx.textAlign = 'left'
  layout.pieces!.forEach((line, i) => {
    const y = layout.firstLineY + i * layout.lineAdvance
    const width = line.reduce((w, piece) => w + piece.width, 0)
    const align = layout.style.textAlign
    let x =
      align === 'center' ? layout.anchorX - width / 2 : align === 'right' ? layout.anchorX - width : layout.anchorX
    for (const piece of line) {
      ctx.font = piece.font
      const pieceFill = piece.color ?? fill
      if (plain) {
        ctx.fillStyle = pieceFill
        ctx.fillText(piece.text, x, y)
      } else {
        drawGlyphs(ctx, item, piece.text, x, y, pieceFill)
      }
      x += piece.width
    }
  })
  // The last piece's font is still on the context otherwise, and the next clip's
  // measurement assumes the base font is there.
  ctx.font = layout.font
}

const NEWLINE = '\n'

/** MOT-5: true while glyphs are still noise. At progress 1 the clip paints exactly as plain text. */
function isScrambling(item: ActiveTextClip): boolean {
  return Boolean(item.scramble && item.scramble.progress < 1 && !isTimedCaption(item))
}

function isTimedCaption(item: ActiveTextClip): boolean {
  return Boolean(item.words?.length && item.captionMode && item.captionMode !== 'static')
}

/** One run of glyphs with outline and shadow; shadow is cast once, by the lowest layer drawn. */
function drawGlyphs(ctx: TextPaintContext, item: ActiveTextClip, text: string, x: number, y: number, fill: string | CanvasGradient): void {
  const outline = item.textOutline && item.textOutline.width > 0 ? item.textOutline : undefined
  const shadow = item.textShadow
  ctx.save()
  if (shadow) {
    const offset = shadowOffsetAtScale(shadow.offsetX, shadow.offsetY)
    ctx.shadowColor = shadow.color
    ctx.shadowBlur = shadowBlurAtScale(shadow.blur)
    ctx.shadowOffsetX = offset.x
    ctx.shadowOffsetY = offset.y
  }
  if (outline) {
    ctx.strokeStyle = outline.color
    ctx.lineWidth = outline.width * 2
    ctx.lineJoin = 'round'
    ctx.strokeText(text, x, y)
    // The fill sits on the outline; a second shadow would double it.
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  }
  ctx.fillStyle = fill
  ctx.fillText(text, x, y)
  ctx.restore()
}

interface Token {
  text: string
  /** Offset from the line's left edge, px. */
  x: number
  /** Unit index across the whole text; -1 for whitespace. */
  unit: number
}

/**
 * Split a line into drawable tokens with their x offsets.
 *
 * `ls` is PV-P3a's tracking. At 0 every expression below reduces to the one that
 * was there before this parameter existed, call for call — which is what keeps
 * the existing animator tests' `measureText` counts unmoved.
 */
function tokensOf(
  ctx: TextPaintContext,
  line: string,
  unit: TextAnimatorUnit,
  firstUnit: number,
  ls = 0,
): Token[] {
  const pieces = piecesOf(line, unit)
  const out: Token[] = []
  let prefix = ''
  let next = firstUnit
  for (const text of pieces) {
    const blank = /^\s+$/.test(text)
    out.push({
      text,
      x: ls ? ctx.measureText(prefix).width + ls * Array.from(prefix).length : ctx.measureText(prefix).width,
      unit: blank ? -1 : next++,
    })
    prefix += text
  }
  return out
}

function paintUnits(ctx: TextPaintContext, item: ActiveTextClip, layout: TextLayout, fill: string | CanvasGradient): void {
  const localFrame = item.localFrame ?? 0
  const caption = isTimedCaption(item)
  // Timed captions are word-driven; an animator picks its own unit.
  const unit: TextAnimatorUnit = caption ? 'word' : (item.textAnimator?.unit ?? 'char')
  // MOT-5: the displayed glyphs of every line, from a pure function of (seed, glyph index, frame). Per-glyph, so char unit only.
  const scrambled =
    isScrambling(item) && unit === 'char'
      ? scrambleText(layout.lines.join(NEWLINE), item.scramble!.progress, localFrame, {
          charset: item.scramble!.charset,
          seed: item.scramble!.seed,
          changeEvery: item.scramble!.changeEvery,
          preserve: item.scramble!.preserve,
        })
          .split(NEWLINE)
          .map((l) => Array.from(l))
      : undefined
  const highlight = item.captionHighlight ?? '#ffd400'
  const fontSize = layout.style.fontSize
  const ls = layout.letterSpacing ?? 0

  ctx.textAlign = 'left'
  const offsets = item.textAnimator && !caption ? animatorOffsets(item.textAnimator, layout.lines) : undefined
  let unitIndex = 0
  layout.lines.forEach((line, i) => {
    const y = layout.firstLineY + i * layout.lineAdvance
    const raw = ctx.measureText(line).width
    const width = ls ? trackedWidth(raw, line, ls) : raw
    const align = layout.style.textAlign
    const left = align === 'center' ? layout.anchorX - width / 2 : align === 'right' ? layout.anchorX - width : layout.anchorX
    const tokens = tokensOf(ctx, line, unit, unitIndex, ls)
    for (const [tk, token] of tokens.entries()) {
      if (token.unit < 0) continue
      unitIndex = token.unit + 1
      let state = VISIBLE
      if (caption) {
        state = captionWordState(item.captionMode!, item.words![token.unit], localFrame, highlight)
      }
      if (item.textAnimator) {
        const a = animatorUnitState(item.textAnimator, token.unit, localFrame, fontSize, offsets)
        state = {
          alpha: state.alpha * a.alpha,
          dy: state.dy + a.dy,
          scale: state.scale * a.scale,
          ...(state.color ? { color: state.color } : {}),
          ...(a.dx ? { dx: a.dx } : {}),
          ...(a.rotation ? { rotation: a.rotation } : {}),
          ...(a.blur ? { blur: a.blur } : {}),
        }
      }
      if (state.alpha <= 0) continue
      let x = left + token.x + (state.dx ?? 0)
      // MOT-5: an unresolved glyph swaps its character but keeps the real glyph's slot, centred in it, so layout never moves.
      let glyph = token.text
      const noise = scrambled?.[i]?.[tk]
      if (noise !== undefined && noise !== token.text) {
        x += (ctx.measureText(token.text).width - ctx.measureText(noise).width) / 2
        glyph = noise
      }
      ctx.save()
      ctx.globalAlpha *= state.alpha
      // MOT-3: blur and rotation exist only on a tween; every preset skips both and issues the calls it always did.
      // Rotation turns about the unit's drawn centre (baseline is 'middle', so y + dy is the vertical centre).
      if (state.blur) (ctx as unknown as { filter: string }).filter = `blur(${state.blur}px)`
      if (state.rotation) {
        const rawToken = ctx.measureText(token.text).width
        const cx = x + (ls ? trackedWidth(rawToken, token.text, ls) : rawToken) / 2
        const cy = y + state.dy
        ctx.translate(cx, cy)
        ctx.rotate(state.rotation)
        ctx.translate(-cx, -cy)
      }
      if (state.scale !== 1) {
        const rawToken = ctx.measureText(token.text).width
        const cx = x + (ls ? trackedWidth(rawToken, token.text, ls) : rawToken) / 2
        ctx.translate(cx, y)
        ctx.scale(state.scale, state.scale)
        ctx.translate(-cx, -y)
      }
      // A tracked token is drawn through `fillTracked`, so its glyphs carry the
      // same spacing the layout measured it at.
      if (ls) {
        fillTracked(ctx, glyph, x, y + state.dy, ls, (t, tx, ty) =>
          drawGlyphs(ctx, item, t, tx, ty, state.color ?? fill))
      } else {
        // A caption highlight still wins over the clip's own fill: the highlight
        // IS the karaoke's job, and a gradient that overrode it would make the
        // sung word indistinguishable from the unsung ones.
        drawGlyphs(ctx, item, glyph, x, y + state.dy, state.color ?? fill)
      }
      ctx.restore()
    }
  })
}
