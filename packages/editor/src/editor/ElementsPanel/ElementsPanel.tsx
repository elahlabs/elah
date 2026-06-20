import { useCallback, type CSSProperties, type DragEvent } from 'react'
import { ELEMENT_DRAG_MIME, type DragElementPayload, type ElementKind } from '@elah/timeline'

export interface ElementsPanelProps {
  style?: CSSProperties
  className?: string
}

interface PaletteTile {
  element: ElementKind
  label: string
  icon: string
  iconStyle?: CSSProperties
}

const TILES: PaletteTile[] = [
  {
    element: 'text',
    label: 'Text',
    icon: 'T',
    iconStyle: {
      background: 'var(--elah-tag-text-bg)',
      border: '1px solid var(--elah-tag-text-border)',
      color: 'var(--elah-tag-text-fg)',
      fontFamily: 'Georgia, serif',
      fontWeight: 700,
      fontSize: 17,
    },
  },
]

export function ElementsPanel({ style, className }: ElementsPanelProps) {
  const makeDragStart = useCallback(
    (element: ElementKind) => (e: DragEvent<HTMLDivElement>) => {
      const payload: DragElementPayload = { kind: 'element', element }
      e.dataTransfer.setData(ELEMENT_DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.effectAllowed = 'copy'
    },
    [],
  )

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent',
        ...style,
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--elah-border)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--elah-text-muted)',
            letterSpacing: '0.08em',
          }}
        >
          ELEMENTS
        </span>
      </div>

      {/* 2-column palette grid — grouping-ready, matches Media grid rhythm */}
      <div
        style={{
          padding: 10,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
        }}
      >
        {TILES.map(({ element, label, icon, iconStyle }) => (
          <div
            key={element}
            draggable
            className="elah-element-card"
            onDragStart={makeDragStart(element)}
            title={`Drag onto the ${label} track`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '12px 8px',
              borderRadius: 'var(--elah-radius-md)',
              cursor: 'grab',
              userSelect: 'none',
              background: 'var(--elah-bg-card)',
              border: '1px solid var(--elah-border)',
              transition: 'background 0.15s, border-color 0.15s',
              minHeight: 72,
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--elah-radius-sm)',
                ...iconStyle,
              }}
            >
              {icon}
            </span>
            <span style={{ fontSize: 11, color: 'var(--elah-text)', fontWeight: 500 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
