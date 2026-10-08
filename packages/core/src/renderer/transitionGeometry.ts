import type { TransitionDirection, TransitionKind } from '../types'

/**
 * Where the OUTGOING picture of a transition is, at progress `t`.
 *
 * Two compositors draw this — the preview's overlay in CSS and the export's 2D
 * canvas — and they had already drifted into agreeing only by accident: both
 * read `direction` for a slide and neither read it for a wipe, so `up` and
 * `down` silently became `right` and every wipe revealed from the same side
 * whatever the project said. The type offered four directions and the picture
 * moved in one. One function means they cannot drift again, and adding a
 * direction is one place, not two.
 *
 * `direction` is where the outgoing picture GOES. A slide moves it off that
 * edge; a wipe eats it from that edge inward. `right` is the default, because
 * it is what both kinds did before they could be told otherwise.
 */
export interface TransitionGeometry {
  /** Translation of the outgoing picture, as a fraction of the stage. */
  x: number
  y: number
  /**
   * How much of the outgoing picture is hidden on each side, as a fraction of
   * the stage. Matches CSS `inset(top right bottom left)` directly.
   */
  inset: { top: number; right: number; bottom: number; left: number }
}

const NOTHING_HIDDEN = { bottom: 0, left: 0, right: 0, top: 0 }

/** `-0` reads as "-0%" once it reaches a CSS string. Nobody needs to see that. */
const zeroed = (v: number): number => (v === 0 ? 0 : v)

export function transitionGeometry(
  kind: TransitionKind,
  direction: TransitionDirection | undefined,
  t: number,
): TransitionGeometry {
  const progress = Math.min(1, Math.max(0, t))
  const where = direction ?? 'right'

  if (kind === 'slide') {
    return {
      inset: { ...NOTHING_HIDDEN },
      x: zeroed(where === 'left' ? -progress : where === 'right' ? progress : 0),
      y: zeroed(where === 'up' ? -progress : where === 'down' ? progress : 0),
    }
  }

  if (kind === 'wipe') {
    return {
      inset: {
        bottom: where === 'down' ? progress : 0,
        left: where === 'left' ? progress : 0,
        right: where === 'right' ? progress : 0,
        top: where === 'up' ? progress : 0,
      },
      x: 0,
      y: 0,
    }
  }

  // Anything else is composited by opacity alone and sits where it was.
  return { inset: { ...NOTHING_HIDDEN }, x: 0, y: 0 }
}
