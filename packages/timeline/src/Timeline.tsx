import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import type { TimelineEngine } from '@elah/core'
import type { PlaybackEngine } from '@elah/core'
import type { Clip } from '@elah/core'
import type { CreateClipOptions } from '@elah/core'
import { useTracksStore } from '@elah/core'
import { usePlaybackStore } from '@elah/core'
import { useSelectionStore } from '@elah/core'
import { splitClipAtPlayhead } from '@elah/core'
import { useEditor } from '@elah/core'
import { Ruler } from './Ruler'
import { Playhead } from './Playhead'
import { TrackRow } from './TrackRow'
import { AudioDropDialog } from './AudioDropDialog'
import { cn } from './cn'
import type { TimelineClassNames } from './classNames'

export interface TimelineRef {
  engine: TimelineEngine
  playback: PlaybackEngine
  /**
   * Set the zoom so the whole timeline fits the visible track area. Useful for
   * long clips that overflow far past the viewport. No-op until mounted.
   */
  fitToWindow: () => void
}

/** Width of the track-label sidebar; the clip lanes begin after it. */
const SIDEBAR_WIDTH = 160

function buildPasteOptions(clip: Clip, startFrame: number): CreateClipOptions {
  const base = {
    trackId: clip.trackId,
    name: clip.name,
    startFrame,
    durationFrames: clip.durationFrames,
    volume: clip.volume,
    opacity: clip.opacity,
    transform: clip.transform,
  }
  if (clip.type === 'text') {
    return {
      ...base,
      type: 'text',
      text: {
        content: clip.content ?? '',
        fontSize: clip.fontSize,
        color: clip.color,
        fontFamily: clip.fontFamily,
        fontWeight: clip.fontWeight,
        textAlign: clip.textAlign,
      },
    }
  }
  return {
    ...base,
    type: clip.type as 'video' | 'audio' | 'image',
    src: clip.src ?? '',
    assetId: clip.assetId,
  } as CreateClipOptions
}

export interface TimelineProps {
  fps?: number
  /** Shorthand for `classNames.root`. Merged after it, so it takes precedence. */
  className?: string
  style?: React.CSSProperties
  /** Per-slot Tailwind class overrides for the timeline subtree. */
  classNames?: TimelineClassNames
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
    { fps = 30, className, style, classNames },
    ref,
  ) {
    const { engine, playback } = useEditor()

    const scrollRef = useRef<HTMLDivElement>(null)
    const rulerWrapRef = useRef<HTMLDivElement>(null)
    const clipboardRef = useRef<Clip[]>([])

    // Fit the entire timeline into the visible lane width. Falls back to a
    // 10-second baseline (matching the ruler) when the timeline is empty.
    const fitToWindow = useCallback(() => {
      const el = scrollRef.current
      if (!el) return
      const available = el.clientWidth - SIDEBAR_WIDTH
      if (available <= 0) return
      const totalFrames = useTracksStore.getState().totalFrames
      const frames = Math.max(totalFrames, fps * 10)
      usePlaybackStore.getState().setZoom(available / frames)
    }, [fps])

    useImperativeHandle(
      ref,
      () => ({ engine, playback, fitToWindow }),
      [engine, playback, fitToWindow],
    )

    const tracks = useTracksStore((s) => s.tracks)
    const totalFrames = useTracksStore((s) => s.totalFrames)
    const zoom = usePlaybackStore((s) => s.zoom)
    const setZoom = usePlaybackStore((s) => s.setZoom)
    const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)

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

        if (e.key === 'Delete' || e.key === 'Backspace') {
          const selected = useSelectionStore.getState().selectedClipIds
          if (selected.size === 0) return
          e.preventDefault()
          // One undo entry for the whole deletion, even across tracks.
          engine.batch(() => {
            for (const clipId of selected) {
              const found = engine.findClip(clipId)
              if (found) engine.removeClip(clipId, found.trackId)
            }
          }, 'Delete clip')
          useSelectionStore.getState().clearSelection()
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey) {
          const selected = useSelectionStore.getState().selectedClipIds
          if (selected.size === 0) return
          e.preventDefault()
          const snaps: Clip[] = []
          for (const clipId of selected) {
            const found = engine.findClip(clipId)
            if (found) snaps.push({ ...found.clip })
          }
          clipboardRef.current = snaps
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !e.shiftKey) {
          const clips = clipboardRef.current
          if (clips.length === 0) return
          e.preventDefault()
          // Anchor paste right after the last copied clip ends,
          // preserving relative offsets for multi-clip selections.
          const minStart = Math.min(...clips.map((c) => c.startFrame))
          const pasteFrame = Math.max(...clips.map((c) => c.startFrame + c.durationFrames))
          const newIds: string[] = []
          engine.batch(() => {
            for (const src of clips) {
              const offset = src.startFrame - minStart
              const options = buildPasteOptions(src, pasteFrame + offset)
              const newClip = engine.addClip(options)
              // Preserve trim info the factory doesn't carry through
              if (src.sourceStartFrame !== 0 || src.sourceDurationFrames !== src.durationFrames) {
                engine.updateClip(newClip.id, newClip.trackId, {
                  sourceStartFrame: src.sourceStartFrame,
                  sourceDurationFrames: src.sourceDurationFrames,
                })
              }
              newIds.push(newClip.id)
            }
          }, 'Paste clip')
          useSelectionStore.getState().selectClips(newIds)
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
        className={cn('bg-ed-bg-2 text-ed-text', classNames?.root, className)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          fontFamily: 'var(--elah-font-ui, sans-serif)',
          ...style,
        }}
      >
        {/* Ruler row */}
        <div style={{ display: 'flex' }}>
          {/* Sidebar spacer — static surface tokens as className */}
          <div
            className="bg-ed-panel border-ed-border border-ed-border-subtle"
            style={{
              width: SIDEBAR_WIDTH,
              flexShrink: 0,
              height: rulerHeight,
              borderRightWidth: 1,
              borderRightStyle: 'solid',
              borderBottomWidth: 1,
              borderBottomStyle: 'solid',
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
              className={classNames?.ruler}
              tickClassName={classNames?.rulerTick}
              labelClassName={classNames?.rulerLabel}
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
              fps={fps}
              className={classNames?.track}
              labelClassName={classNames?.trackLabel}
              laneClassName={classNames?.lane}
              clipClassName={classNames?.clip}
              clipVideo={classNames?.clipVideo}
              clipAudio={classNames?.clipAudio}
              clipText={classNames?.clipText}
              clipImage={classNames?.clipImage}
              clipVideoAccent={classNames?.clipVideoAccent}
              clipAudioAccent={classNames?.clipAudioAccent}
              clipTextAccent={classNames?.clipTextAccent}
              clipImageAccent={classNames?.clipImageAccent}
            />
          ))}

          {tracks.length === 0 && (
            <div
              className="text-ed-text-muted"
              style={{
                padding: 24,
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
          sidebarWidth={SIDEBAR_WIDTH}
          className={classNames?.playhead}
        />

        {/* Blocking modal for the "video has audio" drop choice (position:fixed,
            so it overlays the whole app regardless of mount point). */}
        <AudioDropDialog />
      </div>
    )
  }),
)


