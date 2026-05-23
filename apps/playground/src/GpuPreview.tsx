import { useEffect, useRef } from 'react'
import {
  GpuRenderer,
  resolveTimeline,
  usePlaybackEngine,
  usePlaybackStore,
  useTimelineEngine,
  useTracksStore,
} from '@elah/editor'

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

    const renderer = new GpuRenderer()
    renderer.mount(container)
    renderer.setDebug(debugMode)

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
        borderTop: '1px solid #2a2a2a',
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
          height: 240,
          background: '#000',
        }}
      />
    </div>
  )
}
