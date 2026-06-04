import { useEffect, useRef } from 'react'
import MediaLimitsLab from './MediaLimitsLab'
import { GpuPreview } from './GpuPreview'
import { TextClipProperties } from './TextClipProperties'
import {
  AssetPanel,
  ElementsPanel,
  EditorProvider,
  Timeline,
  useTracksStore,
  usePlaybackStore,
  useSelectionStore,
  useResolvedScene,
  useMediaLibraryStore,
  splitClipAtPlayhead,
  type InitialTrackConfig,
  type TimelineRef,
} from '@elah/editor'

const FPS = 30
const SHOW_LAB = new URLSearchParams(window.location.search).has('lab')
const SHOW_SCENE_DEBUG = true

// Fixed-lane editor: exactly three tracks, no add/remove.
const INITIAL_TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'text', name: 'Text' },
]

// Zoom slider runs on a log scale so the full range (fit a 30-min clip ↔
// frame-level detail) is reachable with a short travel.
const ZOOM_MIN = 0.02
const ZOOM_MAX = 50
const zoomToSlider = (z: number) =>
  (Math.log(z) - Math.log(ZOOM_MIN)) / (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN))
const sliderToZoom = (s: number) =>
  Math.exp(Math.log(ZOOM_MIN) + s * (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN)))

function ResolvedSceneDebug() {
  const scene = useResolvedScene()

  return (
    <pre
      style={{
        fontSize: 10,
        maxHeight: 120,
        overflow: 'auto',
        margin: 0,
        padding: '8px 12px',
        background: '#0d0d0d',
        borderTop: '1px solid #2a2a2a',
        color: '#8f8',
        fontFamily: 'monospace',
      }}
    >
      {JSON.stringify(scene, null, 2)}
    </pre>
  )
}

