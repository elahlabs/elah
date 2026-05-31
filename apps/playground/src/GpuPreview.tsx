import { useEffect, useRef } from 'react'
import {
  GpuRenderer,
  GpuDebugCounters,
  resolveTimeline,
  usePlaybackEngine,
  usePlaybackStore,
  useTimelineEngine,
  useTracksStore,
  type CounterSnapshot,
} from '@elah/editor'
import { createPlaygroundDemuxerFactory } from './createPlaygroundDemuxerFactory'

/** Dev-only handle exposed on window.__GPU__ for Playwright integration tests. */
interface GpuDevHandle {
  /** Read the current canvas pixels and return a SHA-256 hex digest. */
  readCanvas(): Promise<string>
  /** Read a small region of the canvas and return the raw RGBA bytes. */
  readPixelRegion(x: number, y: number, w: number, h: number): Uint8Array
  /** Snapshot of decode/cache counters. Used by tests to assert real decode happened. */
  counters(): CounterSnapshot
  /** Current canvas drawing buffer size (deterministic in headless Playwright). */
  canvasSize(): { width: number; height: number }
}

export interface GpuPreviewProps {
  debugMode?: boolean
  style?: React.CSSProperties
}

/**
 * Thin React shell that mounts GpuRenderer and drives render(scene) from a RAF loop.
 * PlaybackEngine + resolveTimeline run imperatively — no React re-renders at 60 Hz.
 */
export function GpuPreview({ debugMode = false, style }: GpuPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const engine = useTimelineEngine()
  const playback = usePlaybackEngine()
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const totalFrames = useTracksStore((s) => s.totalFrames)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new GpuRenderer({
      // BISECTION PROBE: bypass VideoLayer/decode and paint synthetic
      // colour + "frame N" per clip, to test the clock→render→draw path
      // in isolation. Set true to restore the synthetic probe.
      probeLayer: false,
      demuxerFactory: createPlaygroundDemuxerFactory(),
      maxOutstandingDecodes: 4,
      // Required so window.__GPU__.readCanvas() (Playwright golden-pixel tests
      // + future dev tools) can call gl.readPixels() outside the RAF tick.
      // The default WebGL behaviour clears the drawing buffer after every
      // compositing op, which makes JS-side readbacks return all zeros even
      // though the canvas is visibly painted.
      preserveDrawingBuffer: true,
    })
    renderer.mount(container)
    renderer.setDebug(debugMode)

    // Dev-only helper consumed by Playwright E2E tests.
    // window.__GPU__ exposes pixel readbacks + decode counters so tests can
    // (a) assert real decoded frames landed on the canvas (not just black)
    // and (b) compute golden-pixel hashes for regression detection.
    if (import.meta.env.DEV) {
      // Manual frame stepping from DevTools: window.__elahSeek(5)
      ;(window as Window & { __elahSeek?: (frame: number) => void }).__elahSeek = (frame: number) => {
        playback.seek(frame)
      }

      const readGl = () => {
        const canvas = renderer.getCanvas()
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
    }

    const resize = () => {
      const dpr = window.devicePixelRatio ?? 1
      renderer.resize(container.clientWidth, container.clientHeight, dpr)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    let rafId = 0
    const tick = () => {
      const frame = Math.floor(playback.getFrameAt())
      const scene = resolveTimeline(frame, engine.getProject())
      renderer.render(scene)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
      renderer.dispose()
      if (import.meta.env.DEV) {
        delete (window as Window & { __GPU__?: GpuDevHandle }).__GPU__
        delete (window as Window & { __elahSeek?: (frame: number) => void }).__elahSeek
      }
    }
  }, [engine, playback, debugMode])

  const togglePlayPause = () => {
    if (playback.isPlaying) playback.pause()
    else playback.play()
  }

  const seek = (frame: number) => {
    playback.seek(frame)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: '#0d0d0d',
        borderBottom: '1px solid #2a2a2a',
        minHeight: 0, // critical so flex children can shrink correctly
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid #222',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: '#888',
            fontFamily: 'monospace',
            marginRight: 4,
          }}
        >
          GPU Preview
        </span>
        <button
          type="button"
          onClick={togglePlayPause}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            fontFamily: 'monospace',
            background: isPlaying ? '#1a3a1a' : '#2a2a2a',
            color: isPlaying ? '#6fcf6f' : '#ddd',
            border: '1px solid #3a3a3a',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(totalFrames - 1, 0)}
          value={currentFrame}
          onChange={(e) => seek(Number(e.target.value))}
          style={{ flex: 1, minWidth: 120 }}
        />
        <span style={{ fontSize: 11, color: '#666', fontFamily: 'monospace' }}>
          f {currentFrame}
        </span>
      </div>
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          flex: 1,
          minHeight: 240,
          background: '#000',
        }}
      />
    </div>
  )
}
