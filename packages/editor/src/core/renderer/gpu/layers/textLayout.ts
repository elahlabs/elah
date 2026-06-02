/**
 * textLayout — the single source of truth for how a text clip is laid out in
 * stage space.
 *
 * Both the GPU `TextLayer` (which paints glyphs onto a canvas → texture) and the
 * interactive editor overlay (which draws the selection box / hit-tests / sizes
 * the inline editor) consume this so the on-screen box always matches the
 * rendered pixels exactly. If the two diverged, drag handles would float off the
 * text — keeping the math here, shared, prevents that class of bug.
 *
 * Positioning model:
 *   `transform.x` / `transform.y` are the normalized (0..1) stage position of the
 *   text block's CENTER. Default is the stage centre (0.5, 0.5). `textAlign`
 *   controls only how multiple wrapped lines justify *within* the block — it does
 *   not move the block on the stage. This is what lets the overlay drag text
 *   freely anywhere, like any other video editor.
 */

import type { ActiveTextClip } from '../../../resolver/scene'

export const DEFAULT_FONT_SIZE = 48
export const DEFAULT_COLOR = '#ffffff'
export const DEFAULT_FONT_FAMILY = 'sans-serif'
export const DEFAULT_FONT_WEIGHT: 'normal' | 'bold' = 'normal'
export const DEFAULT_TEXT_ALIGN: 'left' | 'center' | 'right' = 'center'

/** Fraction of stage width left empty on each side (text wraps within the rest). */
export const SIDE_MARGIN = 0.05
/** Multiplier applied to fontSize to get the line advance. */
export const LINE_HEIGHT = 1.2

/** The subset of a 2D context this module needs — `font` (set) + `measureText`. */
export type TextMeasurer = Pick<CanvasRenderingContext2D, 'font' | 'measureText'>

export interface ResolvedTextStyle {
  fontSize: number
  color: string
  fontFamily: string
  fontWeight: 'normal' | 'bold'
  textAlign: 'left' | 'center' | 'right'
}

/** Bounding box in stage-space pixels. */
export interface StageRect {
  x: number
  y: number
  width: number
  height: number
}

export interface TextLayout {
  style: ResolvedTextStyle
  /** CSS `font` shorthand for this clip (`<weight> <size>px <family>`). */
  font: string
  /** Wrapped display lines. */
  lines: string[]
  /** Vertical advance between line baselines. */
  lineAdvance: number
  /** X passed to `fillText` for every line (depends on textAlign). */
  anchorX: number
  /** Y of the first line's baseline; textBaseline must be `'middle'`. */
  firstLineY: number
  /** Tight bounding box of the painted glyphs, in stage space. */
  box: StageRect
  /** Normalized (0..1) stage position of the block centre. */
  center: { x: number; y: number }
}

/** Apply TextLayer's defaults to an (Active)TextClip's optional style fields. */
export function resolveTextStyle(item: {
  fontSize?: number
  color?: string
  fontFamily?: string
  fontWeight?: 'normal' | 'bold'
  textAlign?: 'left' | 'center' | 'right'
}): ResolvedTextStyle {
  return {
    fontSize: item.fontSize ?? DEFAULT_FONT_SIZE,
    color: item.color ?? DEFAULT_COLOR,
    fontFamily: item.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontWeight: item.fontWeight ?? DEFAULT_FONT_WEIGHT,
    textAlign: item.textAlign ?? DEFAULT_TEXT_ALIGN,
  }
}

/** Greedy word-wrap to `maxWidth`, honouring explicit `\n` paragraph breaks. */
export function wrapText(
  measure: TextMeasurer,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ')
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (line && measure.measureText(candidate).width > maxWidth) {
        out.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    out.push(line)
  }
  return out
}

/**
 * Compute the full layout of a text clip in stage space.
 *
 * `measure.font` is set as a side effect (so the caller can immediately paint
 * with the same metrics that produced the box).
 */
export function computeTextLayout(
  measure: TextMeasurer,
  item: Pick<ActiveTextClip, 'content' | 'transform'> & Partial<ResolvedTextStyle>,
  stage: { width: number; height: number },
): TextLayout {
  const style = resolveTextStyle(item)
  const font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`
  measure.font = font

  const maxWidth = stage.width * (1 - 2 * SIDE_MARGIN)
  const lines = wrapText(measure, item.content, maxWidth)

  const lineAdvance = style.fontSize * LINE_HEIGHT
  const blockHeight = lines.length * lineAdvance

  let maxLineWidth = 0
  for (const line of lines) {
    const w = measure.measureText(line).width
    if (w > maxLineWidth) maxLineWidth = w
  }

  // transform.x/y position the block CENTER; default to the stage centre.
  const center = {
    x: item.transform ? item.transform.x : 0.5,
    y: item.transform ? item.transform.y : 0.5,
  }
  const centerX = center.x * stage.width
  const centerY = center.y * stage.height

  const boxX = centerX - maxLineWidth / 2
  const boxY = centerY - blockHeight / 2

  // The block is centred at `centerX`; textAlign only changes where each line
  // anchors within that block.
  let anchorX: number
  if (style.textAlign === 'left') {
    anchorX = boxX
  } else if (style.textAlign === 'right') {
    anchorX = boxX + maxLineWidth
  } else {
    anchorX = centerX
  }

  const firstLineY = boxY + lineAdvance / 2

  return {
    style,
    font,
    lines,
    lineAdvance,
    anchorX,
    firstLineY,
    box: { x: boxX, y: boxY, width: maxLineWidth, height: blockHeight },
    center,
  }
}
