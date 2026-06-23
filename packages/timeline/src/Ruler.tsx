import { memo, useMemo } from 'react'
import { framesToTimecode } from '@elah/core'
import { cn } from './cn'

interface RulerProps {
  fps: number
  totalFrames: number
  zoom: number
  height?: number
  color?: string
  tickColor?: string
  labelColor?: string
  onSeek?: (frame: number) => void
  /** Override class for the ruler root. */
  className?: string
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
  // Defaults reference CSS vars so callers that omit them pick up the token.
  color = 'var(--elah-bg-panel)',
  tickColor = 'var(--elah-tick-color)',
  labelColor = 'var(--elah-tick-label)',
  onSeek,
  className,
}: RulerProps) {
  // Content-driven width; CSS minWidth: '100%' ensures it fills the container on
  // first load when the content is narrower than the visible area.
  const contentWidth = totalFrames * zoom

  const ticks = useMemo(() => {
    const pixelsPerFrame = zoom
    const pixelsPerSecond = fps * pixelsPerFrame

    // Aim for a label every ~80px — pick the nearest clean interval
    const rawSeconds = 80 / pixelsPerSecond
    const intervals = [
      1 / fps,  // every frame
      0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800,
    ]
    const secondsPerTick =
      intervals.find((i) => i >= rawSeconds) ?? intervals[intervals.length - 1]

    const framesPerTick = Math.max(1, Math.round(secondsPerTick * fps))
    const result: { frame: number; label: string }[] = []

    for (let frame = 0; frame <= totalFrames + framesPerTick; frame += framesPerTick) {
      result.push({ frame, label: framesToTimecode(frame, fps) })
    }

    return result
  }, [fps, totalFrames, zoom])

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    onSeek(Math.max(0, Math.round(x / zoom)))
  }

  return (
    <div
      className={cn(className)}
      style={{
        position: 'relative',
        width: contentWidth,
        minWidth: '100%',
        height,
        background: color,
        flexShrink: 0,
        cursor: onSeek ? 'pointer' : 'default',
        userSelect: 'none',
      }}
      onClick={handleClick}
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
          <div
            style={{
              width: 1,
              height: height * 0.5,
              background: tickColor,
            }}
          />
          <span
            style={{
              fontSize: 9,
              color: labelColor,
              whiteSpace: 'nowrap',
              transform: 'translateX(3px)',
              fontFamily: 'monospace',
            }}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  )
})
