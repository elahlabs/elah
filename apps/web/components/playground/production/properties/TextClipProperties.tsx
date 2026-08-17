'use client'

import { useEffect, useState } from 'react'
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Activity,
} from 'lucide-react'
import {
  useSelectionStore,
  useTracksStore,
  useTimelineEngine,
  type Clip,
  type AnimationDirection,
  type AnimationEasing,
  type TextAnimationKind,
  type TextLoopAnimationKind,
  type TextAnimation,
} from '@elah/editor'
import { cn } from '@/lib/utils'
import {
  inputCls,
  Field,
  NumberField,
  SliderRow,
  PANEL,
  PanelHeader,
  mergeTransform,
} from './propertiesShared'

const FONTS = ['sans-serif', 'serif', 'monospace', 'Georgia', 'Impact']

type Tab = 'style' | 'transform' | 'animate'
const TABS: { id: Tab; label: string }[] = [
  { id: 'style', label: 'Style' },
  { id: 'transform', label: 'Transform' },
  { id: 'animate', label: 'Animate' },
]

function AlignBtn({
  value,
  current,
  onClick,
}: {
  value: 'left' | 'center' | 'right'
  current: string
  onClick: () => void
}) {
  const Icon = value === 'left' ? AlignLeft : value === 'right' ? AlignRight : AlignCenter
  const active = current === value
  return (
    <button
      type="button"
      title={`Align ${value}`}
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center py-1.5 rounded-md cursor-pointer border transition-colors',
        active
          ? 'bg-ed-accent-soft text-ed-accent-hover border-ed-accent'
          : 'bg-ed-bg text-ed-text-muted border-ed-border hover:text-ed-text',
      )}
    >
      <Icon size={15} />
    </button>
  )
}

function mergeAnim(c: Partial<Clip>): TextAnimation {
  return { durationFrames: 15, easing: 'ease-out', direction: 'up', ...c.textAnimation }
}

const PHASE_PRESETS: Array<{ value: TextAnimationKind | 'none'; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide', label: 'Slide' },
  { value: 'pop', label: 'Pop' },
  { value: 'typewriter', label: 'Typewriter' },
]

const DIRECTIONS: Array<{ value: AnimationDirection; label: string }> = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
]

const EASINGS: Array<{ value: AnimationEasing; label: string }> = [
  { value: 'ease-out', label: 'Ease Out' },
  { value: 'ease-in-out', label: 'Ease In Out' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'linear', label: 'Linear' },
]

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

  const commitAnimation = (patch: Partial<TextAnimation>) => {
    const next = { ...mergeAnim(effective), ...patch }
    commit({
      textAnimation: next.in || next.out || next.loop ? next : undefined,
    })
  }

  const previewAnimation = (patch: Partial<TextAnimation>) => {
    const next = { ...mergeAnim(effective), ...patch }
    setLocal((prev) => ({ ...prev, textAnimation: next }))
    engine.previewClip(clip.id, clip.trackId, { textAnimation: next })
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
            <div className="mb-4 flex items-start gap-2.5 rounded-md border border-ed-border bg-ed-bg px-3 py-2.5">
              <Activity size={14} className="mt-0.5 shrink-0 text-ed-accent-dim" />
              <div>
                <div className="text-[11px] font-medium text-ed-text">Clip-relative motion</div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-ed-text-muted">
                  Presets use integer frames, so preview, scrubbing, and export stay identical.
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Entrance">
                <select
                  value={effective.textAnimation?.in ?? 'none'}
                  onChange={(e) => {
                    const value = e.target.value as TextAnimationKind | 'none'
                    commitAnimation({ in: value === 'none' ? undefined : value })
                  }}
                  className={cn(inputCls, 'cursor-pointer')}
                >
                  {PHASE_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>{preset.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Exit">
                <select
                  value={effective.textAnimation?.out ?? 'none'}
                  onChange={(e) => {
                    const value = e.target.value as TextAnimationKind | 'none'
                    commitAnimation({ out: value === 'none' ? undefined : value })
                  }}
                  className={cn(inputCls, 'cursor-pointer')}
                >
                  {PHASE_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>{preset.label}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {effective.textAnimation?.in && (
                <Field label="Entrance Duration">
                  <NumberField
                    value={effective.textAnimation.inDurationFrames ?? effective.textAnimation.durationFrames}
                    step={1}
                    min={1}
                    max={clip.durationFrames}
                    suffix="f"
                    onChange={(value) => previewAnimation({ inDurationFrames: value })}
                    onCommit={() => engine.commitInteraction('Edit text animation')}
                  />
                </Field>
              )}
              {effective.textAnimation?.out && (
                <Field label="Exit Duration">
                  <NumberField
                    value={effective.textAnimation.outDurationFrames ?? effective.textAnimation.durationFrames}
                    step={1}
                    min={1}
                    max={clip.durationFrames}
                    suffix="f"
                    onChange={(value) => previewAnimation({ outDurationFrames: value })}
                    onCommit={() => engine.commitInteraction('Edit text animation')}
                  />
                </Field>
              )}
            </div>

            {(effective.textAnimation?.in === 'slide' || effective.textAnimation?.out === 'slide') && (
              <Field label="Direction">
                <div className="grid grid-cols-4 gap-1.5">
                  {DIRECTIONS.map((direction) => {
                    const active = (effective.textAnimation?.direction ?? 'up') === direction.value
                    return (
                      <button
                        key={direction.value}
                        type="button"
                        onClick={() => commitAnimation({ direction: direction.value })}
                        className={cn(
                          'rounded-md border px-2 py-1.5 text-[11px] transition-colors',
                          active
                            ? 'border-ed-accent bg-ed-accent-soft text-ed-accent-hover'
                            : 'border-ed-border bg-ed-bg text-ed-text-muted hover:text-ed-text',
                        )}
                      >
                        {direction.label}
                      </button>
                    )
                  })}
                </div>
              </Field>
            )}

            {(effective.textAnimation?.in || effective.textAnimation?.out) && (
              <Field label="Easing">
                <select
                  value={effective.textAnimation.easing ?? 'ease-out'}
                  onChange={(e) => commitAnimation({ easing: e.target.value as AnimationEasing })}
                  className={cn(inputCls, 'cursor-pointer')}
                >
                  {EASINGS.map((easing) => (
                    <option key={easing.value} value={easing.value}>{easing.label}</option>
                  ))}
                </select>
              </Field>
            )}

            <div className="my-4 border-t border-ed-border-subtle" />

            <div className="grid grid-cols-2 gap-3">
              <Field label="Loop">
                <select
                  value={effective.textAnimation?.loop ?? 'none'}
                  onChange={(e) => {
                    const value = e.target.value as TextLoopAnimationKind | 'none'
                    commitAnimation({ loop: value === 'none' ? undefined : value })
                  }}
                  className={cn(inputCls, 'cursor-pointer')}
                >
                  <option value="none">None</option>
                  <option value="pulse">Pulse</option>
                </select>
              </Field>
              {effective.textAnimation?.loop && (
                <Field label="Loop Duration">
                  <NumberField
                    value={effective.textAnimation.loopDurationFrames ?? 30}
                    step={1}
                    min={2}
                    max={clip.durationFrames}
                    suffix="f"
                    onChange={(value) => previewAnimation({ loopDurationFrames: value })}
                    onCommit={() => engine.commitInteraction('Edit text animation')}
                  />
                </Field>
              )}
            </div>

            <div className="mt-1 text-[10px] leading-relaxed text-ed-text-muted">
              Custom opacity, position, scale, and rotation keyframes are available through the SDK. Visual keyframe lanes will follow in the timeline editor.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
