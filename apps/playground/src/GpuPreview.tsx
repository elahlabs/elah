import { useEffect, useRef } from 'react'
import {
  GpuDebugCounters,
  Preview,
  usePlaybackEngine,
  usePlaybackStore,
  useTracksStore,
  type PreviewHandle,
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
 * Playground wrapper around the library `<Preview>`.
 *
 * `<Preview>` owns the renderer + RAF + resize. This wrapper adds the
 * playground-only concerns: the transport bar (play/pause + scrubber) and the
 * dev/test hooks on `window.__GPU__` / `window.__elahSeek`, wired through the
 * Preview ref.
 */
export function GpuPreview({ debugMode = false, style }: GpuPreviewProps) {
  const previewRef = useRef<PreviewHandle>(null)
  // A demuxer factory is the only thing the library needs injected; building it
  // once keeps the same mediabunny backend across re-renders.
  const demuxerFactoryRef = useRef(createPlaygroundDemuxerFactory())
  const playback = usePlaybackEngine()
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const totalFrames = useTracksStore((s) => s.totalFrames)

  // Dev-only helpers consumed by Playwright E2E tests. window.__GPU__ exposes
  // pixel readbacks + decode counters so tests can (a) assert real decoded frames
  // landed on the canvas (not just black) and (b) compute golden-pixel hashes for
  // regression detection. Wired through the Preview ref so the library stays free
  // of test scaffolding.
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
      <Preview
        ref={previewRef}
        demuxerFactory={demuxerFactoryRef.current}
        debug={debugMode}
        // Required so window.__GPU__.readCanvas() (Playwright golden-pixel tests
        // + dev tools) can call gl.readPixels() outside the RAF tick. The default
        // WebGL behaviour clears the drawing buffer after every compositing op,
        // making JS-side readbacks return zeros even though the canvas is painted.
        preserveDrawingBuffer
        style={{ flex: 1, minHeight: 240 }}
      />
    </div>
  )
}
