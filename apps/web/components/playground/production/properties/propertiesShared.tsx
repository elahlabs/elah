'use client'

import { type ReactNode } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import {
  TEXT_ANIMATION_KINDS,
  type Clip,
  type TextAnimationKind,
  type Transform,
} from '@elah/editor'
import { cn } from '@/lib/utils'

export const inputCls =
  'w-full bg-ed-bg border border-ed-border rounded-md text-ed-text text-[13px] font-sans px-2.5 py-1.5 outline-none focus:border-ed-accent transition-colors'

/**
 * Read an animation `<select>` value back into a `TextAnimationKind`.
 *
 * The sentinel `'none'` — and anything else not in the catalogue — becomes
 * `undefined`, which is how the clip records "no animation on this end".
 * Validating against `TEXT_ANIMATION_KINDS` rather than casting means the
 * option lists and the type union cannot drift apart: the panels render the
 * catalogue, and only what the catalogue contains can be written back.
 */
export function readAnimationKind(value: string): TextAnimationKind | undefined {
  return TEXT_ANIMATION_KINDS.find((option) => option.kind === value)?.kind
}

export function Field({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-[12px] text-ed-text-muted mb-1.5">
        <span>{label}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

export function NumberField({
  value,
  onChange,
  onCommit,
  step = 1,
  min,
  max,
  suffix,
  placeholder,
}: {
  value: number
  onChange: (v: number) => void
  onCommit: () => void
  step?: number
  min?: number
  max?: number
  suffix?: string
  placeholder?: string
}) {
  const clamp = (v: number) =>
    Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  const bump = (dir: 1 | -1) => {
    onChange(clamp(Number((value + dir * step).toFixed(4))))
    onCommit()
  }
  return (
    <div className="relative">
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={onCommit}
        className={cn(
          inputCls,
          'pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        )}
      />
      {suffix && (
        <span className="absolute right-8 top-1/2 -translate-y-1/2 text-[11px] text-ed-text-muted pointer-events-none">
          {suffix}
        </span>
      )}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-px">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => bump(1)}
          className="flex items-center justify-center w-5 h-[11px] rounded-[3px] text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated"
        >
          <ChevronUp size={10} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => bump(-1)}
          className="flex items-center justify-center w-5 h-[11px] rounded-[3px] text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated"
        >
          <ChevronDown size={10} />
        </button>
      </div>
    </div>
  )
}

export function SliderRow({
  label,
  action,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  action?: ReactNode
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <Field label={label} action={action}>
      <div className="flex items-center gap-2.5">
        <input
          type="range"
          className="elah-range flex-1"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="text-[12px] text-ed-text-muted font-mono w-10 text-right tabular-nums">
          {display}
        </span>
      </div>
    </Field>
  )
}

/**
 * One cell of a row of quick-action buttons (rotate quarter-turns, speed
 * presets). `active` marks the value the clip currently sits on; a button that
 * only *applies* a delta (rotate 90° right) never sets it.
 */
export function PresetButton({
  children,
  onClick,
  title,
  active = false,
  className,
}: {
  children: ReactNode
  onClick: () => void
  title?: string
  active?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'flex items-center justify-center gap-1 px-1 py-1.5 rounded-md border',
        'text-[12px] leading-none whitespace-nowrap transition-colors',
        active
          ? 'border-ed-accent text-ed-accent bg-ed-elevated'
          : 'border-ed-border text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated',
        className,
      )}
    >
      {children}
    </button>
  )
}

export const PANEL = 'w-[300px] shrink-0 flex flex-col bg-ed-panel border-l border-ed-border'

export function PanelHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div className="px-4 pt-4 pb-3 shrink-0">
      <div className="text-[16px] font-semibold text-ed-text">Properties</div>
      {subtitle && (
        <div
          className="text-[11px] text-ed-text-muted mt-0.5 font-mono whitespace-nowrap overflow-hidden text-ellipsis"
          title={subtitle}
        >
          {subtitle}
        </div>
      )}
    </div>
  )
}

/** `"name · 0:03–0:08"`, using the project's real fps rather than a hardcoded 30. */
export function clipTimecode(clip: Clip, fps: number): string {
  const startSec = (clip.startFrame / fps).toFixed(0).padStart(2, '0')
  const endSec = ((clip.startFrame + clip.durationFrames) / fps).toFixed(0).padStart(2, '0')
  return `${clip.name} · 0:${startSec}–0:${endSec}`
}

/**
 * The clip's transform with every optional channel filled in — what the numeric
 * fields read and what a commit writes back.
 *
 * `fallback` is the placement a clip with NO transform of its own is actually
 * drawn at. It matters because the identity defaults below are a *lie* for
 * raster media: `resolveDrawRect` letterboxes an untransformed video/image into
 * the stage, so committing `scale: 1` would snap it to its native pixel size the
 * instant the user nudged any field. Callers that can resolve the real placement
 * (see `transformFromContainRect`) pass it here; text and shapes derive their
 * box from clip data alone and need no fallback.
 */
export function mergeTransform(c: Partial<Clip>, fallback?: Transform) {
  return {
    x: 0.5,
    y: 0.5,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    ...fallback,
    ...c.transform,
  }
}

const TWO_PI = Math.PI * 2

/** Radians → degrees, rounded to 0.01° so repeated quarter-turns can't drift. */
export function radiansToDegrees(rotation: number): number {
  return Math.round(((rotation * 180) / Math.PI) * 100) / 100
}

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Add `deltaDeg` to a rotation and wrap the result into [0, 2π).
 *
 * Additive rather than snapping to the nearest quarter turn: a clip already
 * nudged to 5° to straighten a horizon should land on 95°, not lose the nudge.
 * Wrapping keeps the readout sane after four clicks of "rotate right" — and
 * because the degrees are re-rounded each step, four of them return to exactly 0
 * rather than to a float smear of it.
 */
export function rotateBy(rotation: number, deltaDeg: number): number {
  const next = degreesToRadians(radiansToDegrees(rotation) + deltaDeg)
  return ((next % TWO_PI) + TWO_PI) % TWO_PI
}
