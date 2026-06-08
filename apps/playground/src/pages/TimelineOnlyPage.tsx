/**
 * TimelineOnlyPage
 *
 * Demonstrates standalone timeline usage with EditorProvider.
 * Validates that @elah/timeline is independently usable.
 *
 * Usage:
 * - Shows timeline with playback and clip management controls
 * - EditorProvider handles engine creation and playback sync
 * - Timeline connects to the shared engine and playback state
 */

import { memo } from 'react'
import {
  EditorProvider,
  Timeline,
  usePlaybackStore,
  useTracksStore,
  useTimelineEngine,
  framesToTimecode,
  type InitialTrackConfig,
} from '@elah/editor'

const FPS = 30

const INITIAL_TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'text', name: 'Text' },
]

// Toolbar with timeline demo controls
const TimelineToolbar = memo(function TimelineToolbar() {
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
    </div>
  )
})

export default function TimelineOnlyPage() {
  return (
    <EditorProvider fps={FPS} initialTracks={INITIAL_TRACKS}>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            padding: '16px',
            background: '#0a0a0a',
            color: '#fff',
            borderBottom: '1px solid #333',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Timeline Only Demo</h2>
          <p style={{ margin: '8px 0 0 0', fontSize: 12, color: '#999' }}>
            Standalone @elah/timeline with playback, clip management, and undo
          </p>
        </header>

        {/* Toolbar */}
        <TimelineToolbar />

        {/* Timeline */}
        <Timeline
          fps={FPS}
          style={{
            flex: 1,
            minHeight: 0,
            background: '#0a0a0a',
            borderTop: '1px solid #333',
          }}
        />
      </div>
    </EditorProvider>
  )
}
