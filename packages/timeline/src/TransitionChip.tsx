import { memo, useState, useCallback } from 'react'
import type { Clip, Transition as TransitionData, TransitionKind } from '@elah/core'
import { useTimeline } from './engine-context'
import { useTransitionsStore } from '@elah/core'
import { TransitionPicker } from './TransitionPicker'

interface TransitionChipProps {
  fromClip: Clip
  toClip: Clip
  zoom: number
  trackHeight: number
  fps: number
}

const HIT_W = 24   // invisible hover zone width
const DIAMOND = 16 // icon size

/**
 * A full-height cut-line rendered at every adjacent clip boundary.
 * Always visible as a faint vertical rule — brightens + shows a diamond on hover.
 * When a transition exists the diamond is filled and the line is colored.
 */
export const TransitionChip = memo(function TransitionChip({ fromClip, toClip, zoom, trackHeight, fps }: TransitionChipProps) {
  const engine = useTimeline()
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null)
  const pickerOpen = pickerPos !== null
  const [hovered, setHovered] = useState(false)

  const transition: TransitionData | undefined = useTransitionsStore((s) =>
    s.transitions.find(
      (t) => t.fromClipId === fromClip.id && t.toClipId === toClip.id,
    ),
  )

  const cutX = toClip.startFrame * zoom
  const hasTransition = Boolean(transition)

  // Dynamic: line color depends on state — use var() inline since it's conditional
  const lineColor = hasTransition
    ? `var(--elah-transition-line)`
    : hovered
      ? `var(--elah-transition-line-hover)`
      : `var(--elah-transition-line-idle)`

  const handleAdd = useCallback(
    (kind: TransitionKind, durationFrames: number, offsetFrames: number) => {
      engine.addTransition({
        fromClipId: fromClip.id,
        toClipId: toClip.id,
        trackId: fromClip.trackId,
        kind,
        durationFrames,
        offsetFrames,
      })
    },
    [engine, fromClip, toClip],
  )

  const handleUpdate = useCallback(
    (patch: { durationFrames?: number; offsetFrames?: number; kind?: TransitionKind }) => {
      if (transition) engine.updateTransition(transition.id, patch)
    },
    [engine, transition],
  )

  const handleRemove = useCallback(() => {
    if (transition) engine.removeTransition(transition.id)
  }, [engine, transition])

  const diamondTop = (trackHeight - DIAMOND) / 2

  return (
    <>
      {/* Full-height cut line — always rendered, acts as the primary visual indicator */}
      <div
        style={{
          position: 'absolute',
          left: cutX - 0.5,
          top: 5,
          width: 1,
          height: trackHeight - 10,
          background: lineColor,
          transition: 'background 0.12s',
          pointerEvents: 'none',
          zIndex: 8,
        }}
      />

      {/* Wide invisible hit zone + diamond — centered on the cut line */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={(e) => {
          e.stopPropagation()
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
          setPickerPos({ x: rect.left + rect.width / 2, y: rect.top })
        }}
        title={hasTransition ? `${transition!.kind} — click to change` : 'Add transition'}
        style={{
          position: 'absolute',
          left: cutX - HIT_W / 2,
          top: 0,
          width: HIT_W,
          height: trackHeight,
          zIndex: 11,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Diamond icon — always visible when transition exists, visible on hover otherwise */}
        <div
          className="elah-transition-chip-affordance"
          style={{
            position: 'absolute',
            top: diamondTop,
            width: DIAMOND,
            height: DIAMOND,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hasTransition ? 1 : hovered ? 1 : 0,
            transition: 'opacity 0.12s',
          }}
        >
          {hasTransition ? (
            <svg width={DIAMOND} height={DIAMOND} viewBox="0 0 16 16">
              <rect
                x={2} y={2} width={12} height={12} rx={2}
                transform="rotate(45 8 8)"
                fill={`var(--elah-transition-fill)`}
                stroke={`var(--elah-transition-stroke)`}
                strokeWidth={1}
              />
            </svg>
          ) : (
            <svg width={DIAMOND} height={DIAMOND} viewBox="0 0 16 16">
              <rect
                x={3} y={3} width={10} height={10} rx={1.5}
                transform="rotate(45 8 8)"
                fill={`var(--elah-transition-add-fill)`}
                stroke={`var(--elah-transition-add-stroke)`}
                strokeWidth={1.5}
              />
              <line x1="8" y1="5" x2="8" y2="11" stroke={`var(--elah-transition-add-stroke)`} strokeWidth={1.2} />
              <line x1="5" y1="8" x2="11" y2="8" stroke={`var(--elah-transition-add-stroke)`} strokeWidth={1.2} />
            </svg>
          )}
        </div>
      </div>

      {pickerOpen && pickerPos && (
        <TransitionPicker
          anchorX={pickerPos.x}
          anchorY={pickerPos.y}
          cutFrame={toClip.startFrame}
          fps={fps}
          existing={transition}
          onAdd={handleAdd}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
          onClose={() => setPickerPos(null)}
        />
      )}
    </>
  )
})
