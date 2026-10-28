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
import type { TextBox, TextOverflow, TextVerticalAlign, Transform, FontStyle, FontWeight } from '../../../types'

export const DEFAULT_FONT_SIZE = 48
export const DEFAULT_COLOR = '#ffffff'
export const DEFAULT_FONT_FAMILY = 'sans-serif'
export const DEFAULT_FONT_WEIGHT: 'normal' | 'bold' = 'normal'
export const DEFAULT_TEXT_ALIGN: 'left' | 'center' | 'right' = 'center'
/** Undefined = no background painted behind the glyphs. */
export const DEFAULT_BACKGROUND_COLOR: string | undefined = undefined
export const DEFAULT_BACKGROUND_OPACITY = 1
export const DEFAULT_PADDING = 0
export const DEFAULT_BORDER_RADIUS = 0
export const DEFAULT_BORDER_WIDTH = 0
export const DEFAULT_BORDER_COLOR = '#ffffff'

/** Fraction of stage width left empty on each side (text wraps within the rest). */
export const SIDE_MARGIN = 0.05
/** Multiplier applied to fontSize to get the line advance. */
export const LINE_HEIGHT = 1.2
/** The floor `overflow: 'shrink'` will not go below, in stage px at scale 1. */
export const DEFAULT_MIN_FONT_SIZE = 8

/**
 * This module takes a 2D *context* subset, named `MeasureContext`; the
 * interface-shaped `TextMeasurer` in `./textMeasure` is what callers hold, and
 * `measureContextFor` adapts one to the other. PV-P2b deleted the duplicate
 * `TextMeasurer` type that used to be exported from here, so a caller can no
 * longer pick up the wrong one by accident.
 */
import { trackedWidth, type MeasureContext } from './textMeasure'
import { fontFamilyCss } from '../../../fonts/registry'
import { textRuns, type TextRun } from '../../../elements/textSpans'

export interface ResolvedTextStyle {
  fontSize: number
  color: string
  fontFamily: string
  fontWeight: FontWeight
  /** Present only when the clip sets it (PV-P4b). */
  fontStyle?: FontStyle
  textAlign: 'left' | 'center' | 'right'
  /** Undefined = no background painted behind the glyphs. */
  backgroundColor?: string
  backgroundOpacity: number
  padding: number
  borderRadius: number
  borderWidth: number
  borderColor: string
}

/** Bounding box in stage-space pixels. */
export interface StageRect {
  x: number
  y: number
  width: number
  height: number
}

/** One styled piece of a wrapped line (spans only). */
export interface LinePiece {
  text: string
  font: string
  width: number
  color?: string
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
  /** v2 only, present when scaleX or scaleY ≠ 1: the stretch the painter applies about `center`. */
  stretch?: { x: number; y: number }
  /** PV-P3a: the wrap width in stage px (the inline editor sizes itself by it). */
  wrapWidth?: number
  /** PV-P3a, when ≠ 0: tracking in stage px that the painter applies. */
  letterSpacing?: number
  /** PV-P3a, overflow 'clip': the content area (padding excluded) glyphs are clipped to. */
  clipRect?: StageRect
  /** PV-P4c-2: present only when the clip has spans — each line's pieces, left to right. */
  pieces?: LinePiece[][]
}

/** A number, or the fallback when the stored value is not one. */
function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Where the block's centre sits, normalized. Legacy: `transform.x/y` IS the
 * centre. v2 (PV-P2): `transform.x/y` is the anchor point of the padded box,
 * stretched by scaleX/scaleY, as `resolveTransformRect` places an image. At
 * anchor 0.5/0.5 the added offset is exactly 0, so the result is the legacy
 * value bit for bit.
 */
