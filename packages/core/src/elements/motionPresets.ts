/**
 * Motion presets — named animations that expand into REAL keyframes.
 *
 * A preset is sugar, never a second animation system. Applying one writes
 * ordinary keys through `setKeyframe`, so the result is visible in the
 * properties panel, draggable on the timeline, undoable in one step, and
 * identical in preview and export. Nothing downstream knows a preset was used.
 *
 * That is the difference from `TextAnimation` / `MotionSpec`, the older
 * entry/exit ramps: those are a parallel pass the resolver layers on top of the
 * clip, invisible and uneditable except through the two dropdowns that created
 * them. Presets are the replacement, and `applyMotionPreset` clears the
 * matching end of the old ramp so the two can never stack into double motion.
 *
 * Both audiences use this one module: the presets row in the Animate panel, and
 * the agent op vocabulary.
 */

import type {
  AnyKeyframeChannel,
  Clip,
  Keyframe,
  KeyframeChannel,
  TextAnimationEasing,
  Transform,
} from '../types'
import { setKeyframe, baselineTransform, clearKeyframeChannel, type BaselineContext } from './keyframes'
import { effectChannel, isBuiltinKeyframeChannel, typeDefaultTransform } from '../resolver/keyframes'
import { createEffect } from '../effects/registry'
import { resolveTemplateRamp } from './textTemplates'
import { noise1 } from './noise'

export const MOTION_PRESET_NAMES = [
  'fade-in',
  'fade-out',
  'pop-in',
  'scale-out',
  'slide-in-left',
  'slide-in-right',
  'slide-in-up',
  'slide-in-down',
  // Camera, shake and impact (EDX-P4). These span the whole clip and REPLACE
  // the keys on the channels they write, so reapplying never stacks.
  'zoom-in',
  'zoom-out',
  'punch-in',
  'pan-lr',
  'dolly',
  'ken-burns',
  'spin',
  'shake-soft',
  'shake-hard',
  'handheld',
  'impact',
  // PQ-2d: an exit for every entrance, the reveal pairs, and a breathing hold.
  // Declared last so the first 19 names keep their positions.
  'slide-out-left',
  'slide-out-right',
  'slide-out-up',
  'slide-out-down',
  'pop-out',
  'wipe-in',
  'wipe-out',
  'blur-in',
  'blur-out',
  'tracking-in',
  'tracking-out',
  'highlight-sweep',
  'highlight-clear',
  'underline-draw',
  'underline-erase',
  'pop-overshoot',
  'hold-breathe',
] as const

export type MotionPresetName = (typeof MOTION_PRESET_NAMES)[number]

export type MotionPresetGroup = 'enter' | 'exit' | 'camera' | 'shake' | 'impact'

export interface MotionPresetOption {
  name: MotionPresetName
  label: string
  /**
   * Which part of the clip the preset animates. `in`/`out` touch one end and
   * leave the rest of the clip at rest; `whole` spans the clip and replaces
   * every key on the channels it writes.
   */
  end: 'in' | 'out' | 'whole'
  /** The Animate panel's section. */
  group: MotionPresetGroup
}

/** UI group order in the Animate panel. */
export const MOTION_PRESET_GROUPS: ReadonlyArray<{ id: MotionPresetGroup; label: string }> = [
  { id: 'enter', label: 'Enter' },
  { id: 'exit', label: 'Exit' },
  { id: 'camera', label: 'Camera' },
  { id: 'shake', label: 'Shake' },
  { id: 'impact', label: 'Impact' },
]

