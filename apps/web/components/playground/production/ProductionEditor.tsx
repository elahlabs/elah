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
  Minimize2,
  MoreVertical,
  SlidersHorizontal,
  X,
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
  useSelectionStore,
  useTimelineEngine,
  framesToTimecode,
  type InitialTrackConfig,
  type TimelineRef,
  type ExportVideoCodec,
  type ExportAudioCodec,
} from '@elah/editor'

const FPS = 30

/** Tailwind `md` breakpoint, kept as JS state because the mobile layout needs
 * different component *props* (Timeline sidebar, panel placement), not just CSS. */
const MOBILE_QUERY = '(max-width: 767px)'

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    setIsMobile(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

/** Bottom drawer for the mobile layout — renders the same panels the desktop
 * columns use, so behavior stays identical across breakpoints. */
function MobileSheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50" onClick={onClose} />
      <div
        className="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-xl border-t border-ed-border bg-ed-bg-2 max-h-[68vh] pb-[env(safe-area-inset-bottom)]"
        role="dialog"
        aria-label={title}
      >
        <div className="flex items-center justify-between px-4 pt-2 pb-1 shrink-0">
          <span className="w-8" aria-hidden />
          <span className="h-1 w-9 rounded-full bg-ed-border" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="inline-flex items-center justify-center w-8 h-8 rounded text-ed-text-muted hover:text-ed-text"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">{children}</div>
      </div>
    </>
  )
}

type MobileSheetKind = (typeof RAIL_ITEMS)[number]['id'] | 'properties' | null

/** Floating fullscreen toggle on the preview (Figma's mobile design puts it
 * inside the player, bottom-right). Fullscreens the preview container — the
 * renderer's ResizeObserver picks up the new size automatically. */
function PreviewFullscreenButton({
  targetRef,
}: {
  targetRef: React.RefObject<HTMLDivElement | null>
}) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const onChange = () => setActive(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void targetRef.current?.requestFullscreen?.()
    }
  }, [targetRef])

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={active ? 'Exit fullscreen' : 'Fullscreen'}
      title={active ? 'Exit fullscreen' : 'Fullscreen'}
      className="absolute bottom-3 right-3 z-20 flex items-center justify-center w-10 h-10 rounded-full bg-black/60 text-white border border-white/10 backdrop-blur-sm cursor-pointer"
    >
      {active ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
    </button>
  )
}

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
  const [showOverflow, setShowOverflow] = useState(false)
  const canUndo = useTracksStore((s) => s.canUndo)
  const canRedo = useTracksStore((s) => s.canRedo)
  const engine = useTimelineEngine()
  const [loadingDemo, setLoadingDemo] = useState(false)
  // Conditional rendering, not responsive classes: the published packages ship
  // their own Tailwind utilities (.hidden/.inline-flex), and stylesheet load
  // order lets those beat the app's md: variants either way.
  const isMobile = useIsMobile()

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
        {!isMobile && (
          <>
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
          </>
        )}
      </div>

      {/* Center — desktop: undo/redo; mobile: the aspect dropdown pill (Figma).
          Mobile undo/redo live in the transport row instead. */}
      <div className="flex items-center gap-1">
        {isMobile ? (
          <MobileAspectSelect />
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* Right — export + nav group (tabs kept right-aligned so they hold
          position across Production / Timeline / Raw) */}
      <div className="flex items-center gap-1 justify-end">
        {!isMobile && (
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
        )}
        <button
          type="button"
          className={toolbarBtnCls}
          onClick={onExport}
          title="Export to MP4"
        >
          ⬇ Export
        </button>
        {!isMobile && (
          <>
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
          </>
        )}
        {/* Mobile overflow — desktop-only header actions folded into one menu. */}
        {isMobile && (
        <div className="relative">
          <button
            type="button"
            className={cn(toolbarBtnCls, 'inline-flex items-center justify-center')}
            onClick={() => setShowOverflow((v) => !v)}
            title="More actions"
            aria-label="More actions"
          >
            <MoreVertical size={15} />
          </button>
          {showOverflow && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowOverflow(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[190px] rounded-md border border-ed-border bg-ed-elevated py-1 shadow-[var(--elah-menu-shadow)]">
                <button
                  type="button"
                  disabled={loadingDemo}
                  onClick={() => { setShowOverflow(false); void handleLoadDemo() }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-ed-text-muted hover:text-ed-text hover:bg-ed-highest transition-colors"
                >
                  ✦ {loadingDemo ? 'Loading…' : 'Load Demo Project'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowOverflow(false); onToggleCode() }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-ed-text-muted hover:text-ed-text hover:bg-ed-highest transition-colors"
                >
                  <Code2 size={14} /> {codeOpen ? 'Hide code' : 'Show code'}
                </button>
                <a
                  href={siteConfig.links.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-ed-text-muted hover:text-ed-text hover:bg-ed-highest transition-colors"
                >
                  <Github size={14} /> GitHub
                </a>
              </div>
            </>
          )}
        </div>
        )}
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

// Mobile variant of AspectControl — the Figma's header pill ("▤ 9:16 ⌄").
// Same engine.setStage mutation, dropdown instead of a segmented row.
const MobileAspectSelect = memo(function MobileAspectSelect() {
  const engine = useTimelineEngine()
  const stage = useTracksStore((s) => s.stage)
  const [open, setOpen] = useState(false)

  const current = ASPECTS.find(
    (a) => Math.abs(stage.width / stage.height - a.w / a.h) < 0.001,
  )

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Aspect ratio"
        className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border border-ed-border bg-ed-elevated text-ed-text text-xs cursor-pointer"
      >
        {current && (
          <span
            style={{
              width: current.gw * 0.8,
              height: current.gh * 0.8,
              borderRadius: 2,
              background: 'currentColor',
            }}
          />
        )}
        {current?.label ?? 'Custom'}
        <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 min-w-[120px] rounded-md border border-ed-border bg-ed-elevated py-1 shadow-[var(--elah-menu-shadow)]">
            {ASPECTS.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  engine.setStage(a.w, a.h)
                  setOpen(false)
                }}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors hover:bg-ed-highest',
                  current?.label === a.label
                    ? 'text-ed-text'
                    : 'text-ed-text-muted hover:text-ed-text',
                )}
              >
                <span
                  style={{
                    width: a.gw * 0.8,
                    height: a.gh * 0.8,
                    borderRadius: 2,
                    background: 'currentColor',
                  }}
                />
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
})

