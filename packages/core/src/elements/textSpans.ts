/**
 * Styled runs of a text clip's content (PV-P4c-2).
 *
 * EVERY function here is built on ONE representation: a style per UTF-16 code
 * unit (`unitStyles`). Overlapping spans, out-of-range offsets, clamping, partial
 * edits and merging adjacent runs then all fall out of the same fifteen lines
 * instead of being five separate pieces of set arithmetic — and the awkward cases
 * (a span starting before the text, an emoji split in half, a field present on
 * one span and absent on the next) are handled once, in one place.
 *
 * Pure and DOM-free. The offsets are UTF-16 units, which is exactly what
 * `textarea.selectionStart` speaks, so the inline editor needs no conversion.
 */
import type { Clip, FontStyle, FontWeight, TextSpan } from '../types'

/** The three fields a span can carry. Absent = inherit the clip's own value. */
export type SpanStyle = Pick<TextSpan, 'fontWeight' | 'fontStyle' | 'color'>

/** A value sets the field over the range; `null` removes it (the clip's own style shows). */
export interface SpanPatch {
  fontWeight?: FontWeight | null
  fontStyle?: FontStyle | null
  color?: string | null
}

/** A maximal stretch of content sharing one style. */
export interface TextRun {
  start: number
  end: number
  style: SpanStyle
}

/** The bold threshold, shared with the picker's `legacyWeight` (600). */
const BOLD_AT = 600

/** `'bold'`, or a numeric weight at or above the bold threshold. */
export function isBoldWeight(weight: FontWeight | undefined): boolean {
  if (weight === 'bold') return true
  return typeof weight === 'number' && weight >= BOLD_AT
}

/** A fresh style object per unit — never shared, so a caller cannot alias two units. */
function unitStyles(length: number, spans: readonly TextSpan[] | undefined): SpanStyle[] {
  const units: SpanStyle[] = Array.from({ length: Math.max(0, Math.floor(length)) }, () => ({}))
  if (!spans) return units
  for (const span of spans) {
    if (!span || !Number.isFinite(span.start) || !Number.isFinite(span.end)) continue
    // Clamped to the content, so a span authored against longer text cannot
    // index past the end. floor() because a fractional offset is a document bug
    // and truncating is the only total order available.
    const from = Math.max(0, Math.min(units.length, Math.floor(span.start)))
    const to = Math.max(0, Math.min(units.length, Math.floor(span.end)))
    for (let i = from; i < to; i++) {
      const unit = units[i]!
      // Later spans win FIELD BY FIELD, so a span that sets only `color` does not
      // wipe an earlier span's weight. `undefined` means "inherit", and is skipped
      // rather than assigned, which is what makes field-by-field merging work.
      if (span.fontWeight !== undefined) unit.fontWeight = span.fontWeight
      if (span.fontStyle !== undefined) unit.fontStyle = span.fontStyle
      if (span.color !== undefined) unit.color = span.color
    }
  }
  return units
}

function sameStyle(a: SpanStyle, b: SpanStyle): boolean {
  return a.fontWeight === b.fontWeight && a.fontStyle === b.fontStyle && a.color === b.color
}

function hasStyle(style: SpanStyle): boolean {
  return style.fontWeight !== undefined || style.fontStyle !== undefined || style.color !== undefined
}

/**
 * The content as maximal same-style runs, covering the WHOLE string.
 *
 * The unstyled head and tail are real runs with an empty `style`: a caller
 * measuring a line has to know where the styled parts are, and returning only the
 * styled runs would make every consumer re-derive the gaps.
 */
export function textRuns(content: string, spans: readonly TextSpan[] | undefined): TextRun[] {
  const units = unitStyles(content.length, spans)
  const runs: TextRun[] = []
  for (let i = 0; i < units.length; i++) {
    const style = units[i]!
    const last = runs[runs.length - 1]
    if (last && sameStyle(last.style, style)) last.end = i + 1
    else runs.push({ start: i, end: i + 1, style: { ...style } })
  }
  return runs
}

/** The canonical stored form: sorted, non-overlapping, and only the styled runs. */
export function normalizeSpans(content: string, spans: readonly TextSpan[] | undefined): TextSpan[] {
  return textRuns(content, spans)
    .filter((run) => hasStyle(run.style))
    .map((run) => ({ start: run.start, end: run.end, ...run.style }))
}

/**
 * Apply `patch` to `[start, end)` of the content, clamped, and return the
 * normalized spans.
 *
 * A `null` DELETES the field rather than setting a default, which is what makes
 * "Clear styling" return a range to the clip's own style instead of freezing
 * whatever the clip happened to be using when the button was pressed.
 */
