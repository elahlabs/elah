'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ExportVideoCodec, ExportAudioCodec } from '@elah/editor'
import posthog from 'posthog-js'

// ---------------------------------------------------------------------------
// Quality presets
// ---------------------------------------------------------------------------

interface QualityPreset {
  label: string
  description: string
  outputHeight: number
  videoBitrate: number
  videoCodec: ExportVideoCodec
  audioCodec: ExportAudioCodec
}

// Bitrates follow YouTube's recommended SDR upload rates for each resolution
// (H.264, 30fps) so quality matches what the resolution label promises.
const PRESETS: QualityPreset[] = [
  { label: '360p',  description: '640x360 · 1 Mbps · H.264 · smaller file',   outputHeight: 360,  videoBitrate: 1_000_000,  videoCodec: 'avc', audioCodec: 'aac' },
  { label: '480p',  description: '854x480 · 2.5 Mbps · H.264 · recommended',  outputHeight: 480,  videoBitrate: 2_500_000,  videoCodec: 'avc', audioCodec: 'aac' },
  { label: '720p',  description: '1280x720 · 5 Mbps · H.264 · high quality', outputHeight: 720,  videoBitrate: 5_000_000,  videoCodec: 'avc', audioCodec: 'aac' },
  { label: '1080p', description: '1920x1080 · 8 Mbps · H.264 · full HD',     outputHeight: 1080, videoBitrate: 8_000_000,  videoCodec: 'avc', audioCodec: 'aac' },
]

const DEFAULT_PRESET = 1 // 480p

// ---------------------------------------------------------------------------
// Hardware-based capability limits (mobile only)
// ---------------------------------------------------------------------------

// navigator.deviceMemory/hardwareConcurrency aren't in lib.dom yet on all TS targets.
interface NavigatorWithHardwareHints extends Navigator {
  deviceMemory?: number
}

/** Highest output height this device can reasonably encode. Desktop is
 * unrestricted; mobile is capped using deviceMemory + core count, since
 * high-resolution MediaRecorder/WebCodecs encodes can crash low-end phones.
 * Falls back to a conservative 720p cap when the hints aren't available
 * (e.g. iOS Safari, which doesn't expose deviceMemory). */
function getMaxOutputHeight(isMobile: boolean): number {
  if (!isMobile) return Infinity

  const nav = navigator as NavigatorWithHardwareHints
  const memory = nav.deviceMemory ?? 4 // unknown → assume mid-range
  const cores = nav.hardwareConcurrency ?? 4

  if (memory < 2 || cores < 4) return 480
  if (memory < 4 || cores < 6) return 720
  return 1080
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = 'settings' | 'rendering' | 'error'

export interface ExportModalProps {
  onClose: () => void
  isMobile?: boolean
  onExport: (opts: {
    videoBitrate: number
    outputHeight: number
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
  maxOutputHeight,
}: {
  selectedPreset: number
  onSelect: (i: number) => void
  onCancel: () => void
  onStart: () => void
  maxOutputHeight: number
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
          Resolution
        </div>
        <div className="flex flex-col gap-1">
          {PRESETS.map((p, i) => {
            const disabled = p.outputHeight > maxOutputHeight
            return (
              <button
                key={p.label}
                onClick={() => !disabled && onSelect(i)}
                disabled={disabled}
                title={disabled ? 'Not available on this device' : undefined}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left font-sans border transition-colors',
                  disabled
                    ? 'bg-ed-elevated border-ed-border opacity-40 cursor-not-allowed'
                    : 'cursor-pointer',
                  !disabled && selectedPreset === i
                    ? 'bg-ed-accent-soft border-ed-accent'
                    : !disabled
                      ? 'bg-ed-elevated border-ed-border'
                      : ''
                )}
              >
                <span
                  className={cn(
                    'w-3.5 h-3.5 rounded-full border-2 shrink-0',
                    !disabled && selectedPreset === i
                      ? 'border-ed-accent bg-ed-accent'
                      : 'border-ed-text-muted bg-transparent'
                  )}
                />
                <span className="text-xs font-semibold text-ed-text min-w-[52px]">{p.label}</span>
                <span className="text-[11px] text-ed-text-muted">
                  {disabled ? 'Not available on this device' : p.description}
                </span>
              </button>
            )
          })}
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

/**
 * Every export event carries the same shape off the same preset, so the funnel
 * can be broken down by any one property at every step. Derive it here rather
 * than at each call site — that is how started/completed drifted apart before.
 */
function exportEventProps(preset: (typeof PRESETS)[number]) {
  return {
    resolution: preset.label,
    output_height: preset.outputHeight,
    video_bitrate: preset.videoBitrate,
    video_codec: preset.videoCodec,
    audio_codec: preset.audioCodec,
  }
}

// ---------------------------------------------------------------------------
// ExportModal — main component
// ---------------------------------------------------------------------------

export function ExportModal({ onClose, onExport, isMobile = false }: ExportModalProps) {
  const maxOutputHeight = useRef(getMaxOutputHeight(isMobile)).current
  const [phase, setPhase] = useState<Phase>('settings')
  const [selectedPreset, setSelectedPreset] = useState(() => {
    const preset = PRESETS[DEFAULT_PRESET]
    if (preset.outputHeight <= maxOutputHeight) return DEFAULT_PRESET
    // default is disabled on this device — fall back to the highest allowed preset
    const fallback = [...PRESETS].reverse().findIndex((p) => p.outputHeight <= maxOutputHeight)
    return fallback === -1 ? DEFAULT_PRESET : PRESETS.length - 1 - fallback
  })
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

    posthog.capture('export_started', exportEventProps(preset))

    try {
      await onExport({
        videoBitrate: preset.videoBitrate,
        outputHeight: preset.outputHeight,
        videoCodec: preset.videoCodec,
        audioCodec: preset.audioCodec,
        signal: controller.signal,
        onProgress: (f, total) => {
          setFrame(f)
          setTotalFrames(total)
        },
      })
      // success — modal closes (parent handles the download)
      posthog.capture('export_completed', exportEventProps(preset))
      onClose()
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        // user-cancelled — go back to settings
        setPhase('settings')
      } else {
        const message = String(err)
        setErrorMessage(message)
        setPhase('error')
        posthog.capture('export_failed', exportEventProps(preset))
        posthog.captureException(err instanceof Error ? err : new Error(message))
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
            maxOutputHeight={maxOutputHeight}
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