/** Declaration order is the UI order: entries, exits, then the whole-clip groups. */
export const MOTION_PRESETS: ReadonlyArray<MotionPresetOption> = [
  { name: 'fade-in', label: 'Fade in', end: 'in', group: 'enter' },
  { name: 'pop-in', label: 'Pop in', end: 'in', group: 'enter' },
  { name: 'slide-in-left', label: 'Slide from left', end: 'in', group: 'enter' },
  { name: 'slide-in-right', label: 'Slide from right', end: 'in', group: 'enter' },
  { name: 'slide-in-up', label: 'Slide from below', end: 'in', group: 'enter' },
  { name: 'slide-in-down', label: 'Slide from above', end: 'in', group: 'enter' },
  { name: 'pop-overshoot', label: 'Pop with overshoot', end: 'in', group: 'enter' },
  { name: 'wipe-in', label: 'Wipe in', end: 'in', group: 'enter' },
  { name: 'blur-in', label: 'Blur in', end: 'in', group: 'enter' },
  { name: 'tracking-in', label: 'Tracking in (stretch)', end: 'in', group: 'enter' },
  { name: 'highlight-sweep', label: 'Highlight sweep', end: 'in', group: 'enter' },
  { name: 'underline-draw', label: 'Underline draw', end: 'in', group: 'enter' },
  { name: 'fade-out', label: 'Fade out', end: 'out', group: 'exit' },
  { name: 'scale-out', label: 'Zoom out', end: 'out', group: 'exit' },
  { name: 'pop-out', label: 'Pop out', end: 'out', group: 'exit' },
  { name: 'slide-out-left', label: 'Slide out left', end: 'out', group: 'exit' },
  { name: 'slide-out-right', label: 'Slide out right', end: 'out', group: 'exit' },
  { name: 'slide-out-up', label: 'Slide out up', end: 'out', group: 'exit' },
  { name: 'slide-out-down', label: 'Slide out down', end: 'out', group: 'exit' },
  { name: 'wipe-out', label: 'Wipe out', end: 'out', group: 'exit' },
  { name: 'blur-out', label: 'Blur out', end: 'out', group: 'exit' },
  { name: 'tracking-out', label: 'Tracking out (stretch)', end: 'out', group: 'exit' },
  { name: 'highlight-clear', label: 'Highlight clear', end: 'out', group: 'exit' },
  { name: 'underline-erase', label: 'Underline erase', end: 'out', group: 'exit' },
  { name: 'zoom-in', label: 'Slow zoom in', end: 'whole', group: 'camera' },
  { name: 'zoom-out', label: 'Slow zoom out', end: 'whole', group: 'camera' },
  { name: 'punch-in', label: 'Punch in', end: 'whole', group: 'camera' },
  { name: 'pan-lr', label: 'Pan left → right', end: 'whole', group: 'camera' },
  { name: 'dolly', label: 'Dolly in', end: 'whole', group: 'camera' },
  { name: 'ken-burns', label: 'Ken Burns', end: 'whole', group: 'camera' },
  { name: 'spin', label: 'Spin', end: 'whole', group: 'camera' },
  { name: 'hold-breathe', label: 'Breathe', end: 'whole', group: 'camera' },
  { name: 'shake-soft', label: 'Light shake', end: 'whole', group: 'shake' },
  { name: 'shake-hard', label: 'Heavy shake', end: 'whole', group: 'shake' },
  { name: 'handheld', label: 'Handheld', end: 'whole', group: 'shake' },
  { name: 'impact', label: 'Impact hit', end: 'whole', group: 'impact' },
]

/**
 * Magnitudes of the whole-clip presets at `amount = 1`. Positions are
 * fractions of the stage, scales are multipliers of the rest scale, rotations
 * radians. Shakes also push the scale up by `SHAKE_COVER × amplitude` so a
 * full-frame clip never shows its edges while it jitters.
 */
export const CAMERA_MOTION = {
  zoom: 0.15,
  punch: 0.2,
  punchFrames: 6,
  pan: 0.08,
  panCover: 0.18,
  dollyScale: 0.12,
  dollyRise: 0.02,
  kenBurnsScale: 0.12,
  kenBurnsDrift: 0.03,
  spinTurns: 1,
  /** `hold-breathe`: scale swell at `amount = 1`, as a fraction of rest. */
  breathe: 0.03,
  /** `hold-breathe`: seconds per full breath. */
  breathePeriodSeconds: 2,
} as const

export const SHAKE_MOTION = {
  soft: { amplitude: 0.006, frequency: 0.25, rotation: 0 },
  hard: { amplitude: 0.02, frequency: 0.35, rotation: 0.03 },
  handheld: { amplitude: 0.008, frequency: 0.04, rotation: 0.01 },
  impact: { amplitude: 0.03, frames: 10, scale: 0.25, settleScale: 0.06, settleFrames: 8 },
  /** Scale headroom per unit of positional amplitude, on both sides. */
  cover: 2.5,
  /** Most keys one shake channel may carry; longer clips key less often. */
  maxKeys: 120,
  /** Default key spacing, in frames. */
  step: 2,
} as const

/** How far a slide travels, as a fraction of the stage. Matches `SLIDE_TRAVEL_NORMALIZED`. */
export const SLIDE_TRAVEL = 0.15
/** Default ramp as a fraction of the clip, before `resolveTemplateRamp` caps it. */
const DEFAULT_RAMP_FRACTION = 0.25
/** Scale a `pop-in` starts from, and the one `scale-out` ends on. */
const POP_FROM_SCALE = 0.6
const ZOOM_TO_SCALE = 1.4
/** `pop-overshoot` starts smaller than `pop-in` so the elastic settle has room to overshoot. */
const OVERSHOOT_FROM_SCALE = 0.4
/** `tracking-*` stretches the text this much horizontally (letter spacing is not keyable). */
const TRACKING_STRETCH = 1.12
/** `blur-*` starts or ends at this `gaussianBlur` radius. */
const BLUR_RADIUS = 24
/** Marks the one `gaussianBlur` a blur preset owns, so reapplying finds it instead of stacking. */
export const BLUR_PRESET_MARK = 'motion-preset-blur'
/** Effect id `motionPresetKeys` keys the blur radius on when the caller has no effect yet. */
const BLUR_PLACEHOLDER_ID = 'preset-blur'
/** The curve `applyDrawOn` writes; `underline-*` keys must equal what the Draw-on button writes. */
const DRAW_SMOOTH: [number, number, number, number] = [0.45, 0, 0.25, 1]
/** Frame rate `hold-breathe` assumes when the caller does not say. */
const DEFAULT_FPS = 30

