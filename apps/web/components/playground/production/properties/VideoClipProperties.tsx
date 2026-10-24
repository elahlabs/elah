'use client'

import { useEffect, useMemo, useState } from 'react'
import { Lock, RotateCcw, RotateCw, Unlock } from 'lucide-react'
import {
  useTimelineEngine,
  useMediaLibraryStore,
  normalizeCrop,
  transformFromContainRect,
  type Clip,
  type CropRect,
} from '@elah/editor'
import type { BaselineContext } from '@elah/core'
import { cn } from '@/lib/utils'
import {
  PANEL,
  PanelHeader,
  Field,
  NumberField,
  PresetButton,
  SliderRow,
  radiansToDegrees,
  degreesToRadians,
  rotateBy,
  clipTimecode,
} from './propertiesShared'
import { useKeyframeEditing } from './useKeyframeEditing'
import { AnimatePanel, animatableChannels } from './AnimatePanel'

type Tab = 'transform' | 'crop' | 'style' | 'animate'
const TABS: { id: Tab; label: string }[] = [
  { id: 'transform', label: 'Transform' },
  { id: 'crop', label: 'Crop' },
  { id: 'style', label: 'Style' },
  { id: 'animate', label: 'Animate' },
]

const SPEED_PRESETS = [0.5, 1, 1.5, 2, 4]

/** Crop as four percentage insets from each edge — friendlier to type than raw x/y/w/h. */
type CropInsets = { left: number; right: number; top: number; bottom: number }

function insetsFromCrop(crop: CropRect): CropInsets {
  return {
    left: crop.x * 100,
    top: crop.y * 100,
    right: (1 - crop.x - crop.width) * 100,
    bottom: (1 - crop.y - crop.height) * 100,
  }
}

function cropFromInsets(insets: CropInsets): CropRect {
  return normalizeCrop({
    x: insets.left / 100,
    y: insets.top / 100,
    width: 1 - insets.left / 100 - insets.right / 100,
    height: 1 - insets.top / 100 - insets.bottom / 100,
  })
}

