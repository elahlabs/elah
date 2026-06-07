import { memo, useCallback, useEffect, useRef, useState } from 'react'
import './editor-ui.css'
import { TextClipProperties } from './TextClipProperties'
import { createPlaygroundDemuxerFactory } from './createPlaygroundDemuxerFactory'
import { btnDisabled, theme } from './theme'
import {
  AssetPanel,
  ElementsPanel,
  EditorProvider,
  Preview,
  Timeline,
  useTracksStore,
  usePlaybackStore,
  useSelectionStore,
  useTimelineEngine,
  splitClipAtPlayhead,
  framesToTimecode,
  type InitialTrackConfig,
  type TimelineRef,
} from '@elah/editor'

const FPS = 30

const INITIAL_TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'text', name: 'Text' },
]

const ZOOM_MIN = 0.02
const ZOOM_MAX = 50
const zoomToSlider = (z: number) =>
  (Math.log(z) - Math.log(ZOOM_MIN)) / (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN))
const sliderToZoom = (s: number) =>
  Math.exp(Math.log(ZOOM_MIN) + s * (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN)))

const divider: React.CSSProperties = {
  width: 1,
  height: 18,
  background: theme.border,
  flexShrink: 0,
  margin: '0 8px',
}

// ---------------------------------------------------------------------------
// AppHeader — subscribes only to canUndo/canRedo.
// Re-renders only when history changes or export is running.
// ---------------------------------------------------------------------------
const AppHeader = memo(function AppHeader({
  isExporting,
  exportProgress,
  onExport,
}: {
  isExporting: boolean
  exportProgress: number
  onExport: () => void
}) {
  const canUndo = useTracksStore((s) => s.canUndo)
  const canRedo = useTracksStore((s) => s.canRedo)
  const engine = useTimelineEngine()

  return (
    <header
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        padding: '0 16px',
        height: 46,
        background: theme.bgSecondary,
        borderBottom: `1px solid ${theme.border}`,
        flexShrink: 0,
      }}
    >
      {/* Left: branding */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: theme.textPrimary,
          letterSpacing: '-0.02em',
        }}
      >
        @elah/editor
      </span>

      {/* Center: undo / redo */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          className="elah-toolbar-btn"
          style={btnDisabled(!canUndo)}
          disabled={!canUndo}
          onClick={() => engine.undo()}
          title="Undo (Ctrl+Z)"
        >
          ↶
        </button>
        <button
          type="button"
          className="elah-toolbar-btn"
          style={btnDisabled(!canRedo)}
          disabled={!canRedo}
          onClick={() => engine.redo()}
          title="Redo (Ctrl+Y)"
        >
          ↷
        </button>
      </div>

      {/* Right: export */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="elah-export-btn"
          style={btnDisabled(isExporting)}
          disabled={isExporting}
          onClick={onExport}
          title="Export to MP4"
        >
          {isExporting ? `Exporting ${exportProgress}%` : '⬇ Export'}
        </button>
      </div>
    </header>
  )
})

