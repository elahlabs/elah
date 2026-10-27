'use client'

import { useEffect, useState } from 'react'
import {
  useSelectionStore,
  useTracksStore,
  useTimelineEngine,
  TEXT_ANIMATION_KINDS,
  type Clip,
  type TextAnimation,
} from '@elah/editor'
import type { BaselineContext } from '@elah/core'
import { cn } from '@/lib/utils'
import {
  inputCls,
  Field,
  NumberField,
  SliderRow,
  PANEL,
  PanelHeader,
  clipTimecode,
  readAnimationKind,
} from './propertiesShared'
import { useKeyframeEditing } from './useKeyframeEditing'
import { AnimatePanel, animatableChannels } from './AnimatePanel'

/**
 * Shapes offer every kind except the text-only ones. `spin` is excluded because
 * no shape painter reads `transform.rotation`, so offering it would render a
 * control that silently does nothing — see the catalogue in
 * core/src/resolver/textAnimation.ts.
 */
const SHAPE_ANIMATION_KINDS = TEXT_ANIMATION_KINDS.filter((o) => o.appliesTo === 'both')

type Tab = 'style' | 'transform' | 'animate'
const TABS: { id: Tab; label: string }[] = [
  { id: 'style', label: 'Style' },
  { id: 'transform', label: 'Transform' },
  { id: 'animate', label: 'Animate' },
]

function mergeAnim(c: Partial<Clip>): TextAnimation {
  return { durationFrames: 15, ...c.shapeAnimation }
}

function useSelectedShapeClip(): Clip | null {
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds)
  const clips = useTracksStore((s) => s.clips)

  if (selectedClipIds.size !== 1) return null
  const [id] = selectedClipIds
  for (const trackClips of Object.values(clips)) {
    const clip = trackClips.find((c) => c.id === id && c.type === 'shape')
    if (clip) return clip
  }
  return null
}