export function blockCenter(
  item: { transform?: Transform; transformModel?: 'v2' },
  stage: { width: number; height: number },
  boxWidth: number,
  boxHeight: number,
): { center: { x: number; y: number }; stretch?: { x: number; y: number } } {
  const t = item.transform
  const center = { x: t ? t.x : 0.5, y: t ? t.y : 0.5 }
  if (item.transformModel !== 'v2' || !t) return { center }

  const sx = finite(t.scaleX, 1)
  const sy = finite(t.scaleY, 1)
  const ax = finite(t.anchor?.x, 0.5)
  const ay = finite(t.anchor?.y, 0.5)
  // ADDED to the legacy value, never recomputed from it: `(x * W) / W` is not
  // always `x` in floating point, and the default-anchor case has to stay the
  // same double or a v2 title on an old project moves in the last decimal.
  center.x += ((0.5 - ax) * boxWidth * sx) / stage.width
  center.y += ((0.5 - ay) * boxHeight * sy) / stage.height
  // `!== 1`, not `!== undefined`: the Transform tab writes `scaleX: 1` on every
  // commit, and a stretch of 1 must not reach the painter as a `ctx.scale`.
  return sx !== 1 || sy !== 1 ? { center, stretch: { x: sx, y: sy } } : { center }
}

/** Apply TextLayer's defaults to an (Active)TextClip's optional style fields. */
export function resolveTextStyle(item: {
  fontSize?: number
  color?: string
  fontFamily?: string
  /** PV-P4a: a bundled font id; wins over `fontFamily` when the registry knows it. */
  fontId?: string
  fontWeight?: FontWeight
  /** PV-P4b: 'italic', or absent for normal. */
  fontStyle?: FontStyle
  textAlign?: 'left' | 'center' | 'right'
  backgroundColor?: string
  backgroundOpacity?: number
  padding?: number
  borderRadius?: number
  borderWidth?: number
  borderColor?: string
}): ResolvedTextStyle {
  return {
    fontSize: item.fontSize ?? DEFAULT_FONT_SIZE,
    color: item.color ?? DEFAULT_COLOR,
    // PV-P4a. `fontFamilyCss` returns undefined for an id the registry does not
    // know, so the two fallbacks are not alternatives to each other but a chain:
    // a KNOWN id wins, an unknown one defers to the clip's own `fontFamily`, and
    // a clip with neither keeps the old default. A clip with no `fontId` takes
    // the identical path it took before this line existed, because the
    // conditional yields undefined and `??` then reads `item.fontFamily`.
    fontFamily: (item.fontId !== undefined ? fontFamilyCss(item.fontId) : undefined) ?? item.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontWeight: item.fontWeight ?? DEFAULT_FONT_WEIGHT,
    // PV-P4b: conditional so a legacy clip resolves to a style with NO fontStyle
    // key at all, which is what keeps `cssFont` on its byte-identical branch.
    ...(item.fontStyle !== undefined ? { fontStyle: item.fontStyle } : {}),
    textAlign: item.textAlign ?? DEFAULT_TEXT_ALIGN,
    backgroundColor: item.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
    backgroundOpacity: item.backgroundOpacity ?? DEFAULT_BACKGROUND_OPACITY,
    padding: item.padding ?? DEFAULT_PADDING,
    borderRadius: item.borderRadius ?? DEFAULT_BORDER_RADIUS,
    borderWidth: item.borderWidth ?? DEFAULT_BORDER_WIDTH,
    borderColor: item.borderColor ?? DEFAULT_BORDER_COLOR,
  }
}

/**
 * The canvas `font` shorthand for a resolved style (PV-P4b).
 *
 * The legacy branch is the pre-P4b template LITERALLY, and it is the branch
 * every existing document takes: with no `fontStyle` and a keyword weight the
 * string is `${weight} ${size}px ${family}`, unchanged. The style and weight
 * slots are only ever emitted when the clip actually asks for them, because a
 * font string that fails to parse is IGNORED SILENTLY by a 2D context — the
 * previous value simply stays, and the bug looks like a stale render.
 *
 * `normal 700 48px sans-serif` is valid CSS: the leading `normal` is read as
 * the font-style, and a numeric weight with no style slot is not.
 */