/** Mobile timecode: MM:SS:FF — three fields instead of the desktop four
 * (hours dropped), so the transport grid centers the play button without
 * the timer running underneath it. */
function framesToCompactTimecode(frame: number, fps: number): string {
  const totalSec = Math.floor(frame / fps)
  const ff = frame % fps
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(ff).padStart(2, '0')}`
}

// Video transport — lives under the Preview (not in the timeline toolbar),
// matching the Figma. Play/pause, stop, and current | total time (cyan current).
const TransportBar = memo(function TransportBar() {
  // The floating preview toggle owns fullscreen on mobile — drop the duplicate.
  // Undo/redo live here on mobile (per the Figma); on desktop they stay in the header.
  const isMobile = useIsMobile()
  const engine = useTimelineEngine()
  const canUndo = useTracksStore((s) => s.canUndo)
  const canRedo = useTracksStore((s) => s.canRedo)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const totalFrames = useTracksStore((s) => s.totalFrames)
  const currentTimeRef = useRef<HTMLSpanElement>(null)
  const totalTimeRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const fmt = isMobile ? framesToCompactTimecode : framesToTimecode
    return usePlaybackStore.subscribe((state) => {
      if (currentTimeRef.current) {
        currentTimeRef.current.textContent = fmt(state.currentFrame, FPS)
      }
    })
  }, [isMobile])

  useEffect(() => {
    const fmt = isMobile ? framesToCompactTimecode : framesToTimecode
    const dur = Math.max(totalFrames, 1)
    if (totalTimeRef.current) totalTimeRef.current.textContent = fmt(dur, FPS)
    if (currentTimeRef.current) {
      currentTimeRef.current.textContent = fmt(
        usePlaybackStore.getState().currentFrame,
        FPS,
      )
    }
  }, [totalFrames, isMobile])

  const handleStop = useCallback(() => {
    usePlaybackStore.getState().pause()
    usePlaybackStore.getState().setCurrentFrame(0)
  }, [])

  const ghostIcon =
    'inline-flex items-center justify-center w-7 h-7 rounded text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated transition-colors cursor-pointer'

  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_auto_1fr] items-center h-11 bg-ed-bg-2 border-t border-ed-border shrink-0',
        // Same centering grid on both; mobile fits because the timecode drops
        // to three fields (MM:SS:FF) via framesToCompactTimecode.
        isMobile ? 'px-3' : 'px-4',
      )}
    >
      {/* Left — current | total time (current in accent) */}
      <span className="font-mono text-[11px] tracking-[0.02em] tabular-nums whitespace-nowrap">
        <span ref={currentTimeRef} style={{ color: 'var(--elah-accent)' }}>
          {isMobile ? '00:00:00' : '00:00:00:00'}
        </span>
        <span className="text-ed-text-muted mx-1.5">|</span>
        <span ref={totalTimeRef} className="text-ed-text-muted">
          {isMobile ? '00:00:00' : '00:00:00:00'}
        </span>
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

      {/* Right — undo/redo on mobile (Figma), preview view controls on desktop. */}
      <div className="flex items-center gap-1.5 justify-end">
        {isMobile ? (
          <>
            <button
              type="button"
              className={cn(ghostIcon, !canUndo && 'opacity-40 cursor-not-allowed')}
              disabled={!canUndo}
              onClick={() => engine.undo()}
              title="Undo"
            >
              <Undo2 size={16} />
            </button>
            <button
              type="button"
              className={cn(ghostIcon, !canRedo && 'opacity-40 cursor-not-allowed')}
              disabled={!canRedo}
              onClick={() => engine.redo()}
              title="Redo"
            >
              <Redo2 size={16} />
            </button>
          </>
        ) : (
          <>
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
          </>
        )}
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
  const isMobile = useIsMobile()
  const [mobileSheet, setMobileSheet] = useState<MobileSheetKind>(null)
  const previewBoxRef = useRef<HTMLDivElement>(null)

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
            {!isMobile && <LeftRail active={activePanel} onSelect={setActivePanel} />}
            {!isMobile && (
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
            )}

            <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-black">
              {!isMobile && <AspectControl />}
              <div
                ref={previewBoxRef}
                className={cn('flex-1 min-h-0 relative bg-black', isMobile ? 'py-2' : 'py-6')}
              >
                <Preview
                  demuxerFactory={demuxerFactoryRef.current}
                  style={{ width: '100%', height: '100%' }}
                />
                {isMobile && <PreviewFullscreenButton targetRef={previewBoxRef} />}
              </div>
              <TransportBar />
            </div>

            {!isMobile && <ClipProperties />}
          </div>

          <TimelineControls timelineRef={timelineRef} compact={isMobile} />

          <Timeline
            ref={timelineRef}
            fps={FPS}
            sidebarWidth={isMobile ? 48 : undefined}
            compactSidebar={isMobile}
            style={{ height: isMobile ? 158 : 186, flexShrink: 0, minWidth: 0 }}
          />

          {isMobile && <MobileToolbar onOpenSheet={setMobileSheet} />}
        </div>

        {isMobile && mobileSheet && (
          <MobileSheet
            title={
              mobileSheet === 'properties'
                ? 'Clip properties'
                : (RAIL_ITEMS.find((r) => r.id === mobileSheet)?.label ?? 'Panel')
            }
            onClose={() => setMobileSheet(null)}
          >
            {mobileSheet === 'elements' ? (
              <ElementsPanel activateOnTap style={{ flex: 1, minHeight: 0 }} />
            ) : mobileSheet === 'properties' ? (
              /* Child selector outranks the panel's fixed desktop width (PANEL
                 w-[300px]) by specificity, so stylesheet order can't flip it. */
              <div className="min-h-0 overflow-y-auto [&>div]:w-full [&>div]:border-l-0">
                <ClipProperties />
              </div>
            ) : (
              <MediaPanel mode={mobileSheet} style={{ flex: 1, minHeight: 0 }} />
            )}
          </MobileSheet>
        )}
      </div>
    </EditorProvider>
  )
}

/** Mobile bottom bar — the Figma's tool row, repurposed as sourcing-panel and
 * properties triggers (Filter/FX/etc. have no engine features behind them). */
const MobileToolbar = memo(function MobileToolbar({
  onOpenSheet,
}: {
  onOpenSheet: (kind: MobileSheetKind) => void
}) {
  const hasSelection = useSelectionStore((s) => s.selectedClipIds.size === 1)

  const item =
    'flex flex-col items-center gap-1 py-1 px-1 min-w-0 text-ed-text-muted cursor-pointer'
  const iconBox =
    'flex items-center justify-center w-9 h-9 rounded-xl bg-ed-elevated'

  return (
    <div className="flex items-center justify-around border-t border-ed-border bg-ed-bg-2 shrink-0 pt-1.5 pb-[max(env(safe-area-inset-bottom),6px)]">
      {RAIL_ITEMS.map(({ id, label, Icon }) => (
        <button key={id} type="button" className={item} onClick={() => onOpenSheet(id)}>
          <span className={iconBox}>
            <Icon size={17} />
          </span>
          <span className="text-[10px] leading-none">{label}</span>
        </button>
      ))}
      <button
        type="button"
        className={cn(item, !hasSelection && 'opacity-40 cursor-not-allowed')}
        disabled={!hasSelection}
        onClick={() => onOpenSheet('properties')}
        title={hasSelection ? 'Clip properties' : 'Select a clip first'}
      >
        <span className={iconBox}>
          <SlidersHorizontal size={17} />
        </span>
        <span className="text-[10px] leading-none">Edit</span>
      </button>
    </div>
  )
})