export interface MotionPresetParams {
  durationFrames: number
  /** Explicit ramp length. Omitted → a quarter of the clip, capped at 30 frames. */
  rampFrames?: number
  /** Overrides the preset's own curve. */
  easing?: TextAnimationEasing
  /** Slide travel, normalized. Omitted → `SLIDE_TRAVEL`. */
  distance?: number
  /**
   * Which channel a fade acts on. `opacity` for anything visible; `volume` for
   * an audio clip, which has no opacity — a "fade in" on a music bed has an
   * obvious meaning and it is not a no-op.
   */
  fadeChannel?: 'opacity' | 'volume'
  /**
   * Whole-clip presets only: scales the preset's magnitude. 1 = the defaults
   * in `CAMERA_MOTION` / `SHAKE_MOTION`; clamped to 0..3.
   */
  amount?: number
  /** Shake presets only: the noise seed. Same seed, same keys. Default 1. */
  seed?: number
  /** `hold-breathe` only: frames per second, to turn its 2 s period into frames. Default 30. */
  fps?: number
  /** `blur-*` only: the id of the `gaussianBlur` whose radius is keyed. Set by `applyMotionPreset`. */
  effectId?: string
}

/** The fade channel a clip type implies. Audio fades its level, the rest fade visually. */
export function fadeChannelFor(clipType: Clip['type']): 'opacity' | 'volume' {
  return clipType === 'audio' ? 'volume' : 'opacity'
}

/**
 * Presets that need more than a channel list: a mask, an effect, a draw-on or a
 * clip of one type. `presetsFor` hides every PQ-2d preset unless it is given a
 * `clipType`, so the Animate panel's list is unchanged until a UI follow-up.
 */
const PRESET_CLIP_TYPES: Partial<Record<MotionPresetName, ReadonlyArray<Clip['type']>>> = (() => {
  const visual: Clip['type'][] = ['video', 'image', 'text', 'shape', 'freehand', 'adjustment', 'generator', 'compound', 'sequence']
  const out: Partial<Record<MotionPresetName, ReadonlyArray<Clip['type']>>> = {}
  for (const n of [
    'slide-out-left', 'slide-out-right', 'slide-out-up', 'slide-out-down', 'pop-out', 'pop-overshoot',
    'wipe-in', 'wipe-out', 'blur-in', 'blur-out', 'hold-breathe',
  ] as const) out[n] = visual
  out['tracking-in'] = out['tracking-out'] = ['text']
  out['highlight-sweep'] = out['highlight-clear'] = ['shape']
  out['underline-draw'] = out['underline-erase'] = ['shape']
  return out
})()

/** Whether `name` can be applied to a clip of `type`. Presets from before PQ-2d apply to any type. */
export function presetAppliesTo(name: MotionPresetName, type: Clip['type']): boolean {
  const types = PRESET_CLIP_TYPES[name]
  return types === undefined || types.includes(type)
}

/**
 * Presets that make sense for a clip that can only animate `channels`.
 * `clipType` opts in to the presets that need a mask, an effect, a draw-on or a
 * clip type; without it the answer is exactly what it was before they existed.
 */
export function presetsFor(
  channels: ReadonlyArray<KeyframeChannel>,
  fadeChannel: 'opacity' | 'volume' = 'opacity',
  clipType?: Clip['type'],
): MotionPresetOption[] {
  const allowed = new Set<KeyframeChannel>(channels)
  return MOTION_PRESETS.filter((preset) => {
    if (PRESET_CLIP_TYPES[preset.name] !== undefined && (clipType === undefined || !presetAppliesTo(preset.name, clipType))) {
      return false
    }
    const used = PRESET_CHANNELS[preset.name]
      .filter(isBuiltinKeyframeChannel)
      .map((c) => (c === 'opacity' ? fadeChannel : c))
    return used.every((c) => allowed.has(c))
  })
}

/**
 * Which channels each preset writes, with `opacity` standing in for the fade
 * channel. Extended channels (`mask.*`, `draw`) are listed for the record;
 * `presetsFor` only checks the builtin ones against the clip.
 */