export function cssFont(
  style: Pick<ResolvedTextStyle, 'fontWeight' | 'fontStyle' | 'fontFamily'>,
  fontSizePx: number,
): string {
  if (style.fontStyle === undefined && typeof style.fontWeight !== 'number') {
    return `${style.fontWeight} ${fontSizePx}px ${style.fontFamily}`
  }
  return `${style.fontStyle ?? 'normal'} ${style.fontWeight} ${fontSizePx}px ${style.fontFamily}`
}

/** Greedy word-wrap to `maxWidth`, honouring explicit `\n` paragraph breaks. */
export function wrapText(
  measure: MeasureContext,
  text: string,
  maxWidth: number,
  letterSpacing = 0,
): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ')
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      // `trackedWidth` is a no-op at 0, so the legacy three-argument call site
      // takes exactly the branch it took before this parameter existed.
      if (line && trackedWidth(measure.measureText(candidate).width, candidate, letterSpacing) > maxWidth) {
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
 * A text box with every default applied and every stored value clamped (PV-P3a).
 *
 * Every field is validated, because this reads a STORED document: nothing
 * validates `textBox` on load, so a hand-edited or truncated file can put
 * anything here. The rule throughout is the same as `resolveTextStyle`'s — an
 * unusable value falls back to the default rather than propagating, because a
 * text box that lays out to `NaN` paints nothing at all.
 */
export interface ResolvedTextBox {
  /** Wrap width, stage px (already × scale when authored). */
  wrapWidth: number
  /** True when `width` was authored: the box is exactly `wrapWidth` wide. */
  fixedWidth: boolean
  maxLines?: number
  overflow: TextOverflow
  /** Stage px, × scale. */
  minFontSize: number
  verticalAlign: TextVerticalAlign
  /** Stage px, × scale. */
  letterSpacing: number
  lineHeight: number
}

/** Defaults and clamps, applied once. Pure; exported for tests. */
export function resolveTextBox(
  tb: TextBox,
  scale: number,
  stage: { width: number; height: number },
): ResolvedTextBox {
  const fixed = typeof tb.width === 'number' && Number.isFinite(tb.width) && tb.width > 0
  return {
    wrapWidth: fixed ? tb.width! * scale : stage.width * (1 - 2 * SIDE_MARGIN),
    fixedWidth: fixed,
    maxLines:
      typeof tb.maxLines === 'number' && Number.isFinite(tb.maxLines) && tb.maxLines >= 1
        ? Math.floor(tb.maxLines)
        : undefined,
    overflow: tb.overflow === 'shrink' || tb.overflow === 'clip' ? tb.overflow : 'wrap',
    minFontSize:
      typeof tb.minFontSize === 'number' && Number.isFinite(tb.minFontSize) && tb.minFontSize > 0
        ? tb.minFontSize * scale
        : DEFAULT_MIN_FONT_SIZE * scale,
    verticalAlign:
      tb.verticalAlign === 'top' || tb.verticalAlign === 'bottom' ? tb.verticalAlign : 'middle',
    letterSpacing: typeof tb.letterSpacing === 'number' && Number.isFinite(tb.letterSpacing) ? tb.letterSpacing * scale : 0,
    lineHeight:
      typeof tb.lineHeight === 'number' && Number.isFinite(tb.lineHeight)
        ? Math.max(0.5, Math.min(4, tb.lineHeight))
        : LINE_HEIGHT,
  }
}

/** `computeTextLayout`'s input, widened with the one field the box needs. */
type TextLayoutItem = Pick<
  ActiveTextClip,
  'content' | 'transform' | 'transformModel' | 'textBox' | 'fontId' | 'fontStyle' | 'spans'
> &
  Partial<ResolvedTextStyle>

/**
 * The largest font size at which the text fits the box: no more than
 * `maxLines` lines, and no line wider than the wrap width (PV-P3a).
 *
 * A bounded binary search, 12 iterations over a bracket that halves each time,
 * which is why 12 is not a tuning number: `[lo, hi]` starts at most
 * `fontSize / minFontSize` apart in practice and reaches sub-pixel precision in
 * about six steps. `fits` is monotonic — a smaller font is never wider — so the
 * bracket is real and the loop terminates.
 *
 * The floor and the ceiling are both honoured: a size that already fits returns
 * unchanged, and one that fits at NO size returns the floor rather than
 * continuing to search below it.
 */
function shrinkFontSize(measure: MeasureContext, text: string, style: ResolvedTextStyle, box: ResolvedTextBox): number {
  // PV-P4b: `cssFont` in the shrink loop too, not just at the two final sites.
  // A shrunk box measures each candidate size, and a candidate measured with a
  // different font string than it is finally painted with is a box that fits on
  // paper and overflows on screen.
  const font = (size: number) => cssFont(style, size)
  const fits = (size: number): boolean => {
    measure.font = font(size)
    const lines = wrapText(measure, text, box.wrapWidth, box.letterSpacing)
    if (box.maxLines !== undefined && lines.length > box.maxLines) return false
    return lines.every(
      (line) => trackedWidth(measure.measureText(line).width, line, box.letterSpacing) <= box.wrapWidth,
    )
  }

  let hi = style.fontSize
  let lo = Math.min(hi, box.minFontSize)
  if (fits(hi)) return hi
  if (!fits(lo)) return lo
  for (let i = 0; i < 12 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) lo = mid
    else hi = mid
  }
  // Half-pixel floor, so the result is a size a font stack can actually honour
  // and the test can state exactly.
  return Math.max(Math.min(style.fontSize, box.minFontSize), Math.floor(lo * 2) / 2)
}