export function VideoClipProperties({ clip }: { clip: Clip }) {
  const engine = useTimelineEngine()
  const assets = useMediaLibraryStore((s) => s.assets)
  const [local, setLocal] = useState<Partial<Clip>>({})
  const [tab, setTab] = useState<Tab>('transform')
  const [lockAspect, setLockAspect] = useState(true)

  useEffect(() => { setLocal({}) }, [clip.id])

  const effective = { ...clip, ...local }

  const commit = (updates: Partial<Clip>) => {
    setLocal((prev) => ({ ...prev, ...updates }))
    engine.updateClip(clip.id, clip.trackId, updates)
  }

  const project = engine.getProject()
  const fps = project.fps
  const stage = project.stage

  const crop = normalizeCrop(effective.crop)

  // A clip with no transform of its own is drawn *contained* in the stage, not
  // at native size — so that contain-equivalent transform, not the identity, is
  // what every field here has to edit from. Without it the first nudge of any
  // value (rotation included) would also resize the media. This is the same
  // baseline `<MediaTransformOverlay>` bakes on the first drag, so the panel and
  // the preview handles agree on what "untouched" means.
  //
  // Content size lives on the imported asset; when it hasn't been probed yet we
  // fall back to the stage, which makes contain a no-op and leaves the old
  // identity behaviour for that one case.
  const asset = clip.assetId ? assets[clip.assetId] : undefined
  const contentW = asset?.width ?? stage.width
  const contentH = asset?.height ?? stage.height
  const containBase = useMemo(
    () =>
      transformFromContainRect(
        contentW * crop.width,
        contentH * crop.height,
        stage.width,
        stage.height,
      ),
    [contentW, contentH, crop.width, crop.height, stage.width, stage.height],
  )

  // Keyframe-aware display and commit. `containBase` doubles as the baseline the
  // first transform key bakes onto the clip, so the panel, the preview handles
  // and the keyframes agree on what "untouched" means.
  const kfCtx: BaselineContext = {
    stage,
    content: asset?.width && asset?.height ? { width: contentW, height: contentH } : undefined,
  }
  const { tf, setTf, commitTf, commitTfPatch, scalar, commitScalar, diamond } = useKeyframeEditing(
    clip,
    local,
    setLocal,
    kfCtx,
    containBase,
  )

  const setWidthPct = (v: number) => {
    const scaleX = v / 100
    setTf(lockAspect ? { scaleX, scaleY: scaleX } : { scaleX })
  }
  const setHeightPct = (v: number) => {
    const scaleY = v / 100
    setTf(lockAspect ? { scaleX: scaleY, scaleY } : { scaleY })
  }

  const rotationDeg = radiansToDegrees(tf.rotation)
  const turn = (deltaDeg: number) => commitTfPatch({ rotation: rotateBy(tf.rotation, deltaDeg) })

  const insets = insetsFromCrop(crop)
  const setInset = (patch: Partial<CropInsets>) =>
    setLocal((p) => ({ ...p, crop: cropFromInsets({ ...insets, ...patch }) }))
  const commitCrop = () => commit({ crop: normalizeCrop(effective.crop) })
  const resetCrop = () => commit({ crop: undefined })

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
        {tab === 'transform' && (
          <>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <Field
                label="Width"
                action={diamond('Size', ['scaleX', 'scaleY'], { scaleX: tf.scaleX, scaleY: tf.scaleY })}
              >
                <NumberField
                  value={Math.round(tf.scaleX * 100)}
                  step={1}
                  min={1}
                  suffix="%"
                  onChange={setWidthPct}
                  onCommit={commitTf}
                />
              </Field>
              <Field label="Height">
                <NumberField
                  value={Math.round(tf.scaleY * 100)}
                  step={1}
                  min={1}
                  suffix="%"
                  onChange={setHeightPct}
                  onCommit={commitTf}
                />
              </Field>
              <button
                type="button"
                title={lockAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                onClick={() => setLockAspect((v) => !v)}
                className="mb-1.5 flex items-center justify-center w-8 h-8 rounded-md border border-ed-border text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated"
              >
                {lockAspect ? <Lock size={13} /> : <Unlock size={13} />}
              </button>
            </div>
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
              {/* Quarter turns first — the reason anyone opens this row is a
                  clip that came in sideways, and that is one click, not a
                  typed angle. The number field below stays for the in-between
                  case (straightening a tilted horizon). */}
              <div className="grid grid-cols-4 gap-1 mb-2">
                <PresetButton onClick={() => turn(-90)} title="Rotate 90° left">
                  <RotateCcw size={12} />
                  90°
                </PresetButton>
                <PresetButton onClick={() => turn(90)} title="Rotate 90° right">
                  <RotateCw size={12} />
                  90°
                </PresetButton>
                <PresetButton onClick={() => turn(180)} title="Rotate 180°">
                  180°
                </PresetButton>
                <PresetButton
                  onClick={() => commitTfPatch({ rotation: 0 })}
                  title="Clear rotation"
                  active={Math.round(rotationDeg) === 0}
                >
                  Reset
                </PresetButton>
              </div>
              <NumberField
                value={Math.round(rotationDeg)}
                step={1}
                suffix="°"
                onChange={(v) => setTf({ rotation: degreesToRadians(v) })}
                onCommit={commitTf}
              />
            </Field>
            <SliderRow
              label="Corner radius"
              action={diamond('Corner radius', ['cornerRadius'], { cornerRadius: scalar('cornerRadius', 0) })}
              value={scalar('cornerRadius', 0)}
              display={scalar('cornerRadius', 0) >= 0.5 ? 'Circle' : `${Math.round(scalar('cornerRadius', 0) * 200)}%`}
              min={0}
              max={0.5}
              step={0.01}
              onChange={(v) => commitScalar('cornerRadius', v)}
            />
          </>
        )}

        {tab === 'crop' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Left">
                <NumberField
                  value={Math.round(insets.left)}
                  step={1}
                  min={0}
                  max={99}
                  suffix="%"
                  onChange={(v) => setInset({ left: v })}
                  onCommit={commitCrop}
                />
              </Field>
              <Field label="Right">
                <NumberField
                  value={Math.round(insets.right)}
                  step={1}
                  min={0}
                  max={99}
                  suffix="%"
                  onChange={(v) => setInset({ right: v })}
                  onCommit={commitCrop}
                />
              </Field>
              <Field label="Top">
                <NumberField
                  value={Math.round(insets.top)}
                  step={1}
                  min={0}
                  max={99}
                  suffix="%"
                  onChange={(v) => setInset({ top: v })}
                  onCommit={commitCrop}
                />
              </Field>
              <Field label="Bottom">
                <NumberField
                  value={Math.round(insets.bottom)}
                  step={1}
                  min={0}
                  max={99}
                  suffix="%"
                  onChange={(v) => setInset({ bottom: v })}
                  onCommit={commitCrop}
                />
              </Field>
            </div>
            <button
              type="button"
              onClick={resetCrop}
              className="w-full mt-1 py-1.5 text-[13px] rounded-md border border-ed-border text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated transition-colors"
            >
              Reset crop
            </button>
          </>
        )}

        {tab === 'style' && (
          <>
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
            {/* Video only — audio clips (separate panel) and image clips (no
                source timeline to speed through) don't get a speed control. */}
            {clip.type === 'video' && (
              <Field label="Speed">
                <div className="flex items-center gap-1">
                  {SPEED_PRESETS.map((speed) => (
                    <PresetButton
                      key={speed}
                      // setClipSpeed goes through the engine directly (not the
                      // local commit() idiom above) — it must recompute
                      // durationFrames atomically with speed, which a plain
                      // Partial<Clip> patch can't express.
                      onClick={() => engine.setClipSpeed(clip.id, clip.trackId, speed)}
                      active={(effective.speed ?? 1) === speed}
                      className="flex-1 font-mono"
                    >
                      {speed}x
                    </PresetButton>
                  ))}
                </div>
              </Field>
            )}
          </>
        )}

        {tab === 'animate' && (
          <AnimatePanel clip={clip} ctx={kfCtx} channels={animatableChannels(clip)} />
        )}
      </div>
    </div>
  )
}
