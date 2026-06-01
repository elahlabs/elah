import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import type { TimelineEngine } from '../core/editor/TimelineEngine'
import type { PlaybackEngine } from '../core/playback/PlaybackEngine'
import { useTracksStore } from '../core/stores/tracks.store'
import { usePlaybackStore } from '../core/stores/playback.store'
import { splitClipAtPlayhead } from '../core/actions/splitClipAtPlayhead'
import { useEditor } from '../core/editor-context'
import { Ruler } from './Ruler'
import { Playhead } from './Playhead'
import { TrackRow } from './TrackRow'

export interface TimelineRef {
  engine: TimelineEngine
  playback: PlaybackEngine
}

export interface TimelineProps {
  fps?: number
  className?: string
  style?: React.CSSProperties
}

/**
 * <Timeline /> — the top-level component.
 *
 * Must be rendered inside an `<EditorProvider>`. Access the engine via the
 * ref or via `useTimeline()` from child components.
 *
 * @example
 * ```tsx
 * const ref = useRef<TimelineRef>(null)
 * <EditorProvider fps={30}>
 *   <Timeline ref={ref} fps={30} style={{ height: 300 }} />
 * </EditorProvider>
 *
 * // Add a clip from outside:
 * ref.current?.engine.addClip({ trackId, type: 'video', startFrame: 0, durationFrames: 90 })
 * ```
 */
export const Timeline = memo(
  forwardRef<TimelineRef, TimelineProps>(function Timeline(
    { fps = 30, className, style },
    ref,
  ) {
    const { engine, playback } = useEditor()

    useImperativeHandle(ref, () => ({ engine, playback }), [engine, playback])

    const tracks = useTracksStore((s) => s.tracks)
    const totalFrames = useTracksStore((s) => s.totalFrames)
    const zoom = usePlaybackStore((s) => s.zoom)
    const setZoom = usePlaybackStore((s) => s.setZoom)
    const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)

    const scrollRef = useRef<HTMLDivElement>(null)
    const rulerWrapRef = useRef<HTMLDivElement>(null)

    // Mirror horizontal scroll of the track area into the ruler wrapper so they
    // always stay in sync. The ruler wrapper is overflow:hidden (no visible bar).
    const syncRulerScroll = useCallback(() => {
      if (rulerWrapRef.current && scrollRef.current) {
        rulerWrapRef.current.scrollLeft = scrollRef.current.scrollLeft
      }
    }, [])

    // Ctrl/Cmd + scroll → zoom
    useEffect(() => {
      const el = scrollRef.current
      if (!el) return

      const handleWheel = (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey) return
        e.preventDefault()
        const direction = e.deltaY > 0 ? -0.5 : 0.5
        setZoom(usePlaybackStore.getState().zoom + direction)
      }

      el.addEventListener('wheel', handleWheel, { passive: false })
      return () => el.removeEventListener('wheel', handleWheel)
    }, [setZoom])

    // Keyboard shortcuts: Space = play/pause, Ctrl+Z/Y = undo/redo
    useEffect(() => {
      const handleKey = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        )
          return

        if (e.code === 'Space') {
          e.preventDefault()
          usePlaybackStore.getState().togglePlayPause()
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
          e.preventDefault()
          engine.undo()
        }

        if (
          (e.ctrlKey || e.metaKey) &&
          (e.key === 'y' || (e.key === 'z' && e.shiftKey))
        ) {
          e.preventDefault()
          engine.redo()
        }

        if (
          e.key === 's' &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.shiftKey &&
          !e.altKey
        ) {
          e.preventDefault()
          const result = splitClipAtPlayhead(engine)
          if (!result.ok) {
            console.warn('[timeline] split-at-playhead failed:', result.reason)
          }
        }

        if (e.code === 'ArrowRight' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          const { currentFrame, setCurrentFrame } = usePlaybackStore.getState()
          setCurrentFrame(currentFrame + 1)
        }

        if (e.code === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          const { currentFrame, setCurrentFrame } = usePlaybackStore.getState()
          setCurrentFrame(Math.max(0, currentFrame - 1))
        }
      }

      window.addEventListener('keydown', handleKey)
      return () => window.removeEventListener('keydown', handleKey)
    }, [engine])

    const rulerHeight = 24
    const totalHeight = tracks.reduce((sum, t) => sum + t.height, 0)

    return (
      <div
        className={className}
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: '#111',
          color: '#fff',
          overflow: 'hidden',
          position: 'relative',
          fontFamily: 'sans-serif',
          ...style,
        }}
      >
        {/* Ruler row */}
        <div style={{ display: 'flex' }}>
          {/* Sidebar spacer */}
          <div
            style={{
              width: 160,
              flexShrink: 0,
              height: rulerHeight,
              background: '#1a1a1a',
              borderRight: '1px solid #2a2a2a',
              borderBottom: '1px solid #2a2a2a',
            }}
          />
          {/* Ruler — overflow hidden, scrollLeft driven by track area scroll */}
          <div ref={rulerWrapRef} style={{ flex: 1, overflow: 'hidden' }}>
            <Ruler
              fps={fps}
              totalFrames={Math.max(totalFrames, fps * 10)}
              zoom={zoom}
              height={rulerHeight}
              onSeek={setCurrentFrame}
            />
          </div>
        </div>

        {/* Track area — single scroll source; scrollbar sits at the bottom */}
        <div
          ref={scrollRef}
          onScroll={syncRulerScroll}
          style={{
            flex: 1,
            overflow: 'auto',
            position: 'relative',
            minHeight: 0,
          }}
        >
          {tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              totalFrames={Math.max(totalFrames, fps * 10)}
              zoom={zoom}
            />
          ))}

          {tracks.length === 0 && (
            <div
              style={{
                padding: 24,
                color: '#555',
                fontSize: 13,
                textAlign: 'center',
              }}
            >
              No tracks yet. Add a track to get started.
            </div>
          )}
        </div>

        {/* Playhead spans the full height (ruler + tracks) of the outer container */}
        <Playhead
          zoom={zoom}
          height="100%"
          scrollContainerRef={scrollRef}
          sidebarWidth={160}
        />
      </div>
    )
  }),
)
