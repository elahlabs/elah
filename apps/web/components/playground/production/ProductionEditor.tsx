'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Type as TypeIcon,
  Play,
  Pause,
  Square,
  Maximize2,
  ChevronDown,
  RectangleHorizontal,
  UploadCloud,
  Film,
  Image as ImageIcon,
  Music,
  Github,
  Undo2,
  Redo2,
  Code2,
} from 'lucide-react'
import { ClipProperties } from './properties/ClipProperties'
import { TimelineControls } from '../shared/TimelineControls'
import { ProductionCodePanel } from './ProductionCodePanel'
import { ExportModal } from './ExportModal'
import { loadElahDemo } from './loadElahDemo'
import { PlaygroundTabs } from '../shared/PlaygroundTabs'
import { MediaPanel, type PanelMode } from './MediaPanel'
import { TracePanel } from './TracePanel'
import { siteConfig } from '@/config/site'
import { cn } from '@/lib/utils'
import {
  // SourcePanel,  // replaced by MediaPanel (app-side revamp) — discard later
  ElementsPanel,
  EditorProvider,
  Preview,
  Timeline,
  createDefaultDemuxerFactory,
  useTracksStore,
  usePlaybackStore,
  useTimelineEngine,
  framesToTimecode,
  type InitialTrackConfig,
  type TimelineRef,
  type ExportVideoCodec,
  type ExportAudioCodec,
} from '@elah/editor'

const FPS = 30

// Minimal default — one of each. The model allows a single video track but any
// number of audio / elements tracks; more are added from the toolbar at runtime.
// Order is top→bottom in the UI (lower index = higher zIndex, renders on top),
// per resolveTimeline's track.order → zIndex mapping.
const INITIAL_TRACKS: InitialTrackConfig[] = [
  { kind: 'elements', name: 'Elements' },
  { kind: 'video', name: 'Video' },
  { kind: 'audio', name: 'Audio' },
]

// Base Tailwind classes for toolbar buttons
const toolbarBtnCls =
  'px-3 py-1.5 bg-ed-elevated text-ed-text-muted border border-ed-border rounded-md text-xs cursor-pointer font-sans transition-colors'

const AppHeader = memo(function AppHeader({
  onExport,
  onToggleCode,
  codeOpen,
  timelineRef,
}: {
  onExport: () => void
  onToggleCode: () => void
  codeOpen: boolean
  timelineRef: React.RefObject<TimelineRef | null>
}) {
  const [showTrace, setShowTrace] = useState(false)
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
        // Deeper cyan than the brand accent so the white label keeps contrast.
        background: `linear-gradient(180deg, #00a0d4, #0086b8)`,
        border: '1px solid #0086b8',
        color: '#fff',
        boxShadow: '0 0 14px var(--elah-accent-glow)',
        cursor: 'pointer',
      }

  return (
    <header className="elah-app-header grid grid-cols-[1fr_auto_1fr] items-center px-4 h-[46px] bg-ed-bg-2 border-b border-ed-border shrink-0">
      {/* Left — folded playground nav + brand + demo CTA */}
      <div className="flex items-center gap-3">
        <Link
          href="/playgrounds"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-mono tracking-[0.04em] text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated transition-colors"
        >
          ← Playgrounds
        </Link>
        <div className="w-px h-4 bg-ed-border shrink-0" />
        <span className="inline-flex items-center gap-2">
          <span
            className="w-[7px] h-[7px] rounded-full shrink-0"
            style={{
              background: 'var(--elah-accent)',
              boxShadow: '0 0 8px var(--elah-accent-glow)',
            }}
          />
          <span className="text-[13px] font-bold text-ed-text tracking-[-0.02em]">
            elah
          </span>
          <span className="text-[11px] font-mono text-ed-text-muted">
            @elah/editor
          </span>
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

      {/* Center — undo / redo */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={cn(
            toolbarBtnCls,
            'inline-flex items-center justify-center',
            !canUndo && 'opacity-40 cursor-not-allowed',
          )}
          disabled={!canUndo}
          onClick={() => engine.undo()}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          className={cn(
            toolbarBtnCls,
            'inline-flex items-center justify-center',
            !canRedo && 'opacity-40 cursor-not-allowed',
          )}
          disabled={!canRedo}
          onClick={() => engine.redo()}
          title="Redo (Ctrl+Y)"
        >
          <Redo2 size={15} />
        </button>
      </div>

      {/* Right — export + nav group (tabs kept right-aligned so they hold
          position across Production / Timeline / Raw) */}
      <div className="flex items-center gap-1 justify-end">
        <button
          type="button"
          className={cn(
            toolbarBtnCls,
            'inline-flex items-center gap-1.5',
            codeOpen && 'text-ed-text border-ed-accent/60',
          )}
          onClick={onToggleCode}
          title="Show render code"
        >
          <Code2 size={14} /> Code
        </button>
        <button
          type="button"
          className={toolbarBtnCls}
          onClick={onExport}
          title="Export to MP4"
        >
          ⬇ Export
        </button>
        <div className="relative">
          <button
            type="button"
            className={cn(
              toolbarBtnCls,
              showTrace && 'bg-ed-elevated text-ed-text',
            )}
            onClick={() => setShowTrace((v) => !v)}
            title="Toggle trace channel controls"
          >
            Trace
          </button>
          {showTrace && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowTrace(false)} />
              <div className="relative z-50">
                <TracePanel onClose={() => setShowTrace(false)} />
              </div>
            </>
          )}
        </div>
        <div className="w-px h-4 bg-ed-border shrink-0 mx-1" />
        <PlaygroundTabs />
        <a
          href={siteConfig.links.github}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center px-2 py-1.5 rounded-md text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated transition-colors"
          title="View source on GitHub"
        >
          <Github size={14} />
        </a>
      </div>
    </header>
  )
})

