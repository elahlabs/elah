'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import {
  useSelectionStore,
  useTracksStore,
  useTimelineEngine,
  type Clip,
  type TextAnimationKind,
  type TextAnimation,
} from '@elah/editor'
import { cn } from '@/lib/utils'

const FONTS = ['sans-serif', 'serif', 'monospace', 'Georgia', 'Impact']

type Tab = 'style' | 'transform' | 'animate'
const TABS: { id: Tab; label: string }[] = [
  { id: 'style', label: 'Style' },
  { id: 'transform', label: 'Transform' },
  { id: 'animate', label: 'Animate' },
]

const inputCls =
  'w-full bg-ed-bg border border-ed-border rounded-md text-ed-text text-xs font-sans px-2.5 py-1.5 outline-none focus:border-ed-accent transition-colors'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[11px] text-ed-text-muted mb-1.5">{label}</div>
      {children}
    </div>
  )
}

/** Number input with a unit suffix and up/down steppers — the Figma control. */
function NumberField({
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

/** Label + value header above a cyan slider — the Figma "Scale" pattern. */
function SliderRow({
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

function AlignBtn({
  value,
  current,
  onClick,
}: {
  value: 'left' | 'center' | 'right'
  current: string
  onClick: () => void
}) {
  const labels: Record<string, string> = { left: '⫷', center: '☰', right: '⫸' }
  const active = current === value
  return (
    <button
      type="button"
      title={`Align ${value}`}
      onClick={onClick}
      className={cn(
        'flex-1 py-1.5 text-[13px] rounded-md cursor-pointer border transition-colors',
        active
          ? 'bg-ed-accent-soft text-ed-accent-hover border-ed-accent'
          : 'bg-ed-bg text-ed-text-muted border-ed-border hover:text-ed-text',
      )}
    >
      {labels[value]}
    </button>
  )
}

function mergeTransform(c: Partial<Clip>) {
  return { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 }, ...c.transform }
}

function mergeAnim(c: Partial<Clip>): TextAnimation {
  return { durationFrames: 15, ...c.textAnimation }
}

function useSelectedTextClip(): Clip | null {
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds)
  const clips = useTracksStore((s) => s.clips)

  if (selectedClipIds.size !== 1) return null
  const [id] = selectedClipIds
  for (const trackClips of Object.values(clips)) {
    const clip = trackClips.find((c) => c.id === id && c.type === 'text')
    if (clip) return clip
  }
  return null
}

const PANEL = 'w-[300px] shrink-0 flex flex-col bg-ed-panel border-l border-ed-border'

function PanelHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div className="px-4 pt-4 pb-3 shrink-0">
      <div className="text-[15px] font-semibold text-ed-text">Properties</div>
      {subtitle && (
        <div className="text-[10px] text-ed-text-muted mt-0.5 font-mono">{subtitle}</div>
      )}
    </div>
  )
}