export function ShapeClipProperties() {
  const engine = useTimelineEngine()
  const clip = useSelectedShapeClip()
  const [local, setLocal] = useState<Partial<Clip>>({})
  const [tab, setTab] = useState<Tab>('style')

  useEffect(() => {
    if (clip) setLocal({})
  }, [clip?.id])

  if (!clip) {
    return (
      <div className={cn(PANEL, 'overflow-hidden')}>
        <PanelHeader />
        <div className="flex-1 flex items-center justify-center p-6 text-center text-[13px] text-ed-text-muted">
          Select a shape clip to edit properties
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

  // Keyframe-aware display and commit. A shape draws at the identity placement,
  // so no baseline transform is needed.
  const kfCtx: BaselineContext = { stage: engine.getProject().stage }
  const { tf, setTf, commitTf, commitTfPatch, scalar, commitScalar, diamond } = useKeyframeEditing(
    clip,
    local,
    setLocal,
    kfCtx,
  )

  return (
    <div className={cn(PANEL, 'overflow-hidden')}>
      <PanelHeader subtitle={clipTimecode(clip, fps)} />

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
            <Field label="Fill">
              <div className="flex gap-1.5 items-center">
                <input
                  type="color"
                  value={
                    !effective.shapeFill || effective.shapeFill === 'transparent'
                      ? '#000000'
                      : effective.shapeFill
                  }
                  onChange={(e) => commit({ shapeFill: e.target.value })}
                  className="w-9 h-8 p-0 border border-ed-border rounded-md cursor-pointer bg-transparent shrink-0"
                />
                <input
                  type="text"
                  value={effective.shapeFill ?? 'transparent'}
                  onChange={(e) => setLocal((p) => ({ ...p, shapeFill: e.target.value }))}
                  onBlur={() => {
                    const v = effective.shapeFill ?? 'transparent'
                    if (v !== (clip.shapeFill ?? 'transparent')) commit({ shapeFill: v })
                  }}
                  className={cn(inputCls, 'font-mono')}
                />
              </div>
            </Field>

            <Field label="Stroke">
              <div className="flex gap-1.5 items-center">
                <input
                  type="color"
                  value={
                    !effective.shapeStroke || effective.shapeStroke === 'transparent'
                      ? '#ffffff'
                      : effective.shapeStroke
                  }
                  onChange={(e) => commit({ shapeStroke: e.target.value })}
                  className="w-9 h-8 p-0 border border-ed-border rounded-md cursor-pointer bg-transparent shrink-0"
                />
                <input
                  type="text"
                  value={effective.shapeStroke ?? '#ffffff'}
                  onChange={(e) => setLocal((p) => ({ ...p, shapeStroke: e.target.value }))}
                  onBlur={() => {
                    const v = effective.shapeStroke ?? '#ffffff'
                    if (v !== (clip.shapeStroke ?? '#ffffff')) commit({ shapeStroke: v })
                  }}
                  className={cn(inputCls, 'font-mono')}
                />
              </div>
            </Field>

            <Field label="Stroke Width">
              <NumberField
                value={effective.shapeStrokeWidth ?? 2}
                step={1}
                min={0}
                max={100}
                suffix="px"
                onChange={(v) => setLocal((p) => ({ ...p, shapeStrokeWidth: v }))}
                onCommit={() => {
                  const v = effective.shapeStrokeWidth ?? 2
                  if (v !== (clip.shapeStrokeWidth ?? 2)) commit({ shapeStrokeWidth: v })
                }}
              />
            </Field>

            <SliderRow
              label="Opacity"
              action={diamond('Opacity', ['opacity'], { opacity: scalar('opacity', 1) })}
              value={scalar('opacity', 1)}
              display={`${Math.round(scalar('opacity', 1) * 100)}%`}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => commitScalar('opacity', v)}
            />
          </>
        )}

        {tab === 'transform' && (
          <>
            <SliderRow
              label="Scale"
              action={diamond('Scale', ['scale'], { scale: tf.scale })}
              value={tf.scale}
              display={`${Math.round(tf.scale * 100)}%`}
              min={0.05}
              max={4}
              step={0.01}
              // A slider has no blur to defer to; commit each change.
              onChange={(v) => commitTfPatch({ scale: v })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Position X" action={diamond('Position', ['x', 'y'], { x: tf.x, y: tf.y })}>
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
            <Field label="Rotate" action={diamond('Rotation', ['rotation'], { rotation: tf.rotation })}>
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
          <AnimatePanel
            clip={clip}
            ctx={kfCtx}
            channels={animatableChannels(clip)}
            legacy={
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Entry">
                <select
                  value={effective.shapeAnimation?.in ?? 'none'}
                  onChange={(e) => {
                    const val = readAnimationKind(e.target.value)
                    commit({
                      shapeAnimation: {
                        durationFrames: effective.shapeAnimation?.durationFrames ?? 15,
                        ...effective.shapeAnimation,
                        in: val,
                      },
                    })
                  }}
                  className={cn(inputCls, 'cursor-pointer')}
                >
                  <option value="none">None</option>
                  {SHAPE_ANIMATION_KINDS.map((option) => (
                    <option key={option.kind} value={option.kind}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Exit">
                <select
                  value={effective.shapeAnimation?.out ?? 'none'}
                  onChange={(e) => {
                    const val = readAnimationKind(e.target.value)
                    commit({
                      shapeAnimation: {
                        durationFrames: effective.shapeAnimation?.durationFrames ?? 15,
                        ...effective.shapeAnimation,
                        out: val,
                      },
                    })
                  }}
                  className={cn(inputCls, 'cursor-pointer')}
                >
                  <option value="none">None</option>
                  {SHAPE_ANIMATION_KINDS.map((option) => (
                    <option key={option.kind} value={option.kind}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {(effective.shapeAnimation?.in || effective.shapeAnimation?.out) && (
              <Field label="Duration">
                <NumberField
                  value={effective.shapeAnimation?.durationFrames ?? 15}
                  step={1}
                  min={1}
                  max={clip.durationFrames}
                  suffix="f"
                  onChange={(v) =>
                    setLocal((p) => ({
                      ...p,
                      shapeAnimation: { ...mergeAnim(effective), durationFrames: v },
                    }))
                  }
                  onCommit={() => commit({ shapeAnimation: mergeAnim(effective) })}
                />
              </Field>
            )}
          </>
            }
          />
        )}
      </div>
    </div>
  )
}
