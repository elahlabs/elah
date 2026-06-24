'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { TextClipProperties } from './TextClipProperties'
import { ExportModal } from './ExportModal'
import { loadElahDemo } from './loadElahDemo'
import { cn } from '@/lib/utils'
import {
  SourcePanel,
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

// Base Tailwind classes for toolbar buttons
const toolbarBtnCls =
  'px-3 py-1.5 bg-ed-elevated text-ed-text-muted border border-ed-border rounded-md text-xs cursor-pointer font-sans transition-colors'

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

  // Demo button — gradient + glow are dynamic based on loadingDemo state
  const demoBtnStyle: React.CSSProperties = loadingDemo
    ? {
        background: 'var(--elah-bg-panel)',
        border: '1px solid var(--elah-border)',
        color: 'var(--elah-text-muted)',
        cursor: 'wait',
        opacity: 0.6,
      }
    : {
        background: `linear-gradient(180deg, var(--elah-accent-hover), var(--elah-accent))`,
        border: '1px solid var(--elah-accent)',
        color: '#fff',
        boxShadow: '0 0 14px var(--elah-accent-glow)',
        cursor: 'pointer',
      }

  return (
    <header className="grid grid-cols-[1fr_auto_1fr] items-center px-4 h-[46px] bg-ed-bg-2 border-b border-ed-border shrink-0">
      <div className="flex items-center gap-3.5">
        <span className="text-[13px] font-bold text-ed-text tracking-[-0.02em]">
          @elah/editor
        </span>
        <button
          type="button"
          className="px-3.5 py-1.5 text-xs font-semibold rounded-md font-sans tracking-[-0.01em] transition-all"
          style={demoBtnStyle}
          disabled={loadingDemo}
          onClick={handleLoadDemo}
          title="Load a cinematic demo project: assets, fades, and text overlays"
        >
          {loadingDemo ? 'Loading…' : '✦ Load Elah Demo Project'}
        </button>
      </div>

      <div className="flex gap-1">
        <button
          type="button"
          className={cn(toolbarBtnCls, !canUndo && 'opacity-40 cursor-not-allowed')}
          disabled={!canUndo}
          onClick={() => engine.undo()}
          title="Undo (Ctrl+Z)"
        >
          ↶
        </button>
        <button
          type="button"
          className={cn(toolbarBtnCls, !canRedo && 'opacity-40 cursor-not-allowed')}
          disabled={!canRedo}
          onClick={() => engine.redo()}
          title="Redo (Ctrl+Y)"
        >
          ↷
        </button>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className={toolbarBtnCls}
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

  // Aspect button: active state uses accent color — dynamic inline for the color only
  const aspectBtnStyle = (active: boolean): React.CSSProperties =>
    active
      ? {
          background: 'rgba(225, 29, 72, 0.12)',
          border: '1px solid var(--elah-accent)',
          color: 'var(--elah-accent-hover)',
          boxShadow: '0 0 10px rgba(225, 29, 72, 0.35)',
        }
      : {}

  // Play button — color switches on isPlaying
  const playBtnStyle: React.CSSProperties = isPlaying
    ? {
        background: 'rgba(34, 197, 94, 0.12)',
        border: '1px solid #22C55E',
        color: '#22C55E',
      }
    : {}

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center h-10 px-4 bg-ed-bg-2 border-t border-ed-border shrink-0">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={cn(toolbarBtnCls, !hasSelection && 'opacity-40 cursor-not-allowed')}
          disabled={!hasSelection}
          onClick={splitAtPlayhead}
          title="Split at playhead (S)"
        >
          ✂ Split
        </button>
        <button
          type="button"
          className={toolbarBtnCls}
          onClick={addTextTrack}
          title="Add another text track (for overlapping / stacked text)"
        >
          ＋ Text Track
        </button>
      </div>

      <div className="flex items-center gap-2.5">
        <button
          type="button"
          className={cn(toolbarBtnCls, 'min-w-9 px-3')}
          style={playBtnStyle}
          onClick={togglePlayPause}
          title="Play / Pause (Space)"
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span
          ref={timecodeRef}
          className="text-[11px] text-ed-text-muted font-mono min-w-[172px] tracking-[0.02em]"
        >
          00:00:00:00 / 00:00:00:00
        </span>
      </div>

      <div className="flex items-center gap-2 justify-end">
        <span className="text-[11px] text-ed-text-muted">Zoom</span>
        <input
          type="range"
          className="elah-range w-24"
          min={0}
          max={1}
          step={0.001}
          value={zoomToSlider(zoom)}
          onChange={(e) => setZoom(sliderToZoom(Number(e.target.value)))}
        />
        <span className="text-[11px] text-ed-text-muted font-mono min-w-[56px]">
          {zoom < 1 ? zoom.toFixed(2) : zoom.toFixed(1)} px/f
        </span>
        <button
          type="button"
          className={toolbarBtnCls}
          onClick={() => timelineRef.current?.fitToWindow()}
          title="Zoom to fit timeline"
        >
          Fit
        </button>

        {/* Divider */}
        <div className="w-px h-[18px] bg-ed-border shrink-0 mx-2" />

        <div className="flex items-center gap-1">
          <button
            type="button"
            className={cn(toolbarBtnCls, 'min-w-11')}
            style={aspectBtnStyle(aspectActive(1920, 1080))}
            onClick={() => engine.setStage(1920, 1080)}
          >
            16:9
          </button>
          <button
            type="button"
            className={cn(toolbarBtnCls, 'min-w-11')}
            style={aspectBtnStyle(aspectActive(1080, 1920))}
            onClick={() => engine.setStage(1080, 1920)}
          >
            9:16
          </button>
          <button
            type="button"
            className={cn(toolbarBtnCls, 'min-w-11')}
            style={aspectBtnStyle(aspectActive(1080, 1080))}
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
        className="elah-root flex flex-col h-full"
      >
        <AppHeader onExport={() => setShowExportModal(true)} timelineRef={timelineRef} />
        {showExportModal && (
          <ExportModal
            onClose={() => setShowExportModal(false)}
            onExport={handleExportStart}
          />
        )}

        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex flex-1 min-h-0">
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: 240,
                flexShrink: 0,
                borderRight: '1px solid var(--elah-border)',
                background: 'var(--elah-bg-panel)',
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              <SourcePanel style={{ flex: 1, minHeight: 0 }} />
            </div>

            <div
              className="flex-1 min-w-0 min-h-0 relative bg-ed-bg"
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