// Left icon rail — far-left vertical nav (Figma). UI-only for now: clicking
// moves the active highlight but doesn't switch panels yet.
const RAIL_ITEMS = [
  { id: 'media', label: 'Media', Icon: UploadCloud },
  { id: 'stock', label: 'Stock', Icon: Film },
  { id: 'photos', label: 'Photos', Icon: ImageIcon },
  { id: 'audio', label: 'Audio', Icon: Music },
  { id: 'elements', label: 'Elements', Icon: TypeIcon },
] as const

const LeftRail = memo(function LeftRail({
  active,
  onSelect,
}: {
  active: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="w-[68px] shrink-0 flex flex-col items-center gap-1.5 py-3 border-r border-ed-border bg-ed-bg overflow-y-auto">
      {RAIL_ITEMS.map(({ id, label, Icon }) => {
        const on = active === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className="w-full flex flex-col items-center gap-1.5 py-1 cursor-pointer"
          >
            <span
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded-xl transition-colors',
                on ? 'text-white' : 'text-ed-text-muted',
              )}
              style={
                on
                  ? { background: 'linear-gradient(160deg, rgba(0,194,255,0.5), rgba(0,194,255,0.1))' }
                  : undefined
              }
            >
              <Icon size={18} />
            </span>
            <span
              className={cn(
                'text-[10px] leading-none',
                on ? 'text-ed-text font-semibold' : 'text-ed-text-muted',
              )}
            >
              {label}
            </span>
          </button>
        )
      })}
    </div>
  )
})

// Aspect-ratio segmented control — floats centered above the preview (Figma),
// not in the timeline toolbar. Each option shows a glyph shaped like its ratio.
const ASPECTS = [
  { label: '16:9', w: 1920, h: 1080, gw: 14, gh: 8 },
  { label: '9:16', w: 1080, h: 1920, gw: 8, gh: 14 },
  { label: '1:1', w: 1080, h: 1080, gw: 11, gh: 11 },
] as const

const AspectControl = memo(function AspectControl() {
  const engine = useTimelineEngine()
  const stage = useTracksStore((s) => s.stage)
  const isActive = (w: number, h: number) =>
    Math.abs(stage.width / stage.height - w / h) < 0.001

  return (
    <div className="flex items-center justify-center py-2 shrink-0">
      <div className="flex items-center gap-1">
        {ASPECTS.map((a) => {
        const active = isActive(a.w, a.h)
        return (
          <button
            key={a.label}
            type="button"
            onClick={() => engine.setStage(a.w, a.h)}
            title={`${a.label} aspect ratio`}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs cursor-pointer transition-colors',
              active
                ? 'bg-ed-elevated text-ed-text'
                : 'text-ed-text-muted hover:text-ed-text',
            )}
            style={
              active ? { boxShadow: 'inset 0 0 0 1px var(--elah-accent)' } : undefined
            }
          >
            <span
              style={{
                width: a.gw,
                height: a.gh,
                borderRadius: 2,
                background: 'currentColor',
              }}
            />
            {a.label}
          </button>
        )
        })}
      </div>
    </div>
  )
})

