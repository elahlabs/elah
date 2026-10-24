/**
 * Shared word/line layout math for the type components (AV-8a): kinetic-title
 * needs to place individual words (so an emphasis word can be its own
 * serif-italic element anchored to the line), and circled-phrase/quote-card
 * need an approximate text width to size a loop, an underline or a marker
 * sweep around a phrase.
 *
 * There is no real font metrics call available to a pure spec builder, so
 * width is an ESTIMATE (avg glyph width as a fraction of cap size) — good
 * enough to lay things out and size decoration around them; not a claim of
 * pixel-accurate typesetting. Deterministic, so a test can pin it.
 *
 * This is a helper file under `library/`, not `motion.ts` — AV-8b is using
 * that file in parallel (see TICKET-AV-8a.md). Both `kineticTitle.ts` and
 * `circledPhrase.ts` / `quoteCard.ts` import from here.
 */

import type { SpecFormat } from '../../types'
import { fx, fy } from '../motion'

/** Average glyph advance as a fraction of cap size, for a proportional sans/serif face. */
export const CHAR_WIDTH_FACTOR = 0.56
/** A space's width, same units. */
export const SPACE_FACTOR = 0.32

export function estWordWidth(word: string, size: number): number {
  return word.length * size * CHAR_WIDTH_FACTOR
}

/** Estimated width in stage px of one line of `text` set at `size`. */
export function estTextWidth(text: string, size: number): number {
  return text.length * size * CHAR_WIDTH_FACTOR
}

export interface WordPos {
  word: string
  /** Fraction of stage width — the word's own centre. */
  x: number
  /** Fraction of stage height — the word's own centre (its line's centre). */
  y: number
  line: number
  index: number
  /** Estimated width, stage px — for sizing decoration around the word. */
  widthPx: number
}

export interface WordLayoutResult {
  words: WordPos[]
  lineCount: number
  /** Fraction of stage height — top edge of the whole block. */
  top: number
  /** Fraction of stage height — bottom edge of the whole block. */
  bottom: number
}

/**
 * Greedy-wrap `words` into centred lines inside `maxWidthFrac` of the stage,
 * stacked around `centerYFrac`. Deterministic; no randomness.
 */
export function layoutWords(
  format: SpecFormat,
  words: ReadonlyArray<string>,
  size: number,
  opts: { maxWidthFrac?: number; lineHeightPx?: number; centerYFrac?: number } = {},
): WordLayoutResult {
  const maxWidthPx = (opts.maxWidthFrac ?? 0.84) * format.width
  const spaceW = size * SPACE_FACTOR
  const lineHeightPx = opts.lineHeightPx ?? size * 1.15
  const centerYFrac = opts.centerYFrac ?? 0.45

  const lines: string[][] = []
  let cur: string[] = []
  let curWidth = 0
  for (const w of words) {
    const ww = estWordWidth(w, size)
    const extra = cur.length > 0 ? spaceW + ww : ww
    if (cur.length > 0 && curWidth + extra > maxWidthPx) {
      lines.push(cur)
      cur = [w]
      curWidth = ww
    } else {
      cur.push(w)
      curWidth += extra
    }
  }
  if (cur.length > 0 || lines.length === 0) lines.push(cur)

  const totalH = lineHeightPx * Math.max(0, lines.length - 1)
  const startY = centerYFrac - fy(format, totalH) / 2

  const out: WordPos[] = []
  let index = 0
  lines.forEach((line, li) => {
    const widths = line.map((w) => estWordWidth(w, size))
    const lineWidth = widths.reduce((a, b) => a + b, 0) + spaceW * Math.max(0, line.length - 1)
    let cx = -lineWidth / 2
    line.forEach((w, i) => {
      const ww = widths[i]!
      const centreX = cx + ww / 2
      out.push({
        word: w,
        x: 0.5 + fx(format, centreX),
        y: startY + fy(format, lineHeightPx * li),
        line: li,
        index,
        widthPx: ww,
      })
      cx += ww + spaceW
      index++
    })
  })

  return {
    words: out,
    lineCount: lines.length,
    top: startY - fy(format, lineHeightPx / 2),
    bottom: startY + fy(format, lineHeightPx * Math.max(0, lines.length - 1) + lineHeightPx / 2),
  }
}