// ---------------------------------------------------------------------------
// TimelineControls — owns every timeline-related store subscription.
// Re-renders are isolated here; Preview, media strip, and Timeline are unaffected.
// ---------------------------------------------------------------------------
const TimelineControls = memo(function TimelineControls({
  timelineRef,
}: {
  timelineRef: React.RefObject<TimelineRef | null>
}) {
  const engine = useTimelineEngine()
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const zoom = usePlaybackStore((s) => s.zoom)
  const setZoom = usePlaybackStore((s) => s.setZoom)
  const totalFrames = useTracksStore((s) => s.totalFrames)
  const stage = useTracksStore((s) => s.stage)
  const hasSelection = useSelectionStore((s) => s.selectedClipIds.size === 1)
  const timecodeRef = useRef<HTMLSpanElement>(null)

  // DOM-only timecode update — zero React re-renders per frame tick.
  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      if (timecodeRef.current) {
        const dur = Math.max(totalFrames, 1)
        timecodeRef.current.textContent =
          `${framesToTimecode(state.currentFrame, FPS)} / ${framesToTimecode(dur, FPS)}`
      }
    })
  }, [totalFrames])

  // Seed the timecode display on mount and when duration changes.
  useEffect(() => {
    if (timecodeRef.current) {
      const frame = usePlaybackStore.getState().currentFrame
      const dur = Math.max(totalFrames, 1)
      timecodeRef.current.textContent =
        `${framesToTimecode(frame, FPS)} / ${framesToTimecode(dur, FPS)}`
    }
  }, [totalFrames])

  const splitAtPlayhead = useCallback(() => {
    const result = splitClipAtPlayhead(engine)
    if (!result.ok) console.warn('[playground] split failed:', result.reason)
  }, [engine])

  const aspectActive = (w: number, h: number) =>
    Math.abs(stage.width / stage.height - w / h) < 0.001

  const aspectBtn = (active: boolean): React.CSSProperties => ({
    ...btnDisabled(false),
    minWidth: 44,
    padding: '5px 10px',
    ...(active
      ? {
          background: 'rgba(225, 29, 72, 0.12)',
          borderColor: theme.accent,
          color: theme.accentHover,
          boxShadow: `0 0 10px rgba(225, 29, 72, 0.35)`,
        }
      : {}),
  })

  const playBtnStyle: React.CSSProperties = {
    ...btnDisabled(false),
    minWidth: 36,
    padding: '5px 12px',
    ...(isPlaying
      ? {
          background: 'rgba(34, 197, 94, 0.12)',
          borderColor: theme.success,
          color: theme.success,
        }
      : {}),
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        height: 40,
        padding: '0 16px',
        background: theme.bgSecondary,
        borderTop: `1px solid ${theme.border}`,
        flexShrink: 0,
      }}
    >
      {/* Left: split */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button
          type="button"
          className="elah-toolbar-btn"
          style={btnDisabled(!hasSelection)}
          disabled={!hasSelection}
          onClick={splitAtPlayhead}
          title="Split at playhead (S)"
        >
          ✂ Split
        </button>
      </div>

      {/* Center: play / pause + timecode */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          className="elah-toolbar-btn"
          style={playBtnStyle}
          onClick={togglePlayPause}
          title="Play / Pause (Space)"
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span
          ref={timecodeRef}
          style={{
            fontSize: 11,
            color: theme.textSecondary,
            fontFamily: theme.fontMono,
            minWidth: 172,
            letterSpacing: '0.02em',
          }}
        >
          00:00:00:00 / 00:00:00:00
        </span>
      </div>

      {/* Right: zoom + fit + aspect ratios */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 11, color: theme.textMuted }}>Zoom</span>
        <input
          type="range"
          className="elah-range"
          min={0}
          max={1}
          step={0.001}
          value={zoomToSlider(zoom)}
          onChange={(e) => setZoom(sliderToZoom(Number(e.target.value)))}
          style={{ width: 96 }}
        />
        <span style={{ fontSize: 11, color: theme.textMuted, fontFamily: theme.fontMono, minWidth: 56 }}>
          {zoom < 1 ? zoom.toFixed(2) : zoom.toFixed(1)} px/f
        </span>
        <button
          type="button"
          className="elah-toolbar-btn"
          style={btnDisabled(false)}
          onClick={() => timelineRef.current?.fitToWindow()}
          title="Zoom to fit timeline"
        >
          Fit
        </button>

        <div style={divider} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            className="elah-toolbar-btn"
            style={aspectBtn(aspectActive(1920, 1080))}
            onClick={() => engine.setStage(1920, 1080)}
          >
            16:9
          </button>
          <button
            type="button"
            className="elah-toolbar-btn"
            style={aspectBtn(aspectActive(1080, 1920))}
            onClick={() => engine.setStage(1080, 1920)}
          >
            9:16
          </button>
          <button
            type="button"
            className="elah-toolbar-btn"
            style={aspectBtn(aspectActive(1080, 1080))}
            onClick={() => engine.setStage(1080, 1080)}
          >
            1:1
          </button>
        </div>
      </div>
    </div>
  )
})

// ---------------------------------------------------------------------------
// App — no store subscriptions; only re-renders when export state changes.
// ---------------------------------------------------------------------------
export default function App() {
  const timelineRef = useRef<TimelineRef>(null)
  const demuxerFactoryRef = useRef(createPlaygroundDemuxerFactory())

  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)

  const handleExport = useCallback(async () => {
    const e = timelineRef.current?.engine
    if (!e || isExporting) return

    const project = e.getProject()
    const t0 = performance.now()
    console.log('[export:ui] Export clicked — project:', {
      stage: `${project.stage.width}x${project.stage.height}`,
      fps: project.fps,
      tracks: project.tracks.length,
      clips: Object.values(project.clips).flat().length,
    })

    setIsExporting(true)
    setExportProgress(0)
    try {
      const { lazyExportVideo } = await import('@elah/editor')
      const blob = await lazyExportVideo(project, {
        videoBitrate: 8_000_000,
        onProgress: ({ frame, totalFrames }) => {
          setExportProgress(Math.round((frame / totalFrames) * 100))
        },
      })
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
      console.log(`[export:ui] ${(blob.size / 1_000_000).toFixed(2)} MB in ${elapsed}s`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'export.mp4'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      console.error('[export:ui] export failed:', err)
      alert(`Export failed: ${String(err)}`)
    } finally {
      setIsExporting(false)
      setExportProgress(0)
    }
  }, [isExporting])

  return (
    <>
      <EditorProvider fps={FPS} initialTracks={INITIAL_TRACKS}>
        <div
          className="elah-root"
          style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}
        >
          <AppHeader
            isExporting={isExporting}
            exportProgress={exportProgress}
            onExport={handleExport}
          />

          {/* Main content */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

            {/* Middle row: Asset | Preview | Text edit — all same height */}
            <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

              {/* Left: asset + elements panel */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  width: 220,
                  flexShrink: 0,
                  borderRight: `1px solid ${theme.border}`,
                  background: theme.bgPanel,
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                <ElementsPanel
                  style={{ flexShrink: 0, borderBottom: `1px solid ${theme.border}` }}
                />
                <AssetPanel style={{ flex: 1, minHeight: 0 }} />
              </div>

              {/* Center: preview — RAF loop, never re-renders from store changes */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                  position: 'relative',
                  background: theme.bgPrimary,
                }}
              >
                <Preview
                  demuxerFactory={demuxerFactoryRef.current}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>

              {/* Right: text clip properties — same height as row, not full viewport */}
              <TextClipProperties />
            </div>

            {/* Timeline controls — isolated subscriptions, doesn't affect preview */}
            <TimelineControls timelineRef={timelineRef} />

            {/* Timeline — full width */}
            <Timeline
              ref={timelineRef}
              fps={FPS}
              style={{ height: 236, flexShrink: 0, minWidth: 0 }}
            />
          </div>
        </div>
      </EditorProvider>
    </>
  )
}