const PRESET_CHANNELS: Record<MotionPresetName, AnyKeyframeChannel[]> = {
  'slide-out-left': ['x'],
  'slide-out-right': ['x'],
  'slide-out-up': ['y'],
  'slide-out-down': ['y'],
  'pop-out': ['scale', 'opacity'],
  'wipe-in': ['mask.width'],
  'wipe-out': ['mask.width'],
  'blur-in': ['opacity'],
  'blur-out': ['opacity'],
  'tracking-in': ['scaleX', 'opacity'],
  'tracking-out': ['scaleX', 'opacity'],
  'highlight-sweep': ['scaleX'],
  'highlight-clear': ['scaleX'],
  'underline-draw': ['draw'],
  'underline-erase': ['draw'],
  'pop-overshoot': ['scale', 'opacity'],
  'hold-breathe': ['scale'],
  'fade-in': ['opacity'],
  'fade-out': ['opacity'],
  'pop-in': ['scale', 'opacity'],
  'scale-out': ['scale', 'opacity'],
  'slide-in-left': ['x'],
  'slide-in-right': ['x'],
  'slide-in-up': ['y'],
  'slide-in-down': ['y'],
  'zoom-in': ['scale'],
  'zoom-out': ['scale'],
  'punch-in': ['scale'],
  // A pan needs the clip enlarged or a full-frame shot shows its edge.
  'pan-lr': ['x', 'scale'],
  dolly: ['scale', 'y'],
  'ken-burns': ['scale', 'x', 'y'],
  spin: ['rotation'],
  'shake-soft': ['x', 'y', 'scale'],
  'shake-hard': ['x', 'y', 'rotation', 'scale'],
  handheld: ['x', 'y', 'rotation', 'scale'],
  impact: ['scale', 'x', 'y'],
}

/**
 * The values the clip sits at when it is NOT animating — what a preset returns
 * to. `opacity` doubles as the rest level for an audio clip's fade channel,
 * which is why `motionRest` reads `volume` for audio.
 */
export interface MotionRest {
  x: number
  y: number
  scale: number
  opacity: number
  /** Radians. Omitted = 0. */
  rotation?: number
  /** Horizontal stretch. Omitted = 1. */
  scaleX?: number
}

/** A key without an id; `applyMotionPreset` mints ids through `setKeyframe`. */
export type PresetKey = Omit<Keyframe, 'id'>

export type PresetKeys = Partial<Record<AnyKeyframeChannel, PresetKey[]>>

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * The keys a preset expands into, as pure data.
 *
 * Frame arithmetic uses `last = durationFrames - 1`, the clip's last VISIBLE
 * frame. Keying an exit at `durationFrames` instead puts the final value one
 * frame past anything that renders, so the clip is still partly visible when it
 * cuts — the exact defect the hand-authored reference project shipped with.
 */
