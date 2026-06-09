import { useCallback, useEffect, useRef, useState } from 'react'
import { theme } from './theme'
import type { ExportVideoCodec, ExportAudioCodec } from '@elah/editor'

// ---------------------------------------------------------------------------
// Quality presets
// ---------------------------------------------------------------------------

interface QualityPreset {
  label: string
  description: string
  videoBitrate: number
  videoCodec: ExportVideoCodec
  audioCodec: ExportAudioCodec
}

const PRESETS: QualityPreset[] = [
  { label: 'Low',    description: '2 Mbps · VP9 · smaller file',     videoBitrate: 2_000_000,  videoCodec: 'vp9', audioCodec: 'opus' },
  { label: 'Medium', description: '8 Mbps · H.264 · recommended',    videoBitrate: 8_000_000,  videoCodec: 'avc', audioCodec: 'aac'  },
  { label: 'High',   description: '16 Mbps · H.264 · high quality',  videoBitrate: 16_000_000, videoCodec: 'avc', audioCodec: 'aac'  },
  { label: 'Ultra',  description: '32 Mbps · H.264 · near lossless', videoBitrate: 32_000_000, videoCodec: 'avc', audioCodec: 'aac'  },
]

const DEFAULT_PRESET = 1 // Medium

type Phase = 'settings' | 'rendering' | 'error'

export interface ExportModalProps {
  onClose: () => void
  onExport: (opts: {
    videoBitrate: number
    videoCodec: ExportVideoCodec
    audioCodec: ExportAudioCodec
    signal: AbortSignal
    onProgress: (frame: number, totalFrames: number) => void
  }) => Promise<void>
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.7)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
}

const modal: React.CSSProperties = {
  background: theme.bgPanel,
  border: `1px solid ${theme.border}`,
  borderRadius: 10,
  width: 380,
  maxWidth: 'calc(100vw - 32px)',
  fontFamily: theme.fontSans,
  overflow: 'hidden',
}

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 16px 12px',
  borderBottom: `1px solid ${theme.border}`,
}

const closeBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: theme.textMuted,
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1,
  padding: 2,
}

const body: React.CSSProperties = {
  padding: '16px 16px 8px',
}

const footer: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '12px 16px 14px',
}

const btnSecondary: React.CSSProperties = {
  padding: '7px 16px',
  background: theme.bgElevated,
  color: theme.textSecondary,
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: theme.fontSans,
}

const btnPrimary: React.CSSProperties = {
  padding: '7px 18px',
  background: theme.accent,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: theme.fontSans,
}

function SettingsPhase({
  selectedPreset,
  onSelect,
  onCancel,
  onStart,
}: {
  selectedPreset: number
  onSelect: (i: number) => void
  onCancel: () => void
  onStart: () => void
}) {
  return (
    <>
      <div style={header}>
        <span style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, letterSpacing: '-0.01em' }}>
          Export Video
        </span>
        <button style={closeBtn} onClick={onCancel} title="Close">✕</button>
      </div>

      <div style={body}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: theme.textMuted, marginBottom: 8 }}>
          Quality
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => onSelect(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                background: selectedPreset === i ? 'rgba(225, 29, 72, 0.08)' : theme.bgElevated,
                border: `1px solid ${selectedPreset === i ? theme.accent : theme.border}`,
                borderRadius: 6,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: theme.fontSans,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  border: `2px solid ${selectedPreset === i ? theme.accent : theme.textMuted}`,
                  background: selectedPreset === i ? theme.accent : 'transparent',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary, minWidth: 52 }}>{p.label}</span>
              <span style={{ fontSize: 11, color: theme.textMuted }}>{p.description}</span>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 12, fontSize: 11, color: theme.textMuted }}>
          Format: MP4 container · audio stereo 44.1 kHz
        </div>
      </div>

      <div style={footer}>
        <button style={btnSecondary} onClick={onCancel}>Cancel</button>
        <button style={btnPrimary} onClick={onStart}>Export</button>
      </div>
    </>
  )
}

function RenderingPhase({
  frame,
  totalFrames,
  onCancel,
}: {
  frame: number
  totalFrames: number
  onCancel: () => void
}) {
  const pct = totalFrames > 0 ? Math.round((frame / totalFrames) * 100) : 0

  return (
    <>
      <div style={header}>
        <span style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, letterSpacing: '-0.01em' }}>
          Exporting...
        </span>
      </div>

      <div style={{ ...body, paddingBottom: 16 }}>
        <div style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 12 }}>
          {totalFrames > 0 ? `Rendering frame ${frame} of ${totalFrames}` : 'Preparing…'}
        </div>

        <div style={{ height: 6, background: theme.bgElevated, borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${theme.accent}, ${theme.accentHover})`,
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: theme.textMuted, fontFamily: theme.fontMono }}>{pct}%</div>
      </div>

      <div style={footer}>
        <button style={btnSecondary} onClick={onCancel}>Cancel</button>
      </div>
    </>
  )
}

function ErrorPhase({
  message,
  onClose,
  onRetry,
}: {
  message: string
  onClose: () => void
  onRetry: () => void
}) {
  return (
    <>
      <div style={header}>
        <span style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, letterSpacing: '-0.01em' }}>
          Export failed
        </span>
        <button style={closeBtn} onClick={onClose} title="Close">✕</button>
      </div>

      <div style={body}>
        <div
          style={{
            padding: '10px 12px',
            background: 'rgba(225, 29, 72, 0.08)',
            border: `1px solid rgba(225, 29, 72, 0.3)`,
            borderRadius: 6,
            fontSize: 12,
            color: theme.accentHover,
            fontFamily: theme.fontMono,
            wordBreak: 'break-word',
            marginBottom: 8,
          }}
        >
          {message}
        </div>
      </div>

      <div style={footer}>
        <button style={btnSecondary} onClick={onClose}>Close</button>
        <button style={btnPrimary} onClick={onRetry}>Retry</button>
      </div>
    </>
  )
}

export function ExportModal({ onClose, onExport }: ExportModalProps) {
  const [phase, setPhase] = useState<Phase>('settings')
  const [selectedPreset, setSelectedPreset] = useState(DEFAULT_PRESET)
  const [frame, setFrame] = useState(0)
  const [totalFrames, setTotalFrames] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const startExport = useCallback(async () => {
    const preset = PRESETS[selectedPreset]
    const controller = new AbortController()
    abortRef.current = controller

    setPhase('rendering')
    setFrame(0)
    setTotalFrames(0)

    try {
      await onExport({
        videoBitrate: preset.videoBitrate,
        videoCodec: preset.videoCodec,
        audioCodec: preset.audioCodec,
        signal: controller.signal,
        onProgress: (f, total) => {
          setFrame(f)
          setTotalFrames(total)
        },
      })
      onClose()
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        setPhase('settings')
      } else {
        setErrorMessage(String(err))
        setPhase('error')
      }
    } finally {
      abortRef.current = null
    }
  }, [selectedPreset, onExport, onClose])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleClose = useCallback(() => {
    abortRef.current?.abort()
    onClose()
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleClose])

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div style={modal}>
        {phase === 'settings' && (
          <SettingsPhase
            selectedPreset={selectedPreset}
            onSelect={setSelectedPreset}
            onCancel={handleClose}
            onStart={startExport}
          />
        )}
        {phase === 'rendering' && (
          <RenderingPhase frame={frame} totalFrames={totalFrames} onCancel={handleCancel} />
        )}
        {phase === 'error' && (
          <ErrorPhase message={errorMessage} onClose={handleClose} onRetry={() => setPhase('settings')} />
        )}
      </div>
    </div>
  )
}
