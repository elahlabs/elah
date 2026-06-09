'use client'

import { memo, useRef } from 'react'
import {
  EditorProvider,
  AssetPanel,
  Preview,
  Timeline,
  usePlaybackStore,
  useTracksStore,
  useTimelineEngine,
  framesToTimecode,
  type InitialTrackConfig,
  type TimelineRef,
  type PreviewHandle,
} from '@elah/editor'

const FPS = 30

const INITIAL_TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'text', name: 'Text' },
]

const Toolbar = memo(function Toolbar() {
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
    padding: '6px 12px',
    background: '#1e2433',
    color: '#A7AFBF',
    border: '1px solid #232938',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  }

  const primaryButtonStyle = {
    ...buttonStyle,
    background: isPlaying ? 'rgba(34, 197, 94, 0.12)' : '#E11D48',
    border: isPlaying ? '1px solid #22C55E' : '1px solid #E11D48',
    color: isPlaying ? '#22C55E' : '#fff',
  } as React.CSSProperties

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        background: '#0D1017',
        borderBottom: '1px solid #232938',
        flexShrink: 0,
        overflowX: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12, borderRight: '1px solid #232938' }}>
        <button onClick={togglePlayPause} style={primaryButtonStyle}>
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>

        <span style={{ fontSize: 11, color: '#6B7280', fontFamily: 'monospace', minWidth: 90 }}>
          {framesToTimecode(currentFrame, FPS)} / {framesToTimecode(Math.max(totalFrames, 1), FPS)}
        </span>

        <button onClick={() => engine.undo()} style={buttonStyle}>
          ↶ Undo
        </button>

        <button onClick={handleReset} style={buttonStyle}>
          ⏮ Reset
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12, borderRight: '1px solid #232938' }}>
        <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, fontFamily: 'system-ui, sans-serif', letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>Add:</span>
        <button
          onClick={() => tracks[0] && handleAddClip(tracks[0].id, 'video', FPS * 3)}
          style={{ ...buttonStyle, background: 'rgba(37, 99, 235, 0.15)', border: '1px solid #2563EB', color: '#60A5FA' }}
        >
          + Video
        </button>
        <button
          onClick={() => tracks[1] && handleAddClip(tracks[1].id, 'audio', FPS * 5)}
          style={{ ...buttonStyle, background: 'rgba(22, 163, 74, 0.15)', border: '1px solid #16A34A', color: '#4ADE80' }}
        >
          + Audio
        </button>
        <button
          onClick={() => tracks[2] && handleAddClip(tracks[2].id, 'text', FPS * 2)}
          style={{ ...buttonStyle, background: 'rgba(147, 51, 234, 0.15)', border: '1px solid #9333EA', color: '#C084FC' }}
        >
          + Text
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={handleClearAll} style={{ ...buttonStyle, background: 'rgba(225, 29, 72, 0.1)', border: '1px solid #E11D48', color: '#FB7185' }}>
          ✕ Clear All
        </button>
      </div>
    </div>
  )
})

export default function RawEditor() {
  const timelineRef = useRef<TimelineRef>(null)
  const previewRef = useRef<PreviewHandle>(null)

  return (
    <EditorProvider fps={FPS} initialTracks={INITIAL_TRACKS}>
      <div
        className="elah-root"
        style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      >
        <header
          style={{
            padding: '12px 16px',
            background: '#0D1017',
            borderBottom: '1px solid #232938',
            flexShrink: 0,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#F3F4F6' }}>Raw Editor</h1>
          <p style={{ margin: '3px 0 0 0', fontSize: 12, color: '#6B7280' }}>
            Full @elah/editor composition — asset panel, GPU preview, timeline
          </p>
        </header>

        <Toolbar />

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <AssetPanel
            style={{
              width: 240,
              flexShrink: 0,
              borderRight: '1px solid #232938',
              background: '#06070A',
              minHeight: 0,
              overflowY: 'auto',
            }}
          />

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

        <Timeline
          ref={timelineRef}
          fps={FPS}
          style={{
            height: 240,
            flexShrink: 0,
            minWidth: 0,
            background: '#0A0D14',
            borderTop: '1px solid #232938',
          }}
        />
      </div>
    </EditorProvider>
  )
}
