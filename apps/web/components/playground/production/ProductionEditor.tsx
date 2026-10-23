'use client'

import posthog from 'posthog-js'
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { usePathname } from 'next/navigation'
import {
  Type as TypeIcon,
  Play,
  Pause,
  Square,
  Maximize2,
  ChevronDown,
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
  GripVertical,
  GripHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react'
import { ClipProperties } from './properties/ClipProperties'
import { TimelineControls } from '../shared/TimelineControls'
import { ProductionCodePanel } from './ProductionCodePanel'
import { ExportModal } from './ExportModal'
import { PlaygroundTabs } from '../shared/PlaygroundTabs'
import { BackButton } from '../shared/BackButton'
import { MediaPanel, type PanelMode } from './MediaPanel'
import { TracePanel } from './TracePanel'
import { LocalProjectBridge } from './LocalProjectBridge'
import { ProjectMediaNotice } from './ProjectSaveChrome'
import {
  editorPanelToggleLabel,
  readEditorPanelCollapsed,
  writeEditorPanelCollapsed,
} from '@/lib/editor/panelCollapse'
import { siteConfig } from '@/config/site'
import { cn } from '@/lib/utils'
import {
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

type RailItemId = 'stock' | 'photos' | 'audio' | 'elements'
type MobileSheetKind = RailItemId | 'properties' | null

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

/** Floating clip-properties toggle on the preview, mirroring
 * PreviewFullscreenButton on the opposite (bottom-left) corner. Opens the
 * same "properties" mobile sheet as the bottom toolbar's Edit action. */
function PreviewEditButton({ onOpenSheet }: { onOpenSheet: (kind: MobileSheetKind) => void }) {
  const hasSelection = useSelectionStore((s) => s.selectedClipIds.size === 1)

  return (
    <button
      type="button"
      onClick={() => onOpenSheet('properties')}
      disabled={!hasSelection}
      aria-label="Clip properties"
      title={hasSelection ? 'Clip properties' : 'Select a clip first'}
      className={cn(
        'absolute bottom-3 left-3 z-20 flex items-center justify-center w-10 h-10 rounded-full bg-black/60 text-white border border-white/10 backdrop-blur-sm cursor-pointer',
        !hasSelection && 'opacity-40 cursor-not-allowed',
      )}
    >
      <SlidersHorizontal size={16} />
    </button>
  )
}

const INITIAL_TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio (Main)' },
  { kind: 'elements', name: 'Elements' },
]

// Base Tailwind classes for toolbar buttons
const toolbarBtnCls =
  'px-3 py-1.5 bg-ed-elevated text-ed-text-muted border border-ed-border rounded-md text-xs cursor-pointer font-sans transition-colors'

const AppHeader = memo(function AppHeader({
  onExport,
  onToggleCode,
  codeOpen,
}: {
  onExport: () => void
  onToggleCode: () => void
  codeOpen: boolean
}) {
  const [showTrace, setShowTrace] = useState(false)
  const [showOverflow, setShowOverflow] = useState(false)
  const canUndo = useTracksStore((s) => s.canUndo)
  const canRedo = useTracksStore((s) => s.canRedo)
  const engine = useTimelineEngine()
  const isMobile = useIsMobile()
  const pathname = usePathname()
  const isStandalone = pathname === '/editor'

  return (
    <header className="elah-app-header grid grid-cols-[1fr_auto_1fr] items-center px-4 h-[46px] bg-ed-bg-2 border-b border-ed-border shrink-0">
      {/* Left — folded playground nav + brand + demo CTA */}
      <div className="flex items-center gap-3">
        {!isStandalone && <BackButton />}
        {!isMobile && (
          <>
            {!isStandalone && <div className="w-px h-4 bg-ed-border shrink-0" />}
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

      {/* Right — export + nav group */}
      <div className="flex items-center gap-1 justify-end">
        {!isMobile && !isStandalone && (
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
        {!isMobile && !isStandalone && (
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
          </>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 ml-1 text-xs font-semibold rounded-md font-sans cursor-pointer transition-colors"
          style={{
            background: 'var(--elah-accent)',
            color: '#04202a',
            boxShadow: '0 0 10px var(--elah-accent-glow)',
          }}
          onClick={onExport}
          title="Export to MP4"
        >
          ⬇ Export
        </button>
        {!isMobile && (
          <a
            href={siteConfig.links.github}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-2 py-1.5 rounded-md text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated transition-colors"
            title="View source on GitHub"
          >
            <Github size={14} />
          </a>
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
                {!isStandalone && (
                  <button
                    type="button"
                    onClick={() => { setShowOverflow(false); onToggleCode() }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs text-ed-text-muted hover:text-ed-text hover:bg-ed-highest transition-colors"
                  >
                    <Code2 size={14} /> {codeOpen ? 'Hide code' : 'Show code'}
                  </button>
                )}
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

const RAIL_ITEMS: {
  id: RailItemId
  label: string
  Icon: typeof Film
  danger?: boolean
}[] = [
  { id: 'stock', label: 'Videos', Icon: Film },
  { id: 'photos', label: 'Photos', Icon: ImageIcon },
  { id: 'audio', label: 'Audio', Icon: Music },
  { id: 'elements', label: 'Elements', Icon: TypeIcon },
]

const LeftRail = memo(function LeftRail({
  active,
  onSelect,
}: {
  active: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="w-[68px] shrink-0 flex flex-col items-center gap-1.5 py-3 border-r border-ed-border bg-ed-bg overflow-y-auto">
      {RAIL_ITEMS.map(({ id, label, Icon, danger }) => {
        const on = active === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              onSelect(id)
              posthog.capture('editor_panel_switched', { panel: id })
            }}
            className="w-full flex flex-col items-center gap-1.5 py-1 cursor-pointer"
          >
            <span
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded-xl transition-colors',
                !on && 'text-ed-text-muted',
              )}
              style={
                on
                  ? {
                      background: danger ? 'var(--elah-danger-text)' : 'var(--elah-accent)',
                      color: danger ? '#fff' : 'var(--elah-accent-text)',
                    }
                  : danger
                    ? { color: 'var(--elah-danger-text)' }
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
            onClick={() => {
              engine.setStage(a.w, a.h)
              posthog.capture('aspect_ratio_changed', { aspect_ratio: a.label, width: a.w, height: a.h })
            }}
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
                  posthog.capture('aspect_ratio_changed', { aspect_ratio: a.label, width: a.w, height: a.h })
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

function framesToCompactTimecode(frame: number, fps: number): string {
  const totalSec = Math.floor(frame / fps)
  const ff = frame % fps
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(ff).padStart(2, '0')}`
}

const TransportBar = memo(function TransportBar() {
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

      {/* Right — undo/redo on mobile, preview view controls on desktop */}
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
          <button type="button" title="Fullscreen" className={cn(ghostIcon, 'hidden')}>
            <Maximize2 size={14} />
          </button>
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
  const [activePanel, setActivePanel] = useState('stock')
  const isMobile = useIsMobile()
  const [mobileSheet, setMobileSheet] = useState<MobileSheetKind>(null)
  const previewBoxRef = useRef<HTMLDivElement>(null)

  // Collapsible side panels
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  useEffect(() => {
    setLeftPanelCollapsed(readEditorPanelCollapsed('left'))
    setRightPanelCollapsed(readEditorPanelCollapsed('right'))
  }, [])
  const toggleLeftPanel = useCallback(() => {
    setLeftPanelCollapsed((previous) => {
      const next = !previous
      writeEditorPanelCollapsed('left', next)
      return next
    })
  }, [])
  const toggleRightPanel = useCallback(() => {
    setRightPanelCollapsed((previous) => {
      const next = !previous
      writeEditorPanelCollapsed('right', next)
      return next
    })
  }, [])

  // Resizable panels
  const TIMELINE_MIN = 120
  const [timelineHeight, setTimelineHeight] = useState(186)
  const [isResizingTimeline, setIsResizingTimeline] = useState(false)

  const PANEL_MIN = 240
  const PANEL_DEFAULT = 280
  const PANEL_MAX_RESERVE = 480
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT)
  const [isResizingPanel, setIsResizingPanel] = useState(false)

  const PROPS_PANEL_MIN = 260
  const PROPS_PANEL_DEFAULT = 300
  const PROPS_PANEL_MAX_RESERVE = 480
  const [propertiesPanelWidth, setPropertiesPanelWidth] = useState(PROPS_PANEL_DEFAULT)
  const [isResizingProperties, setIsResizingProperties] = useState(false)

  const workspaceRef = useRef<HTMLDivElement>(null)

  const runResize = useCallback(
    (
      cssVar: string,
      valueAt: (ev: PointerEvent) => number,
      commit: (value: number) => void,
      setDragging: (dragging: boolean) => void,
      cursor: string,
    ) => {
      let latest: number | null = null
      setDragging(true)

      const onMove = (ev: PointerEvent) => {
        latest = valueAt(ev)
        workspaceRef.current?.style.setProperty(cssVar, `${latest}px`)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        setDragging(false)
        if (latest !== null) commit(latest)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      document.body.style.userSelect = 'none'
      document.body.style.cursor = cursor
    },
    [],
  )

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = timelineHeight
    const maxH = (workspaceRef.current?.clientHeight ?? 800) - 140
    runResize(
      '--elah-timeline-h',
      (ev) => {
        const next = startH + (startY - ev.clientY) // drag up → taller
        return Math.min(Math.max(next, TIMELINE_MIN), Math.max(maxH, TIMELINE_MIN))
      },
      setTimelineHeight,
      setIsResizingTimeline,
      'ns-resize',
    )
  }, [timelineHeight, runResize])

  const startPanelResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelWidth
    const maxW = Math.max(
      (workspaceRef.current?.clientWidth ?? 1200) - PANEL_MAX_RESERVE,
      PANEL_MIN,
    )
    runResize(
      '--elah-left-w',
      (ev) => {
        const next = startW + (ev.clientX - startX) // drag right → wider
        return Math.min(Math.max(next, PANEL_MIN), maxW)
      },
      setPanelWidth,
      setIsResizingPanel,
      'col-resize',
    )
  }, [panelWidth, runResize])

  const startPropertiesResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = propertiesPanelWidth
    const maxW = Math.max(
      (workspaceRef.current?.clientWidth ?? 1200) - panelWidth - PROPS_PANEL_MAX_RESERVE,
      PROPS_PANEL_MIN,
    )
    runResize(
      '--elah-right-w',
      (ev) => {
        const next = startW + (startX - ev.clientX) // drag left → wider
        return Math.min(Math.max(next, PROPS_PANEL_MIN), maxW)
      },
      setPropertiesPanelWidth,
      setIsResizingProperties,
      'col-resize',
    )
  }, [propertiesPanelWidth, panelWidth, runResize])

  const handleExportStart = useCallback(async (opts: {
    videoBitrate: number
    outputHeight: number
    videoCodec: ExportVideoCodec
    audioCodec: ExportAudioCodec
    signal: AbortSignal
    onProgress: (frame: number, totalFrames: number) => void
  }) => {
    const e = timelineRef.current?.engine
    if (!e) throw new Error('Editor is not ready yet — try again in a moment.')
    usePlaybackStore.getState().pause()
    const project = e.getProject()
    const { lazyExportVideo } = await import('@elah/editor')
    const blob = await lazyExportVideo(project, {
      videoBitrate: opts.videoBitrate,
      outputHeight: opts.outputHeight,
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
    <EditorProvider
      fps={FPS}
      defaultTrackHeight={36}
      initialTracks={INITIAL_TRACKS}
      stage={{ width: 1920, height: 1080 }}
    >
      <div className="elah-root flex flex-col h-full">
        <AppHeader
          onExport={() => {
            setShowExportModal(true)
            posthog.capture('export_modal_opened')
          }}
          onToggleCode={() => setShowCode((o) => !o)}
          codeOpen={showCode}
        />
        <LocalProjectBridge />
        <ProjectMediaNotice />
        {showExportModal && (
          <ExportModal
            isMobile={isMobile}
            onClose={() => setShowExportModal(false)}
            onExport={handleExportStart}
          />
        )}
        <ProductionCodePanel open={showCode} onClose={() => setShowCode(false)} />

        <div
          ref={workspaceRef}
          className="flex flex-col flex-1 min-h-0"
          style={
            {
              '--elah-left-w': `${panelWidth}px`,
              '--elah-right-w': `${propertiesPanelWidth}px`,
              '--elah-timeline-h': `${timelineHeight}px`,
            } as CSSProperties
          }
        >
          {/* Top section: Panels + Preview + Properties */}
          <div className="flex flex-1 min-h-0">
            {!isMobile && (
              <LeftRail
                active={activePanel}
                onSelect={(id) => {
                  setActivePanel(id)
                  if (leftPanelCollapsed) toggleLeftPanel()
                }}
              />
            )}
            {!isMobile && (
              <>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    width: leftPanelCollapsed ? 0 : 'var(--elah-left-w)',
                    flexShrink: 0,
                    background: 'var(--elah-bg-panel)',
                    minHeight: 0,
                    overflow: 'hidden',
                  }}
                  className={cn(!isResizingPanel && 'transition-[width] duration-200')}
                >
                  <div
                    style={{
                      width: 'var(--elah-left-w)',
                      flex: 1,
                      minHeight: 0,
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {activePanel === 'elements' ? (
                      <ElementsPanel style={{ flex: 1, minHeight: 0 }} />
                    ) : (
                      <MediaPanel mode={activePanel as PanelMode} style={{ flex: 1, minHeight: 0 }} />
                    )}
                  </div>
                </div>

                {/* Drag handle for left panel */}
                <div
                  onPointerDown={startPanelResize}
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize panel"
                  className={cn(
                    'group relative shrink-0 w-[5px] -mr-[2px] flex items-center justify-center cursor-col-resize',
                    leftPanelCollapsed && 'hidden',
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none h-full w-px transition-colors',
                      isResizingPanel
                        ? 'bg-ed-accent'
                        : 'bg-ed-border group-hover:bg-ed-accent',
                    )}
                  />
                  <span
                    className={cn(
                      'pointer-events-none absolute flex h-7 w-[13px] items-center justify-center',
                      'rounded-full border bg-ed-elevated transition-colors',
                      isResizingPanel
                        ? 'border-ed-accent text-ed-accent'
                        : 'border-ed-border text-ed-text-muted group-hover:border-ed-accent group-hover:text-ed-accent',
                    )}
                  >
                    <GripVertical size={11} />
                  </span>
                </div>
              </>
            )}

            <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-black">
              {!isMobile && (
                <div className="relative shrink-0">
                  <AspectControl />
                  <button
                    type="button"
                    onClick={toggleLeftPanel}
                    title={editorPanelToggleLabel('left', leftPanelCollapsed)}
                    aria-label={editorPanelToggleLabel('left', leftPanelCollapsed)}
                    aria-expanded={!leftPanelCollapsed}
                    data-testid="editor-left-panel-toggle"
                    className="absolute left-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg text-ed-text-muted transition-colors hover:bg-ed-elevated hover:text-ed-text cursor-pointer"
                  >
                    {leftPanelCollapsed ? (
                      <PanelLeftOpen size={16} aria-hidden />
                    ) : (
                      <PanelLeftClose size={16} aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={toggleRightPanel}
                    title={editorPanelToggleLabel('right', rightPanelCollapsed)}
                    aria-label={editorPanelToggleLabel('right', rightPanelCollapsed)}
                    aria-expanded={!rightPanelCollapsed}
                    data-testid="editor-right-panel-toggle"
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg text-ed-text-muted transition-colors hover:bg-ed-elevated hover:text-ed-text cursor-pointer"
                  >
                    {rightPanelCollapsed ? (
                      <PanelRightOpen size={16} aria-hidden />
                    ) : (
                      <PanelRightClose size={16} aria-hidden />
                    )}
                  </button>
                </div>
              )}
              <div
                ref={previewBoxRef}
                className={cn('flex-1 min-h-0 relative bg-black', isMobile ? 'py-2' : 'py-6')}
              >
                <Preview
                  demuxerFactory={demuxerFactoryRef.current}
                  style={{ width: '100%', height: '100%' }}
                />
                {isMobile && <PreviewFullscreenButton targetRef={previewBoxRef} />}
                {isMobile && <PreviewEditButton onOpenSheet={setMobileSheet} />}
              </div>
              <TransportBar />
            </div>

            {!isMobile && (
              <>
                {/* Drag handle for Properties column */}
                <div
                  onPointerDown={startPropertiesResize}
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize Properties"
                  className={cn(
                    'group relative shrink-0 w-[5px] -ml-[2px] flex items-center justify-center cursor-col-resize',
                    rightPanelCollapsed && 'hidden',
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none h-full w-px transition-colors',
                      isResizingProperties
                        ? 'bg-ed-accent'
                        : 'bg-ed-border group-hover:bg-ed-accent',
                    )}
                  />
                  <span
                    className={cn(
                      'pointer-events-none absolute flex h-7 w-[13px] items-center justify-center',
                      'rounded-full border bg-ed-elevated transition-colors',
                      isResizingProperties
                        ? 'border-ed-accent text-ed-accent'
                        : 'border-ed-border text-ed-text-muted group-hover:border-ed-accent group-hover:text-ed-accent',
                    )}
                  >
                    <GripVertical size={11} />
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    width: rightPanelCollapsed ? 0 : 'var(--elah-right-w)',
                    flexShrink: 0,
                    minHeight: 0,
                    overflow: 'hidden',
                  }}
                  className={cn(!isResizingProperties && 'transition-[width] duration-200')}
                >
                  <div
                    style={{
                      width: 'var(--elah-right-w)',
                      flex: 1,
                      minHeight: 0,
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                    className="[&>div]:w-full [&>div]:h-full [&>div]:border-l-0"
                  >
                    <ClipProperties />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Drag handle for timeline */}
          {!isMobile && (
            <div
              onPointerDown={startResize}
              role="separator"
              aria-orientation="horizontal"
              title="Drag to resize timeline"
              className="group relative shrink-0 h-[5px] -mb-[2px] flex items-center justify-center cursor-ns-resize"
            >
              <span
                className={cn(
                  'pointer-events-none w-full h-px transition-colors',
                  isResizingTimeline
                    ? 'bg-ed-accent'
                    : 'bg-ed-border group-hover:bg-ed-accent',
                )}
              />
              <span
                className={cn(
                  'pointer-events-none absolute flex w-7 h-[13px] items-center justify-center',
                  'rounded-full border bg-ed-elevated transition-colors',
                  isResizingTimeline
                    ? 'border-ed-accent text-ed-accent'
                    : 'border-ed-border text-ed-text-muted group-hover:border-ed-accent group-hover:text-ed-accent',
                )}
              >
                <GripHorizontal size={11} />
              </span>
            </div>
          )}

          {/* Timeline container — runs horizontally across the full width */}
          <div className="relative flex flex-col min-h-0 shrink-0">
            <TimelineControls timelineRef={timelineRef} compact={isMobile} />

            <Timeline
              ref={timelineRef}
              fps={FPS}
              sidebarWidth={isMobile ? 48 : undefined}
              compactSidebar={isMobile}
              style={{
                height: isMobile ? 158 : 'var(--elah-timeline-h)',
                flexShrink: 0,
                minWidth: 0,
              }}
            />

          </div>

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

const MobileToolbar = memo(function MobileToolbar({
  onOpenSheet,
}: {
  onOpenSheet: (kind: MobileSheetKind) => void
}) {
  const item =
    'flex flex-col items-center gap-1 py-1 px-1 min-w-0 text-ed-text-muted cursor-pointer'
  const iconBox =
    'flex items-center justify-center w-9 h-9 rounded-xl bg-ed-elevated'

  return (
    <div className="flex items-center justify-around border-t border-ed-border bg-ed-bg-2 shrink-0 pt-1.5 pb-[max(env(safe-area-inset-bottom),6px)]">
      {RAIL_ITEMS.map(({ id, label, Icon, danger }) => (
        <button key={id} type="button" className={item} onClick={() => onOpenSheet(id)}>
          <span className={iconBox} style={danger ? { color: 'var(--elah-danger-text)' } : undefined}>
            <Icon size={17} />
          </span>
          <span
            className="text-[10px] leading-none"
            style={danger ? { color: 'var(--elah-danger-text)' } : undefined}
          >
            {label}
          </span>
        </button>
      ))}
    </div>
  )
})
