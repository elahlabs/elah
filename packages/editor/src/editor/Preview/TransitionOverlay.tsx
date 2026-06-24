import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { Scene } from '@elah/core'

/**
 * `<TransitionOverlay>` — snapshot-based transition surface.
 *
 * Sits as a transparent HTML layer directly over the WebGL canvas (below
 * TextOverlay). At transition start it captures a frozen pixel snapshot of the
 * outgoing clip from the WebGL canvas (before the GPU renders the incoming
 * clip) and fades that snapshot away via CSS as `t` progresses 0→1.
 *
 * The GPU renders only the incoming clip at full opacity underneath. The
 * combined result is a correct crossfade with zero decoder contention.
 *
 * For slide/wipe: the snapshot div is translated/clipped via CSS transform
 * instead of opacity — new transition kinds require only a new CSS mapping
 * in `update()`, no resolver or shader changes.
 *
 * Timing note: `captureIfNewTransition` must be called BEFORE
 * `renderer.render(scene)` each tick so the WebGL canvas still holds the
 * previous frame (outgoing clip fully visible). `update` is called after
 * render to set the CSS for the current `t`.
 */

export interface TransitionOverlayHandle {
  /**
   * Call before renderer.render() — canvas still holds the previous frame.
   * Captures a snapshot for any transition that wasn't active last tick.
   */
  captureIfNewTransition(scene: Scene, webglCanvas: HTMLCanvasElement): void
  /**
   * Call after renderer.render() — advances CSS opacity/transform to match
   * current `t`. Removes snapshots for transitions that have ended.
   */
  update(scene: Scene): void
}

interface Snapshot {
  div: HTMLDivElement
}

export const TransitionOverlay = forwardRef<TransitionOverlayHandle>(
  function TransitionOverlay(_, ref) {
    const rootRef = useRef<HTMLDivElement>(null)
    const snapshotsRef = useRef(new Map<string, Snapshot>())

    useImperativeHandle(ref, () => ({
      captureIfNewTransition(scene: Scene, webglCanvas: HTMLCanvasElement) {
        const root = rootRef.current
        if (!root) return

        for (const tr of scene.transitions) {
          if (snapshotsRef.current.has(tr.id)) continue

          // Copy the WebGL canvas at its full internal resolution.
          // CSS width/height: 100% stretches it to fill the overlay container.
          const snap = document.createElement('canvas')
          snap.width = webglCanvas.width
          snap.height = webglCanvas.height
          const ctx2d = snap.getContext('2d')
          if (!ctx2d) continue
          ctx2d.drawImage(webglCanvas, 0, 0)

          const div = document.createElement('div')
          div.style.cssText = 'position:absolute;inset:0;pointer-events:none;'
          snap.style.cssText = 'display:block;width:100%;height:100%;'
          div.appendChild(snap)
          root.appendChild(div)

          snapshotsRef.current.set(tr.id, { div })
        }
      },

      update(scene: Scene) {
        const activeIds = new Set(scene.transitions.map(tr => tr.id))

        // Remove snapshots whose transition window has closed.
        for (const [id, { div }] of snapshotsRef.current) {
          if (!activeIds.has(id)) {
            div.remove()
            snapshotsRef.current.delete(id)
          }
        }

        // Advance CSS for each active transition.
        for (const tr of scene.transitions) {
          const snap = snapshotsRef.current.get(tr.id)
          if (!snap) continue

          if (tr.kind === 'slide') {
            const sign = tr.direction === 'left' ? -1 : 1
            snap.div.style.opacity = '1'
            snap.div.style.transform = `translateX(${sign * tr.t * 100}%)`
            snap.div.style.clipPath = ''
          } else if (tr.kind === 'wipe') {
            snap.div.style.opacity = '1'
            snap.div.style.transform = ''
            snap.div.style.clipPath = `inset(0 ${tr.t * 100}% 0 0)`
          } else {
            // fade (default)
            snap.div.style.opacity = String(1 - tr.t)
            snap.div.style.transform = ''
            snap.div.style.clipPath = ''
          }
        }
      },
    }), [])

    return (
      <div
        ref={rootRef}
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{
          // zIndex 1: above the imperatively-appended WebGL canvas (no z-index),
          // below TextOverlay (zIndex 2).
          zIndex: 1,
        }}
      />
    )
  },
)
