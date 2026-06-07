import { useEffect, useRef, useState } from 'react'
import {
  GpuDebugCounters,
  Preview,
  usePlaybackEngine,
  usePlaybackStore,
  useTracksStore,
  useResolvedScene,
  type PreviewHandle,
  type CounterSnapshot,
} from '@elah/editor'
import { createPlaygroundDemuxerFactory } from './createPlaygroundDemuxerFactory'
import { JsonHighlight } from './JsonHighlight'
import { theme } from './theme'

interface GpuDevHandle {
  readCanvas(): Promise<string>
  readPixelRegion(x: number, y: number, w: number, h: number): Uint8Array
  counters(): CounterSnapshot
  canvasSize(): { width: number; height: number }
}

export interface GpuPreviewProps {
  debugMode?: boolean
  showSceneResolver?: boolean
  style?: React.CSSProperties
}

function CollapsiblePanelHeader({
  title,
  meta,
  collapsed,
  onToggle,
}: {
  title: string
  meta?: string
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        width: '100%',
        padding: '6px 10px',
        background: 'transparent',
        border: 'none',
        borderBottom: collapsed ? 'none' : `1px solid ${theme.borderSubtle}`,
        cursor: 'pointer',
        pointerEvents: 'auto',
        textAlign: 'left',
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.1em',
          color: theme.textMuted,
          fontFamily: theme.fontSans,
          textTransform: 'uppercase',
        }}
      >
        {title}
      </span>
      {collapsed && meta ? (
        <span
          style={{
            fontSize: 9,
            color: theme.textSecondary,
            fontFamily: theme.fontMono,
            marginLeft: 'auto',
          }}
        >
          {meta}
        </span>
      ) : null}
      <span style={{ fontSize: 10, color: theme.textMuted, opacity: 0.7, flexShrink: 0 }}>
        {collapsed ? '▸' : '▾'}
      </span>
    </button>
  )
}

function SceneResolverPanel({ top }: { top: number }) {
  const scene = useResolvedScene()
  const [collapsed, setCollapsed] = useState(false)
  const layerCount =
    (scene?.videos?.length ?? 0) +
    (scene?.audios?.length ?? 0) +
    (scene?.texts?.length ?? 0) +
    (scene?.images?.length ?? 0)

  return (
    <div
      style={{
        position: 'absolute',
        top,
        right: 8,
        width: 220,
        maxHeight: collapsed ? undefined : `calc(100% - ${top + 12}px)`,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'none',
        zIndex: 12,
        background: 'rgba(18, 23, 34, 0.88)',
        backdropFilter: 'blur(8px)',
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
      }}
    >
      <CollapsiblePanelHeader
        title="Scene Resolver"
        meta={`${layerCount} layers`}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />
      {!collapsed && (
        <pre
          style={{
            flex: 1,
            margin: 0,
            padding: '8px 10px',
            overflow: 'auto',
            fontSize: 9,
            lineHeight: 1.45,
            fontFamily: theme.fontMono,
            color: theme.textSecondary,
            pointerEvents: 'auto',
          }}
        >
          <JsonHighlight value={scene} />
        </pre>
      )}
    </div>
  )
}

/** Measure GPU debug panel height so Scene Resolver stacks below it without overlap. */
function useGpuDebugStackTop(
  containerRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
): number {
  const [top, setTop] = useState(8)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !enabled) {
      setTop(8)
      return
    }

    let gpuObserver: ResizeObserver | null = null

    const measure = () => {
      const gpuRoot = container.querySelector('[data-elah-gpu-debug]') as HTMLElement | null
      if (!gpuRoot) {
        setTop(8)
        return
      }
      gpuObserver?.disconnect()
      gpuObserver = new ResizeObserver(measure)
      gpuObserver.observe(gpuRoot)
      setTop(gpuRoot.offsetTop + gpuRoot.offsetHeight + 8)
    }

    const containerObserver = new ResizeObserver(measure)
    containerObserver.observe(container)

    const mutationObserver = new MutationObserver(measure)
    mutationObserver.observe(container, { childList: true, subtree: true })

    measure()

    return () => {
      containerObserver.disconnect()
      mutationObserver.disconnect()
      gpuObserver?.disconnect()
    }
  }, [containerRef, enabled])

  return top
}

/** Transport bar — the only part that subscribes to currentFrame.
 *  Isolated here so the rest of GpuPreview never re-renders during playback. */
