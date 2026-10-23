'use client'

import { useState } from 'react'
import { usePlaybackStore, useTimelineEngine } from '@elah/editor'
import {
  applyMotionPreset,
  clearAllKeyframes,
  keyFrameUnion,
  keyedChannels,
  channelKeys,
  moveKeysAtFrame,
  nextKeyFrame,
  prevKeyFrame,
  removeKeysAtFrame,
  setKeysEasingAtFrame,
  setKeysBezierAtFrame,
  setKeysHoldAtFrame,
  setKeysSpringAtFrame,
  setKeysStepsAtFrame,
  repeatKeysPatch,
  isValidSteps,
  BEZIER_PRESETS,
  findBezierPreset,
  matchBezierPreset,
  SPRING_PRESETS,
  findSpringPreset,
  matchSpringPreset,
  TEXT_ANIMATION_EASINGS,
  fadeChannelFor,
  presetsFor,
  expressionChannels,
  BEAT_PRESETS,
  applyBeatPreset,
  localBeatsInClip,
  type BaselineContext,
  type Clip,
  type Keyframe,
  type KeyframeChannel,
  type MotionPresetName,
  type MotionPresetOption,
  type BeatPresetName,
  type TextAnimationEasing,
} from '@elah/core'
import { ChevronLeft, ChevronRight, Diamond, Square, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { clampLocalFrame } from '@/lib/editor/keyframeEdit'
import { Field, inputCls } from './propertiesShared'
import { ExpressionRows } from './ExpressionRows'
import { MotionPathSection } from './MotionPathSection'

/**
 * `<AnimatePanel>` — the one animation surface, shared by every clip type.
 *
 * Until this existed, "animating" meant two dropdowns on text and shapes
 * (Entry / Exit / Duration) and nothing at all on video and images. Those
 * dropdowns write `textAnimation`, a ramp the resolver layers on separately:
 * invisible on the timeline, not editable per-frame, and unavailable to media
 * clips. The panel replaces them with the real thing — keyframes — and works
 * identically for video, image, text, shape and audio, because a keyframe is an
 * ordinary clip field that every renderer already honours.
 *
 * Three bands, in the order someone actually works:
 *   1. Presets — one click writes real keys (`applyMotionPreset`), which is
 *      also why no separate transition pipeline is needed for elements: a fade
 *      between two graphics is an opacity key on each.
 *   2. Keyframes — the frames that carry keys, with the playhead's own frame
 *      called out, prev/next navigation, a per-frame easing picker and delete.
 *   3. Channels — which properties are animated, and a way to clear them.
 *
 * Every write goes through `engine.updateClip`, so it is one undo entry and the
 * preview and export agree by construction.
 */

export interface AnimatePanelProps {
  clip: Clip
  ctx: BaselineContext
  /**
   * Channels this clip type can animate. Audio gets `volume` only; media and
   * graphics get the transform channels. Purely a display filter — the writers
   * never care.
   */
  channels: ReadonlyArray<KeyframeChannel>
  /** Rendered above the presets: the legacy Entry/Exit selects, where they still apply. */
  legacy?: React.ReactNode
}

const CHANNEL_LABELS: Record<KeyframeChannel, string> = {
  x: 'Position X',
  y: 'Position Y',
  scale: 'Scale',
  scaleX: 'Width',
  scaleY: 'Height',
  rotation: 'Rotation',
  skewX: 'Skew X',
  skewY: 'Skew Y',
  rotateX: 'Tilt X (3D)',
  rotateY: 'Tilt Y (3D)',
  opacity: 'Opacity',
  volume: 'Volume',
  cornerRadius: 'Corner radius',
}

/** Preset sections in panel order. Whole-clip groups span the clip; enter/exit touch one end. */
const PRESET_GROUPS: ReadonlyArray<{ id: MotionPresetOption['group']; label: string; hint: string }> = [
  { id: 'enter', label: 'Enter', hint: 'animates the start of the clip' },
  { id: 'exit', label: 'Exit', hint: 'animates the end of the clip' },
  { id: 'camera', label: 'Camera', hint: 'moves across the whole clip; replaces keys on its channels' },
  { id: 'shake', label: 'Shake', hint: 'jitters the whole clip; replaces keys on its channels' },
  { id: 'impact', label: 'Impact', hint: 'a hit at the start that settles' },
]

/** Frames as `1:04` at the project's rate — the same shape `clipTimecode` uses. */
/** Named-easing families, in picker order. A name belongs to the family it starts with. */
const EASE_FAMILIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'sine', label: 'Sine' },
  { id: 'quad', label: 'Quad' },
  { id: 'cubic', label: 'Cubic' },
  { id: 'quart', label: 'Quart' },
  { id: 'quint', label: 'Quint' },
  { id: 'expo', label: 'Expo' },
  { id: 'circ', label: 'Circ' },
  { id: 'back', label: 'Back' },
  { id: 'elastic', label: 'Elastic' },
  { id: 'bounce', label: 'Bounce' },
]