export function motionPresetKeys(
  name: MotionPresetName,
  rest: MotionRest,
  params: MotionPresetParams,
): PresetKeys {
  const duration = Math.max(1, Math.floor(finiteOr(params.durationFrames, 1)))
  const last = duration - 1
  const ramp = Math.min(
    last,
    params.rampFrames !== undefined && Number.isFinite(params.rampFrames)
      ? Math.max(1, Math.round(params.rampFrames))
      : resolveTemplateRamp(DEFAULT_RAMP_FRACTION, duration),
  )
  const travel = finiteOr(params.distance, SLIDE_TRAVEL)
  const ease = params.easing
  const fade: KeyframeChannel = params.fadeChannel ?? 'opacity'
  const restScaleX = finiteOr(rest.scaleX, 1)
  const blurChannel = effectChannel(params.effectId ?? BLUR_PLACEHOLDER_ID, 'radius')

  /** One channel's keys; typed so a template-literal channel name does not widen the key list. */
  const keyed = (channel: AnyKeyframeChannel, keys: PresetKey[]): PresetKeys => {
    const out: PresetKeys = {}
    out[channel] = keys
    return out
  }

  /** [extreme at frame 0, rest at frame ramp] */
  const entry = (channel: AnyKeyframeChannel, from: number, to: number, curve: TextAnimationEasing): PresetKeys =>
    keyed(channel, [
      { frame: 0, value: from, easing: 'linear' },
      { frame: ramp, value: to, easing: ease ?? curve },
    ])

  /** A fade-in over a few frames instead of the full ramp. */
  const fadeEntry = (channel: KeyframeChannel, to: number, frames: number): PresetKeys =>
    keyed(channel, [
      { frame: 0, value: 0, easing: 'linear' },
      { frame: Math.min(last, frames), value: to, easing: 'linear' },
    ])

  /** [rest at frame last-ramp, extreme at frame last] */
  const exit = (channel: AnyKeyframeChannel, from: number, to: number, curve: TextAnimationEasing): PresetKeys =>
    keyed(channel, [
      { frame: Math.max(0, last - ramp), value: from, easing: 'linear' },
      { frame: last, value: to, easing: ease ?? curve },
    ])

  switch (name) {
    case 'fade-in':
      return entry(fade, 0, rest.opacity, 'linear')
    case 'fade-out':
      return exit(fade, rest.opacity, 0, 'linear')
    case 'pop-in':
      // Scale AND opacity: a pop that only scales reads as a glitch on a clip
      // that is already at full opacity when it appears.
      return {
        ...entry('scale', rest.scale * POP_FROM_SCALE, rest.scale, 'back-out'),
        ...entry(fade, 0, rest.opacity, 'linear'),
      }
    case 'scale-out':
      return {
        ...exit('scale', rest.scale, rest.scale * ZOOM_TO_SCALE, 'quad-in'),
        ...exit(fade, rest.opacity, 0, 'linear'),
      }
    case 'slide-in-left':
      return entry('x', rest.x - travel, rest.x, 'quad-out')
    case 'slide-in-right':
      return entry('x', rest.x + travel, rest.x, 'quad-out')
    // Stage y grows downward, so arriving "from below" starts at a LARGER y.
    case 'slide-in-up':
      return entry('y', rest.y + travel, rest.y, 'quad-out')
    case 'slide-in-down':
      return entry('y', rest.y - travel, rest.y, 'quad-out')
    // Exits travel in the named direction (stage y grows downward, so "up" is a SMALLER y).
    case 'slide-out-left':
      return exit('x', rest.x, rest.x - travel, 'quad-in')
    case 'slide-out-right':
      return exit('x', rest.x, rest.x + travel, 'quad-in')
    case 'slide-out-up':
      return exit('y', rest.y, rest.y - travel, 'quad-in')
    case 'slide-out-down':
      return exit('y', rest.y, rest.y + travel, 'quad-in')
    // The true mirror of pop-in (scale-out zooms UP and stays big).
    case 'pop-out':
      return {
        ...exit('scale', rest.scale, rest.scale * POP_FROM_SCALE, 'back-in'),
        ...exit(fade, rest.opacity, 0, 'linear'),
      }
    case 'pop-overshoot':
      return {
        ...entry('scale', rest.scale * OVERSHOOT_FROM_SCALE, rest.scale, 'elastic-out'),
        // A short fade: the pop itself carries the entrance.
        ...fadeEntry(fade, rest.opacity, Math.max(1, Math.round(ramp / 3))),
      }
    case 'wipe-in':
      return entry('mask.width', 0, 1, 'quad-out')
    case 'wipe-out':
      return exit('mask.width', 1, 0, 'quad-out')
    case 'blur-in':
      return {
        ...entry(blurChannel, BLUR_RADIUS, 0, 'quad-out'),
        ...entry(fade, 0, rest.opacity, 'linear'),
      }
    case 'blur-out':
      return {
        ...exit(blurChannel, 0, BLUR_RADIUS, 'quad-in'),
        ...exit(fade, rest.opacity, 0, 'linear'),
      }
    // Letter spacing is not a keyable channel: a horizontal stretch approximates the look.
    case 'tracking-in':
      return {
        ...entry('scaleX', restScaleX * TRACKING_STRETCH, restScaleX, 'quad-out'),
        ...entry(fade, 0, rest.opacity, 'linear'),
      }
    case 'tracking-out':
      return {
        ...exit('scaleX', restScaleX, restScaleX * TRACKING_STRETCH, 'quad-in'),
        ...exit(fade, rest.opacity, 0, 'linear'),
      }
    case 'highlight-sweep':
      return entry('scaleX', 0, restScaleX, 'quad-out')
    case 'highlight-clear':
      return exit('scaleX', restScaleX, 0, 'quad-in')
    case 'underline-draw':
    case 'underline-erase': {
      // Same frames, values and curve `applyDrawOn` writes for the Draw-on button.
      const l = Math.max(1, last)
      const len = Math.max(1, Math.min(l, Math.round(params.rampFrames ?? Math.min(45, l * 0.4))))
      const pair: Array<[number, number]> = name === 'underline-draw' ? [[0, 0], [len, 1]] : [[l - len, 1], [l, 0]]
      return {
        draw: pair.map(([frame, value]) => ({
          frame: Math.min(last, Math.max(0, frame)),
          value,
          easing: 'linear' as const,
          easingBezier: [...DRAW_SMOOTH] as [number, number, number, number],
        })),
      }
    }
  }
  return wholeClipKeys(name, rest, last, params)
}

/** Clamp a preset's `amount` into 0..3; anything unusable means 1. */
function presetAmount(params: MotionPresetParams): number {
  const a = finiteOr(params.amount, 1)
  return a < 0 ? 0 : a > 3 ? 3 : a
}

/**
 * Keys for the whole-clip presets (camera, shake, impact). `last` is the
 * clip's last visible frame; every key lands in `[0, last]`.
 */
