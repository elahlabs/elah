import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react'
import { TimelineEngine } from '../core/editor/TimelineEngine'
import { PlaybackEngine } from '../core/playback/PlaybackEngine'
import type { TimelineConfig } from '../types'
import { useTracksStore } from '../stores/tracks.store'
import { usePlaybackStore } from '../stores/playback.store'
import { splitClipAtPlayhead } from '../actions/splitClipAtPlayhead'
import { EngineContext } from './engine-context'
import { Ruler } from './Ruler'
import { Playhead } from './Playhead'
import { TrackRow } from './TrackRow'

export interface TimelineRef {
  engine: TimelineEngine
  playback: PlaybackEngine
}

export interface TimelineProps extends Partial<TimelineConfig> {
  fps?: number
  className?: string
  style?: React.CSSProperties
}

/**
 * <Timeline /> — the top-level component.
 *
 * Drop it anywhere in your React tree and get a fully working timeline editor.
 * Access the engine via the ref or via `useTimeline()` from child components.
 *
 * @example
 * ```tsx
 * const ref = useRef<TimelineRef>(null)
 * <Timeline ref={ref} fps={30} style={{ height: 300 }} />
 *
 * // Add a clip from outside:
 * ref.current?.engine.addClip({ trackId, type: 'video', startFrame: 0, durationFrames: 90 })
 * ```
 */
export const Timeline = memo(
  forwardRef<TimelineRef, TimelineProps>(function Timeline(
    { fps = 30, defaultTrackHeight = 64, maxHistorySize = 100, className, style },
    ref,
  ) {
    const engine = useMemo(
      () => new TimelineEngine({ fps, defaultTrackHeight, maxHistorySize }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    )

    const playback = useMemo(
      () =>
        new PlaybackEngine({
          fps,
          getTotalFrames: () => useTracksStore.getState().totalFrames,
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    )

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

    // Wire engine events → Zustand stores
    useEffect(() => {
      const syncTracks = () => {
        useTracksStore.getState().sync(engine.getProject(), {
          canUndo: engine.canUndo(),
          canRedo: engine.canRedo(),
        })
      }

      engine.on('change', syncTracks)
      engine.on('history:change', syncTracks)

      // Sync initial state
      syncTracks()

      return () => {
        engine.off('change', syncTracks)
        engine.off('history:change', syncTracks)
      }
    }, [engine])

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

    // Destroy PlaybackEngine when the component unmounts (or fps changes).
    useEffect(() => {
      return () => playback.destroy()
    }, [playback])

    // PlaybackEngine → Zustand store.
    // The engine is the source of truth for currentFrame / isPlaying.
    // This effect mirrors every engine tick into the store so React UI stays reactive.
    // Guard: only call setCurrentFrame when the value actually changed so we don't
    // fire a Zustand epoch bump (and re-notify every subscriber) on every RAF tick.
    useEffect(() => {
      return playback.subscribe((snapshot) => {
        const pb = usePlaybackStore.getState()
        if (snapshot.currentFrame !== pb.currentFrame) {
          pb.setCurrentFrame(snapshot.currentFrame)
        }
        if (snapshot.isPlaying && !pb.isPlaying) pb.play()
        else if (!snapshot.isPlaying && pb.isPlaying) pb.pause()
      })
    }, [playback])

    // Zustand store → PlaybackEngine.
    // Propagates external play/pause/seek/rate changes (e.g. toolbar buttons,
    // ruler clicks) back into the engine without creating a feedback loop.
    // The echo guard works because when the engine emits a frame update:
    //   engine._frame = X → setCurrentFrame(X) → store.currentFrame = X
    //   store subscription fires with state.currentFrame === playback.currentFrame
    //   → seek condition is false → no echo.
    //
    // Persisted-state init: push localStorage-restored values into the engine
    // before subscribing. Without this, a persisted loop=true or playbackRate=2
    // would be invisible to the engine until the user changed them again.
    useEffect(() => {
      const s0 = usePlaybackStore.getState()
      playback.setPlaybackRate(s0.playbackRate)
      playback.setLoop(s0.loop)
      if (s0.isPlaying) playback.play()

      return usePlaybackStore.subscribe((state, prev) => {
        if (state.isPlaying !== prev.isPlaying) {
          if (state.isPlaying) playback.play()
          else playback.pause()
        }
        if (
          state.currentFrameEpoch !== prev.currentFrameEpoch &&
          state.currentFrame !== playback.currentFrame
        ) {
          playback.seek(state.currentFrame)
        }
        if (state.playbackRate !== prev.playbackRate) {
          playback.setPlaybackRate(state.playbackRate)
        }
        if (state.loop !== prev.loop) {
          playback.setLoop(state.loop)
        }
      })
    }, [playback])

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
      }

      window.addEventListener('keydown', handleKey)
      return () => window.removeEventListener('keydown', handleKey)
    }, [engine])

    const rulerHeight = 24
    const totalHeight = tracks.reduce((sum, t) => sum + t.height, 0)

    return (
      <EngineContext.Provider value={engine}>
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
      </EngineContext.Provider>
    )
  }),
)
