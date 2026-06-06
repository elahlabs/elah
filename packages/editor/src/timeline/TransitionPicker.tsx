import { useEffect, useRef } from 'react'
import type { TransitionKind, Transition } from '../core/types'

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

interface TransitionPickerProps {
  /** Pixel x position (left edge of chip) */
  anchorX: number
  /** Pixel y position (top of track row) */
  anchorY: number
  /** Existing transition if one already exists at this cut */
  existing?: Transition
  onAdd: (kind: TransitionKind, durationFrames: number) => void
  onRemove: () => void
  onClose: () => void
}

const DEFAULT_DURATION = 15

export function TransitionPicker({
  anchorX,
  anchorY,
  existing,
  onAdd,
  onRemove,
  onClose,
}: TransitionPickerProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: anchorX,
        top: anchorY - 120,
        zIndex: 1000,
        background: '#1A1F2B',
        border: '1px solid #2D3548',
        borderRadius: 10,
        padding: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        minWidth: 160,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: '#6B7280',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 8,
          paddingLeft: 2,
        }}
      >
        Transition
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        {OPTIONS.map((opt) => {
          const isActive = existing?.kind === opt.kind
          return (
            <button
              key={opt.kind}
              type="button"
              onClick={() => {
                if (isActive) return
                onAdd(opt.kind, DEFAULT_DURATION)
                onClose()
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '8px 6px',
                background: isActive ? '#3B4A6B' : '#232938',
                border: isActive ? '1px solid #6B8CFF' : '1px solid #2D3548',
                borderRadius: 7,
                cursor: isActive ? 'default' : 'pointer',
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLButtonElement).style.background = '#2D3548'
              }}
              onMouseLeave={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLButtonElement).style.background = '#232938'
              }}
            >
              <svg
                width={24}
                height={24}
                viewBox="0 0 24 24"
                fill="none"
                stroke={isActive ? '#6B8CFF' : '#9CA3AF'}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={opt.icon} />
              </svg>
              <span
                style={{
                  fontSize: 9,
                  color: isActive ? '#A5B4FC' : '#9CA3AF',
                  fontWeight: 500,
                }}
              >
                {opt.label}
              </span>
            </button>
          )
        })}
      </div>

      {existing && (
        <button
          type="button"
          onClick={() => {
            onRemove()
            onClose()
          }}
          style={{
            marginTop: 8,
            width: '100%',
            padding: '5px 0',
            fontSize: 10,
            color: '#F87171',
            background: 'transparent',
            border: '1px solid #3F2A2A',
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