/**
 * The layout for a clip that carries a `textBox` (PV-P3a).
 *
 * The legacy path in `computeTextLayout` is untouched and still the default;
 * this is the branch a box opts into. The order of operations is fixed:
 * shrink the font first (it changes the wrap, so it must precede it), then wrap
 * at the resolved width, then drop or keep lines, then size the block, and only
 * then place it — because the box's own width is what `textAlign` aligns inside.
 */
function computeBoxedLayout(
  measure: MeasureContext,
  item: TextLayoutItem,
  stage: { width: number; height: number },
  style: ResolvedTextStyle,
  box: ResolvedTextBox,
): TextLayout {
  if (box.overflow === 'shrink') {
    style.fontSize = shrinkFontSize(measure, item.content, style, box)
  }
  // The painter paints with whatever font this leaves on the context, so this
  // assignment is load-bearing after a shrink, not a duplicate of the one above.
  const font = cssFont(style, style.fontSize)
  measure.font = font

  let lines = wrapText(measure, item.content, box.wrapWidth, box.letterSpacing)
  if (box.overflow === 'clip' && box.maxLines !== undefined && lines.length > box.maxLines) {
    lines = lines.slice(0, box.maxLines)
  }

  const lineAdvance = style.fontSize * box.lineHeight
  // A box with a line limit is that many rows tall even when the text is
  // shorter, which is what gives `verticalAlign` something to align inside.
  // 'wrap' has no line limit, so its box hugs the text.
  const rows = box.overflow !== 'wrap' && box.maxLines !== undefined ? Math.max(box.maxLines, lines.length) : lines.length
  const blockHeight = rows * lineAdvance

  let maxLineWidth = 0
  for (const line of lines) {
    const w = trackedWidth(measure.measureText(line).width, line, box.letterSpacing)
    if (w > maxLineWidth) maxLineWidth = w
  }
  // A fixed-width box is exactly as wide as it was asked to be, even when the
  // text inside it is narrower — that is the whole point of authoring a width.
  const contentWidth = box.fixedWidth ? box.wrapWidth : maxLineWidth

  const { center, stretch } = blockCenter(
    item,
    stage,
    contentWidth + style.padding * 2,
    blockHeight + style.padding * 2,
  )
  const centerX = center.x * stage.width
  const centerY = center.y * stage.height

  const boxX = centerX - contentWidth / 2
  const boxY = centerY - blockHeight / 2

  let anchorX: number
  if (style.textAlign === 'left') {
    anchorX = boxX
  } else if (style.textAlign === 'right') {
    anchorX = boxX + contentWidth
  } else {
    anchorX = centerX
  }

  // The slack is the empty rows at the bottom of a taller-than-text box.
  const slack = (rows - lines.length) * lineAdvance
  const offset = box.verticalAlign === 'top' ? 0 : box.verticalAlign === 'bottom' ? slack : slack / 2
  const firstLineY = boxY + offset + lineAdvance / 2

  const padding = style.padding
  const laidOut: StageRect = {
    x: boxX - padding,
    y: boxY - padding,
    width: contentWidth + padding * 2,
    height: blockHeight + padding * 2,
  }

  return {
    style,
    font,
    lines,
    lineAdvance,
    anchorX,
    firstLineY,
    box: laidOut,
    center,
    ...(stretch ? { stretch } : {}),
    wrapWidth: box.wrapWidth,
    ...(box.letterSpacing ? { letterSpacing: box.letterSpacing } : {}),
    // Only a clipped box clips: a wrapped or shrunk one is exactly as tall as
    // its own lines, so a clip rect there would be a no-op with a cost.
    ...(box.overflow === 'clip'
      ? { clipRect: { x: boxX, y: boxY, width: contentWidth, height: blockHeight } }
      : {}),
  }
}

