'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { TextClipProperties } from './TextClipProperties'
import { ExportModal } from './ExportModal'
import { loadElahDemo } from './loadElahDemo'
import { btnDisabled, theme } from './theme'
import {
  AssetPanel,
  ElementsPanel,
  EditorProvider,
  Preview,
  Timeline,
  createDefaultDemuxerFactory,
  useTracksStore,
  usePlaybackStore,
  useSelectionStore,
  useTimelineEngine,
  splitClipAtPlayhead,
  framesToTimecode,
  type InitialTrackConfig,
  type TimelineRef,
  type ExportVideoCodec,
  type ExportAudioCodec,
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

const AppHeader = memo(function AppHeader({
  onExport,
  timelineRef,
}: {
  onExport: () => void
  timelineRef: React.RefObject<TimelineRef | null>
}) {
  const canUndo = useTracksStore((s) => s.canUndo)
  const canRedo = useTracksStore((s) => s.canRedo)
  const engine = useTimelineEngine()
  const [loadingDemo, setLoadingDemo] = useState(false)

  const handleLoadDemo = useCallback(async () => {
    setLoadingDemo(true)
    try {
      await loadElahDemo({ engine, timelineRef })
    } catch (err) {
      console.error('[playground] Failed to load Elah demo project:', err)
      globalThis.alert?.('Could not load the demo project — check the console for details.')
    } finally {
      setLoadingDemo(false)
    }
  }, [engine, timelineRef])

  const demoBtnStyle: React.CSSProperties = {
    ...btnDisabled(loadingDemo),
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600,
    color: loadingDemo ? theme.textMuted : '#fff',
    background: loadingDemo
      ? theme.bgPanel
      : `linear-gradient(180deg, ${theme.accentHover}, ${theme.accent})`,
    border: `1px solid ${theme.accent}`,
    boxShadow: loadingDemo ? 'none' : `0 0 14px ${theme.accentGlow}`,
    cursor: loadingDemo ? 'wait' : 'pointer',
    letterSpacing: '-0.01em',
  }

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
        <button
          type="button"
          style={demoBtnStyle}
          disabled={loadingDemo}
          onClick={handleLoadDemo}
          title="Load a cinematic demo project: assets, fades, and text overlays"
        >
          {loadingDemo ? 'Loading…' : '✦ Load Elah Demo Project'}
        </button>
      </div>

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

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="elah-export-btn"
          style={btnDisabled(false)}
          onClick={onExport}
          title="Export to MP4"
        >
          ⬇ Export
        </button>
      </div>
    </header>
  )
})

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

  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      if (timecodeRef.current) {
        const dur = Math.max(totalFrames, 1)
        timecodeRef.current.textContent =
          `${framesToTimecode(state.currentFrame, FPS)} / ${framesToTimecode(dur, FPS)}`
      }
    })
  }, [totalFrames])

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

  const addTextTrack = useCallback(() => {
    const n = useTracksStore.getState().tracks.filter((t) => t.kind === 'text').length + 1
    engine.addTrack('text', { name: `Text ${n}` })
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
          border: `1px solid ${theme.accent}`,
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
          border: `1px solid ${theme.success}`,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
        <button
          type="button"
          className="elah-toolbar-btn"
          style={btnDisabled(false)}
          onClick={addTextTrack}
          title="Add another text track (for overlapping / stacked text)"
        >
          ＋ Text Track
        </button>
      </div>

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

export default function ProductionEditor() {
  const timelineRef = useRef<TimelineRef>(null)
  const demuxerFactoryRef = useRef(createDefaultDemuxerFactory())

  const [showExportModal, setShowExportModal] = useState(false)

  const handleExportStart = useCallback(async (opts: {
    videoBitrate: number
    videoCodec: ExportVideoCodec
    audioCodec: ExportAudioCodec
    signal: AbortSignal
    onProgress: (frame: number, totalFrames: number) => void
  }) => {
    const e = timelineRef.current?.engine
    if (!e) return
    usePlaybackStore.getState().pause()
    const project = e.getProject()
    const { lazyExportVideo } = await import('@elah/editor')
    const blob = await lazyExportVideo(project, {
      videoBitrate: opts.videoBitrate,
      videoCodec: opts.videoCodec,
      audioCodec: opts.audioCodec,
      signal: opts.signal,
      onProgress: ({ frame, totalFrames }) => opts.onProgress(frame, totalFrames),
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'export.mp4'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }, [])

  return (
    <EditorProvider fps={FPS} initialTracks={INITIAL_TRACKS}>
      <div
        className="elah-root"
        style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      >
        <AppHeader onExport={() => setShowExportModal(true)} timelineRef={timelineRef} />
        {showExportModal && (
          <ExportModal
            onClose={() => setShowExportModal(false)}
            onExport={handleExportStart}
          />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
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

            <TextClipProperties />
          </div>

          <TimelineControls timelineRef={timelineRef} />

          <Timeline
            ref={timelineRef}
            fps={FPS}
            style={{ height: 236, flexShrink: 0, minWidth: 0 }}
          />
        </div>
      </div>
    </EditorProvider>
  )
}
