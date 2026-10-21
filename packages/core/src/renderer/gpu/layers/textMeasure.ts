/**
 * Measuring text, DOM-free (PV-P2a, consumed by PV-P3b).
 *
 * One interface, `TextMeasurer`, so anything that needs a glyph width - the
 * preview's overlay, an element's frame, and later the resolver's own layout
 * pass - can be handed a measurer instead of a 2D context. A context is
 * implemented here (`createCanvasMeasurer`); a test, a worker or a font-metrics
 * table can implement the interface without one.
 *
 * `measureContextFor` goes the other way, because `computeTextLayout` predates
 * this and takes a context. It is deliberately untracked: tracking is layout's
 * business (PV-P3a), and a measurer that already tracked would double-count.
 */

/** The subset of a 2D context text layout needs: `font` (set) and `measureText`. */
export type MeasureContext = Pick<CanvasRenderingContext2D, 'font' | 'measureText'>

/** Measures text for layout (PV-P3b) and element frames (PV-P2). */
export interface TextMeasurer {
  measure(font: string, text: string, letterSpacingPx?: number): { width: number; ascent: number; descent: number }
}

/**
 * Width of `text` tracked by `letterSpacingPx`: the gap sits between characters,
 * never after the last one, so a single character is unchanged.
 */
export function trackedWidth(baseWidth: number, text: string, letterSpacingPx: number): number {
  if (!letterSpacingPx) return baseWidth
  const n = Array.from(text).length
  return n > 1 ? baseWidth + letterSpacingPx * (n - 1) : baseWidth
}

/**
 * A `TextMeasurer` over any 2D context (HTML or Offscreen). Sets `ctx.font` on
 * every call, because that is the only way the context knows which metrics it is
 * being asked for.
 */
export function createCanvasMeasurer(ctx: MeasureContext): TextMeasurer {
  return {
    measure(font, text, letterSpacingPx = 0) {
      ctx.font = font
      const m = ctx.measureText(text)
      return {
        width: trackedWidth(m.width, text, letterSpacingPx),
        // A stub context (jsdom, a test double) has no bounding box. Zero is the
        // honest answer: "ascent unknown", not a fabricated one.
        ascent: Number.isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent : 0,
        descent: Number.isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent : 0,
      }
    },
  }
}

/**
 * A `TextMeasurer` seen as the `font` + `measureText` context
 * `computeTextLayout` takes. Measures UNtracked widths; tracking is layout's job
 * (PV-P3a).
 */
export function measureContextFor(measurer: TextMeasurer): MeasureContext {
  let font = ''
  const ctx = {
    get font() {
      return font
    },
    set font(value: string) {
      font = value
    },
    measureText(text: string) {
      return { width: measurer.measure(font, text).width } as TextMetrics
    },
  }
  return ctx as MeasureContext
}
