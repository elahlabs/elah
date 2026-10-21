'use client'

import { useEffect, useState } from 'react'
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  X,
} from 'lucide-react'
import {
  useTimelineEngine,
  useTextStylePresetsStore,
  BUILT_IN_TEXT_STYLE_PRESETS,
  BUILT_IN_TEXT_TEMPLATES,
  TEXT_ANIMATION_KINDS,
  applyTextTemplate,
  type Clip,
  type TextAnimation,
  type TextStylePreset,
  type TextTemplate,
} from '@elah/editor'
import { cn } from '@/lib/utils'
import { useSelectedTextClip } from '../useSelectedTextClip'
import {
  inputCls,
  Field,
  NumberField,
  SliderRow,
  PANEL,
  PanelHeader,
  mergeTransform,
  clipTimecode,
  readAnimationKind,
} from './propertiesShared'

const FONTS = [
  'sans-serif',
  'serif',
  'monospace',
  'Georgia',
  'Impact',
  'Arial',
  'Helvetica',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Times New Roman',
  'Courier New',
  'Palatino',
  'Garamond',
  'Comic Sans MS',
  'cursive',
  'fantasy',
]

/**
 * The two weights this panel and the preset store know. A clip's weight can
 * be 100..900 since the core accepts bundled fonts; a number reads as bold
 * from 600 up, so the select and a saved preset show the nearest keyword.
 */
function keywordWeight(weight: Clip['fontWeight']): 'normal' | 'bold' {
  if (typeof weight === 'number') return weight >= 600 ? 'bold' : 'normal'
  return weight ?? 'normal'
}

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

