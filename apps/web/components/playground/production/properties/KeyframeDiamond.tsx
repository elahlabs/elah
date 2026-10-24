'use client'

import { Diamond } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KeyState } from '@/lib/editor/keyframeEdit'

/**
 * The keyframe diamond next to a property label — CapCut's one gesture.
 *
 *   none    → dim outline. Click: start keyframing, key at the playhead.
 *   keyed   → accent outline. Click: add a key at the playhead.
 *   on-key  → accent, filled. Click: remove that key.
 *
 * It is the whole discoverability mechanism: only properties that can animate
 * get one, so its presence IS the affordance.
 */
export function KeyframeDiamond({
  state,
  label,
  onClick,
  disabledReason,
}: {
  state: KeyState
  label: string
  onClick: () => void
  /**
   * PV-P5c-2: when set, the diamond is inert and shows this instead of a
   * click handler — a gradient `Paint` fill/stroke can't be keyed (there is
   * no channel behind it), so the field explains why rather than hiding the
   * control outright.
   */
  disabledReason?: string
}) {
  if (disabledReason) {
    return (
      <span
        title={disabledReason}
        aria-label={disabledReason}
        data-key-state="disabled"
        className="flex items-center justify-center w-5 h-5 -my-1 text-ed-text-muted/30"
      >
        <Diamond size={11} strokeWidth={2} />
      </span>
    )
  }
  const title =
    state === 'on-key'
      ? `Remove ${label} keyframe`
      : state === 'keyed'
        ? `Add ${label} keyframe at playhead`
        : `Animate ${label}: add a keyframe at playhead`
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={state !== 'none'}
      data-key-state={state}
      className={cn(
        'flex items-center justify-center w-5 h-5 -my-1 rounded transition-colors',
        state === 'none' && 'text-ed-text-muted/50 hover:text-ed-text',
        state === 'keyed' && 'text-ed-accent hover:bg-ed-elevated',
        state === 'on-key' && 'text-ed-accent hover:bg-ed-elevated',
      )}
    >
      <Diamond size={11} strokeWidth={2} fill={state === 'on-key' ? 'currentColor' : 'none'} />
    </button>
  )
}
