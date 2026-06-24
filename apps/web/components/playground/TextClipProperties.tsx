'use client'

import { useEffect, useState, type ReactNode } from 'react'
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

// Shared input className for all text/select/number inputs
const inputCls =
  'flex-1 bg-ed-bg border border-ed-border rounded-md text-ed-text text-xs font-sans px-2 py-1.5 outline-none'

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-ed-border-subtle">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center justify-between w-full px-3.5 py-2.5 bg-transparent border-none cursor-pointer',
          'text-[10px] font-semibold tracking-[0.08em] uppercase',
          open ? 'text-ed-text-muted' : 'text-ed-text-muted/70'
        )}
      >
        {title}
        <span className="text-[10px] opacity-70">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-3.5 pb-3">{children}</div>}
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2.5">
      <div className="text-[10px] text-ed-text-muted mb-1">{label}</div>
      {children}
    </div>
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
        'flex-1 py-1.5 text-[13px] rounded-md cursor-pointer border',
        active
          ? 'bg-ed-accent-soft text-ed-accent-hover border-ed-accent'
          : 'bg-ed-elevated text-ed-text-muted border-ed-border'
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

export function TextClipProperties() {
  const engine = useTimelineEngine()
  const clip = useSelectedTextClip()
  const [local, setLocal] = useState<Partial<Clip>>({})

  useEffect(() => {
    if (clip) setLocal({})
  }, [clip?.id])

  const panelShell = (
    <div className="w-[300px] shrink-0 flex flex-col bg-ed-panel border-l border-ed-border overflow-hidden">
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-ed-border shrink-0">
        <div className="text-[13px] font-semibold text-ed-text">
          {clip ? clip.name : 'Properties'}
        </div>
        {clip && (
          <div className="text-[10px] text-ed-text-muted mt-1 font-mono">
            Layer · text
          </div>
        )}
      </div>
      {!clip ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center text-xs text-ed-text-muted">
          Select a text clip to edit properties
        </div>
      ) : null}
    </div>
  )

  if (!clip) return panelShell

  const effective = { ...clip, ...local }

  const commit = (updates: Partial<Clip>) => {
    setLocal((prev) => ({ ...prev, ...updates }))
    engine.updateClip(clip.id, clip.trackId, updates)
  }

  const startSec = (clip.startFrame / 30).toFixed(0)
  const endSec = ((clip.startFrame + clip.durationFrames) / 30).toFixed(0)

  return (
    <div className="w-[300px] shrink-0 flex flex-col bg-ed-panel border-l border-ed-border overflow-auto">
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-ed-border shrink-0">
        <div className="text-[13px] font-semibold text-ed-text">{clip.name}</div>
        <div className="text-[10px] text-ed-text-muted mt-1 font-mono">
          0:{startSec.padStart(2, '0')} – 0:{endSec.padStart(2, '0')}
        </div>
      </div>

      <CollapsibleSection title="CONTENT">
        <FieldRow label="Text">
          <textarea
            value={effective.content ?? ''}
            onChange={(e) => {
              setLocal((p) => ({ ...p, content: e.target.value }))
              engine.previewClip(clip.id, clip.trackId, { content: e.target.value })
            }}
            onBlur={() => engine.commitInteraction('Edit text content')}
            rows={2}
            className={cn(inputCls, 'resize-y min-h-[56px] leading-[1.4] border-ed-accent w-full')}
          />
        </FieldRow>
      </CollapsibleSection>

      <CollapsibleSection title="TYPOGRAPHY">
        <FieldRow label="Font Family">
          <select
            value={effective.fontFamily ?? 'sans-serif'}
            onChange={(e) => commit({ fontFamily: e.target.value })}
            className={cn(inputCls, 'cursor-pointer w-full')}
          >
            {FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f === 'sans-serif' ? 'Sans Serif' : f}
              </option>
            ))}
          </select>
        </FieldRow>
        <div className="flex gap-2">
          <FieldRow label="Weight">
            <select
              value={effective.fontWeight ?? 'normal'}
              onChange={(e) => commit({ fontWeight: e.target.value as 'normal' | 'bold' })}
              className={cn(inputCls, 'cursor-pointer w-full')}
            >
              <option value="normal">Regular</option>
              <option value="bold">Semibold</option>
            </select>
          </FieldRow>
          <FieldRow label="Size">
            <input
              type="number"
              min={6}
              max={4000}
              value={effective.fontSize ?? 48}
              onChange={(e) => setLocal((p) => ({ ...p, fontSize: Number(e.target.value) }))}
              onBlur={() => {
                const v = effective.fontSize ?? 48
                if (v !== (clip.fontSize ?? 48)) commit({ fontSize: v })
              }}
              className={cn(inputCls, 'w-full')}
            />
          </FieldRow>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="STYLE">
        <FieldRow label="Alignment">
          <div className="flex gap-1">
            {(['left', 'center', 'right'] as const).map((a) => (
              <AlignBtn
                key={a}
                value={a}
                current={effective.textAlign ?? 'center'}
                onClick={() => commit({ textAlign: a })}
              />
            ))}
          </div>
        </FieldRow>
        <FieldRow label="Fill">
          <div className="flex gap-1.5 items-center">
            <input
              type="color"
              value={effective.color ?? '#ffffff'}
              onChange={(e) => commit({ color: e.target.value })}
              className="w-8 h-7 p-0 border border-ed-border rounded cursor-pointer bg-transparent"
            />
            <input
              type="text"
              value={effective.color ?? '#ffffff'}
              onChange={(e) => setLocal((p) => ({ ...p, color: e.target.value }))}
              onBlur={() => {
                const v = effective.color ?? '#ffffff'
                if (v !== (clip.color ?? '#ffffff')) commit({ color: v })
              }}
              className={cn(inputCls, 'font-mono flex-1')}
            />
          </div>
        </FieldRow>
        <FieldRow label="Opacity">
          <div className="flex items-center gap-2">
            <input
              type="range"
              className="elah-range flex-1"
              min={0}
              max={1}
              step={0.01}
              value={effective.opacity ?? 1}
              onChange={(e) => commit({ opacity: Number(e.target.value) })}
            />
            <span className="text-[10px] text-ed-text-muted font-mono w-9 text-right">
              {Math.round((effective.opacity ?? 1) * 100)}%
            </span>
          </div>
        </FieldRow>
      </CollapsibleSection>

      <CollapsibleSection title="TRANSFORM" defaultOpen={false}>
        <div className="flex gap-2">
          <FieldRow label="X (%)">
            <input
              type="number"
              step={1}
              value={Math.round((effective.transform?.x ?? 0.5) * 100)}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  transform: { ...mergeTransform(effective), x: Number(e.target.value) / 100 },
                }))
              }
              onBlur={() => commit({ transform: mergeTransform(effective) })}
              className={inputCls}
            />
          </FieldRow>
          <FieldRow label="Y (%)">
            <input
              type="number"
              step={1}
              value={Math.round((effective.transform?.y ?? 0.5) * 100)}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  transform: { ...mergeTransform(effective), y: Number(e.target.value) / 100 },
                }))
              }
              onBlur={() => commit({ transform: mergeTransform(effective) })}
              className={inputCls}
            />
          </FieldRow>
        </div>
        <div className="flex gap-2">
          <FieldRow label="Scale">
            <input
              type="number"
              step={0.05}
              min={0.05}
              max={10}
              value={(effective.transform?.scale ?? 1).toFixed(2)}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  transform: { ...mergeTransform(effective), scale: Number(e.target.value) },
                }))
              }
              onBlur={() => commit({ transform: mergeTransform(effective) })}
              className={inputCls}
            />
          </FieldRow>
          <FieldRow label="Rotation (°)">
            <input
              type="number"
              step={1}
              value={Math.round(((effective.transform?.rotation ?? 0) * 180) / Math.PI)}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  transform: {
                    ...mergeTransform(effective),
                    rotation: (Number(e.target.value) * Math.PI) / 180,
                  },
                }))
              }
              onBlur={() => commit({ transform: mergeTransform(effective) })}
              className={inputCls}
            />
          </FieldRow>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="ANIMATION" defaultOpen={false}>
        <FieldRow label="Fade In">
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
            className={cn(inputCls, 'cursor-pointer w-full')}
          >
            <option value="none">None</option>
            <option value="fade">Fade</option>
          </select>
        </FieldRow>
        <FieldRow label="Fade Out">
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
            className={cn(inputCls, 'cursor-pointer w-full')}
          >
            <option value="none">None</option>
            <option value="fade">Fade</option>
          </select>
        </FieldRow>
        {(effective.textAnimation?.in || effective.textAnimation?.out) && (
          <FieldRow label="Duration (frames)">
            <input
              type="number"
              min={1}
              max={clip.durationFrames}
              value={effective.textAnimation?.durationFrames ?? 15}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  textAnimation: { ...mergeAnim(effective), durationFrames: Number(e.target.value) },
                }))
              }
              onBlur={() => commit({ textAnimation: mergeAnim(effective) })}
              className={inputCls}
            />
          </FieldRow>
        )}
      </CollapsibleSection>
    </div>
  )
}
