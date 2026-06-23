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
 *     root: 'rounded-xl',
 *     clip: 'rounded-2xl shadow-lg',
 *     lane: 'bg-zinc-900',
 *   }}
 * />
 */
export interface TimelineClassNames {
  /** Outer timeline wrapper. Equivalent to the bare `className` prop. */
  root?: string
  /** Ruler strip (the timecode track at the top). */
  ruler?: string
  /** Each track row container (label sidebar + clip lane). */
  track?: string
  /** The track-label sidebar within a row. */
  trackLabel?: string
  /** The clip lane (where ClipBlocks are positioned) within a row. */
  lane?: string
  /** Each clip block body. */
  clip?: string
  /** The playhead needle. */
  playhead?: string
}
