'use client'

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
import { cn } from '@/lib/utils'

const FPS = 30

const INITIAL_TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'text', name: 'Text' },
]

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

  // Base button classes
  const btnCls = 'px-3 py-1.5 bg-ed-elevated text-ed-text-muted border border-ed-border rounded-md cursor-pointer text-xs font-medium whitespace-nowrap font-sans'

  // Dynamic play button — color switches on state, kept as inline style
  const playBtnStyle: React.CSSProperties = isPlaying
    ? { background: 'rgba(34, 197, 94, 0.12)', border: '1px solid #22C55E', color: '#22C55E' }
    : { background: 'var(--elah-accent)', border: '1px solid var(--elah-accent)', color: '#fff' }

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-ed-bg-2 border-b border-ed-border shrink-0 overflow-x-auto">
      <div className="flex items-center gap-2 pr-3 border-r border-ed-border">
        <button onClick={togglePlayPause} className={btnCls} style={playBtnStyle}>
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>

        <span className="text-[11px] text-ed-text-muted font-mono min-w-[90px]">
          {framesToTimecode(currentFrame, FPS)} / {framesToTimecode(Math.max(totalFrames, 1), FPS)}
        </span>

        <button onClick={() => engine.undo()} className={btnCls}>
          ↶ Undo
        </button>

        <button onClick={handleReset} className={btnCls}>
          ⏮ Reset
        </button>
      </div>

      <div className="flex items-center gap-2 pr-3 border-r border-ed-border">
        <span className="text-[11px] text-ed-text-muted font-semibold font-sans tracking-[0.06em] uppercase">Add:</span>
        <button
          onClick={() => tracks[0] && handleAddClip(tracks[0].id, 'video', FPS * 3)}
          className={cn(btnCls, 'bg-clip-video-mid/15 border-clip-video-mid text-clip-video-mid')}
          title="Add 3-second video clip"
        >
          + Video
        </button>
        <button
          onClick={() => tracks[1] && handleAddClip(tracks[1].id, 'audio', FPS * 5)}
          className={cn(btnCls, 'bg-clip-audio-mid/15 border-clip-audio-mid text-clip-audio-mid')}
          title="Add 5-second audio clip"
        >
          + Audio
        </button>
        <button
          onClick={() => tracks[2] && handleAddClip(tracks[2].id, 'text', FPS * 2)}
          className={cn(btnCls, 'bg-clip-text-mid/15 border-clip-text-mid text-clip-text-mid')}
          title="Add 2-second text clip"
        >
          + Text
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleClearAll}
          className={cn(btnCls, 'bg-ed-accent-soft border-ed-accent text-ed-accent-hover')}
        >
          ✕ Clear All
        </button>
      </div>
    </div>
  )
})

export default function TimelineEditor() {
  return (
    <EditorProvider fps={FPS} initialTracks={INITIAL_TRACKS}>
      <div
        className="elah-root h-full flex flex-col"
      >
        <header className="px-4 py-3 bg-ed-bg-2 border-b border-ed-border shrink-0">
          <h2 className="m-0 text-sm font-semibold text-ed-text">Timeline Only</h2>
          <p className="m-0 mt-0.5 text-xs text-ed-text-muted">
            Standalone @elah/timeline — drag to move, edge-drag to trim, Ctrl+Scroll to zoom
          </p>
        </header>

        <TimelineToolbar />

        <Timeline
          fps={FPS}
          style={{
            flex: 1,
            minHeight: 0,
            background: 'var(--elah-bg)',
            borderTop: '1px solid var(--elah-border)',
          }}
        />
      </div>
    </EditorProvider>
  )
}
