import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../utils'
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
  { label: 'Low',   description: '2 Mbps · VP9 · smaller file',  videoBitrate: 2_000_000,  videoCodec: 'vp9', audioCodec: 'opus' },
  { label: 'Medium', description: '8 Mbps · H.264 · recommended', videoBitrate: 8_000_000,  videoCodec: 'avc', audioCodec: 'aac'  },
  { label: 'High',  description: '16 Mbps · H.264 · high quality', videoBitrate: 16_000_000, videoCodec: 'avc', audioCodec: 'aac'  },
  { label: 'Ultra', description: '32 Mbps · H.264 · near lossless', videoBitrate: 32_000_000, videoCodec: 'avc', audioCodec: 'aac'  },
]

const DEFAULT_PRESET = 1 // Medium

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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
      <div className="flex items-center justify-between px-4 py-3 border-b border-ed-border">
        <span className="text-[13px] font-bold text-ed-text tracking-[-0.01em]">
          Export Video
        </span>
        <button
          className="bg-transparent border-none text-ed-text-muted cursor-pointer text-lg leading-none p-0.5"
          onClick={onCancel}
          title="Close"
        >
          ✕
        </button>
      </div>

      <div className="px-4 pt-4 pb-2">
        <div className="text-[10px] font-semibold tracking-[0.08em] uppercase text-ed-text-muted mb-2">
          Quality
        </div>
        <div className="flex flex-col gap-1">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => onSelect(i)}
              className={cn(
                'flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer text-left font-sans border transition-colors',
                selectedPreset === i
                  ? 'bg-ed-accent-soft border-ed-accent'
                  : 'bg-ed-elevated border-ed-border'
              )}
            >
              <span
                className={cn(
                  'w-3.5 h-3.5 rounded-full border-2 shrink-0',
                  selectedPreset === i
                    ? 'border-ed-accent bg-ed-accent'
                    : 'border-ed-text-muted bg-transparent'
                )}
              />
              <span className="text-xs font-semibold text-ed-text min-w-[52px]">{p.label}</span>
              {i === DEFAULT_PRESET && (
                <span className="text-[9px] font-semibold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded bg-ed-accent/20 text-ed-accent shrink-0">
                  Default
                </span>
              )}
              <span className="text-[11px] text-ed-text-muted">{p.description}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 text-[11px] text-ed-text-muted">
          Format: MP4 container · audio stereo 44.1 kHz
        </div>
      </div>

      <div className="flex justify-end gap-2 px-4 pt-3 pb-3.5">
        <button
          className="px-4 py-[7px] bg-ed-elevated text-ed-text-muted border border-ed-border rounded-md text-xs cursor-pointer font-sans"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="px-4 py-[7px] bg-ed-accent text-white border-none rounded-md text-xs font-semibold cursor-pointer font-sans"
          onClick={onStart}
        >
          Export
        </button>
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-ed-border">
        <span className="text-[13px] font-bold text-ed-text tracking-[-0.01em]">
          Exporting...
        </span>
      </div>

      <div className="px-4 pt-4 pb-4">
        <div className="text-xs text-ed-text-muted mb-3">
          {totalFrames > 0
            ? `Rendering frame ${frame} of ${totalFrames}`
            : 'Preparing…'}
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-ed-elevated rounded-[3px] overflow-hidden mb-1.5">
          <div
            className="h-full rounded-[3px] transition-[width] duration-300 ease-out"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, var(--elah-accent), var(--elah-accent-hover))`,
            }}
          />
        </div>
        <div className="text-[11px] text-ed-text-muted font-mono">{pct}%</div>
      </div>

      <div className="flex justify-end gap-2 px-4 pt-3 pb-3.5">
        <button
          className="px-4 py-[7px] bg-ed-elevated text-ed-text-muted border border-ed-border rounded-md text-xs cursor-pointer font-sans"
          onClick={onCancel}
        >
          Cancel
        </button>
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-ed-border">
        <span className="text-[13px] font-bold text-ed-text tracking-[-0.01em]">
          Export failed
        </span>
        <button
          className="bg-transparent border-none text-ed-text-muted cursor-pointer text-lg leading-none p-0.5"
          onClick={onClose}
          title="Close"
        >
          ✕
        </button>
      </div>

      <div className="px-4 pt-4 pb-2">
        <div className="px-3 py-2.5 bg-ed-accent-soft border border-ed-accent/30 rounded-md text-xs text-ed-accent-hover font-mono break-words mb-2">
          {message}
        </div>
      </div>

      <div className="flex justify-end gap-2 px-4 pt-3 pb-3.5">
        <button
          className="px-4 py-[7px] bg-ed-elevated text-ed-text-muted border border-ed-border rounded-md text-xs cursor-pointer font-sans"
          onClick={onClose}
        >
          Close
        </button>
        <button
          className="px-4 py-[7px] bg-ed-accent text-white border-none rounded-md text-xs font-semibold cursor-pointer font-sans"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// ExportModal — main component
// ---------------------------------------------------------------------------

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
      // success — modal closes (parent handles the download)
      onClose()
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        // user-cancelled — go back to settings
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

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleClose])

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[9999]"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="bg-ed-panel border border-ed-border rounded-[10px] w-[380px] max-w-[calc(100vw-32px)] font-sans overflow-hidden">
        {phase === 'settings' && (
          <SettingsPhase
            selectedPreset={selectedPreset}
            onSelect={setSelectedPreset}
            onCancel={handleClose}
            onStart={startExport}
          />
        )}
        {phase === 'rendering' && (
          <RenderingPhase
            frame={frame}
            totalFrames={totalFrames}
            onCancel={handleCancel}
          />
        )}
        {phase === 'error' && (
          <ErrorPhase
            message={errorMessage}
            onClose={handleClose}
            onRetry={() => setPhase('settings')}
          />
        )}
      </div>
    </div>
  )
}