function frameLabel(frame: number, fps: number): string {
  const totalSec = frame / fps
  const s = Math.floor(totalSec)
  const f = Math.round((totalSec - s) * fps)
  return `${s}:${String(f).padStart(2, '0')}`
}

export function AnimatePanel({ clip, ctx, channels, legacy }: AnimatePanelProps) {
  const engine = useTimelineEngine()
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)
  const fps = engine.getProject().fps

  const localFrame = clampLocalFrame(clip, currentFrame)
  const frames = keyFrameUnion(clip)
  const animated = keyedChannels(clip).filter((c) => channels.includes(c))
  const prev = prevKeyFrame(clip, localFrame)
  const next = nextKeyFrame(clip, localFrame)
  // Only presets whose channels this clip type actually has. An audio clip
  // gets the two fades (on its volume, not an opacity it does not have) and
  // none of the slides.
  const presets = presetsFor(channels, fadeChannelFor(clip.type))

  const write = (patch: Partial<Clip>) => {
    if (Object.keys(patch).length === 0) return
    engine.updateClip(clip.id, clip.trackId, patch)
  }
  /** Keys are clip-relative; the playhead is absolute. */
  const seekLocal = (frame: number) => setCurrentFrame(clip.startFrame + frame)

  // Strength of the camera / shake / impact presets. Enter/exit presets ignore it.
  const [amount, setAmount] = useState(1)
  // The Expressions band is collapsed until asked for — UNLESS the clip already
  // has an expression, which must not be hidden behind an "Add" button: the
  // author would have no way to see or remove what they already wrote.
  const [showExpressions, setShowExpressions] = useState(false)
  const hasExpression = expressionChannels(clip).some((c) => (channels as ReadonlyArray<string>).includes(c))
  const expressionsOpen = showExpressions || hasExpression
  const hasWholeClip = presets.some((p) => p.end === 'whole')
  const groups = PRESET_GROUPS.map((g) => ({ ...g, items: presets.filter((p) => p.group === g.id) })).filter(
    (g) => g.items.length > 0,
  )
  // Beat presets key on detected beats, not the fade/scale channels above:
  // every clip that can animate at all gets the Beat group, except audio
  // (which has no picture and no scale/x/y to key).
  const showBeatGroup = clip.type !== 'audio'
  const localBeats = showBeatGroup ? localBeatsInClip(engine.getProject(), clip) : []

  const applyPreset = (name: MotionPresetName) => {
    write(applyMotionPreset(clip, name, { amount }, ctx))
  }
  const applyBeat = (name: BeatPresetName) => {
    write(applyBeatPreset(clip, name, localBeats, { amount }, ctx).patch)
  }

  const keyAt = (frame: number): Keyframe | undefined => {
    // MOT-1: `motion.progress` is not one of the nine display channels but its keys take curves like any other.
    for (const channel of [...animated, 'motion.progress' as const]) {
      const key = channelKeys(clip, channel).find((k) => k.frame === frame)
      if (key) return key
    }
    return undefined
  }
  /**
   * Select value for the curve driving the segment into `key`: `sp:<id>` for a
   * spring, then `bz:<id>` for a preset bezier, then `bz:custom`, else the
   * named easing. The `sp:` prefix is what keeps a spring named "Snappy" and a
   * bezier preset named "Snappy" apart in one `<select>`.
   */
  const curveValue = (key: Keyframe | undefined): string => {
    if (!key) return 'linear'
    if (key.spring) return `sp:${matchSpringPreset(key.spring)?.id ?? 'custom'}`
    if (key.easingBezier) return `bz:${matchBezierPreset(key.easingBezier)?.id ?? 'custom'}`
    if (isValidSteps(key.steps)) return `st:${key.steps}`
    return key.easing
  }
  const writeCurve = (frame: number, value: string) => {
    if (value.startsWith('st:')) {
      const n = Number(value.slice(3))
      if (isValidSteps(n)) write(setKeysStepsAtFrame(clip, frame, n))
      return
    }
    if (value.startsWith('sp:')) {
      const preset = findSpringPreset(value.slice(3))
      // 'sp:custom' is a display-only option: there is no spring editor, so
      // picking it is a no-op rather than clearing the key's curve.
      if (preset) write(setKeysSpringAtFrame(clip, frame, preset.spring))
      return
    }
    if (value.startsWith('bz:')) {
      const preset = findBezierPreset(value.slice(3))
      if (preset) write(setKeysBezierAtFrame(clip, frame, preset.bezier))
      return
    }
    write(setKeysEasingAtFrame(clip, frame, value as TextAnimationEasing))
  }

  return (
    <>
      {legacy}

      {(groups.length > 0 || showBeatGroup) && (
      <Field label="Presets">
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.id}>
              <div
                className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ed-text-muted"
                title={group.hint}
              >
                {group.label}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {group.items.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => applyPreset(preset.name)}
                    title={`${preset.label} — ${group.hint}. Writes keyframes you can then edit below.`}
                    className="px-2 py-1.5 rounded-md text-[12px] text-ed-text-muted hover:text-ed-text bg-ed-elevated hover:bg-ed-highest border border-ed-border transition-colors text-left truncate"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {showBeatGroup && (
            <div>
              <div
                className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ed-text-muted"
                title={
                  localBeats.length === 0
                    ? 'Detect beats on the music first (select the audio clip → Beats)'
                    : 'keys on every detected beat'
                }
              >
                Beat
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {BEAT_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    disabled={localBeats.length === 0}
                    onClick={() => applyBeat(preset.name)}
                    title={`${preset.label} — ${preset.hint}. Writes keyframes you can then edit below.`}
                    className={cn(
                      'px-2 py-1.5 rounded-md text-[12px] bg-ed-elevated border border-ed-border transition-colors text-left truncate',
                      localBeats.length === 0
                        ? 'text-ed-text-muted/40 cursor-not-allowed'
                        : 'text-ed-text-muted hover:text-ed-text hover:bg-ed-highest',
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(hasWholeClip || showBeatGroup) && (
            <label className="flex items-center gap-2 text-[12px] text-ed-text-muted">
              <span className="shrink-0">Amount</span>
              <input
                type="range"
                min={0.25}
                max={3}
                step={0.25}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                aria-label="Camera and shake preset amount"
                className="flex-1 accent-ed-accent"
              />
              <span className="w-9 text-right tabular-nums text-ed-text">{amount.toFixed(2)}×</span>
            </label>
          )}
        </div>
      </Field>
      )}

      <Field
        label="Keyframes"
        action={
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              disabled={prev === undefined}
              onClick={() => prev !== undefined && seekLocal(prev)}
              title="Previous keyframe"
              aria-label="Previous keyframe"
              className={cn(
                'w-5 h-5 -my-1 flex items-center justify-center rounded transition-colors',
                prev === undefined
                  ? 'text-ed-text-muted/30 cursor-not-allowed'
                  : 'text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated',
              )}
            >
              <ChevronLeft size={13} />
            </button>
            <button
              type="button"
              disabled={next === undefined}
              onClick={() => next !== undefined && seekLocal(next)}
              title="Next keyframe"
              aria-label="Next keyframe"
              className={cn(
                'w-5 h-5 -my-1 flex items-center justify-center rounded transition-colors',
                next === undefined
                  ? 'text-ed-text-muted/30 cursor-not-allowed'
                  : 'text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated',
              )}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        }
      >
        {frames.length === 0 ? (
          <p className="text-[12px] text-ed-text-muted leading-[1.5]">
            No keyframes yet. Apply a preset above, or click the diamond beside any
            property to key it at the playhead.
          </p>
        ) : (
          <div className="rounded-md border border-ed-border divide-y divide-ed-border overflow-hidden">
            {frames.map((frame) => {
              const onPlayhead = frame === localFrame
              const key = keyAt(frame)
              const keySteps = key?.steps
              return (
                <div
                  key={frame}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 transition-colors',
                    onPlayhead ? 'bg-ed-elevated' : 'hover:bg-ed-elevated/50',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => seekLocal(frame)}
                    title={`Go to frame ${frame}`}
                    className="flex items-center gap-1.5 shrink-0 text-ed-accent"
                  >
                    <Diamond
                      size={10}
                      strokeWidth={2}
                      fill={onPlayhead ? 'currentColor' : 'none'}
                      aria-hidden
                    />
                    <span className="text-[11px] font-mono tabular-nums text-ed-text">
                      {frameLabel(frame, fps)}
                    </span>
                  </button>

                  <select
                    value={curveValue(key)}
                    onChange={(e) => writeCurve(frame, e.target.value)}
                    title="Curve of the segment arriving at this keyframe"
                    className="flex-1 min-w-0 bg-transparent text-[11px] text-ed-text-muted hover:text-ed-text cursor-pointer outline-none"
                  >
                    <optgroup label="Curves">
                      {BEZIER_PRESETS.map((p) => (
                        <option key={p.id} value={`bz:${p.id}`}>
                          {p.label}
                        </option>
                      ))}
                      {curveValue(key) === 'bz:custom' && <option value="bz:custom">Custom curve</option>}
                    </optgroup>
                    <optgroup label="Springs">
                      {SPRING_PRESETS.map((p) => (
                        <option key={p.id} value={`sp:${p.id}`}>
                          {p.label}
                        </option>
                      ))}
                      {curveValue(key) === 'sp:custom' && <option value="sp:custom">Custom spring</option>}
                    </optgroup>
                    <optgroup label="Linear">
                      <option value="linear">linear</option>
                    </optgroup>
                    {EASE_FAMILIES.map((fam) => (
                      <optgroup key={fam.id} label={fam.label}>
                        {TEXT_ANIMATION_EASINGS.filter((name) => name.startsWith(`${fam.id}-`)).map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <optgroup label="Steps">
                      {[2, 3, 4, 6, 8, 12].map((n) => (
                        <option key={n} value={`st:${n}`}>
                          Steps {n}
                        </option>
                      ))}
                      {isValidSteps(keySteps) && ![2, 3, 4, 6, 8, 12].includes(keySteps) && (
                        <option value={`st:${keySteps}`}>Steps {keySteps}</option>
                      )}
                    </optgroup>
                  </select>
                  {isValidSteps(keySteps) && (
                    <input
                      type="number"
                      min={1}
                      max={64}
                      step={1}
                      value={keySteps}
                      onChange={(e) => {
                        const n = Math.round(Number(e.target.value))
                        if (isValidSteps(n)) write(setKeysStepsAtFrame(clip, frame, n))
                      }}
                      title="Number of steps (1 to 64)"
                      aria-label="Number of steps"
                      className="w-9 shrink-0 bg-transparent text-[11px] text-ed-text tabular-nums outline-none border-b border-ed-border"
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => write(setKeysHoldAtFrame(clip, frame, !key?.hold))}
                    title={key?.hold ? 'Hold is on: the value steps at the next keyframe' : 'Hold this value until the next keyframe'}
                    aria-label="Toggle hold"
                    aria-pressed={!!key?.hold}
                    className={cn(
                      'w-5 h-5 shrink-0 flex items-center justify-center rounded transition-colors',
                      key?.hold ? 'text-ed-accent bg-ed-highest' : 'text-ed-text-muted hover:text-ed-text hover:bg-ed-highest',
                    )}
                  >
                    <Square size={10} strokeWidth={2.5} fill={key?.hold ? 'currentColor' : 'none'} />
                  </button>

                  {/* Nudging by a frame is the edit that matters in a panel;
                      dragging is the timeline's job. */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => write(moveKeysAtFrame(clip, frame, frame - 1))}
                      title="Move one frame earlier"
                      aria-label="Move keyframe one frame earlier"
                      className="w-5 h-5 flex items-center justify-center rounded text-ed-text-muted hover:text-ed-text hover:bg-ed-highest transition-colors"
                    >
                      <ChevronLeft size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => write(moveKeysAtFrame(clip, frame, frame + 1))}
                      title="Move one frame later"
                      aria-label="Move keyframe one frame later"
                      className="w-5 h-5 flex items-center justify-center rounded text-ed-text-muted hover:text-ed-text hover:bg-ed-highest transition-colors"
                    >
                      <ChevronRight size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => write(removeKeysAtFrame(clip, frame))}
                      title="Delete this keyframe"
                      aria-label="Delete keyframe"
                      className="w-5 h-5 flex items-center justify-center rounded text-ed-text-muted hover:text-[var(--elah-danger-text)] hover:bg-ed-highest transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <RepeatControl clip={clip} channels={animated} write={write} />
      </Field>

      <Field
        label="Expressions"
        action={
          hasExpression ? undefined : (
            <button
              type="button"
              onClick={() => setShowExpressions((v) => !v)}
              className="text-[11px] text-ed-text-muted hover:text-ed-text transition-colors"
            >
              {showExpressions ? 'Hide' : 'Add'}
            </button>
          )
        }
      >
        {expressionsOpen ? (
          <ExpressionRows
            clip={clip}
            ctx={ctx}
            localFrame={localFrame}
            rows={channels.map((channel) => ({ channel, label: CHANNEL_LABELS[channel] }))}
          />
        ) : (
          <p className="text-[12px] text-ed-text-muted leading-[1.5]">
            Drive a property with a formula instead of keys, e.g.{' '}
            <span className="font-mono">value + wiggle(2, 0.02)</span>.
          </p>
        )}
      </Field>

      {clip.type !== 'audio' && <MotionPathSection clip={clip} ctx={ctx} write={write} />}

      {animated.length > 0 && (
        <Field
          label="Animated properties"
          action={
            <button
              type="button"
              onClick={() => write(clearAllKeyframes(clip))}
              title="Remove every keyframe on this clip"
              className="text-[11px] text-ed-text-muted hover:text-[var(--elah-danger-text)] transition-colors"
            >
              Clear all
            </button>
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {animated.map((channel) => (
              <span
                key={channel}
                className="px-2 py-1 rounded-md text-[11px] text-ed-text-muted bg-ed-elevated border border-ed-border"
              >
                {CHANNEL_LABELS[channel]}
                <span className="ml-1.5 text-ed-accent tabular-nums">
                  {channelKeys(clip, channel).length}
                </span>
              </span>
            ))}
          </div>
        </Field>
      )}
    </>
  )
}

/** Channels each clip type can animate — the panel's display filter. */
export function animatableChannels(clip: Clip): ReadonlyArray<KeyframeChannel> {
  if (clip.type === 'audio') return ['volume']
  if (clip.type === 'video') {
    return ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'rotateX', 'rotateY', 'opacity', 'cornerRadius', 'volume']
  }
  // PV-P8d: a sequence clip is drawn the same way an image is — one frame,
  // laid out and animated identically — so it shares the image channel list.
  // MOT-8 phase B: video, image, sequence and compound clips tilt in 3D (rotateX / rotateY). Text,
  // shape and freehand clips paint to a 2D canvas that cannot show a tilt the same in preview and
  // export, so their lists do not offer it.
  if (clip.type === 'image' || clip.type === 'sequence') {
    return ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'rotateX', 'rotateY', 'opacity', 'cornerRadius']
  }
  if (clip.type === 'shape') {
    return ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'opacity', 'cornerRadius']
  }
  // MOT-8: a compound is placed by the same draw rect an image is, so it skews like one.
  if (clip.type === 'compound') {
    return ['x', 'y', 'scale', 'rotation', 'skewX', 'skewY', 'rotateX', 'rotateY', 'opacity']
  }
  // PV-P2: a v2 text clip has a real content box, so its stretch is animatable
  // exactly as a shape's is. A legacy clip is left on the old list: keyframing
  // scaleX there would animate a number nothing reads.
  if (clip.type === 'text' && clip.transformModel === 'v2') {
    return ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'opacity']
  }
  return ['x', 'y', 'scale', 'rotation', 'opacity']
}

/**
 * MOT-7: copy a span of one channel's keys N more times, optionally back and forth. One `write` is one undo
 * step, and the result is ordinary keys: drag or delete any of them afterwards.
 */
function RepeatControl({
  clip,
  channels,
  write,
}: {
  clip: Clip
  channels: ReadonlyArray<KeyframeChannel>
  write: (patch: Partial<Clip>) => void
}) {
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<KeyframeChannel | undefined>(undefined)
  const [fromKey, setFromKey] = useState<number | undefined>(undefined)
  const [toKey, setToKey] = useState<number | undefined>(undefined)
  const [count, setCount] = useState(3)
  const [yoyo, setYoyo] = useState(true)
  const [gap, setGap] = useState(0)
  const [note, setNote] = useState('')

  const usable = channels.filter((c) => channelKeys(clip, c).length >= 2)
  if (usable.length === 0) return null
  const active = channel && usable.includes(channel) ? channel : usable[0]!
  const frames = channelKeys(clip, active).map((k) => k.frame)
  const from = fromKey !== undefined && frames.includes(fromKey) ? fromKey : frames[0]!
  const to = toKey !== undefined && frames.includes(toKey) ? toKey : frames[frames.length - 1]!

  const apply = () => {
    const r = repeatKeysPatch(clip, active, { from, to, count, yoyo, gapFrames: gap, maxKeys: 128 })
    if (r.added === 0) {
      setNote('Nothing fits: pick two different keys, or a clip with room after them.')
      return
    }
    write(r.patch)
    setNote(r.capped ? 'Stopped at 128 keys.' : r.cut ? `Cut at the clip end after ${r.cycles} cycles.` : '')
  }
  const fieldCls = 'bg-transparent text-[11px] text-ed-text outline-none border-b border-ed-border'
  const frameOptions = frames.map((f) => (
    <option key={f} value={f}>
      frame {f}
    </option>
  ))

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-[11px] text-ed-text-muted hover:text-ed-text transition-colors"
      >
        Repeat
      </button>
      {open && (
        <div className="mt-1.5 rounded-md border border-ed-border p-2 flex flex-col gap-1.5 text-[11px] text-ed-text-muted">
          <label className="flex items-center justify-between gap-2">
            Property
            <select value={active} onChange={(e) => setChannel(e.target.value as KeyframeChannel)} className={fieldCls}>
              {usable.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c] ?? c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            From key
            <select value={from} onChange={(e) => setFromKey(Number(e.target.value))} className={fieldCls}>
              {frameOptions}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            To key
            <select value={to} onChange={(e) => setToKey(Number(e.target.value))} className={fieldCls}>
              {frameOptions}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            Repeat times
            <input
              type="number"
              min={1}
              max={64}
              step={1}
              value={count}
              onChange={(e) => setCount(Math.min(64, Math.max(1, Math.round(Number(e.target.value) || 1))))}
              className={cn(fieldCls, 'w-12 text-right tabular-nums')}
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            Back and forth
            <input type="checkbox" checked={yoyo} onChange={(e) => setYoyo(e.target.checked)} />
          </label>
          <label className="flex items-center justify-between gap-2">
            Gap (frames)
            <input
              type="number"
              min={0}
              step={1}
              value={gap}
              onChange={(e) => setGap(Math.max(0, Math.round(Number(e.target.value) || 0)))}
              className={cn(fieldCls, 'w-12 text-right tabular-nums')}
            />
          </label>
          <button
            type="button"
            onClick={apply}
            disabled={from === to}
            className="self-start rounded px-2 py-0.5 text-ed-text bg-ed-elevated hover:bg-ed-highest disabled:opacity-40 transition-colors"
          >
            Repeat {count}x
          </button>
          {note && <p role="status">{note}</p>}
        </div>
      )}
    </div>
  )
}
