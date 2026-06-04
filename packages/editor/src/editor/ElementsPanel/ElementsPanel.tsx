import { useCallback, type CSSProperties, type DragEvent } from 'react'
import {
  ELEMENT_DRAG_MIME,
  type DragElementPayload,
} from '../../timeline/elementDrag'

export interface ElementsPanelProps {
  style?: CSSProperties
  className?: string
}

export function ElementsPanel({ style, className }: ElementsPanelProps) {
  const onTextDragStart = useCallback((e: DragEvent<HTMLDivElement>) => {
    const payload: DragElementPayload = { kind: 'element', element: 'text' }
    e.dataTransfer.setData(ELEMENT_DRAG_MIME, JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'copy'
  }, [])

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent',
        borderBottom: '1px solid #232938',
        ...style,
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid #232938',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: '#6B7280',
            letterSpacing: '0.08em',
          }}
        >
          ELEMENTS
        </span>
      </div>

      <div style={{ padding: 10 }}>
        <div
          draggable
          className="elah-element-card"
          onDragStart={onTextDragStart}
          title="Drag onto the Text track"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            borderRadius: 8,
            cursor: 'grab',
            userSelect: 'none',
            background: '#171D2B',
            border: '1px solid #232938',
            transition: 'background 0.15s, border-color 0.15s',
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
              borderRadius: 6,
              background: 'rgba(147, 51, 234, 0.25)',
              border: '1px solid rgba(147, 51, 234, 0.4)',
              color: '#C4B5FD',
              fontWeight: 700,
              fontFamily: 'Georgia, serif',
              fontSize: 17,
            }}
          >
            T
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12, color: '#F3F4F6', fontWeight: 500 }}>Text</span>
            <span style={{ fontSize: 10, color: '#6B7280' }}>+ Drag onto timeline</span>
          </div>
        </div>
      </div>
    </div>
  )
}
