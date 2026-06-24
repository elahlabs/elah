import { useEffect, useRef, useState } from 'react'
import type { TransitionKind, Transition } from '@elah/core'

interface TransitionOption {
  kind: TransitionKind
  label: string
  /** SVG path for the mini icon */
  icon: string
}

const OPTIONS: TransitionOption[] = [
  {
    kind: 'fade',
    label: 'Fade',
    icon: 'M4 12 Q12 4 20 12 Q12 20 4 12Z',
  },
  {
    kind: 'slide',
    label: 'Slide',
    icon: 'M4 8h16M4 12h10M4 16h7',
  },
  {
    kind: 'wipe',
    label: 'Wipe',
    icon: 'M4 4h16v16H4z M12 4v16',
  },
]

const DEFAULT_DURATION = 15
const MIN_DURATION = 2
const MAX_DURATION = 120

interface TransitionPickerProps {
  /** Pixel x position (left edge of chip) */
  anchorX: number
  /** Pixel y position (top of track row) */
  anchorY: number
  /** The frame index of the cut point (= toClip.startFrame) */
  cutFrame: number
  /** Frames per second of the project, for converting frames → seconds label */
  fps: number
  /** Existing transition if one already exists at this cut */
  existing?: Transition
  onAdd: (kind: TransitionKind, durationFrames: number, offsetFrames: number) => void
  onUpdate: (patch: { durationFrames?: number; offsetFrames?: number; kind?: TransitionKind }) => void
  onRemove: () => void
  onClose: () => void
}

function deriveOffset(existing: Transition, cutFrame: number): number {
  const half = Math.floor(existing.durationFrames / 2)
  const center = existing.startFrame + half
  return center - cutFrame
}

export function TransitionPicker({
  anchorX,
  anchorY,
  cutFrame,
  fps,
  existing,
  onAdd,
  onUpdate,
  onRemove,
  onClose,
}: TransitionPickerProps) {
  const ref = useRef<HTMLDivElement>(null)

  const [durationFrames, setDurationFrames] = useState(
    existing?.durationFrames ?? DEFAULT_DURATION,
  )
  const [offsetFrames, setOffsetFrames] = useState(
    existing ? deriveOffset(existing, cutFrame) : 0,
  )

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const half = Math.max(1, Math.floor(durationFrames / 2))
  const before = half - offsetFrames   // frames taken from end of fromClip
  const after = half + offsetFrames    // frames taken from start of toClip
  const maxOffset = half - 1
  const durationSec = (durationFrames / fps).toFixed(2)

  const handleDurationChange = (val: number) => {
    const clamped = Math.max(MIN_DURATION, Math.min(MAX_DURATION, val))
    setDurationFrames(clamped)
    // Clamp offset so before/after don't go negative
    const newHalf = Math.max(1, Math.floor(clamped / 2))
    const clampedOffset = Math.max(-(newHalf - 1), Math.min(newHalf - 1, offsetFrames))
    setOffsetFrames(clampedOffset)
    if (existing) onUpdate({ durationFrames: clamped, offsetFrames: clampedOffset })
  }

  const handleOffsetChange = (val: number) => {
    const clamped = Math.max(-maxOffset, Math.min(maxOffset, val))
    setOffsetFrames(clamped)
    if (existing) onUpdate({ offsetFrames: clamped })
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: anchorX,
        top: anchorY - 200,
        zIndex: 1000,
        background: `var(--elah-popover-bg)`,
        border: `1px solid var(--elah-popover-border)`,
        borderRadius: 10,
        padding: 10,
        boxShadow: `var(--elah-popover-shadow)`,
        width: 184,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: `var(--elah-text-muted)`,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 8,
          paddingLeft: 2,
        }}
      >
        Transition
      </div>

      {/* Kind selector */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        {OPTIONS.map((opt) => {
          const isActive = existing?.kind === opt.kind
          return (
            <button
              key={opt.kind}
              type="button"
              onClick={() => {
                if (existing) {
                  onUpdate({ kind: opt.kind })
                  onClose()
                } else {
                  onAdd(opt.kind, durationFrames, offsetFrames)
                  onClose()
                }
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '8px 6px',
                background: isActive
                  ? `var(--elah-popover-option-bg-active)`
                  : `var(--elah-popover-option-bg)`,
                border: isActive
                  ? `1px solid var(--elah-popover-accent)`
                  : `1px solid var(--elah-popover-border)`,
                borderRadius: 7,
                cursor: 'pointer',
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--elah-popover-option-bg-hover)'
              }}
              onMouseLeave={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--elah-popover-option-bg)'
              }}
            >
              <svg
                width={24}
                height={24}
                viewBox="0 0 24 24"
                fill="none"
                stroke={isActive ? `var(--elah-popover-accent)` : `var(--elah-popover-icon)`}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={opt.icon} />
              </svg>
              <span style={{ fontSize: 9, color: isActive ? `var(--elah-popover-accent-text)` : `var(--elah-popover-icon)`, fontWeight: 500 }}>
                {opt.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Duration slider */}
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: `var(--elah-text-muted)`, fontWeight: 500 }}>Duration</span>
          <span style={{ fontSize: 10, color: `var(--elah-text)`, fontFamily: 'monospace' }}>
            {durationFrames}f &nbsp;{durationSec}s
          </span>
        </div>
        <input
          type="range"
          min={MIN_DURATION}
          max={MAX_DURATION}
          value={durationFrames}
          onChange={(e) => handleDurationChange(Number(e.target.value))}
          style={{ width: '100%', accentColor: `var(--elah-popover-accent)`, cursor: 'pointer' }}
        />
      </div>

      {/* Position slider */}
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: `var(--elah-text-muted)`, fontWeight: 500 }}>Position</span>
          <span style={{ fontSize: 10, color: `var(--elah-text)`, fontFamily: 'monospace' }}>
            {before}f ◆ {after}f
          </span>
        </div>
        <input
          type="range"
          min={-maxOffset}
          max={maxOffset}
          value={offsetFrames}
          onChange={(e) => handleOffsetChange(Number(e.target.value))}
          style={{ width: '100%', accentColor: `var(--elah-popover-accent)`, cursor: 'pointer' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
          <span style={{ fontSize: 8, color: `var(--elah-text-muted)` }}>← before cut</span>
          <span style={{ fontSize: 8, color: `var(--elah-text-muted)` }}>after cut →</span>
        </div>
      </div>

      {existing && (
        <button
          type="button"
          onClick={() => { onRemove(); onClose() }}
          style={{
            marginTop: 10,
            width: '100%',
            padding: '5px 0',
            fontSize: 10,
            color: `var(--elah-danger-text-alt)`,
            background: 'transparent',
            border: `1px solid var(--elah-danger-border)`,
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Remove transition
        </button>
      )}
    </div>
  )
}