export function applySpanStyle(
  content: string,
  spans: readonly TextSpan[] | undefined,
  start: number,
  end: number,
  patch: SpanPatch,
): TextSpan[] {
  const length = content.length
  const units = unitStyles(length, spans)
  const from = Math.max(0, Math.min(length, Math.floor(start)))
  const to = Math.max(0, Math.min(length, Math.floor(end)))
  for (let i = from; i < to; i++) {
    const unit = units[i]!
    for (const key of ['fontWeight', 'fontStyle', 'color'] as const) {
      if (!(key in patch)) continue
      const value = patch[key]
      if (value === null) delete unit[key]
      else (unit as Record<string, unknown>)[key] = value
    }
  }
  return normalizeSpans(
    content,
    units.map((style, i) => (hasStyle(style) ? { start: i, end: i + 1, ...style } : undefined)).filter(Boolean) as TextSpan[],
  )
}

/** True when `test` holds for EVERY unit in `[start, end)`; false for an empty range. */
export function spanRangeEvery(
  content: string,
  spans: readonly TextSpan[] | undefined,
  start: number,
  end: number,
  test: (style: SpanStyle) => boolean,
): boolean {
  const length = content.length
  const from = Math.max(0, Math.min(length, Math.floor(start)))
  const to = Math.max(0, Math.min(length, Math.floor(end)))
  // An empty range is NOT vacuously true: the toolbar's "is the whole selection
  // bold?" question has to answer false for a collapsed caret, or a click with no
  // selection would report the clip's state and then apply a patch to nothing.
  if (to <= from) return false
  const units = unitStyles(length, spans)
  for (let i = from; i < to; i++) if (!test(units[i]!)) return false
  return true
}

/**
 * Move spans onto new content, so typing keeps its styling attached to its text.
 *
 * The interesting boundaries, and all four are deliberate:
 *  - typing INSIDE a span, or at its END, extends it (you are still typing that
 *    styled run);
 *  - typing at a span's START does not extend it (the new character belongs to
 *    what came before);
 *  - replacing a whole styled word KEEPS the style (the user retyped it in place);
 *  - deleting a styled word DROPS the span (nothing is left to style).
 *
 * Derived from the common prefix/suffix of the two strings, which is the standard
 * way to treat an edit as a replacement of the differing middle.
 */
export function remapSpans(
  oldContent: string,
  newContent: string,
  spans: readonly TextSpan[] | undefined,
): TextSpan[] {
  if (!spans || spans.length === 0) return []
  const oldLen = oldContent.length
  const newLen = newContent.length

  let p = 0
  while (p < oldLen && p < newLen && oldContent[p] === newContent[p]) p++
  // Capped so prefix and suffix cannot overlap: `min(oldLen, newLen) - p` is the
  // most suffix that still leaves the differing middle intact.
  let s = 0
  while (s < Math.min(oldLen, newLen) - p && oldContent[oldLen - 1 - s] === newContent[newLen - 1 - s]) s++

  const oldEnd = oldLen - s
  const newEnd = newLen - s
  const delta = newLen - oldLen

  const mapStart = (o: number): number => {
    if (o < p) return o
    if (o === p && p < oldEnd) return p
    if (o >= oldEnd) return o + delta
    return newEnd
  }
  const mapEnd = (o: number): number => {
    if (o < p) return o
    if (o >= oldEnd) return o + delta
    return newEnd
  }

  const mapped = spans
    .map((span) => ({
      ...span,
      start: Math.max(0, Math.min(newLen, mapStart(span.start))),
      end: Math.max(0, Math.min(newLen, mapEnd(span.end))),
    }))
    // An inverted or empty range is not a span; normalizeSpans would drop it, but
    // dropping it here keeps the intermediate list honest.
    .filter((span) => span.end > span.start)

  return normalizeSpans(newContent, mapped)
}

/**
 * The patch an inline text edit writes: the new content, plus remapped spans —
 * but ONLY if the clip already had spans.
 *
 * The conditional matters: a clip that never had spans must receive a patch whose
 * keys are exactly `{ content }`, or every keystroke in every title would write an
 * empty `spans` array into the document and mark it dirty for no reason.
 */
export function contentPatch(clip: Pick<Clip, 'content' | 'spans'>, next: string): Partial<Clip> {
  if (!clip.spans || clip.spans.length === 0) return { content: next }
  const spans = remapSpans(clip.content ?? '', next, clip.spans)
  // `spans` is present as a key even when it ends up empty: that is how "delete
  // the styled word" clears the styling instead of leaving a stale range behind.
  return { content: next, spans: spans.length ? spans : undefined }
}
