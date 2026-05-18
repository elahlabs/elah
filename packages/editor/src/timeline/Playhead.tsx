import { useCallback, useEffect, useRef } from 'react'
import { usePlaybackStore } from '../core/stores/playback.store'

interface PlayheadProps {
  zoom: number
  height: number | string
  color?: string
  /**
   * When the playhead is rendered outside the scroll container (e.g. in the
   * outer timeline wrapper), pass the scroll container ref so the playhead can
   * listen for horizontal scroll and stay aligned.
   */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
  /**
   * Pixel offset for the track label sidebar so the playhead's x-origin matches
   * the ruler / clip area origin.
   */
  sidebarWidth?: number
}

/**
 * Playhead needle that follows currentFrame.
 * Uses direct DOM style mutation via a ref — no React re-render on every frame.
 */
export function Playhead({
  zoom,
  height,
  color = '#ef4444',
  scrollContainerRef,
  sidebarWidth = 0,
}: PlayheadProps) {
  const needleRef = useRef<HTMLDivElement>(null)

  // Always-fresh refs so every callback always reads the latest prop values
  // without creating new closures or re-registering subscriptions.
  const zoomRef = useRef(zoom)
  const sidebarWidthRef = useRef(sidebarWidth)
  zoomRef.current = zoom
  sidebarWidthRef.current = sidebarWidth

  // Pure DOM write — zero React involvement.
  const applyPosition = (frame: number, scrollLeft: number) => {
    if (needleRef.current) {
      needleRef.current.style.left = `${sidebarWidthRef.current + frame * zoomRef.current - scrollLeft}px`
    }
  }

  // Store subscription: fires on every currentFrame change, writes directly to
  // the DOM ref — no React render triggered at all.
  useEffect(() => {
    return usePlaybackStore.subscribe((state, prev) => {
      if (state.currentFrame === prev.currentFrame) return
      const scrollLeft = scrollContainerRef?.current?.scrollLeft ?? 0
      applyPosition(state.currentFrame, scrollLeft)
    })
  // scrollContainerRef identity is stable; re-subscribe only if it changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollContainerRef])

  // Zoom / sidebarWidth change → re-sync position from current store value.
  // These are React-prop-driven changes (human speed), so a useEffect is fine.
  useEffect(() => {
    const scrollLeft = scrollContainerRef?.current?.scrollLeft ?? 0
    applyPosition(usePlaybackStore.getState().currentFrame, scrollLeft)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, sidebarWidth, scrollContainerRef])

  // Re-position on horizontal scroll so the needle stays over the correct frame.
  useEffect(() => {
    const el = scrollContainerRef?.current
    if (!el) return
    const handleScroll = () => {
      applyPosition(usePlaybackStore.getState().currentFrame, el.scrollLeft)
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const store = usePlaybackStore.getState()
      const { setCurrentFrame } = store

      // Pause for the duration of the scrub so the RAF loop doesn't fight the
      // user's drag. Resume after mouseup only if we were playing to begin with.
      const wasPlaying = store.isPlaying
      if (wasPlaying) store.pause()

      const handleMove = (moveEvent: MouseEvent) => {
        const container = scrollContainerRef?.current
        const scrollLeft = container?.scrollLeft ?? 0
        const parent = needleRef.current?.parentElement
        if (!parent) return
        const rect = parent.getBoundingClientRect()
        const x = moveEvent.clientX - rect.left - sidebarWidthRef.current + scrollLeft
        setCurrentFrame(Math.max(0, Math.round(x / zoomRef.current)))
      }

      const handleUp = () => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
        if (wasPlaying) usePlaybackStore.getState().play()
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [scrollContainerRef],
  )

  return (
    <div
      ref={needleRef}
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 2,
        height,
        background: color,
        zIndex: 50,
        cursor: 'col-resize',
        willChange: 'left',
        pointerEvents: 'all',
      }}
    >
      {/* Playhead handle cap */}
      <div
        style={{
          position: 'absolute',
          top: -4,
          left: -5,
          width: 12,
          height: 12,
          background: color,
          borderRadius: '50% 50% 0 0',
          clipPath: 'polygon(50% 100%, 0 0, 100% 0)',
        }}
      />
    </div>
  )
}
