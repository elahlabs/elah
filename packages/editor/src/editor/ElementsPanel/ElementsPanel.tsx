import { useCallback, type CSSProperties, type DragEvent } from 'react'
import {
  ELEMENT_DRAG_MIME,
  type DragElementPayload,
} from '../../timeline/elementDrag'

export interface ElementsPanelProps {
  style?: CSSProperties
  className?: string
}

/**
 * Palette of synthetic timeline elements that aren't backed by imported media.
 * Today that's just a Text block: drag the tile onto the Text track and the
 * drop handler (`useTimelineDrop`) creates a text clip at the drop position.
 *
 * Must be rendered inside `<EditorProvider>`. Kept deliberately minimal so the
 * upcoming visual design can restyle it without touching drag wiring.
 */
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
        background: '#121212',
        borderRight: '1px solid #2a2a2a',
        borderBottom: '1px solid #2a2a2a',
        ...style,
      }}
    >
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid #2a2a2a',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#888',
            fontFamily: 'monospace',
          }}
        >
          Elements
        </span>
      </div>

      <div style={{ padding: 8 }}>
        <div
          draggable
          onDragStart={onTextDragStart}
          title="Drag onto the Text track"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            borderRadius: 5,
            cursor: 'grab',
            userSelect: 'none',
            background: '#1a1a1a',
            border: '1px solid #2a2a2a',
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              background: '#9b59b6',
              color: '#fff',
              fontWeight: 700,
              fontFamily: 'serif',
              fontSize: 16,
            }}
          >
            T
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 11, color: '#ccc', fontFamily: 'monospace' }}>
              Text
            </span>
            <span style={{ fontSize: 9, color: '#666', fontFamily: 'monospace' }}>
              Drag to timeline
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
