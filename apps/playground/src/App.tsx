import { useEffect, useRef } from 'react'
import './editor-ui.css'
import MediaLimitsLab from './MediaLimitsLab'
import { GpuPreview } from './GpuPreview'
import { TextClipProperties } from './TextClipProperties'
import { btnDisabled, theme } from './theme'
import {
  AssetPanel,
  ElementsPanel,
  EditorProvider,
  Timeline,
  useTracksStore,
  usePlaybackStore,
  useSelectionStore,
  useMediaLibraryStore,
  splitClipAtPlayhead,
  framesToTimecode,
  type InitialTrackConfig,
  type TimelineRef,
} from '@elah/editor'

const FPS = 30
const SHOW_LAB = new URLSearchParams(window.location.search).has('lab')

const INITIAL_TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'text', name: 'Text' },
]

const ZOOM_MIN = 0.02
const ZOOM_MAX = 50
const zoomToSlider = (z: number) =>
  (Math.log(z) - Math.log(ZOOM_MIN)) / (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN))
const sliderToZoom = (s: number) =>
  Math.exp(Math.log(ZOOM_MIN) + s * (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN)))

const divider: React.CSSProperties = {
  width: 1,
  height: 22,
  background: theme.borderSubtle,
  flexShrink: 0,
}

const toolGroup: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