function wholeClipKeys(
  name: MotionPresetName,
  rest: MotionRest,
  last: number,
  params: MotionPresetParams,
): PresetKeys {
  const a = presetAmount(params)
  const seed = Math.floor(finiteOr(params.seed, 1))
  const rot = finiteOr(rest.rotation, 0)
  const C = CAMERA_MOTION

  /** [from at frame 0, to at the last frame] */
  const span = (from: number, to: number, curve: TextAnimationEasing): PresetKey[] => [
    { frame: 0, value: from, easing: 'linear' },
    { frame: last, value: to, easing: params.easing ?? curve },
  ]
  /** One key: the channel holds this value for the whole clip. */
  const hold = (value: number): PresetKey[] => [{ frame: 0, value, easing: 'linear' }]

  switch (name) {
    case 'zoom-in':
      return { scale: span(rest.scale, rest.scale * (1 + C.zoom * a), 'quad-in-out') }
    case 'zoom-out':
      return { scale: span(rest.scale * (1 + C.zoom * a), rest.scale, 'quad-in-out') }
    case 'punch-in':
      return {
        scale: [
          { frame: 0, value: rest.scale, easing: 'linear' },
          { frame: Math.min(last, C.punchFrames), value: rest.scale * (1 + C.punch * a), easing: params.easing ?? 'expo-out' },
        ],
      }
    case 'pan-lr':
      return {
        x: span(rest.x - C.pan * a, rest.x + C.pan * a, 'linear'),
        scale: hold(rest.scale * (1 + C.panCover * a)),
      }
    case 'dolly':
      return {
        scale: span(rest.scale, rest.scale * (1 + C.dollyScale * a), 'quad-in-out'),
        y: span(rest.y, rest.y - C.dollyRise * a, 'quad-in-out'),
      }
    case 'ken-burns':
      return {
        scale: span(rest.scale, rest.scale * (1 + C.kenBurnsScale * a), 'quad-in-out'),
        x: span(rest.x - C.kenBurnsDrift * a, rest.x + C.kenBurnsDrift * a, 'quad-in-out'),
        y: span(rest.y + C.kenBurnsDrift * a * 0.66, rest.y - C.kenBurnsDrift * a * 0.66, 'quad-in-out'),
      }
    case 'spin':
      return { rotation: span(rot, rot + Math.PI * 2 * C.spinTurns * a, 'linear') }
    case 'hold-breathe':
      return { scale: breatheKeys(rest.scale, last, a, finiteOr(params.fps, DEFAULT_FPS), params.easing) }
    case 'shake-soft':
      return shakeKeys(rest, rot, last, SHAKE_MOTION.soft, a, seed)
    case 'shake-hard':
      return shakeKeys(rest, rot, last, SHAKE_MOTION.hard, a, seed)
    case 'handheld':
      return shakeKeys(rest, rot, last, SHAKE_MOTION.handheld, a, seed)
    case 'impact':
      return impactKeys(rest, last, a, seed)
    default:
      return {}
  }
}

/**
 * `hold-breathe`: scale swells from rest to `rest x (1 + 3% x amount)` and back
 * on a 2 s period. Keys sit at every half period (rest, peak, rest, ...) with
 * `quad-in-out` between them, which draws a smooth breath; the last frame is
 * always rest. A long clip spaces the keys wider so the channel stays within
 * `SHAKE_MOTION.maxKeys`.
 */
function breatheKeys(rest: number, last: number, a: number, fps: number, easing?: TextAnimationEasing): PresetKey[] {
  const peak = rest * (1 + CAMERA_MOTION.breathe * a)
  const period = Math.max(4, Math.round(CAMERA_MOTION.breathePeriodSeconds * (fps > 0 ? fps : DEFAULT_FPS)))
  const half = Math.max(2, Math.round(period / 2), Math.ceil(last / (SHAKE_MOTION.maxKeys - 2)))
  const curve = easing ?? 'quad-in-out'
  const keys: PresetKey[] = []
  for (let f = 0, i = 0; f < last; f += half, i++) {
    keys.push({ frame: f, value: i % 2 === 0 ? rest : peak, easing: curve })
  }
  keys.push({ frame: last, value: rest, easing: curve })
  return keys
}

/** Key frames for a shake: every `step` frames, the last frame always included. */
function shakeFrames(last: number): number[] {
  // At most maxKeys-1 steps plus the final frame keeps a channel ≤ maxKeys keys.
  const step = Math.max(SHAKE_MOTION.step, Math.ceil(last / Math.max(1, SHAKE_MOTION.maxKeys - 2)))
  const frames: number[] = []
  for (let f = 0; f <= last; f += step) frames.push(f)
  if (frames[frames.length - 1] !== last) frames.push(last)
  return frames
}

function shakeKeys(
  rest: MotionRest,
  rot: number,
  last: number,
  cfg: { amplitude: number; frequency: number; rotation: number },
  a: number,
  seed: number,
): PresetKeys {
  const amp = cfg.amplitude * a
  const frames = shakeFrames(last)
  const along = (offsetSeed: number, centre: number, magnitude: number): PresetKey[] =>
    frames.map((frame) => ({
      frame,
      value: centre + noise1(seed * 31 + offsetSeed, frame * cfg.frequency) * magnitude,
      easing: 'linear',
    }))
  const keys: PresetKeys = {
    x: along(0, rest.x, amp),
    y: along(7919, rest.y, amp),
    // Enlarge just enough that the jitter never reveals a full-frame edge.
    scale: [{ frame: 0, value: rest.scale * (1 + SHAKE_MOTION.cover * amp), easing: 'linear' }],
  }
  if (cfg.rotation > 0) keys.rotation = along(15731, rot, cfg.rotation * a)
  return keys
}