function TransportBar() {
  const playback = usePlaybackEngine()
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const totalFrames = useTracksStore((s) => s.totalFrames)

  const togglePlayPause = () => {
    if (playback.isPlaying) playback.pause()
    else playback.play()
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        borderBottom: `1px solid ${theme.borderSubtle}`,
        flexShrink: 0,
        background: 'rgba(13, 16, 23, 0.6)',
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: theme.textMuted,
          fontFamily: theme.fontSans,
        }}
      >
        GPU PREVIEW
      </span>
      <button
        type="button"
        onClick={togglePlayPause}
        style={{
          padding: '4px 12px',
          fontSize: 11,
          fontFamily: theme.fontSans,
          background: isPlaying ? 'rgba(34, 197, 94, 0.12)' : theme.bgElevated,
          color: isPlaying ? theme.success : theme.textSecondary,
          border: `1px solid ${isPlaying ? theme.success : theme.border}`,
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        {isPlaying ? 'Pause' : 'Play'}
      </button>
      <input
        type="range"
        className="elah-range"
        min={0}
        max={Math.max(totalFrames - 1, 0)}
        value={currentFrame}
        onChange={(e) => playback.seek(Number(e.target.value))}
        style={{ flex: 1, minWidth: 120 }}
      />
      <span style={{ fontSize: 10, color: theme.textMuted, fontFamily: theme.fontMono }}>
        f {currentFrame}
      </span>
    </div>
  )
}

export function GpuPreview({ debugMode = false, showSceneResolver = false, style }: GpuPreviewProps) {
  const previewInnerRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<PreviewHandle>(null)
  const demuxerFactoryRef = useRef(createPlaygroundDemuxerFactory())
  const playback = usePlaybackEngine()

  const sceneResolverTop = useGpuDebugStackTop(
    previewInnerRef,
    Boolean(debugMode && showSceneResolver),
  )

  useEffect(() => {
    if (!import.meta.env.DEV) return

    ;(window as Window & { __elahSeek?: (frame: number) => void }).__elahSeek = (
      frame: number,
    ) => {
      playback.seek(frame)
    }

    const readGl = () => {
      const canvas = previewRef.current?.getCanvas()
      if (!canvas) throw new Error('__GPU__: renderer not mounted')
      const gl = canvas.getContext('webgl2')
      if (!gl) throw new Error('__GPU__: no WebGL2 context')
      return { canvas, gl }
    }

    ;(window as Window & { __GPU__?: GpuDevHandle }).__GPU__ = {
      async readCanvas(): Promise<string> {
        const { canvas, gl } = readGl()
        const { width, height } = canvas
        const pixels = new Uint8Array(width * height * 4)
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        const hash = await crypto.subtle.digest('SHA-256', pixels)
        return Array.from(new Uint8Array(hash))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      },
      readPixelRegion(x, y, w, h): Uint8Array {
        const { gl } = readGl()
        const pixels = new Uint8Array(w * h * 4)
        gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        return pixels
      },
      counters(): CounterSnapshot {
        return GpuDebugCounters.snapshot()
      },
      canvasSize(): { width: number; height: number } {
        const { canvas } = readGl()
        return { width: canvas.width, height: canvas.height }
      },
    }

    return () => {
      delete (window as Window & { __GPU__?: GpuDevHandle }).__GPU__
      delete (window as Window & { __elahSeek?: (frame: number) => void }).__elahSeek
    }
  }, [playback])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: `radial-gradient(ellipse at center, #0d1017 0%, ${theme.bgPrimary} 70%)`,
        borderRight: `1px solid ${theme.border}`,
        minHeight: 0,
        position: 'relative',
        ...style,
      }}
    >
      <TransportBar />

      <div
        style={{
          flex: 1,
          minHeight: 200,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          boxShadow: 'inset 0 0 60px rgba(0,0,0,0.35)',
        }}
      >
        <div
          ref={previewInnerRef}
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            maxWidth: '100%',
            borderRadius: 4,
            overflow: 'hidden',
            boxShadow: '0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(35,41,56,0.8)',
          }}
        >
          <Preview
            ref={previewRef}
            demuxerFactory={demuxerFactoryRef.current}
            debug={debugMode}
            preserveDrawingBuffer
            style={{ flex: 1, minHeight: 200, width: '100%', height: '100%' }}
          />

          {showSceneResolver && <SceneResolverPanel top={sceneResolverTop} />}
        </div>
      </div>
    </div>
  )
}