export default function App() {
  const timelineRef = useRef<TimelineRef>(null)
  const timecodeRef = useRef<HTMLSpanElement>(null)
  const canUndo = useTracksStore((s) => s.canUndo)
  const canRedo = useTracksStore((s) => s.canRedo)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const zoom = usePlaybackStore((s) => s.zoom)
  const setZoom = usePlaybackStore((s) => s.setZoom)
  const totalFrames = useTracksStore((s) => s.totalFrames)
  const stage = useTracksStore((s) => s.stage)
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds)
  const hasSelection = selectedClipIds.size === 1
  const aspectActive = (w: number, h: number) =>
    Math.abs(stage.width / stage.height - w / h) < 0.001

  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      if (timecodeRef.current) {
        const dur = Math.max(totalFrames, 1)
        timecodeRef.current.textContent = `${framesToTimecode(state.currentFrame, FPS)} / ${framesToTimecode(dur, FPS)}`
      }
    })
  }, [totalFrames])

  useEffect(() => {
    const frame = usePlaybackStore.getState().currentFrame
    if (timecodeRef.current) {
      const dur = Math.max(totalFrames, 1)
      timecodeRef.current.textContent = `${framesToTimecode(frame, FPS)} / ${framesToTimecode(dur, FPS)}`
    }
  }, [totalFrames])

  const engine = () => timelineRef.current?.engine

  const addVideoClip = () => {
    const e = engine()
    if (!e) return

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

  const aspectBtn = (active: boolean): React.CSSProperties => ({
    ...btnDisabled(false),
    minWidth: 44,
    padding: '5px 10px',
    ...(active
      ? {
          background: 'rgba(225, 29, 72, 0.12)',
          borderColor: theme.accent,
          color: theme.accentHover,
          boxShadow: `0 0 10px ${theme.accentGlow}`,
        }
      : {}),
  })

  const playBtn: React.CSSProperties = {
    ...btnDisabled(false),
    minWidth: 36,
    padding: '5px 12px',
    ...(isPlaying
      ? {
          background: 'rgba(34, 197, 94, 0.12)',
          borderColor: theme.success,
          color: theme.success,
        }
      : {}),
  }

  return (
    <>
      {SHOW_LAB && <MediaLimitsLab />}
      <EditorProvider fps={FPS} initialTracks={INITIAL_TRACKS}>
        <div className="elah-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
          {/* Toolbar */}
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 16px',
              background: theme.bgSecondary,
              borderBottom: `1px solid ${theme.border}`,
              flexWrap: 'wrap',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: theme.textPrimary,
                letterSpacing: '-0.02em',
                marginRight: 4,
              }}
            >
              @elah/editor
            </span>

            <div style={divider} />

            <div style={toolGroup}>
              <button type="button" className="elah-toolbar-btn" style={btnDisabled(false)} onClick={addVideoClip} title="Add video clip">
                ▶ Video
              </button>
              <button type="button" className="elah-toolbar-btn" style={btnDisabled(false)} onClick={addAudioClip} title="Add audio clip">
                ♪ Audio
              </button>
              <button type="button" className="elah-toolbar-btn" style={btnDisabled(false)} onClick={addTextClip} title="Add text clip">
                T Text
              </button>
              <button
                type="button"
                className="elah-toolbar-btn"
                style={btnDisabled(!hasSelection)}
                disabled={!hasSelection}
                onClick={splitAtPlayhead}
                title="Split at playhead"
              >
                ✂ Split
              </button>
            </div>

            <div style={divider} />

            <div style={toolGroup}>
              <button
                type="button"
                className={aspectActive(1920, 1080) ? 'elah-toolbar-btn elah-toolbar-btn--active' : 'elah-toolbar-btn'}
                style={aspectBtn(aspectActive(1920, 1080))}
                onClick={() => engine()?.setStage(1920, 1080)}
              >
                16:9
              </button>
              <button
                type="button"
                className={aspectActive(1080, 1920) ? 'elah-toolbar-btn elah-toolbar-btn--active' : 'elah-toolbar-btn'}
                style={aspectBtn(aspectActive(1080, 1920))}
                onClick={() => engine()?.setStage(1080, 1920)}
              >
                9:16
              </button>
              <button
                type="button"
                className={aspectActive(1080, 1080) ? 'elah-toolbar-btn elah-toolbar-btn--active' : 'elah-toolbar-btn'}
                style={aspectBtn(aspectActive(1080, 1080))}
                onClick={() => engine()?.setStage(1080, 1080)}
              >
                1:1
              </button>
            </div>

            <div style={divider} />

            <div style={toolGroup}>
              <button type="button" className="elah-toolbar-btn" style={playBtn} onClick={togglePlayPause}>
                {isPlaying ? '⏸' : '▶'}
              </button>
              <span
                ref={timecodeRef}
                style={{
                  fontSize: 11,
                  color: theme.textSecondary,
                  fontFamily: theme.fontMono,
                  minWidth: 180,
                }}
              >
                00:00:00:00 / 00:00:00:00
              </span>
            </div>

            <div style={divider} />

            <div style={{ ...toolGroup, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: theme.textMuted }}>Zoom</span>
              <input
                type="range"
                className="elah-range"
                min={0}
                max={1}
                step={0.001}
                value={zoomToSlider(zoom)}
                onChange={(e) => setZoom(sliderToZoom(Number(e.target.value)))}
                style={{ width: 88, margin: '0 6px' }}
              />
              <span style={{ fontSize: 11, color: theme.textMuted, fontFamily: theme.fontMono, minWidth: 52 }}>
                {zoom < 1 ? zoom.toFixed(2) : zoom.toFixed(1)} px/f
              </span>
              <button
                type="button"
                className="elah-toolbar-btn"
                style={btnDisabled(false)}
                onClick={() => timelineRef.current?.fitToWindow()}
                title="Zoom to fit the whole timeline"
              >
                Fit
              </button>
            </div>

            <div style={divider} />

            <div style={toolGroup}>
              <button
                type="button"
                className="elah-toolbar-btn"
                style={btnDisabled(!canUndo)}
                disabled={!canUndo}
                onClick={() => engine()?.undo()}
                title="Undo (Ctrl+Z)"
              >
                ↶
              </button>
              <button
                type="button"
                className="elah-toolbar-btn"
                style={btnDisabled(!canRedo)}
                disabled={!canRedo}
                onClick={() => engine()?.redo()}
                title="Redo (Ctrl+Y)"
              >
                ↷
              </button>
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 10, color: theme.textMuted }}>
                Ctrl+scroll zoom · Ctrl+Z/Y undo
              </span>
              <button type="button" className="elah-export-btn" style={btnDisabled(false)}>
                Export
              </button>
            </div>
          </header>

          {/* Main work area */}
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: 240,
                flexShrink: 0,
                minHeight: 0,
                background: theme.bgPanel,
                borderRight: `1px solid ${theme.border}`,
              }}
            >
              <ElementsPanel />
              <AssetPanel style={{ flex: 1, minHeight: 0 }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
              <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
                <GpuPreview debugMode showSceneResolver style={{ flex: 1, minHeight: 200 }} />
                <TextClipProperties />
              </div>

              <Timeline
                ref={timelineRef}
                fps={FPS}
                style={{ height: 280, flexShrink: 0, minWidth: 0, borderTop: `1px solid ${theme.border}` }}
              />
            </div>
          </div>
        </div>
      </EditorProvider>
    </>
  )
}
