import { type ReactNode } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import type { Clip } from '@elah/editor'
import { cn } from '../../utils'

export const inputCls =
  'w-full bg-ed-bg border border-ed-border rounded-md text-ed-text text-xs font-sans px-2.5 py-1.5 outline-none focus:border-ed-accent transition-colors'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[11px] text-ed-text-muted mb-1.5">{label}</div>
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
        <span className="absolute right-8 top-1/2 -translate-y-1/2 text-[10px] text-ed-text-muted pointer-events-none">
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
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <Field label={label}>
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
        <span className="text-[11px] text-ed-text-muted font-mono w-10 text-right tabular-nums">
          {display}
        </span>
      </div>
    </Field>
  )
}

export const PANEL = 'w-[300px] shrink-0 flex flex-col bg-ed-panel border-l border-ed-border'

export function PanelHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div className="px-4 pt-4 pb-3 shrink-0">
      <div className="text-[15px] font-semibold text-ed-text">Properties</div>
      {subtitle && (
        <div className="text-[10px] text-ed-text-muted mt-0.5 font-mono">{subtitle}</div>
      )}
    </div>
  )
}

export function mergeTransform(c: Partial<Clip>) {
  return { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 }, ...c.transform }
}
