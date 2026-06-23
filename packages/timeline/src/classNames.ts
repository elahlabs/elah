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
 *     ruler:      'bg-zinc-900',    // ruler strip
 *     rulerTick:  'bg-zinc-600',    // tick marks
 *     rulerLabel: 'text-zinc-400',  // timecode labels
 *     lane:       'bg-zinc-950',
 *     clip:       'rounded-2xl shadow-lg',
 *     playhead:   'text-cyan-400',  // a TEXT color — see note below
 *   }}
 * />
 *
 * Note: the playhead paints from `currentColor`, so recolor it with a TEXT
 * color class (e.g. `text-cyan-400`), not `bg-*`. The clip's gradient is inline
 * (dynamic) — recolor that via the `--elah-clip-*` tokens.
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
  /** Each clip block body. */
  clip?: string
  /** The playhead needle. Recolor with a TEXT color class (paints from currentColor). */
  playhead?: string
}