/** A hard scale hit that settles, plus a shake that decays to rest. */
function impactKeys(rest: MotionRest, last: number, a: number, seed: number): PresetKeys {
  const I = SHAKE_MOTION.impact
  const end = Math.min(last, I.frames)
  const frames: number[] = []
  for (let f = 0; f < end; f += SHAKE_MOTION.step) frames.push(f)
  frames.push(end)
  const decay = (frame: number) => (end > 0 ? 1 - frame / end : 0)
  const along = (offsetSeed: number, centre: number): PresetKey[] =>
    frames.map((frame) => ({
      frame,
      value: centre + noise1(seed * 31 + offsetSeed, frame * 0.5) * I.amplitude * a * decay(frame),
      easing: 'linear',
    }))
  return {
    scale: [
      { frame: 0, value: rest.scale * (1 + I.scale * a), easing: 'linear' },
      { frame: Math.min(last, I.settleFrames), value: rest.scale * (1 + I.settleScale * a), easing: 'cubic-out' },
    ],
    x: along(0, rest.x),
    y: along(7919, rest.y),
  }
}

/**
 * The rest values a preset animates to or from: the clip as authored, with the
 * renderer's own defaults filled in for anything it never set.
 */
export function motionRest(clip: Clip, ctx: BaselineContext): MotionRest {
  const base: Transform = clip.transform ?? baselineTransform(clip, ctx) ?? typeDefaultTransform(clip.type)
  return {
    x: finiteOr(base.x, 0.5),
    y: finiteOr(base.y, 0.5),
    scale: finiteOr(base.scale, 1),
    // For audio this is the level a fade returns to, not an opacity.
    opacity: finiteOr(clip.type === 'audio' ? clip.volume : clip.opacity, 1),
    // Only when rotated: an unrotated rest keeps its original four-field shape.
    ...(finiteOr(base.rotation, 0) !== 0 ? { rotation: base.rotation } : {}),
    // Likewise only when stretched, so tracking and highlight presets return to the authored stretch.
    ...(finiteOr(base.scaleX, 1) !== 1 ? { scaleX: base.scaleX } : {}),
  }
}

/**
 * Build the `Partial<Clip>` patch that applies a preset, ready for
 * `engine.updateClip` — the same contract `applyTextTemplate` and the keyframe
 * writers use.
 *
 * Keys go through `setKeyframe` one at a time rather than being assembled by
 * hand, which is what bakes the baseline transform on a clip that has none: a
 * video's "rest" position is an object-fit-contain rect the resolver cannot
 * compute, so a slide written without that bake would animate to the wrong
 * place the moment the playhead left the ramp.
 *
 * The matching end of `textAnimation`/`shapeAnimation` is cleared, because the
 * old ramp is a SEPARATE pass layered on top of the keys — leaving it would
 * fade the clip twice.
 */
export function applyMotionPreset(
  clip: Clip,
  name: MotionPresetName,
  params: Omit<MotionPresetParams, 'durationFrames'> & { durationFrames?: number },
  ctx: BaselineContext,
): Partial<Clip> {
  return applyPresetShifted(clip, name, params, ctx, 0)
}

/** The one `gaussianBlur` a blur preset owns on `clip`, if it has been added. */
function blurEffectOf(clip: Clip) {
  return clip.effects?.find((e) => e.kind === 'gaussianBlur' && e.preset === BLUR_PRESET_MARK)
}

/**
 * What must exist on the clip before a preset's keys land, as a patch (`{}` when
 * nothing is needed, which is every preset from before PQ-2d):
 *
 * - `wipe-*`: a full-box rect `mask`, whose `mask.width` the keys drive. Any
 *   mask the clip already had is replaced.
 * - `blur-*`: ONE `gaussianBlur` at radius 0, marked through its `preset` field.
 *   Reapplying finds that effect, so effects never stack.
 * - `highlight-*`: the transform anchor moves to the left edge (`anchor.x = 0`) so
 *   `scaleX` grows rightwards, and `x` is compensated so the left edge stays put.
 * - `underline-*`: `shapeDraw` covering the whole outline, which the `draw` keys narrow.
 */
export function presetSetup(name: MotionPresetName, clip: Clip, ctx: BaselineContext): Partial<Clip> {
  if (!presetAppliesTo(name, clip.type)) return {}
  switch (name) {
    case 'wipe-in':
    case 'wipe-out':
      return { mask: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 } }
    case 'blur-in':
    case 'blur-out': {
      if (blurEffectOf(clip)) return {}
      const effect = { ...createEffect('gaussianBlur'), preset: BLUR_PRESET_MARK }
      effect.params = { ...effect.params, radius: 0 }
      return { effects: [...(clip.effects ?? []), effect] }
    }
    case 'highlight-sweep':
    case 'highlight-clear': {
      const base = baselineTransform(clip, ctx)
      if (!base) return {}
      const anchor = base.anchor ?? { x: 0.5, y: 0.5 }
      if (anchor.x === 0) return clip.transform ? {} : { transform: base }
      // A shape is a square of `scale x shorter stage side`, stretched by scaleX.
      const shortSide = Math.min(ctx.stage.width, ctx.stage.height)
      const widthPx = finiteOr(base.scale, 0.5) * shortSide * finiteOr(base.scaleX, 1)
      const x = finiteOr(base.x, 0.5) - (anchor.x * widthPx) / Math.max(1, ctx.stage.width)
      return { transform: { ...base, x, anchor: { x: 0, y: anchor.y } } }
    }
    case 'underline-draw':
    case 'underline-erase':
      return { shapeDraw: { start: 0, end: 1 } }
    default:
      return {}
  }
}

