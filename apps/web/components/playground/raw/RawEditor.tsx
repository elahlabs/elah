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
import { cn } from '@/lib/utils'

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

  // Base button classes
  const btnCls = 'px-3 py-1.5 bg-ed-elevated text-ed-text-muted border border-ed-border rounded cursor-pointer text-xs font-medium whitespace-nowrap font-sans'

  // Dynamic play button — color switches on state, so we keep inline style for the color logic only
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
        >
          + Video
        </button>
        <button
          onClick={() => tracks[1] && handleAddClip(tracks[1].id, 'audio', FPS * 5)}
          className={cn(btnCls, 'bg-clip-audio-mid/15 border-clip-audio-mid text-clip-audio-mid')}
        >
          + Audio
        </button>
        <button
          onClick={() => tracks[2] && handleAddClip(tracks[2].id, 'text', FPS * 2)}
          className={cn(btnCls, 'bg-clip-text-mid/15 border-clip-text-mid text-clip-text-mid')}
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

export default function RawEditor() {
  const timelineRef = useRef<TimelineRef>(null)
  const previewRef = useRef<PreviewHandle>(null)

  return (
    <EditorProvider fps={FPS} initialTracks={INITIAL_TRACKS}>
      <div
        className="elah-root flex flex-col h-full"
      >
        <header className="px-4 py-3 bg-ed-bg-2 border-b border-ed-border shrink-0">
          <h1 className="m-0 text-sm font-semibold text-ed-text">Raw Editor</h1>
          <p className="m-0 mt-0.5 text-xs text-ed-text-muted">
            Full @elah/editor composition — asset panel, GPU preview, timeline
          </p>
        </header>

        <Toolbar />

        <div className="flex flex-1 min-h-0">
          <AssetPanel
            style={{
              width: 240,
              flexShrink: 0,
              borderRight: '1px solid var(--elah-border)',
              background: 'var(--elah-bg)',
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
            background: 'var(--elah-bg)',
            borderTop: '1px solid var(--elah-border)',
          }}
        />
      </div>
    </EditorProvider>
  )
}
