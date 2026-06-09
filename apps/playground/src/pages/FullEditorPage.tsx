/**
 * FullEditorPage
 *
 * Demonstrates the complete editor experience.
 * Validates full @elah/editor package composition and interoperability.
 *
 * Usage:
 * - EditorProvider creates and wires the engines
 * - AssetPanel manages media library
 * - Preview renders with GPU renderer and playback sync
 * - Timeline handles timeline UI and interactions
 * - All pieces work together through shared state
 */

import { memo, useCallback, useRef, useState } from 'react'
import {
  EditorProvider,
  AssetPanel,
  Preview,
  Timeline,
  usePlaybackStore,
  useTracksStore,
  useTimelineEngine,
  framesToTimecode,
  lazyExportVideo,
  type InitialTrackConfig,
  type TimelineRef,
  type PreviewHandle,
  type ExportVideoCodec,
  type ExportAudioCodec,
} from '@elah/editor'

// ---------------------------------------------------------------------------
// Minimal export modal for the standalone playground
// ---------------------------------------------------------------------------

type ExportPhase = 'idle' | 'rendering' | 'error'

function ExportOverlay({
  phase,
  frame,
  totalFrames,
  error,
  onCancel,
  onClose,
}: {
  phase: ExportPhase
  frame: number
  totalFrames: number
  error: string
  onCancel: () => void
  onClose: () => void
}) {
  if (phase === 'idle') return null
  const pct = totalFrames > 0 ? Math.round((frame / totalFrames) * 100) : 0

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    fontFamily: 'system-ui, sans-serif',
  }

  const cardStyle: React.CSSProperties = {
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: 8,
    padding: '20px 24px',
    width: 340,
    color: '#f3f4f6',
  }

  const btnStyle: React.CSSProperties = {
    padding: '7px 16px',
    background: '#262626',
    color: '#a7afbf',
    border: '1px solid #333',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
  }

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        {phase === 'rendering' ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Exporting…</div>
            <div style={{ fontSize: 12, color: '#a7afbf', marginBottom: 10 }}>
              {totalFrames > 0 ? `Frame ${frame} / ${totalFrames}` : 'Preparing…'}
            </div>
            <div style={{ height: 6, background: '#333', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: '#e11d48', borderRadius: 3, transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 16 }}>{pct}%</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button style={btnStyle} onClick={onCancel}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Export failed</div>
            <div style={{ fontSize: 11, color: '#fb7185', fontFamily: 'monospace', marginBottom: 16, wordBreak: 'break-word' }}>{error}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button style={btnStyle} onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const FPS = 30

const INITIAL_TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'text', name: 'Text' },
]

// Toolbar with playback controls and demo buttons
const Toolbar = memo(function Toolbar({ onExport }: { onExport: () => void }) {
  const engine = useTimelineEngine()
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const totalFrames = useTracksStore((s) => s.totalFrames)
  const tracks = useTracksStore((s) => s.tracks)
  const clips = useTracksStore((s) => s.clips)
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)

  const handleAddClip = (trackId: string, type: 'video' | 'audio' | 'text', duration: number = FPS * 5) => {
    const clipCount = (clips[trackId] ?? []).length
    if (type === 'text') {
      engine.addClip({
        trackId,
        type: 'text',
        startFrame: currentFrame,
        durationFrames: duration,
        name: `Text Clip ${clipCount + 1}`,
        text: {
          content: `Text ${clipCount + 1}`,
          fontSize: 32,
          color: '#ffffff',
        },
      })
    } else {
      engine.addClip({
        trackId,
        type,
        src: `demo-${type}-${clipCount + 1}`,
        startFrame: currentFrame,
        durationFrames: duration,
        name: `${type.charAt(0).toUpperCase()}${type.slice(1)} Clip ${clipCount + 1}`,
      })
    }
  }

  const handleReset = () => {
    setCurrentFrame(0)
  }

  const handleClearAll = () => {
    engine.batch(() => {
      tracks.forEach((track) => {
        const trackClips = clips[track.id] ?? []
        trackClips.forEach((clip) => {
          engine.removeClip(clip.id, track.id)
        })
      })
    }, 'Clear all clips')
  }

  const buttonStyle = {
    padding: '8px 12px',
    background: '#333',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
  }

  const primaryButtonStyle = {
    ...buttonStyle,
    background: '#e81c48',
  } as React.CSSProperties

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        background: '#1a1a1a',
        borderBottom: '1px solid #333',
        flexShrink: 0,
        overflowX: 'auto',
      }}
    >
      {/* Playback Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12, borderRight: '1px solid #333' }}>
        <button
          onClick={togglePlayPause}
          style={{
            ...primaryButtonStyle,
            background: isPlaying ? '#e81c48' : '#333',
          }}
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>

        <span style={{ fontSize: 11, color: '#999', fontFamily: 'monospace', minWidth: 90 }}>
          {framesToTimecode(currentFrame, FPS)} / {framesToTimecode(Math.max(totalFrames, 1), FPS)}
        </span>

        <button onClick={() => engine.undo()} style={buttonStyle}>
          ↶ Undo
        </button>

        <button onClick={handleReset} style={buttonStyle}>
          ⏮ Reset
        </button>
      </div>

      {/* Add Clip Demo Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12, borderRight: '1px solid #333' }}>
        <span style={{ fontSize: 11, color: '#666', fontWeight: 600 }}>ADD CLIP:</span>
        <button
          onClick={() => tracks[0] && handleAddClip(tracks[0].id, 'video', FPS * 3)}
          style={{ ...buttonStyle, background: '#1a5f38' }}
          title="Add 3-second video clip"
        >
          + Video
        </button>
        <button
          onClick={() => tracks[1] && handleAddClip(tracks[1].id, 'audio', FPS * 5)}
          style={{ ...buttonStyle, background: '#4a3f2f' }}
          title="Add 5-second audio clip"
        >
          + Audio
        </button>
        <button
          onClick={() => tracks[2] && handleAddClip(tracks[2].id, 'text', FPS * 2)}
          style={{ ...buttonStyle, background: '#3a2a4a' }}
          title="Add 2-second text clip"
        >
          + Text
        </button>
      </div>

      {/* Utility Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={handleClearAll} style={{ ...buttonStyle, background: '#5a3a3a' }}>
          🗑 Clear All
        </button>
      </div>

      {/* Export */}
      <div style={{ marginLeft: 'auto' }}>
        <button onClick={onExport} style={primaryButtonStyle}>
          ⬇ Export
        </button>
      </div>
    </div>
  )
})

