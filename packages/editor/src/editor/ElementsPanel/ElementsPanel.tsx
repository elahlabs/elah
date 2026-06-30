import { useCallback, type CSSProperties, type DragEvent } from 'react'
import { ELEMENT_DRAG_MIME, cn, type DragElementPayload, type ElementKind, type ShapeVariant } from '@elah/timeline'

export interface ElementsPanelProps {
  style?: CSSProperties
  className?: string
}

interface PaletteTile {
  element: ElementKind
  shapeVariant?: ShapeVariant
  label: string
  icon: React.ReactNode
  iconStyle?: CSSProperties
}

const ShapeRect = () => (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor">
    <rect x="3" y="5" width="18" height="14" rx="2" />
  </svg>
)

const ShapeCircle = () => (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor">
    <circle cx="12" cy="12" r="9" />
  </svg>
)

const ShapeTriangle = () => (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor">
    <polygon points="12,3 22,21 2,21" />
  </svg>
)

const FreehandIcon = () => (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17c3-3 5-7 8-7s4 4 7 1" />
    <path d="M17 11l2 2-2 2" />
  </svg>
)

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
  {
    element: 'shape',
    shapeVariant: 'rect',
    label: 'Rectangle',
    icon: <ShapeRect />,
    iconStyle: {
      background: 'var(--elah-tag-shape-bg)',
      border: '1px solid var(--elah-tag-shape-border)',
      color: 'var(--elah-tag-shape-fg)',
    },
  },
  {
    element: 'shape',
    shapeVariant: 'circle',
    label: 'Circle',
    icon: <ShapeCircle />,
    iconStyle: {
      background: 'var(--elah-tag-shape-bg)',
      border: '1px solid var(--elah-tag-shape-border)',
      color: 'var(--elah-tag-shape-fg)',
    },
  },
  {
    element: 'shape',
    shapeVariant: 'triangle',
    label: 'Triangle',
    icon: <ShapeTriangle />,
    iconStyle: {
      background: 'var(--elah-tag-shape-bg)',
      border: '1px solid var(--elah-tag-shape-border)',
      color: 'var(--elah-tag-shape-fg)',
    },
  },
  {
    element: 'freehand',
    label: 'Freehand',
    icon: <FreehandIcon />,
    iconStyle: {
      background: 'var(--elah-tag-freehand-bg)',
      border: '1px solid var(--elah-tag-freehand-border)',
      color: 'var(--elah-tag-freehand-fg)',
    },
  },
]

export function ElementsPanel({ style, className }: ElementsPanelProps) {
  const makeDragStart = useCallback(
    (element: ElementKind, shapeVariant?: ShapeVariant) => (e: DragEvent<HTMLDivElement>) => {
      const payload: DragElementPayload = { kind: 'element', element, shapeVariant }
      e.dataTransfer.setData(ELEMENT_DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.effectAllowed = 'copy'
    },
    [],
  )

  return (
    <div
      className={cn('flex flex-col bg-transparent', className)}
      style={style}
    >
      <div className="px-3 py-[10px] border-b border-ed-border shrink-0">
        <span className="text-[10px] font-bold text-ed-text-muted tracking-[0.08em]">
          ELEMENTS
        </span>
      </div>

      {/* 2-column palette grid — grouping-ready, matches Media grid rhythm */}
      <div className="p-[10px] grid grid-cols-2 gap-[6px]">
        {TILES.map(({ element, shapeVariant, label, icon, iconStyle }) => (
          <div
            key={shapeVariant ? `${element}-${shapeVariant}` : element}
            draggable
            className="elah-element-card flex flex-col items-center justify-center gap-[6px] px-2 py-3 rounded-md cursor-grab select-none bg-ed-card border border-ed-border transition-[background,border-color] duration-[150ms] min-h-[72px]"
            onDragStart={makeDragStart(element, shapeVariant)}
            title={`Drag ${label} onto the elements track`}
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
