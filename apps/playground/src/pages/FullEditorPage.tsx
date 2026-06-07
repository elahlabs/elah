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

import { memo, useRef, useState } from 'react'
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

// Toolbar with playback controls
const Toolbar = memo(function Toolbar({ previewRef }: { previewRef: React.RefObject<PreviewHandle> }) {
  const engine = useTimelineEngine()
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const totalFrames = useTracksStore((s) => s.totalFrames)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        height: 48,
        padding: '0 16px',
        background: '#1a1a1a',
        borderBottom: '1px solid #333',
        flexShrink: 0,
      }}
    >
      <button
        onClick={togglePlayPause}
        style={{
          padding: '8px 16px',
          background: isPlaying ? '#e81c48' : '#333',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        {isPlaying ? '⏸ Pause' : '▶ Play'}
      </button>

      <span style={{ fontSize: 12, color: '#999', fontFamily: 'monospace' }}>
        {framesToTimecode(currentFrame, FPS)} / {framesToTimecode(Math.max(totalFrames, 1), FPS)}
      </span>

      <button
        onClick={() => engine.undo()}
        style={{
          padding: '4px 8px',
          background: '#333',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        ↶ Undo
      </button>
    </div>
  )
})

export default function FullEditorPage() {
  const timelineRef = useRef<TimelineRef>(null)
  const previewRef = useRef<PreviewHandle>(null)

  return (
    <EditorProvider fps={FPS} initialTracks={INITIAL_TRACKS}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
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
        <Toolbar previewRef={previewRef} />

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
