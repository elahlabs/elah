'use client'

import { memo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { TimelineProps } from '@elah/editor'
import { cn } from '@/lib/utils'
import { TimelineThemeMode } from './TimelineThemeMode'

/**
 * Live config panel for the timeline playground (playground-only UI).
 *
 * Two kinds of config, two mechanisms:
 *   • Timeline `classNames` slots — applied LIVE; the parent passes the state
 *     straight to `<Timeline classNames={...} />`.
 *   • `EditorProvider` props (track height, history size, stage) — the provider
 *     memoizes its engine on mount, so these only take effect on a remount. The
 *     parent owns a remount key; this panel just edits a draft and asks to apply.
 *
 * Note on Tailwind: the panel's preset class strings are written as literals so
 * Tailwind's JIT compiles them into the app stylesheet. Free-form classes typed
 * into the inputs only render if those utilities already exist in the build.
 */

export type ClassNamesState = NonNullable<TimelineProps['classNames']>

type Swatch = 'none' | 'bg' | 'text' | 'gradient'

interface Slot {
  key: keyof ClassNamesState
  label: string
  swatch: Swatch
  presets: string[]
}

interface SlotGroup {
  title: string
  slots: Slot[]
}

// Preset class strings are LITERAL on purpose — Tailwind scans this file and
// compiles every one of them into the app stylesheet.
const GROUPS: SlotGroup[] = [
  {
    title: 'Structure',
    slots: [
      { key: 'root', label: 'Root', swatch: 'none', presets: ['rounded-xl', 'rounded-2xl', 'shadow-2xl', 'border-2 border-ed-border'] },
      { key: 'track', label: 'Track row', swatch: 'none', presets: ['border-b border-ed-border', 'border-b-2 border-ed-accent'] },
      { key: 'trackLabel', label: 'Track label', swatch: 'none', presets: ['font-bold', 'italic', 'uppercase tracking-wide'] },
      { key: 'clip', label: 'Clip shape', swatch: 'none', presets: ['rounded-sm', 'rounded-lg', 'rounded-2xl', 'shadow-lg'] },
    ],
  },
  {
    title: 'Ruler & Lane',
    slots: [
      { key: 'ruler', label: 'Ruler', swatch: 'bg', presets: ['bg-zinc-900', 'bg-slate-900', 'bg-neutral-950'] },
      { key: 'rulerTick', label: 'Ticks', swatch: 'bg', presets: ['bg-zinc-600', 'bg-slate-500', 'bg-zinc-700'] },
      { key: 'rulerLabel', label: 'Labels', swatch: 'text', presets: ['text-zinc-400', 'text-slate-400', 'text-zinc-500'] },
      { key: 'lane', label: 'Lane', swatch: 'bg', presets: ['bg-zinc-950', 'bg-slate-950', 'bg-black'] },
    ],
  },
  {
    title: 'Clip bodies',
    slots: [
      { key: 'clipVideo', label: 'Video', swatch: 'gradient', presets: ['from-sky-400 to-sky-600', 'from-blue-400 to-blue-700', 'from-indigo-400 to-indigo-600'] },
      { key: 'clipAudio', label: 'Audio', swatch: 'gradient', presets: ['from-emerald-400 to-emerald-600', 'from-teal-400 to-teal-600', 'from-green-400 to-green-700'] },
      { key: 'clipText', label: 'Text', swatch: 'gradient', presets: ['from-violet-400 to-violet-600', 'from-purple-400 to-purple-700', 'from-fuchsia-400 to-fuchsia-600'] },
      { key: 'clipImage', label: 'Image', swatch: 'gradient', presets: ['from-amber-400 to-amber-600', 'from-orange-400 to-orange-600', 'from-yellow-400 to-yellow-600'] },
    ],
  },
  {
    title: 'Accents & Playhead',
    slots: [
      { key: 'clipVideoAccent', label: 'Video accent', swatch: 'text', presets: ['text-sky-300', 'text-blue-300'] },
      { key: 'clipAudioAccent', label: 'Audio accent', swatch: 'text', presets: ['text-emerald-300', 'text-teal-300'] },
      { key: 'clipTextAccent', label: 'Text accent', swatch: 'text', presets: ['text-violet-300', 'text-purple-300'] },
      { key: 'clipImageAccent', label: 'Image accent', swatch: 'text', presets: ['text-amber-300', 'text-orange-300'] },
      { key: 'playhead', label: 'Playhead', swatch: 'text', presets: ['text-cyan-400', 'text-rose-400', 'text-white', 'text-lime-400'] },
    ],
  },
]

function PresetChip({ value, swatch, active, onClick }: { value: string; swatch: Swatch; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={value}
      className={cn(
        'flex items-center gap-1 h-5 px-1.5 rounded border text-[9px] font-mono transition-colors',
        active
          ? 'border-ed-accent text-ed-text bg-ed-accent-soft'
          : 'border-ed-border text-ed-text-muted hover:text-ed-text hover:border-ed-accent/50',
      )}
    >
      {swatch === 'gradient' && (
        <span className={cn('h-2.5 w-4 rounded-[2px] bg-gradient-to-r', value)} />
      )}
      {swatch === 'bg' && <span className={cn('h-2.5 w-2.5 rounded-[2px] border border-white/10', value)} />}
      {swatch === 'text' && <span className={cn('leading-none', value)}>●</span>}
      <span className="max-w-[88px] truncate">{value}</span>
    </button>
  )
}

function SlotControl({
  slot,
  value,
  onChange,
}: {
  slot: Slot
  value: string
  onChange: (next: string | undefined) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ed-text">{slot.label}</span>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-[9px] text-ed-text-muted hover:text-ed-text uppercase tracking-wide cursor-pointer"
          >
            clear
          </button>
        ) : null}
      </div>
      <input
        type="text"
        value={value}
        spellCheck={false}
        placeholder="Tailwind classes…"
        onChange={(e) => onChange(e.target.value || undefined)}
        className="w-full px-2 py-1 bg-ed-bg border border-ed-border rounded text-[10px] font-mono text-ed-text placeholder:text-ed-text-muted/60 focus:border-ed-accent focus:outline-none"
      />
      <div className="flex flex-wrap gap-1">
        {slot.presets.map((p) => (
          <PresetChip
            key={p}
            value={p}
            swatch={slot.swatch}
            active={value === p}
            onClick={() => onChange(value === p ? undefined : p)}
          />
        ))}
      </div>
    </div>
  )
}

