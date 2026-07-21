import { createContext, useContext } from 'react'

/** Lane-local pixel range (relative to scrollLeft, not viewport coordinates). */
export interface VisibleWindow {
  start: number
  end: number
}

// Pre-mounts clips just outside the viewport so they don't visibly pop in
// during fast scrolls/drags.
export const VIRTUALIZATION_BUFFER_PX = 200

// Quantization step for computeVisibleWindow — rows re-render only every
// QUANTUM_PX of scroll instead of every pixel (memoization safeguard).
export const QUANTUM_PX = 200

/** Default window so TrackRow used outside Timeline (or before first measure) renders everything. */
export const SHOW_ALL_WINDOW: VisibleWindow = { start: -Infinity, end: Infinity }

export const VisibleWindowContext = createContext<VisibleWindow>(SHOW_ALL_WINDOW)

export function useVisibleWindow(): VisibleWindow {
  return useContext(VisibleWindowContext)
}

/**
 * Computes the lane-local visible window from raw scroll metrics.
 *
 * The sticky sidebar overlays the left `sidebarWidth` px of the viewport, so
 * lane content only becomes visible after it — hence `containerWidth - sidebarWidth`.
 */
export function computeVisibleWindow(
  scrollLeft: number,
  containerWidth: number,
  sidebarWidth: number,
  quantum: number,
): VisibleWindow {
  const start = scrollLeft
  const end = scrollLeft + Math.max(0, containerWidth - sidebarWidth)

  // Quantize asymmetrically (floor start, ceil end) so the result is always a
  // superset of the true window — never culls a clip that's actually visible.
  return {
    start: Math.floor(start / quantum) * quantum,
    end: Math.ceil(end / quantum) * quantum,
  }
}

/** Whether a clip's pixel span intersects the visible window, padded by `buffer`. Safe with ±Infinity. */
export function isClipVisible(
  clipStartPx: number,
  clipEndPx: number,
  window: VisibleWindow,
  buffer: number,
): boolean {
  return clipEndPx > window.start - buffer && clipStartPx < window.end + buffer
}
