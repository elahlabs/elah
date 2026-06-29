'use client'

import { memo, useEffect, useState } from 'react'
import type { TimelineProps } from '@elah/editor'
import { cn } from '@/lib/utils'

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

export interface ProviderCfg {
  defaultTrackHeight: number
  maxHistorySize: number
  stageWidth: number
  stageHeight: number
}

export const DEFAULT_PROVIDER_CFG: ProviderCfg = {
  defaultTrackHeight: 36,
  maxHistorySize: 100,
  stageWidth: 1920,
  stageHeight: 1080,
}

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

const NumberField = memo(function NumberField({
  label,
  value,
  min,
  onChange,
}: {
  label: string
  value: number
  min?: number
  onChange: (next: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-ed-text-muted">{label}</span>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 px-2 py-1 bg-ed-bg border border-ed-border rounded text-[11px] font-mono text-ed-text focus:border-ed-accent focus:outline-none"
      />
    </label>
  )
})

interface TimelineConfigPanelProps {
  classNames: ClassNamesState
  onClassNamesChange: (next: ClassNamesState) => void
  providerCfg: ProviderCfg
  onProviderCfgChange: (next: ProviderCfg) => void
  providerDirty: boolean
  onApplyProvider: () => void
}

export const TimelineConfigPanel = memo(function TimelineConfigPanel({
  classNames,
  onClassNamesChange,
  providerCfg,
  onProviderCfgChange,
  providerDirty,
  onApplyProvider,
}: TimelineConfigPanelProps) {
  const [open, setOpen] = useState(true)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)

  // Esc closes the panel.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const setSlot = (key: keyof ClassNamesState, next: string | undefined) => {
    const draft = { ...classNames }
    if (next) draft[key] = next
    else delete draft[key]
    onClassNamesChange(draft)
  }

  const setCfg = (patch: Partial<ProviderCfg>) =>
    onProviderCfgChange({ ...providerCfg, ...patch })

  const activeKeys = Object.keys(classNames)
  const classNamesDirty = activeKeys.length > 0

  const copyJsx = () => {
    const body = activeKeys
      .map((k) => `  ${k}: '${classNames[k as keyof ClassNamesState]}',`)
      .join('\n')
    const snippet = `classNames={{\n${body}\n}}`
    void navigator.clipboard?.writeText(snippet).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  /** Active overrides within a group — drives the per-group count badge. */
  const groupCount = (group: SlotGroup) =>
    group.slots.filter((s) => classNames[s.key]).length

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute top-3 right-3 z-30 flex items-center gap-1.5 px-3 py-1.5 bg-ed-panel/90 backdrop-blur border border-ed-border rounded-lg text-xs font-medium text-ed-text-muted hover:text-ed-text hover:border-ed-accent/50 shadow-lg transition-colors"
        title="Open config panel"
      >
        ⚙ Config
        {classNamesDirty && (
          <span className="flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-ed-accent text-ed-accent-text text-[9px] font-semibold tabular-nums">
            {activeKeys.length}
          </span>
        )}
        {providerDirty && (
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Provider changes pending" />
        )}
      </button>
    )
  }

  return (
    <aside className="absolute top-3 right-3 z-30 w-[272px] max-h-[calc(100%-1.5rem)] flex flex-col bg-ed-panel/95 backdrop-blur border border-ed-border rounded-xl shadow-2xl overflow-hidden font-sans">
      <div className="flex items-center justify-between px-3 py-2 border-b border-ed-border shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ed-text">
          Config
        </span>
        <button
          onClick={() => setOpen(false)}
          className="text-ed-text-muted hover:text-ed-text text-base leading-none px-1 cursor-pointer"
          aria-label="Collapse config panel"
        >
          ×
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-5">
        {/* ── Provider config (remount-gated) ─────────────────────────── */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-ed-text-muted/70">
              EditorProvider
            </span>
            {providerDirty && (
              <span className="text-[9px] text-amber-400 uppercase tracking-wide">
                pending
              </span>
            )}
          </div>
          <NumberField
            label="Track height"
            value={providerCfg.defaultTrackHeight}
            min={16}
            onChange={(v) => setCfg({ defaultTrackHeight: v })}
          />
          <NumberField
            label="Max history"
            value={providerCfg.maxHistorySize}
            min={1}
            onChange={(v) => setCfg({ maxHistorySize: v })}
          />
          <NumberField
            label="Stage width"
            value={providerCfg.stageWidth}
            min={1}
            onChange={(v) => setCfg({ stageWidth: v })}
          />
          <NumberField
            label="Stage height"
            value={providerCfg.stageHeight}
            min={1}
            onChange={(v) => setCfg({ stageHeight: v })}
          />
          <button
            onClick={onApplyProvider}
            disabled={!providerDirty}
            className={cn(
              'mt-1 px-3 py-1.5 rounded-md text-[11px] font-medium border transition-colors',
              providerDirty
                ? 'bg-ed-accent-soft border-ed-accent text-ed-accent-hover cursor-pointer hover:bg-ed-accent/20'
                : 'border-ed-border text-ed-text-muted/40 cursor-not-allowed',
            )}
          >
            ⟳ Apply &amp; remount
          </button>
          <p className="text-[9px] text-ed-text-muted/70 leading-snug">
            The provider builds its engine once on mount, so these only take
            effect after a remount (clears clips & history).
          </p>
        </section>

        {/* ── Timeline classNames (live) ──────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-ed-text-muted/70">
              Timeline classNames · live
            </span>
            {classNamesDirty && (
              <div className="flex items-center gap-2">
                <button
                  onClick={copyJsx}
                  className="text-[9px] text-ed-text-muted hover:text-ed-text uppercase tracking-wide cursor-pointer"
                >
                  {copied ? '✓ copied' : 'copy jsx'}
                </button>
                <button
                  onClick={() => onClassNamesChange({})}
                  className="text-[9px] text-ed-text-muted hover:text-ed-text uppercase tracking-wide cursor-pointer"
                >
                  reset
                </button>
              </div>
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
      </div>
    </aside>
  )
})