type Mode = 'granular' | 'theme'

const MODES: { id: Mode; label: string }[] = [
  { id: 'theme', label: 'Theme' },
  { id: 'granular', label: 'Granular' },
]

interface TimelineConfigPanelProps {
  classNames: ClassNamesState
  onClassNamesChange: (next: ClassNamesState) => void
  /** Theme-mode picker state (raw colour values keyed by token id). */
  themeValues: Record<string, string>
  onThemeValuesChange: (next: Record<string, string>) => void
  /** Toggle the Export Style sidebar (owned by the parent). */
  onToggleExport: () => void
  exportOpen: boolean
}

export const TimelineConfigPanel = memo(function TimelineConfigPanel({
  classNames,
  onClassNamesChange,
  themeValues,
  onThemeValuesChange,
  onToggleExport,
  exportOpen,
}: TimelineConfigPanelProps) {
  const [mode, setMode] = useState<Mode>('theme')
  // Only the first group starts expanded; the rest collapse by default.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.slice(1).map((g) => [g.title, true])),
  )

  const setSlot = (key: keyof ClassNamesState, next: string | undefined) => {
    const draft = { ...classNames }
    if (next) draft[key] = next
    else delete draft[key]
    onClassNamesChange(draft)
  }

  const classNamesDirty = Object.keys(classNames).length > 0

  /** Active overrides within a group — drives the per-group count badge. */
  const groupCount = (group: SlotGroup) =>
    group.slots.filter((s) => classNames[s.key]).length

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col bg-ed-panel border-r border-ed-border font-sans">
      {/* Header + tabs (underline-accent, like the source panel) */}
      <div className="flex items-center gap-4 border-b border-ed-border px-3.5 pt-2.5 shrink-0">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              'relative pb-2 text-[13px] font-medium transition-colors',
              mode === m.id ? 'text-ed-text' : 'text-ed-text-muted hover:text-ed-text',
            )}
          >
            {m.label}
            {mode === m.id && (
              <span
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full"
                style={{ background: 'var(--elah-accent)' }}
              />
            )}
          </button>
        ))}

        {/* Export Style — toggles the code sidebar (classNames + theme.css) */}
        <button
          onClick={onToggleExport}
          className={cn(
            'ml-auto mb-1.5 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-opacity hover:opacity-90',
            exportOpen && 'ring-1 ring-inset ring-white/30',
          )}
          style={{ background: 'var(--elah-accent)', color: 'var(--elah-accent-text)' }}
          title="Export style as code"
        >
          <Sparkles size={12} /> Export
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 flex flex-col gap-5">
        {mode === 'theme' && (
          <TimelineThemeMode values={themeValues} onChange={onThemeValuesChange} />
        )}

        {mode === 'granular' && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-ed-text-muted/70">
                Timeline classNames · live
              </span>
              {classNamesDirty && (
                <button
                  onClick={() => onClassNamesChange({})}
                  className="text-[9px] text-ed-text-muted hover:text-ed-text uppercase tracking-wide cursor-pointer"
                >
                  reset
                </button>
              )}
            </div>

            {GROUPS.map((group) => {
              const count = groupCount(group)
              const isCollapsed = collapsed[group.title]
              return (
                <div key={group.title} className="flex flex-col gap-2.5">
                  <button
                    onClick={() =>
                      setCollapsed((c) => ({ ...c, [group.title]: !c[group.title] }))
                    }
                    className="flex items-center gap-1.5 text-left cursor-pointer group/header"
                  >
                    <span className="text-ed-text-muted/50 text-[9px] w-2">
                      {isCollapsed ? '▸' : '▾'}
                    </span>
                    <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-ed-text-muted/50 group-hover/header:text-ed-text-muted">
                      {group.title}
                    </span>
                    {count > 0 && (
                      <span className="flex items-center justify-center min-w-[14px] h-3.5 px-1 rounded-full bg-ed-accent-soft text-ed-accent-hover text-[8px] font-semibold tabular-nums">
                        {count}
                      </span>
                    )}
                  </button>
                  {!isCollapsed &&
                    group.slots.map((slot) => (
                      <SlotControl
                        key={slot.key}
                        slot={slot}
                        value={(classNames[slot.key] as string) ?? ''}
                        onChange={(next) => setSlot(slot.key, next)}
                      />
                    ))}
                </div>
              )
            })}
          </section>
        )}
      </div>
    </aside>
  )
})