export default function App() {
  const timelineRef = useRef<TimelineRef>(null)
  const frameDisplayRef = useRef<HTMLSpanElement>(null)
  const canUndo = useTracksStore((s) => s.canUndo)
  const canRedo = useTracksStore((s) => s.canRedo)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const zoom = usePlaybackStore((s) => s.zoom)
  const setZoom = usePlaybackStore((s) => s.setZoom)
  const stage = useTracksStore((s) => s.stage)
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds)
  const hasSelection = selectedClipIds.size === 1
  const aspectActive = (w: number, h: number) =>
    Math.abs(stage.width / stage.height - w / h) < 0.001

  // Write frame counter directly to the DOM — no React render on every tick.
  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      if (frameDisplayRef.current) {
        frameDisplayRef.current.textContent =
          `Frame ${state.currentFrame} | ${(state.currentFrame / FPS).toFixed(2)}s`
      }
    })
  }, [])

  const engine = () => timelineRef.current?.engine

  const addVideoClip = () => {
    const e = engine()
    if (!e) return

    // Use the most recently imported video asset so the clip has a real src.
    // Without a src, the resolver drops the clip and the canvas stays black.
    const mediaState = useMediaLibraryStore.getState()
    const videoAsset = mediaState.order
      .map((id) => mediaState.assets[id])
      .reverse()
      .find((a) => a?.kind === 'video')
    if (!videoAsset) {
      alert('Import a video file from the Media panel first')
      return
    }

    let videoTracks = e.getProject().tracks.filter((t) => t.kind === 'video')
    // Auto-create a video track if none exist — don't make the user click a
    // separate button just to place a clip.
    if (videoTracks.length === 0) {
      e.addTrack('video')
      videoTracks = e.getProject().tracks.filter((t) => t.kind === 'video')
    }
    console.log(
      '[addVideoClip] videoTracks:', videoTracks.length,
      '| asset:', videoAsset.name,
      '| duration:', videoAsset.durationSec.toFixed(2) + 's',
    )
    const track = videoTracks[0]
    const existing = e.getClipsOnTrack(track.id)
    const startFrame =
      existing.length > 0
        ? existing[existing.length - 1].startFrame +
        existing[existing.length - 1].durationFrames
        : 0
    const durationFrames =
      videoAsset.durationSec > 0
        ? Math.round(videoAsset.durationSec * FPS)
        : FPS * 3
    e.addClip({
      trackId: track.id,
      type: 'video',
      name: videoAsset.name,
      startFrame,
      durationFrames,
      src: videoAsset.src,
      assetId: videoAsset.id,
    })
  }

  const addAudioClip = () => {
    const e = engine()
    if (!e) return

    // Use the most recently imported audio asset so the clip has a real src —
    // without one the resolver drops it and AudioPlaybackController has nothing
    // to play. (Video files carry audio too; fall back to those.)
    const mediaState = useMediaLibraryStore.getState()
    const audioAsset = mediaState.order
      .map((id) => mediaState.assets[id])
      .reverse()
      .find((a) => a?.kind === 'audio' || a?.kind === 'video')
    if (!audioAsset) {
      alert('Import an audio (or video) file from the Media panel first')
      return
    }

    let tracks = e.getProject().tracks.filter((t) => t.kind === 'audio')
    if (tracks.length === 0) {
      e.addTrack('audio')
      tracks = e.getProject().tracks.filter((t) => t.kind === 'audio')
    }
    const track = tracks[0]
    const existing = e.getClipsOnTrack(track.id)
    const startFrame =
      existing.length > 0
        ? existing[existing.length - 1].startFrame +
        existing[existing.length - 1].durationFrames
        : 0
    const durationFrames =
      audioAsset.durationSec > 0
        ? Math.round(audioAsset.durationSec * FPS)
        : FPS * 4
    e.addClip({
      trackId: track.id,
      type: 'audio',
      name: audioAsset.name,
      startFrame,
      durationFrames,
      src: audioAsset.src,
      assetId: audioAsset.id,
    })
  }

  const addTextClip = () => {
    const e = engine()
    if (!e) return

    let textTracks = e.getProject().tracks.filter((t) => t.kind === 'text')
    if (textTracks.length === 0) {
      e.addTrack('text')
      textTracks = e.getProject().tracks.filter((t) => t.kind === 'text')
    }

    const track = textTracks[0]
    const existing = e.getClipsOnTrack(track.id)
    const startFrame =
      existing.length > 0
        ? existing[existing.length - 1].startFrame +
          existing[existing.length - 1].durationFrames
        : 0
    const n = existing.length + 1
    e.addClip({
      trackId: track.id,
      type: 'text',
      name: `Text ${n}`,
      startFrame,
      durationFrames: FPS * 3,
      text: {
        content: `Text ${n}`,
        fontSize: 200,
        color: '#ffffff',
        fontFamily: 'sans-serif',
        fontWeight: 'normal',
        textAlign: 'center',
      },
    })
  }

  const splitAtPlayhead = () => {
    const e = engine()
    if (!e) return
    const result = splitClipAtPlayhead(e)
    if (!result.ok) {
      console.warn('[playground] split failed:', result.reason)
    }
  }

  const btnStyle = (disabled = false): React.CSSProperties => ({
    padding: '6px 14px',
    background: disabled ? '#333' : '#2a2a2a',
    color: disabled ? '#555' : '#ddd',
    border: '1px solid #3a3a3a',
    borderRadius: 6,
    fontSize: 12,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'monospace',
  })

  const aspectBtnStyle = (active: boolean): React.CSSProperties => ({
    ...btnStyle(),
    minWidth: 48,
    background: active ? '#1a2a3a' : '#2a2a2a',
    borderColor: active ? '#3a6a9a' : '#3a3a3a',
    color: active ? '#7fb3ff' : '#ddd',
  })

  return (
    <>
      {SHOW_LAB && <MediaLimitsLab />}
      <EditorProvider fps={FPS} initialTracks={INITIAL_TRACKS}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
          {/* Toolbar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              background: '#151515',
              borderBottom: '1px solid #2a2a2a',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: '#888', fontFamily: 'monospace', marginRight: 8 }}>
              @elah/editor
            </span>

            <button style={btnStyle()} onClick={addVideoClip}>+ Video Clip</button>
            <button style={btnStyle()} onClick={addAudioClip}>+ Audio Clip</button>
            <button style={btnStyle()} onClick={addTextClip}>+ Text Clip</button>
            <button
              style={btnStyle(!hasSelection)}
              disabled={!hasSelection}
              onClick={splitAtPlayhead}
            >
              ✂ Split
            </button>

            <div style={{ width: 1, height: 20, background: '#333', margin: '0 4px' }} />

            <span style={{ fontSize: 12, color: '#888', fontFamily: 'monospace' }}>Aspect</span>
            <button
              style={aspectBtnStyle(aspectActive(1920, 1080))}
              onClick={() => engine()?.setStage(1920, 1080)}
            >
              16:9
            </button>
            <button
              style={aspectBtnStyle(aspectActive(1080, 1920))}
              onClick={() => engine()?.setStage(1080, 1920)}
            >
              9:16
            </button>

            <div style={{ width: 1, height: 20, background: '#333', margin: '0 4px' }} />

            <button
              style={{
                ...btnStyle(),
                minWidth: 68,
                background: isPlaying ? '#1a3a1a' : '#2a2a2a',
                borderColor: isPlaying ? '#2d6a2d' : '#3a3a3a',
                color: isPlaying ? '#6fcf6f' : '#ddd',
              }}
              onClick={togglePlayPause}
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>

            <div style={{ width: 1, height: 20, background: '#333', margin: '0 4px' }} />

            <button
              style={btnStyle(!canUndo)}
              disabled={!canUndo}
              onClick={() => engine()?.undo()}
            >
              Undo
            </button>
            <button
              style={btnStyle(!canRedo)}
              disabled={!canRedo}
              onClick={() => engine()?.redo()}
            >
              Redo
            </button>

            <div style={{ width: 1, height: 20, background: '#333', margin: '0 4px' }} />

            <label style={{ fontSize: 12, color: '#888', fontFamily: 'monospace' }}>
              Zoom
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={zoomToSlider(zoom)}
                onChange={(e) => setZoom(sliderToZoom(Number(e.target.value)))}
                style={{ marginLeft: 8, width: 80 }}
              />
              {zoom < 1 ? zoom.toFixed(2) : zoom.toFixed(1)}px/f
            </label>
            <button
              style={btnStyle()}
              onClick={() => timelineRef.current?.fitToWindow()}
              title="Zoom to fit the whole timeline"
            >
              Fit
            </button>

            <div style={{ marginLeft: 'auto', fontSize: 12, color: '#666', fontFamily: 'monospace' }}>
              <span ref={frameDisplayRef}>Frame 0 | 0.00s</span>
              &nbsp;|&nbsp; Ctrl+scroll to zoom · Ctrl+Z/Y to undo/redo
            </div>
          </div>

          {/* Main work area: preview on top, asset panel + timeline below */}
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {/* Left column: draggable elements palette + media library */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: 220,
                flexShrink: 0,
                minHeight: 0,
              }}
            >
              <ElementsPanel />
              <AssetPanel style={{ flex: 1, minHeight: 0 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
              {/* GPU Preview — above the timeline, fills available vertical space */}
              <GpuPreview debugMode style={{ flex: 1, minHeight: 240 }} />

              {SHOW_SCENE_DEBUG && <ResolvedSceneDebug />}

              {/* Text clip properties — appears when a text clip is selected */}
              <TextClipProperties />

              {/* Timeline — fixed height at the bottom */}
              <Timeline
                ref={timelineRef}
                fps={FPS}
                style={{ height: 300, flexShrink: 0, minWidth: 0 }}
              />
            </div>
          </div>
        </div>
      </EditorProvider>
    </>
  )
}
