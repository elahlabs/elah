'use client'

import { memo, useMemo, useRef, useState } from 'react'
import {
  EditorProvider,
  Timeline,
  usePlaybackStore,
  useTracksStore,
  useTimelineEngine,
  framesToTimecode,
  type InitialTrackConfig,
  type TimelineRef,
} from '@elah/editor'
import { Play, Pause, Square, Undo2, Redo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  TimelineConfigPanel,
  type ClassNamesState,
} from './TimelineConfigPanel'
import { TimelineControls } from './TimelineControls'
import { TimelineSceneIO } from './TimelineSceneIO'
import { TimelineStyleExport } from './TimelineStyleExport'
import {
  buildThemeVars,
  DEFAULT_THEME_VALUES,
} from './TimelineThemeMode'

const FPS = 30

const INITIAL_TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'text', name: 'Text' },
]

const TimelineToolbar = memo(function TimelineToolbar() {
  const engine = useTimelineEngine()
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const totalFrames = useTracksStore((s) => s.totalFrames)
  const tracks = useTracksStore((s) => s.tracks)
  const clips = useTracksStore((s) => s.clips)
  const canUndo = useTracksStore((s) => s.canUndo)
  const canRedo = useTracksStore((s) => s.canRedo)
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)

  const handleAddClip = (trackId: string, type: 'video' | 'audio' | 'text', duration: number = FPS * 5) => {
    const clipCount = (clips[trackId] ?? []).length
    if (type === 'text') {
      engine.addClip({
        trackId,
        type: 'text',
        startFrame: currentFrame,
        durationFrames: duration,
        name: `Text Clip ${clipCount + 1}`,
        text: {
          content: `Text ${clipCount + 1}`,
          fontSize: 32,
          color: '#ffffff',
        },
      })
    } else {
      engine.addClip({
        trackId,
        type,
        src: `demo-${type}-${clipCount + 1}`,
        startFrame: currentFrame,
        durationFrames: duration,
        name: `${type.charAt(0).toUpperCase()}${type.slice(1)} Clip ${clipCount + 1}`,
      })
    }
  }

  const handleStop = () => {
    usePlaybackStore.getState().pause()
    setCurrentFrame(0)
  }

  const handleClearAll = () => {
    engine.batch(() => {
      tracks.forEach((track) => {
        const trackClips = clips[track.id] ?? []
        trackClips.forEach((clip) => {
          engine.removeClip(clip.id, track.id)
        })
      })
    }, 'Clear all clips')
  }

  // Base button classes
  const btnCls = 'px-3 py-1.5 bg-ed-elevated text-ed-text-muted border border-ed-border rounded-md cursor-pointer text-xs font-medium whitespace-nowrap font-sans'
  const ghostIcon =
    'inline-flex items-center justify-center w-7 h-7 rounded text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated transition-colors cursor-pointer'

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-ed-bg-2 border-b border-ed-border shrink-0 overflow-x-auto">
      {/* Transport — matches the Production editor's TransportBar. */}
      <div className="flex items-center gap-2.5 pr-3 border-r border-ed-border">
        <button
          type="button"
          onClick={togglePlayPause}
          title="Play / Pause (Space)"
          className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white text-black hover:opacity-90 transition-opacity cursor-pointer shrink-0"
        >
          {isPlaying ? (
            <Pause size={14} fill="currentColor" />
          ) : (
            <Play size={14} fill="currentColor" className="ml-0.5" />
          )}
        </button>

        <button type="button" onClick={handleStop} title="Stop" className={ghostIcon}>
          <Square size={12} fill="currentColor" />
        </button>

        <span className="font-mono text-[11px] tracking-[0.02em] tabular-nums whitespace-nowrap">
          <span style={{ color: 'var(--elah-accent)' }}>{framesToTimecode(currentFrame, FPS)}</span>
          <span className="text-ed-text-muted mx-1.5">|</span>
          <span className="text-ed-text-muted">{framesToTimecode(Math.max(totalFrames, 1), FPS)}</span>
        </span>

        <button
          type="button"
          onClick={() => engine.undo()}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className={cn(ghostIcon, !canUndo && 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-ed-text-muted')}
        >
          <Undo2 size={15} />
        </button>

        <button
          type="button"
          onClick={() => engine.redo()}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
          className={cn(ghostIcon, !canRedo && 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-ed-text-muted')}
        >
          <Redo2 size={15} />
        </button>
      </div>

      <div className="flex items-center gap-2 pr-3 border-r border-ed-border">
        <span className="text-[11px] text-ed-text-muted font-semibold font-sans tracking-[0.06em] uppercase">Add:</span>
        <button
          onClick={() => tracks[0] && handleAddClip(tracks[0].id, 'video', FPS * 3)}
          className={cn(btnCls, 'bg-clip-video-mid/15 border-clip-video-mid text-clip-video-mid')}
          title="Add 3-second video clip"
        >
          + Video
        </button>
        <button
          onClick={() => tracks[1] && handleAddClip(tracks[1].id, 'audio', FPS * 5)}
          className={cn(btnCls, 'bg-clip-audio-mid/15 border-clip-audio-mid text-clip-audio-mid')}
          title="Add 5-second audio clip"
        >
          + Audio
        </button>
        <button
          onClick={() => tracks[2] && handleAddClip(tracks[2].id, 'text', FPS * 2)}
          className={cn(btnCls, 'bg-clip-text-mid/15 border-clip-text-mid text-clip-text-mid')}
          title="Add 2-second text clip"
        >
          + Text
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleClearAll}
          className={cn(btnCls, 'bg-ed-accent-soft border-ed-accent text-ed-accent-hover')}
        >
          ✕ Clear All
        </button>
      </div>
    </div>
  )
})

export default function TimelineEditor() {
  // Live Timeline classNames — passed straight to <Timeline>, no remount needed.
  const [classNames, setClassNames] = useState<ClassNamesState>({})

  // Theme mode: raw picker values → derived `--elah-*` overrides applied inline
  // to `.elah-root`, which win over the tokens.css defaults. Live, no remount.
  const [themeValues, setThemeValues] = useState<Record<string, string>>(DEFAULT_THEME_VALUES)
  const themeVars = useMemo(() => buildThemeVars(themeValues), [themeValues])

  // Export Style sidebar (right of the upper region).
  const [exportOpen, setExportOpen] = useState(false)

  // Resizable timeline: drag the handle up/down to grow/shrink it. Height is
  // clamped to [MIN, available − reserved] so the IO area above never vanishes.
  const TIMELINE_MIN = 120
  const [timelineHeight, setTimelineHeight] = useState(186)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<TimelineRef>(null)

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = timelineHeight
    const maxH = (workspaceRef.current?.clientHeight ?? 800) - 140
    const onMove = (ev: PointerEvent) => {
      const next = startH + (startY - ev.clientY) // drag up → taller
      setTimelineHeight(Math.min(Math.max(next, TIMELINE_MIN), Math.max(maxH, TIMELINE_MIN)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.style.userSelect = 'none'
  }

  return (
    <EditorProvider fps={FPS} defaultTrackHeight={36} initialTracks={INITIAL_TRACKS}>
      <div className="elah-root h-full flex flex-col" style={themeVars as React.CSSProperties}>
        <header className="px-4 py-3 bg-ed-bg-2 border-b border-ed-border shrink-0">
          <h2 className="m-0 text-sm font-semibold text-ed-text">Timeline Only</h2>
          <p className="m-0 mt-0.5 text-xs text-ed-text-muted">
            Standalone @elah/timeline — drag to move, edge-drag to trim, Ctrl+Scroll to zoom
          </p>
        </header>

        <div ref={workspaceRef} className="flex-1 min-h-0 flex flex-col">
          {/* Upper region: config docked left, Scene I/O fills the rest. The
              config panel stops here — the timeline below spans full width. */}
          <div className="flex-1 min-h-0 flex relative overflow-hidden">
            <TimelineConfigPanel
              classNames={classNames}
              onClassNamesChange={setClassNames}
              themeValues={themeValues}
              onThemeValuesChange={setThemeValues}
              exportOpen={exportOpen}
              onToggleExport={() => setExportOpen((o) => !o)}
            />
            <TimelineSceneIO />

            {/* Export Style — slides in from / out to the right. */}
            <div
              aria-hidden={!exportOpen}
              className={cn(
                'absolute top-0 right-0 h-full z-20 transition-transform duration-300 ease-out',
                exportOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full pointer-events-none',
              )}
            >
              <TimelineStyleExport
                classNames={classNames}
                themeValues={themeValues}
                onClose={() => setExportOpen(false)}
              />
            </div>
          </div>

          {/* Drag handle — resize the docked timeline vertically (full width). */}
          <div
            onPointerDown={startResize}
            role="separator"
            aria-orientation="horizontal"
            title="Drag to resize timeline"
            className="group shrink-0 h-2 flex items-center justify-center cursor-ns-resize bg-ed-bg-2 border-t border-ed-border hover:bg-ed-accent-soft transition-colors"
          >
            <span className="h-0.5 w-10 rounded-full bg-ed-text-muted/40 group-hover:bg-ed-accent transition-colors" />
          </div>

          {/* Controls + timeline span the full width, end to end. */}
          <TimelineToolbar />
          <TimelineControls timelineRef={timelineRef} />
          <Timeline
            ref={timelineRef}
            fps={FPS}
            classNames={classNames}
            style={{
              height: timelineHeight,
              flexShrink: 0,
              minWidth: 0,
              background: 'var(--elah-bg)',
            }}
          />
        </div>
      </div>
    </EditorProvider>
  )
}