// Video transport — lives under the Preview (not in the timeline toolbar),
// matching the Figma. Play/pause, stop, and current | total time (cyan current).
const TransportBar = memo(function TransportBar() {
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const totalFrames = useTracksStore((s) => s.totalFrames)
  const currentTimeRef = useRef<HTMLSpanElement>(null)
  const totalTimeRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      if (currentTimeRef.current) {
        currentTimeRef.current.textContent = framesToTimecode(state.currentFrame, FPS)
      }
    })
  }, [])

  useEffect(() => {
    const dur = Math.max(totalFrames, 1)
    if (totalTimeRef.current) totalTimeRef.current.textContent = framesToTimecode(dur, FPS)
    if (currentTimeRef.current) {
      currentTimeRef.current.textContent = framesToTimecode(
        usePlaybackStore.getState().currentFrame,
        FPS,
      )
    }
  }, [totalFrames])

  const handleStop = useCallback(() => {
    usePlaybackStore.getState().pause()
    usePlaybackStore.getState().setCurrentFrame(0)
  }, [])

  const ghostIcon =
    'inline-flex items-center justify-center w-7 h-7 rounded text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated transition-colors cursor-pointer'

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center h-11 px-4 bg-ed-bg-2 border-t border-ed-border shrink-0">
      {/* Left — current | total time (current in accent) */}
      <span className="font-mono text-[11px] tracking-[0.02em] tabular-nums whitespace-nowrap">
        <span ref={currentTimeRef} style={{ color: 'var(--elah-accent)' }}>00:00:00:00</span>
        <span className="text-ed-text-muted mx-1.5">|</span>
        <span ref={totalTimeRef} className="text-ed-text-muted">00:00:00:00</span>
      </span>

      {/* Center — video controls */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlayPause}
          title="Play / Pause (Space)"
          className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-white text-black hover:opacity-90 transition-opacity cursor-pointer shrink-0"
        >
          {isPlaying ? (
            <Pause size={15} fill="currentColor" />
          ) : (
            <Play size={15} fill="currentColor" className="ml-0.5" />
          )}
        </button>
        <button
          type="button"
          onClick={handleStop}
          title="Stop"
          className={ghostIcon}
        >
          <Square size={13} fill="currentColor" />
        </button>
      </div>

      {/* Right — preview view controls from the Figma (visual only for now). */}
      <div className="flex items-center gap-1.5 justify-end">
        <button type="button" title="Fullscreen" className={ghostIcon}>
          <Maximize2 size={14} />
        </button>
        <button
          type="button"
          title="Fit"
          className="inline-flex items-center gap-1 px-2 h-7 rounded border border-ed-border text-ed-text-muted text-[11px] hover:text-ed-text transition-colors cursor-pointer"
        >
          Fit <ChevronDown size={12} />
        </button>
        <button type="button" title="Frame" className={ghostIcon}>
          <RectangleHorizontal size={15} />
        </button>
      </div>
    </div>
  )
})

export default function ProductionEditor() {
  const timelineRef = useRef<TimelineRef>(null)
  const demuxerFactoryRef = useRef(createDefaultDemuxerFactory())

  const [showExportModal, setShowExportModal] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const [activePanel, setActivePanel] = useState('media')

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
    <EditorProvider fps={FPS} defaultTrackHeight={36} initialTracks={INITIAL_TRACKS}>
      <div
        className="elah-root flex flex-col h-full"
      >
        <AppHeader
          onExport={() => setShowExportModal(true)}
          onToggleCode={() => setShowCode((o) => !o)}
          codeOpen={showCode}
          timelineRef={timelineRef}
        />
        {showExportModal && (
          <ExportModal
            onClose={() => setShowExportModal(false)}
            onExport={handleExportStart}
          />
        )}
        <ProductionCodePanel open={showCode} onClose={() => setShowCode(false)} />

        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex flex-1 min-h-0">
            <LeftRail active={activePanel} onSelect={setActivePanel} />
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
              {/* Old SDK panel — kept commented for comparison, discard later. */}
              {/* <SourcePanel style={{ flex: 1, minHeight: 0 }} /> */}
              {activePanel === 'elements' ? (
                <ElementsPanel style={{ flex: 1, minHeight: 0 }} />
              ) : (
                <MediaPanel mode={activePanel as PanelMode} style={{ flex: 1, minHeight: 0 }} />
              )}
            </div>

            <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-black">
              <AspectControl />
              <div className="flex-1 min-h-0 relative py-6">
                <Preview
                  demuxerFactory={demuxerFactoryRef.current}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
              <TransportBar />
            </div>

            <ClipProperties />
          </div>

          <TimelineControls timelineRef={timelineRef} />

          <Timeline
            ref={timelineRef}
            fps={FPS}
            style={{ height: 186, flexShrink: 0, minWidth: 0 }}
          />
        </div>
      </div>
    </EditorProvider>
  )
}