export default function FullEditorPage() {
  const timelineRef = useRef<TimelineRef>(null)
  const previewRef = useRef<PreviewHandle>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [exportPhase, setExportPhase] = useState<ExportPhase>('idle')
  const [exportFrame, setExportFrame] = useState(0)
  const [exportTotalFrames, setExportTotalFrames] = useState(0)
  const [exportError, setExportError] = useState('')

  const handleExport = useCallback(async () => {
    const engine = timelineRef.current?.engine
    if (!engine) return
    usePlaybackStore.getState().pause()
    const project = engine.getProject()
    const controller = new AbortController()
    abortRef.current = controller
    setExportPhase('rendering')
    setExportFrame(0)
    setExportTotalFrames(0)
    try {
      const blob = await lazyExportVideo(project, {
        videoBitrate: 8_000_000,
        videoCodec: 'avc' as ExportVideoCodec,
        audioCodec: 'aac' as ExportAudioCodec,
        signal: controller.signal,
        onProgress: ({ frame, totalFrames }) => {
          setExportFrame(frame)
          setExportTotalFrames(totalFrames)
        },
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'export.mp4'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setExportPhase('idle')
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        setExportPhase('idle')
      } else {
        setExportError(String(err))
        setExportPhase('error')
      }
    } finally {
      abortRef.current = null
    }
  }, [])

  return (
    <EditorProvider fps={FPS} initialTracks={INITIAL_TRACKS}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <ExportOverlay
        phase={exportPhase}
        frame={exportFrame}
        totalFrames={exportTotalFrames}
        error={exportError}
        onCancel={() => abortRef.current?.abort()}
        onClose={() => setExportPhase('idle')}
      />
        {/* Header */}
        <header
          style={{
            padding: '16px',
            background: '#0a0a0a',
            borderBottom: '1px solid #333',
            color: '#fff',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Full Editor Demo</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#999' }}>
            Complete @elah/editor composition with assets, preview, and timeline
          </p>
        </header>

        {/* Toolbar */}
        <Toolbar onExport={handleExport} />

        {/* Main content */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left: Asset panel */}
          <AssetPanel
            style={{
              width: 240,
              flexShrink: 0,
              borderRight: '1px solid #333',
              background: '#0a0a0a',
              minHeight: 0,
              overflowY: 'auto',
            }}
          />

          {/* Center: Preview */}
          <Preview
            ref={previewRef}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              background: '#000',
            }}
          />
        </div>

        {/* Bottom: Timeline */}
        <Timeline
          ref={timelineRef}
          fps={FPS}
          style={{
            height: 240,
            flexShrink: 0,
            minWidth: 0,
            background: '#0a0a0a',
            borderTop: '1px solid #333',
          }}
        />
      </div>
    </EditorProvider>
  )
}
