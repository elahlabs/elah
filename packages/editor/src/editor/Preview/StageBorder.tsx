import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { computeContainViewport, useTracksStore } from '@elah/core'

/**
 * `<StageBorder>` — a thin, non-interactive outline of the project frame inside
 * the preview.
 *
 * The WebGL canvas letterboxes the project stage within the container, leaving
 * black bars; without an outline the project area is indistinguishable from the
 * bars. This draws the SAME `computeContainViewport` fit rect the renderer uses
 * for `gl.viewport`, so the border always hugs the rendered frame and tracks
 * aspect-ratio changes for free.
 *
 * Coordinate note: the fit rect is centred, so its margins are symmetric and
 * `fit.x` / `fit.y` map directly to CSS `left` / `top` (same as TextOverlay).
 */
export function StageBorder() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const stage = useTracksStore((s) => s.stage)

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const apply = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    apply()
    const obs = new ResizeObserver(apply)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const fit = useMemo(
    () => computeContainViewport(size.width, size.height, stage.width, stage.height),
    [size.width, size.height, stage.width, stage.height],
  )

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-[1] pointer-events-none overflow-hidden"
    >
      {fit.width > 0 && fit.height > 0 && (
        <div
          style={{
            // Dynamic: position and dimensions are runtime-computed from fit rect
            position: 'absolute',
            left: fit.x,
            top: fit.y,
            width: fit.width,
            height: fit.height,
            border: '1px solid var(--elah-stage-border, rgba(225, 29, 72, 0.45))',
            boxShadow: 'var(--elah-stage-glow, 0 0 20px rgba(225, 29, 72, 0.08))',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  )
}
