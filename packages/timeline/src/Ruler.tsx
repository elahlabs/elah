import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { computeRulerTicks } from '@elah/core'
import { cn } from './cn'
import { timelineContentWidth } from './contentWidth'

interface RulerProps {
  fps: number
  totalFrames: number
  zoom: number
  height?: number
  onSeek?: (frame: number) => void
  /** Override class for the ruler root (background). */
  className?: string
  /** Override class for each tick mark. */
  tickClassName?: string
  /** Override class for each timecode label. */
  labelClassName?: string
}

/**
 * Timeline ruler showing frame/timecode markers.
 * Tick density adapts to zoom level so labels never overlap.
 */
export const Ruler = memo(function Ruler({
  fps,
  totalFrames,
  zoom,
  height = 24,
  onSeek,
  // Colors come from default token classes (bg-ed-panel / bg-tick /
  // text-tick-label). Override per-instance via these slots, or globally via the
  // --elah-* tokens. cn() ensures a passed class wins over the default.
  className,
  tickClassName,
  labelClassName,
}: RulerProps) {
  // Content-driven width; CSS minWidth: '100%' ensures it fills the container on
  // first load when the content is narrower than the visible area. Must match
  // the lanes' width formula or ticks and clips desync at low zoom.
  const contentWidth = timelineContentWidth(totalFrames, zoom)

  // Tick placement and labels come from core (`computeRulerTicks`) so the
  // React Native ruler lays its marks out identically. Aim for a label every
  // ~80px; the helper picks the nearest clean interval.
  const ticks = useMemo(() => computeRulerTicks(fps, totalFrames, zoom, 80), [fps, totalFrames, zoom])

  const activeGestureCleanup = useRef<(() => void) | null>(null)

  const clearActiveGesture = useCallback(() => {
    activeGestureCleanup.current?.()
    activeGestureCleanup.current = null
  }, [])

  useEffect(() => clearActiveGesture, [clearActiveGesture])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || !onSeek) return
      clearActiveGesture()

      const rulerEl = e.currentTarget
      const seekFromClientX = (clientX: number) => {
        const rect = rulerEl.getBoundingClientRect()
        const x = clientX - rect.left
        onSeek(Math.max(0, Math.round(x / zoom)))
      }

      seekFromClientX(e.clientX)

      const handleMove = (moveEvent: PointerEvent) => {
        seekFromClientX(moveEvent.clientX)
      }

      const removeWindowListeners = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
      }

      const finish = () => {
        removeWindowListeners()
        activeGestureCleanup.current = null
      }

      const handleUp = () => finish()
      const handleCancel = () => finish()

      activeGestureCleanup.current = handleCancel
      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
    },
    [onSeek, zoom, clearActiveGesture],
  )

  return (
    <div
      className={cn('bg-ed-panel', className)}
      style={{
        position: 'relative',
        width: contentWidth,
        minWidth: '100%',
        height,
        flexShrink: 0,
        cursor: onSeek ? 'pointer' : 'default',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
    >
      {ticks.map(({ frame, label }) => (
        <div
          key={frame}
          style={{
            position: 'absolute',
            left: frame * zoom,
            top: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
          }}
        >
          {/* Label sits above a short tick, matching the design. */}
          <span
            className={cn('text-tick-label', labelClassName)}
            style={{
              fontSize: 11,
              whiteSpace: 'nowrap',
              transform: 'translateX(3px)',
              fontFamily: 'monospace',
            }}
          >
            {label}
          </span>
          <div
            className={cn('bg-tick', tickClassName)}
            style={{
              width: 1,
              height: height * 0.35,
              marginTop: 1,
            }}
          />
        </div>
      ))}
    </div>
  )
})