function PresetChip({
  preset,
  onApply,
  onDelete,
}: {
  preset: TextStylePreset
  onApply: () => void
  onDelete?: () => void
}) {
  return (
    <div className="group relative flex items-center">
      <button
        type="button"
        onClick={onApply}
        title={`Apply "${preset.name}"`}
        className={cn(
          'pl-2.5 py-1 rounded-full border border-ed-border bg-ed-bg text-[12px] text-ed-text-muted hover:text-ed-text hover:border-ed-accent transition-colors',
          onDelete ? 'pr-6' : 'pr-2.5',
        )}
      >
        {preset.name}
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title="Delete preset"
          className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-4 rounded-full text-ed-text-muted opacity-0 group-hover:opacity-100 hover:bg-ed-bg-2 hover:text-ed-text transition-opacity"
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}

function mergeAnim(c: Partial<Clip>): TextAnimation {
  return { durationFrames: 15, ...c.textAnimation }
}

/**
 * Summarize what a template's entry actually does, for the picker subtitle.
 *
 * Derived from the spec's channels rather than stored as a string, so a template
 * whose motion is retuned cannot end up described by a stale label. Reads the
 * entry only: it is the half a viewer notices, and two lines of chip is enough.
 */
function describeMotion(template: TextTemplate): string {
  const spec = template.animation.in
  if (!spec) return ''

  const parts: string[] = []
  if (spec.opacity !== undefined) parts.push('Fade')
  if (spec.offsetY !== undefined) parts.push(spec.offsetY > 0 ? 'Rise' : 'Drop')
  if (spec.offsetX !== undefined) parts.push(spec.offsetX > 0 ? 'From right' : 'From left')
  if (spec.scale !== undefined) parts.push(spec.scale < 1 ? 'Grow' : 'Shrink')
  if (spec.rotation !== undefined) parts.push('Tilt')

  // The curve is the part that makes two otherwise-identical templates feel
  // different, so it is worth surfacing when it is one of the expressive ones.
  const flavour =
    spec.ease === 'back-out' || spec.ease === 'elastic-out'
      ? ' · springy'
      : spec.ease === 'bounce-out'
        ? ' · bouncy'
        : ''

  return parts.join(' + ') + flavour
}

/**
 * One template in the picker. Deliberately describes the motion in words rather
 * than showing a thumbnail: a still image cannot convey an entry/exit, and the
 * clip itself is the preview — applying is one click and undoable, so trying a
 * template IS the preview.
 */
function TemplateCard({
  template,
  onApply,
}: {
  template: TextTemplate
  onApply: () => void
}) {
  const motion = describeMotion(template)

  return (
    <button
      type="button"
      onClick={onApply}
      title={template.description}
      className="w-full text-left px-3 py-2 rounded-md border border-ed-border bg-ed-bg hover:border-ed-accent transition-colors cursor-pointer"
    >
      <div
        className="text-[13px] text-ed-text truncate"
        style={{
          fontFamily: template.style.fontFamily,
          fontWeight: template.style.fontWeight,
          color: template.style.color,
        }}
      >
        {template.name}
      </div>
      {motion && <div className="text-[11px] text-ed-text-muted mt-0.5">{motion}</div>}
    </button>
  )
}

export function TextClipProperties() {
  const engine = useTimelineEngine()
  const clip = useSelectedTextClip()
  const [local, setLocal] = useState<Partial<Clip>>({})
  const [tab, setTab] = useState<Tab>('style')
  const [presetName, setPresetName] = useState('')
  const presets = useTextStylePresetsStore((s) => s.presets)
  const addPreset = useTextStylePresetsStore((s) => s.addPreset)
  const removePreset = useTextStylePresetsStore((s) => s.removePreset)

  useEffect(() => {
    if (clip) setLocal({})
  }, [clip?.id])

  if (!clip) {
    return (
      <div className={cn(PANEL, 'overflow-hidden')}>
        <PanelHeader />
        <div className="flex-1 flex items-center justify-center p-6 text-center text-[13px] text-ed-text-muted">
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

  const fps = engine.getProject().fps

  const tf = mergeTransform(effective)
  const setTf = (patch: Partial<ReturnType<typeof mergeTransform>>) =>
    setLocal((p) => ({ ...p, transform: { ...mergeTransform(effective), ...patch } }))
  const commitTf = () => commit({ transform: mergeTransform(effective) })

  return (
    <div className={cn(PANEL, 'overflow-hidden')}>
      <PanelHeader subtitle={clipTimecode(clip, fps)} />

      {/* Tabs — active gets a cyan underline (Figma) */}
      <div className="flex items-center gap-4 px-4 border-b border-ed-border shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'relative py-2.5 text-[13px] transition-colors',
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
                  value={keywordWeight(effective.fontWeight)}
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

            <Field label="Background">
              <div className="flex gap-1.5 items-center">
                <input
                  type="color"
                  value={effective.backgroundColor ?? '#000000'}
                  onChange={(e) => commit({ backgroundColor: e.target.value })}
                  className="w-9 h-8 p-0 border border-ed-border rounded-md cursor-pointer bg-transparent shrink-0"
                />
                <input
                  type="text"
                  value={effective.backgroundColor ?? ''}
                  placeholder="None"
                  onChange={(e) =>
                    setLocal((p) => ({ ...p, backgroundColor: e.target.value || undefined }))
                  }
                  onBlur={() => {
                    const v = effective.backgroundColor || undefined
                    if (v !== (clip.backgroundColor || undefined)) commit({ backgroundColor: v })
                  }}
                  className={cn(inputCls, 'font-mono')}
                />
                {effective.backgroundColor && (
                  <button
                    type="button"
                    title="Remove background"
                    onClick={() => commit({ backgroundColor: undefined })}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md border border-ed-border text-ed-text-muted hover:text-ed-text hover:border-ed-accent transition-colors"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </Field>

            {effective.backgroundColor && (
              <SliderRow
                label="Background opacity"
                value={effective.backgroundOpacity ?? 1}
                display={`${Math.round((effective.backgroundOpacity ?? 1) * 100)}%`}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => commit({ backgroundOpacity: v })}
              />
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Padding">
                <NumberField
                  value={effective.padding ?? 0}
                  step={1}
                  min={0}
                  max={400}
                  suffix="px"
                  onChange={(v) => setLocal((p) => ({ ...p, padding: v }))}
                  onCommit={() => {
                    const v = effective.padding ?? 0
                    if (v !== (clip.padding ?? 0)) commit({ padding: v })
                  }}
                />
              </Field>
              <Field label="Corner radius">
                <NumberField
                  value={effective.borderRadius ?? 0}
                  step={1}
                  min={0}
                  max={400}
                  suffix="px"
                  onChange={(v) => setLocal((p) => ({ ...p, borderRadius: v }))}
                  onCommit={() => {
                    const v = effective.borderRadius ?? 0
                    if (v !== (clip.borderRadius ?? 0)) commit({ borderRadius: v })
                  }}
                />
              </Field>
            </div>

            <Field label="Border">
              <div className="flex gap-1.5 items-center">
                <input
                  type="color"
                  value={effective.borderColor ?? '#ffffff'}
                  onChange={(e) => commit({ borderColor: e.target.value })}
                  className="w-9 h-8 p-0 border border-ed-border rounded-md cursor-pointer bg-transparent shrink-0"
                />
                <NumberField
                  value={effective.borderWidth ?? 0}
                  step={1}
                  min={0}
                  max={100}
                  suffix="px"
                  onChange={(v) => setLocal((p) => ({ ...p, borderWidth: v }))}
                  onCommit={() => {
                    const v = effective.borderWidth ?? 0
                    if (v !== (clip.borderWidth ?? 0)) commit({ borderWidth: v })
                  }}
                />
              </div>
            </Field>

            <Field label="Style presets">
              <div className="flex flex-wrap gap-1.5 mb-2">
                {BUILT_IN_TEXT_STYLE_PRESETS.map((preset) => (
                  <PresetChip
                    key={preset.id}
                    preset={preset}
                    onApply={() =>
                      commit({
                        fontFamily: preset.fontFamily,
                        fontWeight: preset.fontWeight,
                        fontSize: preset.fontSize,
                        textAlign: preset.textAlign,
                        color: preset.color,
                        opacity: preset.opacity,
                      })
                    }
                  />
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Preset name"
                  className={inputCls}
                />
                <button
                  type="button"
                  disabled={!presetName.trim()}
                  onClick={() => {
                    addPreset({
                      name: presetName.trim(),
                      fontFamily: effective.fontFamily ?? 'sans-serif',
                      fontWeight: keywordWeight(effective.fontWeight),
                      fontSize: effective.fontSize ?? 48,
                      textAlign: effective.textAlign ?? 'center',
                      color: effective.color ?? '#ffffff',
                      opacity: effective.opacity ?? 1,
                    })
                    setPresetName('')
                  }}
                  className="shrink-0 px-3 rounded-md border border-ed-accent bg-ed-accent-soft text-ed-accent-hover text-[13px] disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:opacity-90 transition-opacity"
                >
                  Save
                </button>
              </div>
              {presets.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {presets.map((preset) => (
                    <PresetChip
                      key={preset.id}
                      preset={preset}
                      onApply={() =>
                        commit({
                          fontFamily: preset.fontFamily,
                          fontWeight: preset.fontWeight,
                          fontSize: preset.fontSize,
                          textAlign: preset.textAlign,
                          color: preset.color,
                          opacity: preset.opacity,
                        })
                      }
                      onDelete={() => removePreset(preset.id)}
                    />
                  ))}
                </div>
              )}
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
            <Field label="Templates">
              <div className="grid grid-cols-2 gap-1.5">
                {BUILT_IN_TEXT_TEMPLATES.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    // `applyTextTemplate` reads the CLIP, not `effective`, so the
                    // ramp is resolved against the clip's real length on the
                    // timeline. Committing the whole patch in one `updateClip`
                    // keeps it a single undo step.
                    onApply={() => commit(applyTextTemplate(template, clip))}
                  />
                ))}
              </div>
              <div className="text-[11px] text-ed-text-muted mt-1.5">
                Applying a template replaces the clip’s look and motion. Your text is kept.
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Entry">
                <select
                  value={effective.textAnimation?.in ?? 'none'}
                  onChange={(e) => {
                    const val = readAnimationKind(e.target.value)
                    commit({
                      textAnimation: {
                        durationFrames: effective.textAnimation?.durationFrames ?? 15,
                        ...effective.textAnimation,
                        in: val,
                      },
                    })
                  }}
                  className={cn(inputCls, 'cursor-pointer')}
                >
                  <option value="none">None</option>
                  {TEXT_ANIMATION_KINDS.map((option) => (
                    <option key={option.kind} value={option.kind}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Exit">
                <select
                  value={effective.textAnimation?.out ?? 'none'}
                  onChange={(e) => {
                    const val = readAnimationKind(e.target.value)
                    commit({
                      textAnimation: {
                        durationFrames: effective.textAnimation?.durationFrames ?? 15,
                        ...effective.textAnimation,
                        out: val,
                      },
                    })
                  }}
                  className={cn(inputCls, 'cursor-pointer')}
                >
                  <option value="none">None</option>
                  {TEXT_ANIMATION_KINDS.map((option) => (
                    <option key={option.kind} value={option.kind}>
                      {option.label}
                    </option>
                  ))}
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
