import { useEffect, useState } from 'react'
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react'
import {
  useSelectionStore,
  useTracksStore,
  useTimelineEngine,
  type Clip,
  type TextAnimationKind,
  type TextAnimation,
} from '@elah/editor'
import { cn } from '../../utils'
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