export function TextClipProperties() {
  const engine = useTimelineEngine()
  const clip = useSelectedTextClip()
  const [local, setLocal] = useState<Partial<Clip>>({})
  const [tab, setTab] = useState<Tab>('style')

  useEffect(() => {
    if (clip) setLocal({})
  }, [clip?.id])

  if (!clip) {
    return (
      <div className={cn(PANEL, 'overflow-hidden')}>
        <PanelHeader />
        <div className="flex-1 flex items-center justify-center p-6 text-center text-xs text-ed-text-muted">
          Select a text clip to edit properties
        </div>
      </div>
    )
  }

  const effective = { ...clip, ...local }

  const commit = (updates: Partial<Clip>) => {
    setLocal((prev) => ({ ...prev, ...updates }))
    engine.updateClip(clip.id, clip.trackId, updates)
  }

  const startSec = (clip.startFrame / 30).toFixed(0)
  const endSec = ((clip.startFrame + clip.durationFrames) / 30).toFixed(0)

  const tf = mergeTransform(effective)
  const setTf = (patch: Partial<ReturnType<typeof mergeTransform>>) =>
    setLocal((p) => ({ ...p, transform: { ...mergeTransform(effective), ...patch } }))
  const commitTf = () => commit({ transform: mergeTransform(effective) })

  return (
    <div className={cn(PANEL, 'overflow-hidden')}>
      <PanelHeader subtitle={`${clip.name} · 0:${startSec.padStart(2, '0')}–0:${endSec.padStart(2, '0')}`} />

      {/* Tabs — active gets a cyan underline (Figma) */}
      <div className="flex items-center gap-4 px-4 border-b border-ed-border shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'relative py-2.5 text-xs transition-colors',
              tab === t.id ? 'text-ed-text' : 'text-ed-text-muted hover:text-ed-text',
            )}
          >
            {t.label}
            {tab === t.id && (
              <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-ed-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tab === 'style' && (
          <>
            <Field label="Text">
              <textarea
                value={effective.content ?? ''}
                onChange={(e) => {
                  setLocal((p) => ({ ...p, content: e.target.value }))
                  engine.previewClip(clip.id, clip.trackId, { content: e.target.value })
                }}
                onBlur={() => engine.commitInteraction('Edit text content')}
                rows={2}
                className={cn(inputCls, 'resize-y min-h-[56px] leading-[1.4]')}
              />
            </Field>

            <Field label="Font">
              <select
                value={effective.fontFamily ?? 'sans-serif'}
                onChange={(e) => commit({ fontFamily: e.target.value })}
                className={cn(inputCls, 'cursor-pointer')}
              >
                {FONTS.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {f === 'sans-serif' ? 'Sans Serif' : f}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Weight">
                <select
                  value={effective.fontWeight ?? 'normal'}
                  onChange={(e) => commit({ fontWeight: e.target.value as 'normal' | 'bold' })}
                  className={cn(inputCls, 'cursor-pointer')}
                >
                  <option value="normal">Regular</option>
                  <option value="bold">Semibold</option>
                </select>
              </Field>
              <Field label="Size">
                <NumberField
                  value={effective.fontSize ?? 48}
                  step={1}
                  min={6}
                  max={4000}
                  suffix="px"
                  onChange={(v) => setLocal((p) => ({ ...p, fontSize: v }))}
                  onCommit={() => {
                    const v = effective.fontSize ?? 48
                    if (v !== (clip.fontSize ?? 48)) commit({ fontSize: v })
                  }}
                />
              </Field>
            </div>

            <Field label="Alignment">
              <div className="flex gap-1.5">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <AlignBtn
                    key={a}
                    value={a}
                    current={effective.textAlign ?? 'center'}
                    onClick={() => commit({ textAlign: a })}
                  />
                ))}
              </div>
            </Field>

            <Field label="Fill">
              <div className="flex gap-1.5 items-center">
                <input
                  type="color"
                  value={effective.color ?? '#ffffff'}
                  onChange={(e) => commit({ color: e.target.value })}
                  className="w-9 h-8 p-0 border border-ed-border rounded-md cursor-pointer bg-transparent shrink-0"
                />
                <input
                  type="text"
                  value={effective.color ?? '#ffffff'}
                  onChange={(e) => setLocal((p) => ({ ...p, color: e.target.value }))}
                  onBlur={() => {
                    const v = effective.color ?? '#ffffff'
                    if (v !== (clip.color ?? '#ffffff')) commit({ color: v })
                  }}
                  className={cn(inputCls, 'font-mono')}
                />
              </div>
            </Field>

            <SliderRow
              label="Opacity"
              value={effective.opacity ?? 1}
              display={`${Math.round((effective.opacity ?? 1) * 100)}%`}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => commit({ opacity: v })}
            />
          </>
        )}

        {tab === 'transform' && (
          <>
            <SliderRow
              label="Scale"
              value={tf.scale}
              display={`${Math.round(tf.scale * 100)}%`}
              min={0.05}
              max={4}
              step={0.01}
              onChange={(v) => setTf({ scale: v })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Position X">
                <NumberField
                  value={Math.round(tf.x * 100)}
                  step={1}
                  suffix="%"
                  onChange={(v) => setTf({ x: v / 100 })}
                  onCommit={commitTf}
                />
              </Field>
              <Field label="Position Y">
                <NumberField
                  value={Math.round(tf.y * 100)}
                  step={1}
                  suffix="%"
                  onChange={(v) => setTf({ y: v / 100 })}
                  onCommit={commitTf}
                />
              </Field>
            </div>
            <Field label="Rotate">
              <NumberField
                value={Math.round((tf.rotation * 180) / Math.PI)}
                step={1}
                suffix="°"
                onChange={(v) => setTf({ rotation: (v * Math.PI) / 180 })}
                onCommit={commitTf}
              />
            </Field>
          </>
        )}

        {tab === 'animate' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fade In">
                <select
                  value={effective.textAnimation?.in ?? 'none'}
                  onChange={(e) => {
                    const val = e.target.value
                    commit({
                      textAnimation: {
                        durationFrames: effective.textAnimation?.durationFrames ?? 15,
                        ...effective.textAnimation,
                        in: val === 'none' ? undefined : (val as TextAnimationKind),
                      },
                    })
                  }}
                  className={cn(inputCls, 'cursor-pointer')}
                >
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                </select>
              </Field>
              <Field label="Fade Out">
                <select
                  value={effective.textAnimation?.out ?? 'none'}
                  onChange={(e) => {
                    const val = e.target.value
                    commit({
                      textAnimation: {
                        durationFrames: effective.textAnimation?.durationFrames ?? 15,
                        ...effective.textAnimation,
                        out: val === 'none' ? undefined : (val as TextAnimationKind),
                      },
                    })
                  }}
                  className={cn(inputCls, 'cursor-pointer')}
                >
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                </select>
              </Field>
            </div>
            {(effective.textAnimation?.in || effective.textAnimation?.out) && (
              <Field label="Duration">
                <NumberField
                  value={effective.textAnimation?.durationFrames ?? 15}
                  step={1}
                  min={1}
                  max={clip.durationFrames}
                  suffix="f"
                  onChange={(v) =>
                    setLocal((p) => ({
                      ...p,
                      textAnimation: { ...mergeAnim(effective), durationFrames: v },
                    }))
                  }
                  onCommit={() => commit({ textAnimation: mergeAnim(effective) })}
                />
              </Field>
            )}
          </>
        )}
      </div>
    </div>
  )
}