/**
 * Compute the full layout of a text clip in stage space.
 *
 * `measure.font` is set as a side effect (so the caller can immediately paint
 * with the same metrics that produced the box).
 */
/**
 * Wrap `content` into `[start, end)` ranges, measuring each candidate with the
 * font of whichever run it falls in (PV-P4c-2).
 *
 * A deliberate re-implementation of `wrapText`'s ALGORITHM rather than a call into
 * it, because `wrapText` measures a candidate as one string and a candidate with
 * spans is several fonts. The loop is line-for-line the same — including the two
 * quirks the Gotchas warn about, a dropped leading space and kept double spaces —
 * and `__tests__/textSpans.test.ts` asserts the two produce identical `lines` for
 * the same content. **Do not "fix" either one.**
 */
function wrapRuns(
  content: string,
  maxWidth: number,
  widthOf: (from: number, to: number) => number,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let base = 0
  for (const paragraph of content.split('\n')) {
    let line = ''
    let lineStart = base
    let pos = base
    for (const word of paragraph.split(' ')) {
      const wordStart = pos
      if (line && widthOf(lineStart, wordStart + word.length) > maxWidth) {
        out.push([lineStart, lineStart + line.length])
        line = word
        lineStart = wordStart
      } else if (line) {
        line = line + ' ' + word
      } else {
        line = word
        lineStart = wordStart
      }
      pos = wordStart + word.length + 1
    }
    out.push([lineStart, lineStart + line.length])
    base += paragraph.length + 1
  }
  return out
}

