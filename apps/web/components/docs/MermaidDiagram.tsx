'use client'

import { useEffect, useState, useId, useCallback, useRef } from 'react'
import { Maximize2, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { useTheme } from '@/components/ThemeProvider'

interface MermaidDiagramProps {
  chart: string
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const ZOOM_STEP = 0.25

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const id = useId().replace(/:/g, '')
  const [svg, setSvg] = useState<string>('')
  const [fullscreen, setFullscreen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()

  useEffect(() => {
    let cancelled = false
    import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: theme === 'dark' ? 'dark' : 'neutral',
        fontFamily: 'var(--font-mono), ui-monospace, monospace',
        fontSize: 13,
        flowchart: { curve: 'basis', padding: 16 },
        sequence: { actorMargin: 60, messageMargin: 30 },
      })
      mermaid.render(`mmd-${id}`, chart).then(({ svg: result }) => {
        if (!cancelled) setSvg(result)
      }).catch(() => {})
    })
    return () => { cancelled = true }
  }, [chart, theme, id])

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))

  const close = useCallback(() => {
    setFullscreen(false)
    setZoom(1)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return }
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        setZoom(z => clampZoom(z + ZOOM_STEP))
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault()
        setZoom(z => clampZoom(z - ZOOM_STEP))
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault()
        setZoom(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen, close])

  // Ctrl+wheel zoom
  useEffect(() => {
    const el = scrollAreaRef.current
    if (!el || !fullscreen) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom(z => clampZoom(z - e.deltaY * 0.002))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [fullscreen])

  if (!svg) {
    return (
      <div className="h-48 animate-pulse rounded-md border border-outline-variant bg-surface-container" />
    )
  }

  return (
    <>
      {/* Inline diagram */}
      <div className="group relative overflow-x-auto rounded-md border border-outline-variant bg-surface-low p-4 [&_svg]:mx-auto [&_svg]:max-w-full">
        <button
          onClick={() => setFullscreen(true)}
          title="View fullscreen"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded border border-outline-variant bg-surface text-on-surface-variant opacity-0 transition-opacity hover:bg-surface-high hover:text-on-surface group-hover:opacity-100"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </div>

      {/* Fullscreen */}
      {fullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: 'var(--color-surface, #fff)' }}>
          {/* Toolbar */}
          <div className="flex shrink-0 items-center justify-between border-b border-outline-variant px-4 py-2" style={{ backgroundColor: 'var(--color-surface-low, #f5f5f5)' }}>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setZoom(z => clampZoom(z - ZOOM_STEP))}
                disabled={zoom <= MIN_ZOOM}
                title="Zoom out (Ctrl −)"
                className="flex h-7 w-7 items-center justify-center rounded border border-outline-variant text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-30"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>

              <span className="w-14 text-center font-mono text-xs text-on-surface-variant tabular-nums">
                {Math.round(zoom * 100)}%
              </span>

              <button
                onClick={() => setZoom(z => clampZoom(z + ZOOM_STEP))}
                disabled={zoom >= MAX_ZOOM}
                title="Zoom in (Ctrl +)"
                className="flex h-7 w-7 items-center justify-center rounded border border-outline-variant text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-30"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>

              <button
                onClick={() => setZoom(1)}
                disabled={zoom === 1}
                title="Reset zoom (Ctrl 0)"
                className="ml-1 flex h-7 w-7 items-center justify-center rounded border border-outline-variant text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-30"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </div>

            <p className="hidden text-2xs text-on-surface-variant opacity-50 sm:block">
              Ctrl+scroll · Ctrl +/− · Esc to close
            </p>

            <button
              onClick={close}
              title="Close (Esc)"
              className="flex h-7 w-7 items-center justify-center rounded border border-outline-variant text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Diagram scroll area */}
          <div ref={scrollAreaRef} className="flex-1 overflow-auto p-12">
            <div
              className="[&_svg]:block [&_svg]:h-auto [&_svg]:w-auto"
              style={{ zoom: zoom, transformOrigin: 'top left' }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      )}
    </>
  )
}
