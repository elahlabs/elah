/**
 * Per-slot className overrides for the timeline subtree.
 *
 * Each key targets one visually-meaningful sub-part ("slot"). Values are Tailwind
 * class strings; whatever you pass is merged so it WINS over the built-in classes
 * for the same CSS property (see `cn`). Colors are also themeable globally via the
 * `--elah-*` CSS variables — use this prop for per-instance structural overrides
 * (shape, spacing, size, borders) on a specific timeline.
 *
 * @example
 * <Timeline
 *   classNames={{
 *     root:       'rounded-xl',
 *     ruler:      'bg-zinc-900',           // ruler strip
 *     rulerTick:  'bg-zinc-600',           // tick marks
 *     rulerLabel: 'text-zinc-400',         // timecode labels
 *     lane:       'bg-zinc-950',
 *     clip:       'rounded-2xl shadow-lg', // clip shape (all types)
 *     clipVideo:       'from-sky-400 to-sky-600',  // video clip body
 *     clipVideoAccent: 'text-sky-300',              // its stripe + track bar
 *     playhead:   'text-cyan-400',         // a TEXT color — see note below
 *   }}
 * />
 *
 * Note: the playhead, clip stripe/border, and track-label bar paint from
 * `currentColor`, so recolor those with a TEXT color class (e.g. `text-cyan-400`),
 * not `bg-*`. Clip bodies take a background (gradient `from-…to-…` or solid `bg-…`).
 */
export interface TimelineClassNames {
  /** Outer timeline wrapper. Equivalent to the bare `className` prop. */
  root?: string
  /** Ruler strip background (the timecode track at the top). */
  ruler?: string
  /** Each tick mark in the ruler. */
  rulerTick?: string
  /** Each timecode label in the ruler. */
  rulerLabel?: string
  /** Each track row container (label sidebar + clip lane). */
  track?: string
  /** The track-label sidebar within a row. */
  trackLabel?: string
  /** The clip lane (where ClipBlocks are positioned) within a row. */
  lane?: string
  /** Each clip block body shape/shadow (all types). For color, use the slots below. */
  clip?: string
  /**
   * Per-clip-type body background — a gradient ('from-teal-400 to-teal-600') or a
   * solid ('bg-teal-500'). Replaces that type's default gradient.
   */
  clipVideo?: string
  clipAudio?: string
  clipText?: string
  clipImage?: string
  /**
   * Per-clip-type accent — a 'text-*' class for the left stripe, selected border,
   * and the track-label bar (they paint from currentColor). Pairs with the body
   * slot above so one type recolors coherently.
   */
  clipVideoAccent?: string
  clipAudioAccent?: string
  clipTextAccent?: string
  clipImageAccent?: string
  /** The playhead needle. Recolor with a TEXT color class (paints from currentColor). */
  playhead?: string
}