export function computeTextLayout(
  measure: MeasureContext,
  item: TextLayoutItem,
  stage: { width: number; height: number },
): TextLayout {
  const style = resolveTextStyle(item)
  // transform.scale multiplies the glyph size, re-rasterizing at the larger size
  // so text stays crisp (rather than bitmap-scaling the quad). This keeps the
  // GPU layer and the editor overlay — both of which read style.fontSize —
  // agreeing on the painted size. (Rotation is applied separately, in the shader.)
  const scale = item.transform?.scale ?? 1
  if (scale !== 1) style.fontSize *= scale
  // PV-P3a: a clip with a box takes the boxed path and nothing below this line.
  // A clip without one falls straight through to the untouched legacy layout.
  if (item.textBox) {
    return computeBoxedLayout(measure, item, stage, style, resolveTextBox(item.textBox, scale, stage))
  }
  const font = cssFont(style, style.fontSize)
  measure.font = font

  const maxWidth = stage.width * (1 - 2 * SIDE_MARGIN)

  // PV-P4c-2: the run path. `runs === undefined` means the clip has no spans and
  // every line below is the code that was there before, untouched.
  const runs = item.spans?.length ? textRuns(item.content, item.spans) : undefined
  let lines: string[]
  let pieces: LinePiece[][] | undefined
  let maxLineWidth = 0

  if (runs === undefined) {
    lines = wrapText(measure, item.content, maxWidth)
    for (const line of lines) {
      const w = measure.measureText(line).width
      if (w > maxLineWidth) maxLineWidth = w
    }
  } else {
    /** The font for a run: the clip's own, unless the run overrides weight or style. */
    const runFont = (run: TextRun): string => {
      if (run.style.fontWeight === undefined && run.style.fontStyle === undefined) return font
      return cssFont(
        {
          fontFamily: style.fontFamily,
          fontWeight: run.style.fontWeight ?? style.fontWeight,
          fontStyle: run.style.fontStyle ?? style.fontStyle,
        },
        style.fontSize,
      )
    }
    /** Width of `[a, b)`, summed over the runs that overlap it, each in its own font. */
    const widthOf = (a: number, b: number): number => {
      let total = 0
      for (const run of runs) {
        if (run.end <= a || run.start >= b) continue
        measure.font = runFont(run)
        total += measure.measureText(item.content.slice(Math.max(a, run.start), Math.min(b, run.end))).width
      }
      return total
    }
    const ranges = wrapRuns(item.content, maxWidth, widthOf)
    lines = ranges.map(([a, b]) => item.content.slice(a, b))
    pieces = ranges.map(([a, b]) => {
      const linePieces: LinePiece[] = []
      for (const run of runs) {
        if (run.end <= a || run.start >= b) continue
        const text = item.content.slice(Math.max(a, run.start), Math.min(b, run.end))
        if (text === '') continue
        const pieceFont = runFont(run)
        measure.font = pieceFont
        linePieces.push({
          text,
          font: pieceFont,
          width: measure.measureText(text).width,
          ...(run.style.color ? { color: run.style.color } : {}),
        })
      }
      return linePieces
    })
    for (const linePieces of pieces) {
      const w = linePieces.reduce((sum, piece) => sum + piece.width, 0)
      if (w > maxLineWidth) maxLineWidth = w
    }
    // Callers (the painter, the measurer) expect the BASE font left on the context.
    measure.font = font
  }

  const lineAdvance = style.fontSize * LINE_HEIGHT
  const blockHeight = lines.length * lineAdvance

  // transform.x/y position the block CENTER; default to the stage centre.
  // Under v2 they name the anchor point of the padded box instead, which moves
  // the centre by the box's own half-extent - see `blockCenter`.
  const { center, stretch } = blockCenter(
    item,
    stage,
    maxLineWidth + style.padding * 2,
    blockHeight + style.padding * 2,
  )
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

  // The glyph box padded out by `style.padding` — this is what the background
  // fill/border paint, and what the editor overlay draws its selection box
  // around, so padding reads as "space around the text" rather than shifting
  // the glyphs themselves (anchorX/firstLineY above stay glyph-tight).
  const padding = style.padding
  const box: StageRect = {
    x: boxX - padding,
    y: boxY - padding,
    width: maxLineWidth + padding * 2,
    height: blockHeight + padding * 2,
  }

  return {
    style,
    font,
    lines,
    lineAdvance,
    anchorX,
    firstLineY,
    box,
    center,
    // Absent unless v2 asked for a real stretch, so a legacy layout object has
    // exactly the keys it had before.
    ...(stretch ? { stretch } : {}),
    // Absent unless the clip has spans, so `'pieces' in layout` is the test for
    // "is this a run layout" and a no-span clip's object is unchanged.
    ...(pieces ? { pieces } : {}),
  }
}
