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
      className={`flex flex-col bg-transparent${className ? ` ${className}` : ''}`}
      style={style}
    >
      <div className="px-3 py-[10px] border-b border-ed-border shrink-0">
        <span className="text-[10px] font-bold text-ed-text-muted tracking-[0.08em]">
          ELEMENTS
        </span>
      </div>

      {/* 2-column palette grid — grouping-ready, matches Media grid rhythm */}
      <div className="p-[10px] grid grid-cols-2 gap-[6px]">
        {TILES.map(({ element, label, icon, iconStyle }) => (
          <div
            key={element}
            draggable
            className="elah-element-card flex flex-col items-center justify-center gap-[6px] px-2 py-3 rounded-md cursor-grab select-none bg-ed-card border border-ed-border transition-[background,border-color] duration-[150ms] min-h-[72px]"
            onDragStart={makeDragStart(element)}
            title={`Drag onto the ${label} track`}
          >
            <span
              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-sm"
              style={iconStyle}
            >
              {icon}
            </span>
            <span className="text-[11px] text-ed-text font-medium">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