/**
 * `applyMotionPreset` with every key moved `shift` frames later and clamped
 * inside the clip. Shared by the single-clip path (`shift = 0`) and stagger.
 */
function applyPresetShifted(
  clip: Clip,
  name: MotionPresetName,
  params: Omit<MotionPresetParams, 'durationFrames'> & { durationFrames?: number },
  ctx: BaselineContext,
  shift: number,
): Partial<Clip> {
  // A preset the clip's type cannot perform (a wipe on audio, an underline on
  // text) writes nothing, so the op layer reports "does not apply".
  if (!presetAppliesTo(name, clip.type)) return {}

  const end = MOTION_PRESETS.find((p) => p.name === name)?.end ?? 'in'
  const last = Math.max(0, clip.durationFrames - 1)

  let working: Clip = clip
  let patch: Partial<Clip> = {}
  const merge = (p: Partial<Clip>) => {
    working = { ...working, ...p }
    patch = { ...patch, ...p }
  }

  // What must exist before keys land (a mask, an effect, an anchor, a draw-on).
  // Merged first so every key below is written against the prepared clip.
  merge(presetSetup(name, clip, ctx))

  const keys = motionPresetKeys(name, motionRest(working, ctx), {
    ...params,
    durationFrames: params.durationFrames ?? clip.durationFrames,
    fadeChannel: params.fadeChannel ?? fadeChannelFor(clip.type),
    ...(name === 'blur-in' || name === 'blur-out' ? { effectId: blurEffectOf(working)?.id } : {}),
  })

  // A whole-clip preset owns its channels: clear them first so applying it
  // twice yields the same keys, not two interleaved sets.
  if (end === 'whole') {
    for (const channel of Object.keys(keys) as AnyKeyframeChannel[]) {
      merge(clearKeyframeChannel(working, channel))
    }
  }

  for (const [channel, list] of Object.entries(keys) as [AnyKeyframeChannel, PresetKey[]][]) {
    for (const key of list) {
      const frame = Math.min(last, Math.max(0, key.frame + shift))
      merge(
        setKeyframe(working, channel, frame, ctx, key.value, {
          easing: key.easing,
          ...(key.easingBezier ? { easingBezier: key.easingBezier } : {}),
          ...(key.hold ? { hold: true as const } : {}),
        }),
      )
    }
  }

  // Whole-clip presets move the clip for its whole life; the legacy entry/exit
  // ramp is a separate concern and stays. In/out presets replace it.
  if (end === 'whole') return patch
  return { ...patch, ...clearLegacyRamp(clip, end) }
}

/**
 * The same preset on several clips, each clip's keys starting `offsetFrames`
 * later than the previous clip's — the "stagger" of a word-by-word or
 * card-by-card build. Keys are clamped inside each clip. Returns one patch per
 * clip; the caller applies them in ONE `engine.batch` so it is one undo step.
 */
export function staggerPresetPatches(
  clips: ReadonlyArray<Clip>,
  name: MotionPresetName,
  params: Omit<MotionPresetParams, 'durationFrames'>,
  offsetFrames: number,
  ctx: BaselineContext,
  /** MOT-2: per-clip frame offsets (see `staggerOffsets`). Omitted: `index * offsetFrames`, exactly as before. */
  offsets?: ReadonlyArray<number>,
): Array<{ clipId: string; trackId: string; patch: Partial<Clip> }> {
  const offset = Math.max(0, Math.round(finiteOr(offsetFrames, 0)))
  return clips.map((clip, index) => ({
    clipId: clip.id,
    trackId: clip.trackId,
    patch: applyPresetShifted(clip, name, params, ctx, offsets ? Math.max(0, Math.round(finiteOr(offsets[index], 0))) : index * offset),
  }))
}

/**
 * Drop the entry or exit half of the old `TextAnimation` ramp, keeping the
 * other half. Returns `{}` when there is nothing to clear, so a clip that never
 * used the dropdowns gets a patch with no stray keys in it.
 */
function clearLegacyRamp(clip: Clip, end: 'in' | 'out'): Partial<Clip> {
  const field = clip.type === 'shape' ? 'shapeAnimation' : 'textAnimation'
  const anim = clip[field]
  if (!anim) return {}

  const next = { ...anim }
  if (end === 'in') {
    delete next.in
    delete next.inMotion
  } else {
    delete next.out
    delete next.outMotion
  }
  // An animation with neither end left is noise in the document; drop it.
  const empty = !next.in && !next.out && !next.inMotion && !next.outMotion
  return { [field]: empty ? undefined : next }
}
