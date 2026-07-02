import { useCallback, useEffect, useState, type CSSProperties, type DragEvent } from 'react'
import { ELEMENT_DRAG_MIME, cn, type DragElementPayload, type ElementKind, type ShapeVariant } from '@elah/timeline'
import {
  isActivationKey,
  useAssetActivation,
  type ActivationToast,
  type AssetActivationHandler,
} from '../activation'

export interface ElementsPanelProps {
  style?: CSSProperties
  className?: string
  activateOnTap?: boolean
  onAssetActivate?: AssetActivationHandler
}

interface PaletteTile {
  element: ElementKind
  shapeVariant?: ShapeVariant
  label: string
  icon: React.ReactNode
  iconStyle?: CSSProperties
}

const ShapeRect = () => (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
  </svg>
)

const ShapeCircle = () => (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="9" />
  </svg>
)

const ShapeTriangle = () => (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
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
]

const TOAST_DISMISS_MS = 3000

export function ElementsPanel({
  style,
  className,
  activateOnTap,
  onAssetActivate,
}: ElementsPanelProps) {
  const [toast, setToast] = useState<ActivationToast | null>(null)
  const activationEnabled = activateOnTap === true || Boolean(onAssetActivate)
  const activateAsset = useAssetActivation({
    activateOnTap,
    onAssetActivate,
    setToast,
  })

  useEffect(() => {
    if (!toast) return
    const timer = globalThis.setTimeout(() => setToast(null), TOAST_DISMISS_MS)
    return () => globalThis.clearTimeout(timer)
  }, [toast])

  const makeDragStart = useCallback(
    (element: ElementKind, shapeVariant?: ShapeVariant) => (e: DragEvent<HTMLDivElement>) => {
      const payload: DragElementPayload = { kind: 'element', element, shapeVariant }
      e.dataTransfer.setData(ELEMENT_DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.effectAllowed = 'copy'
    },
    [],
  )
  const handleElementActivate = useCallback(
    (element: ElementKind, shapeVariant: ShapeVariant | undefined, label: string) => {
      void activateAsset({ kind: 'element', element, shapeVariant, label })
    },
    [activateAsset],
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

      {toast && (
        <div
          role="status"
          className="mx-[10px] mt-[10px] rounded-sm px-[10px] py-2 text-[10px] font-mono leading-[1.4]"
          style={{
            color: toast.tone === 'warn' ? 'var(--elah-danger-text, #f5d0a9)' : 'var(--elah-info-text, #c8d8f0)',
            background: toast.tone === 'warn' ? 'var(--elah-danger-bg, #3a2418)' : 'var(--elah-info-bg, #1a2433)',
            border: `1px solid ${toast.tone === 'warn' ? 'var(--elah-danger-border, #7a4a2a)' : 'var(--elah-info-border, #355070)'}`,
          }}
        >
          {toast.message}
        </div>
      )}

      {/* 2-column palette grid — grouping-ready, matches Media grid rhythm */}
      <div className="p-[10px] grid grid-cols-2 gap-[6px]">
        {TILES.map(({ element, shapeVariant, label, icon, iconStyle }) => (
          <div
            key={shapeVariant ? `${element}-${shapeVariant}` : element}
            draggable
            role={activationEnabled ? 'button' : undefined}
            tabIndex={activationEnabled ? 0 : undefined}
            className="elah-element-card flex flex-col items-center justify-center gap-[6px] px-2 py-3 rounded-md cursor-grab select-none bg-ed-card border border-ed-border transition-[background,border-color] duration-[150ms] min-h-[72px]"
            onDragStart={makeDragStart(element, shapeVariant)}
            onClick={activationEnabled ? () => handleElementActivate(element, shapeVariant, label) : undefined}
            onKeyDown={
              activationEnabled
                ? (e) => {
                    if (!isActivationKey(e.key)) return
                    e.preventDefault()
                    handleElementActivate(element, shapeVariant, label)
                  }
                : undefined
            }
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
