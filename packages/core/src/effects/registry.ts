/**
 * The effect registry — what every `Clip.effects[].kind` means.
 *
 * Pure data plus pure helpers: no DOM, no GL, no React, so the resolver, the
 * export worker, the Inspector and an agent's op sanitizer can all read it.
 * Shaders do NOT live here; each kind's GPU implementation lives under
 * `renderer/gpu/effects/<kind>.ts` (EDX-P2), and a test there asserts every
 * kind registered here has one, so the two cannot drift.
 *
 * Params are FLAT scalars — numbers, '#rrggbb' colours, enum strings,
 * booleans — because an agent authors them and the Inspector draws one
 * control per param. Everything an effect reads goes through
 * `clampEffectParams`, which is the only place ranges are enforced.
 */

import type { ClipType, Effect } from '../types'
import { generateId } from '../utils/id'

export type EffectCategory =
  | 'color'
  | 'blur'
  | 'cinematic'
  | 'glitch'
  | 'distortion'
  | 'light'
  | 'stylize'
  | 'text'
  | 'generator'
  | 'audio'

export type EffectParamValue = number | string | boolean

export interface ParamDef {
  type: 'number' | 'color' | 'enum' | 'boolean' | 'text'
  default: EffectParamValue
  min?: number
  max?: number
  step?: number
  /** Numbers only: round to an integer after clamping. */
  integer?: boolean
  /** Enums only. */
  options?: readonly string[]
  /** Text only (EDX-P9 generators): longest accepted string. */
  maxLength?: number
  /**
   * May be animated: numbers by an `fx.<id>.<param>` scalar channel; colours
   * (PV-P5c) by the same channel name with `vec` keys.
   */
  keyframeable: boolean
  label: string
  /** Display unit for the Inspector, e.g. 'px', '°'. */
  unit?: string
}

export interface EffectPreset {
  id: string
  label: string
  params: Record<string, EffectParamValue>
}

export interface EffectDefinition {
  kind: string
  label: string
  category: EffectCategory
  /** Clip types the Inspector offers this effect on. */
  appliesTo: ReadonlyArray<ClipType>
  params: Record<string, ParamDef>
  render: {
    gpu: true
    /** Whether the frozen Canvas2D export fallback can draw it. */
    canvas2d: boolean
    /** Full-box draws per frame; separable blurs declare 2. */
    passes: number
    /** Extra stage pixels the chain must allocate around the clip's box. */
    padding?: number
  }
  presets?: ReadonlyArray<EffectPreset>
}

/**
 * Every clip type that draws pixels, plus adjustment clips (EDX-P7), whose
 * effects apply to the picture below them. Audio has no picture to affect.
 */
const VISUAL: ReadonlyArray<ClipType> = ['video', 'image', 'text', 'shape', 'freehand', 'adjustment', 'generator', 'compound', 'sequence']

const DEFINITIONS: EffectDefinition[] = [
  {
    kind: 'colorGrade',
    label: 'Colour grade',
    category: 'color',
    appliesTo: VISUAL,
    params: {
      exposure: { type: 'number', default: 0, min: -2, max: 2, step: 0.01, keyframeable: true, label: 'Exposure', unit: 'EV' },
      contrast: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, keyframeable: true, label: 'Contrast' },
      saturation: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, keyframeable: true, label: 'Saturation' },
      temperature: { type: 'number', default: 0, min: -1, max: 1, step: 0.01, keyframeable: true, label: 'Temperature' },
      tint: { type: 'number', default: 0, min: -1, max: 1, step: 0.01, keyframeable: true, label: 'Tint' },
      hue: { type: 'number', default: 0, min: -180, max: 180, step: 1, keyframeable: true, label: 'Hue', unit: '°' },
      lift: { type: 'number', default: 0, min: -0.5, max: 0.5, step: 0.01, keyframeable: true, label: 'Lift' },
      gamma: { type: 'number', default: 1, min: 0.2, max: 3, step: 0.01, keyframeable: true, label: 'Gamma' },
      gain: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, keyframeable: true, label: 'Gain' },
    },
    render: { gpu: true, canvas2d: false, passes: 1 },
    presets: [
      { id: 'teal-orange', label: 'Teal & Orange', params: { contrast: 1.12, saturation: 1.15, temperature: 0.18, tint: -0.06, lift: -0.02, gain: 1.04 } },
      { id: 'film-fade', label: 'Film Fade', params: { contrast: 0.88, saturation: 0.85, lift: 0.08, gamma: 1.05, temperature: 0.06 } },
      { id: 'bleach', label: 'Bleach Bypass', params: { contrast: 1.3, saturation: 0.45, gain: 1.05 } },
      { id: 'noir', label: 'Noir', params: { contrast: 1.35, saturation: 0, lift: -0.04, gamma: 0.95 } },
    ],
  },
  {
    kind: 'gaussianBlur',
    label: 'Gaussian blur',
    category: 'blur',
    appliesTo: VISUAL,
    params: {
      radius: { type: 'number', default: 12, min: 0, max: 100, step: 0.5, keyframeable: true, label: 'Radius', unit: 'px' },
    },
    render: { gpu: true, canvas2d: false, passes: 2, padding: 100 },
  },
  {
    kind: 'vignette',
    label: 'Vignette',
    category: 'cinematic',
    appliesTo: VISUAL,
    params: {
      amount: { type: 'number', default: 0.4, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Amount' },
      radius: { type: 'number', default: 0.75, min: 0, max: 1.5, step: 0.01, keyframeable: true, label: 'Radius' },
      softness: { type: 'number', default: 0.45, min: 0.01, max: 1, step: 0.01, keyframeable: true, label: 'Softness' },
      color: { type: 'color', default: '#000000', keyframeable: true, label: 'Colour' },
    },
    render: { gpu: true, canvas2d: false, passes: 1 },
  },
  {
    kind: 'grain',
    label: 'Film grain',
    category: 'cinematic',
    appliesTo: VISUAL,
    params: {
      amount: { type: 'number', default: 0.25, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Amount' },
      size: { type: 'number', default: 1.5, min: 0.5, max: 4, step: 0.1, keyframeable: true, label: 'Size' },
      seed: { type: 'number', default: 7, min: 0, max: 9999, step: 1, integer: true, keyframeable: false, label: 'Seed' },
      animated: { type: 'boolean', default: true, keyframeable: false, label: 'Animate per frame' },
    },
    render: { gpu: true, canvas2d: false, passes: 1 },
  },
  {
    kind: 'rgbSplit',
    label: 'RGB split',
    category: 'glitch',
    appliesTo: VISUAL,
    params: {
      amount: { type: 'number', default: 0.008, min: 0, max: 0.05, step: 0.001, keyframeable: true, label: 'Amount' },
      angle: { type: 'number', default: 0, min: -180, max: 180, step: 1, keyframeable: true, label: 'Angle', unit: '°' },
    },
    render: { gpu: true, canvas2d: false, passes: 1, padding: 60 },
  },
  {
    kind: 'letterbox',
    label: 'Letterbox',
    category: 'cinematic',
    appliesTo: VISUAL,
    params: {
      ratio: { type: 'number', default: 2.39, min: 1, max: 3, step: 0.01, keyframeable: true, label: 'Aspect ratio' },
      color: { type: 'color', default: '#000000', keyframeable: true, label: 'Colour' },
    },
    render: { gpu: true, canvas2d: true, passes: 1 },
  },
  {
    kind: 'chromaticAberration',
    label: 'Chromatic aberration',
    category: 'cinematic',
    appliesTo: VISUAL,
    params: {
      amount: { type: 'number', default: 0.006, min: 0, max: 0.05, step: 0.001, keyframeable: true, label: 'Amount' },
    },
    render: { gpu: true, canvas2d: false, passes: 1, padding: 40 },
  },
  {
    kind: 'scanlines',
    label: 'Scanlines',
    category: 'glitch',
    appliesTo: VISUAL,
    params: {
      density: { type: 'number', default: 480, min: 50, max: 1500, step: 1, integer: true, keyframeable: true, label: 'Lines' },
      intensity: { type: 'number', default: 0.3, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Intensity' },
      speed: { type: 'number', default: 0, min: 0, max: 10, step: 0.1, keyframeable: true, label: 'Scroll speed' },
    },
    render: { gpu: true, canvas2d: false, passes: 1 },
  },
  // --- EDX-P9: light ---
  {
    kind: 'bloom',
    label: 'Bloom',
    category: 'light',
    appliesTo: VISUAL,
    params: {
      threshold: { type: 'number', default: 0.7, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Threshold' },
      intensity: { type: 'number', default: 0.8, min: 0, max: 3, step: 0.01, keyframeable: true, label: 'Intensity' },
      radius: { type: 'number', default: 24, min: 0, max: 120, step: 1, keyframeable: true, label: 'Radius', unit: 'px' },
      tint: { type: 'color', default: '#ffffff', keyframeable: true, label: 'Tint' },
    },
    render: { gpu: true, canvas2d: false, passes: 1, padding: 120 },
  },
  {
    kind: 'glow',
    label: 'Glow',
    category: 'light',
    appliesTo: VISUAL,
    params: {
      intensity: { type: 'number', default: 1.5, min: 0, max: 5, step: 0.05, keyframeable: true, label: 'Intensity' },
      radius: { type: 'number', default: 24, min: 0, max: 120, step: 1, keyframeable: true, label: 'Radius', unit: 'px' },
      color: { type: 'color', default: '#ffffff', keyframeable: true, label: 'Colour' },
    },
    render: { gpu: true, canvas2d: false, passes: 1, padding: 120 },
  },
  {
    kind: 'flash',
    label: 'Flash',
    category: 'light',
    appliesTo: VISUAL,
    params: {
      amount: { type: 'number', default: 0.8, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Amount' },
      color: { type: 'color', default: '#ffffff', keyframeable: true, label: 'Colour' },
    },
    render: { gpu: true, canvas2d: false, passes: 1 },
  },
  {
    kind: 'strobe',
    label: 'Strobe',
    category: 'light',
    appliesTo: VISUAL,
    params: {
      rate: { type: 'number', default: 8, min: 0.5, max: 30, step: 0.5, keyframeable: true, label: 'Flashes per second' },
      duty: { type: 'number', default: 0.5, min: 0.05, max: 0.95, step: 0.05, keyframeable: true, label: 'On fraction' },
      amount: { type: 'number', default: 0.8, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Amount' },
      mode: { type: 'enum', default: 'white', options: ['white', 'black'], keyframeable: false, label: 'Mode' },
    },
    render: { gpu: true, canvas2d: false, passes: 1 },
  },
  {
    kind: 'lightRays',
    label: 'Light rays',
    category: 'light',
    appliesTo: VISUAL,
    params: {
      centerX: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Centre X' },
      centerY: { type: 'number', default: 0.2, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Centre Y' },
      length: { type: 'number', default: 0.6, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Length' },
      intensity: { type: 'number', default: 1, min: 0, max: 3, step: 0.01, keyframeable: true, label: 'Intensity' },
      threshold: { type: 'number', default: 0.6, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Threshold' },
    },
    render: { gpu: true, canvas2d: false, passes: 1 },
  },
  // --- EDX-P9: distortion ---
  {
    kind: 'wave',
    label: 'Wave',
    category: 'distortion',
    appliesTo: VISUAL,
    params: {
      amplitude: { type: 'number', default: 0.02, min: 0, max: 0.2, step: 0.001, keyframeable: true, label: 'Amplitude' },
      frequency: { type: 'number', default: 6, min: 0.5, max: 40, step: 0.5, keyframeable: true, label: 'Waves' },
      speed: { type: 'number', default: 1, min: -10, max: 10, step: 0.1, keyframeable: true, label: 'Speed' },
      direction: { type: 'enum', default: 'horizontal', options: ['horizontal', 'vertical'], keyframeable: false, label: 'Direction' },
    },
    render: { gpu: true, canvas2d: false, passes: 1, padding: 200 },
  },
  {
    kind: 'twirl',
    label: 'Twirl',
    category: 'distortion',
    appliesTo: VISUAL,
    params: {
      angle: { type: 'number', default: 180, min: -1080, max: 1080, step: 1, keyframeable: true, label: 'Angle', unit: '°' },
      radius: { type: 'number', default: 0.5, min: 0.01, max: 1.5, step: 0.01, keyframeable: true, label: 'Radius' },
      centerX: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Centre X' },
      centerY: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Centre Y' },
    },
    render: { gpu: true, canvas2d: false, passes: 1 },
  },
  {
    kind: 'bulge',
    label: 'Bulge / pinch',
    category: 'distortion',
    appliesTo: VISUAL,
    params: {
      amount: { type: 'number', default: 0.5, min: -0.9, max: 1, step: 0.01, keyframeable: true, label: 'Amount' },
      radius: { type: 'number', default: 0.4, min: 0.01, max: 1.5, step: 0.01, keyframeable: true, label: 'Radius' },
      centerX: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Centre X' },
      centerY: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Centre Y' },
    },
    render: { gpu: true, canvas2d: false, passes: 1 },
  },
  {
    kind: 'fisheye',
    label: 'Fisheye',
    category: 'distortion',
    appliesTo: VISUAL,
    params: {
      amount: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Amount' },
    },
    render: { gpu: true, canvas2d: false, passes: 1 },
  },
  {
    kind: 'displace',
    label: 'Noise displace',
    category: 'distortion',
    appliesTo: VISUAL,
    params: {
      amount: { type: 'number', default: 0.03, min: 0, max: 0.3, step: 0.001, keyframeable: true, label: 'Amount' },
      scale: { type: 'number', default: 6, min: 0.5, max: 40, step: 0.5, keyframeable: true, label: 'Scale' },
      speed: { type: 'number', default: 0.5, min: 0, max: 10, step: 0.1, keyframeable: true, label: 'Speed' },
      seed: { type: 'number', default: 3, min: 0, max: 9999, step: 1, integer: true, keyframeable: false, label: 'Seed' },
    },
    render: { gpu: true, canvas2d: false, passes: 1, padding: 150 },
  },
  // --- EDX-P9: glitch v2 / retro ---
  {
    kind: 'vhs',
    label: 'VHS',
    category: 'glitch',
    appliesTo: VISUAL,
    params: {
      amount: { type: 'number', default: 0.6, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Amount' },
    },
    render: { gpu: true, canvas2d: false, passes: 1, padding: 40 },
  },
  {
    kind: 'crt',
    label: 'CRT',
    category: 'glitch',
    appliesTo: VISUAL,
    params: {
      curvature: { type: 'number', default: 0.12, min: 0, max: 0.5, step: 0.01, keyframeable: true, label: 'Curvature' },
      scanlines: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Scanlines' },
      vignette: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Vignette' },
      mask: { type: 'number', default: 0.2, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Shadow mask' },
    },
    render: { gpu: true, canvas2d: false, passes: 1 },
  },
  {
    kind: 'pixelate',
    label: 'Pixelate',
    category: 'stylize',
    appliesTo: VISUAL,
    params: {
      size: { type: 'number', default: 12, min: 1, max: 200, step: 1, keyframeable: true, label: 'Block size', unit: 'px' },
    },
    render: { gpu: true, canvas2d: false, passes: 1 },
  },
  {
    kind: 'glitchBlocks',
    label: 'Glitch blocks',
    category: 'glitch',
    appliesTo: VISUAL,
    params: {
      amount: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Amount' },
      blockSize: { type: 'number', default: 0.06, min: 0.01, max: 0.3, step: 0.005, keyframeable: true, label: 'Block size' },
      speed: { type: 'number', default: 8, min: 0, max: 30, step: 0.5, keyframeable: true, label: 'Changes per second' },
      seed: { type: 'number', default: 5, min: 0, max: 9999, step: 1, integer: true, keyframeable: false, label: 'Seed' },
    },
    render: { gpu: true, canvas2d: false, passes: 1, padding: 160 },
  },
  {
    // MI-P8. Blurs a clip along its own motion. With `auto` (the default) the
    // resolver measures the clip's velocity and hands it to the effect as the
    // `MOTION_BLUR_INPUTS` entries of its resolved params; with `auto` off the
    // blur is the authored `angle` / `length` instead.
    kind: 'motionBlur',
    label: 'Motion blur',
    category: 'blur',
    appliesTo: VISUAL,
    params: {
      shutter: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, keyframeable: true, label: 'Shutter' },
      samples: { type: 'number', default: 12, min: 4, max: 32, step: 1, integer: true, keyframeable: false, label: 'Samples' },
      minPx: { type: 'number', default: 1.5, min: 0, max: 20, step: 0.1, keyframeable: false, label: 'Ignore below', unit: 'px' },
      auto: { type: 'boolean', default: true, keyframeable: false, label: 'Follow the clip\'s motion' },
      angle: { type: 'number', default: 0, min: -180, max: 180, step: 1, keyframeable: true, label: 'Angle (manual)', unit: '°' },
      length: { type: 'number', default: 40, min: 0, max: 200, step: 1, keyframeable: true, label: 'Length (manual)', unit: 'px' },
    },
    render: { gpu: true, canvas2d: false, passes: 1, padding: 200 },
  },
]

/**
 * Resolver-supplied inputs of `motionBlur` (MI-P8). They are NOT registry
 * params: no Inspector control, no keyframe channel, no vocabulary entry, and
 * `clampEffectParams` drops them. The resolver adds them to the RESOLVED
 * params of a `motionBlur` effect with `auto: true` (after clamping), so they
 * travel with the effect to the preview chain and the export chain alike.
 *
 *  - x, y: stage px per frame the clip's anchor point travels (screen space,
 *    +x right, +y down).
 *  - spin: radians per frame (positive = clockwise).
 *  - zoom: fractional scale change per frame (0.02 = growing 2% a frame).
 */
export const MOTION_BLUR_INPUTS = {
  x: 'velX',
  y: 'velY',
  spin: 'velSpin',
  zoom: 'velZoom',
} as const

/** Every registered effect, keyed by kind, in UI order. */
export const EFFECT_REGISTRY: ReadonlyMap<string, EffectDefinition> = new Map(
  DEFINITIONS.map((d) => [d.kind, d]),
)

/** Categories in the order the Effects browser lists them. */
export const EFFECT_CATEGORIES: ReadonlyArray<EffectCategory> = [
  'color',
  'blur',
  'cinematic',
  'glitch',
  'distortion',
  'light',
  'stylize',
  'text',
  'generator',
  'audio',
]

export function getEffectDefinition(kind: string): EffectDefinition | undefined {
  return EFFECT_REGISTRY.get(kind)
}

/** Registered kinds offered on a clip type, in registry order. */
export function effectsFor(clipType: ClipType): EffectDefinition[] {
  return DEFINITIONS.filter((d) => d.appliesTo.includes(clipType))
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** One param clamped to its definition; the default when the input is unusable. */
export function clampParam(def: ParamDef, value: unknown): EffectParamValue {
  switch (def.type) {
    case 'number': {
      const n = typeof value === 'number' && Number.isFinite(value) ? value : (def.default as number)
      const lo = def.min ?? -Infinity
      const hi = def.max ?? Infinity
      const c = n < lo ? lo : n > hi ? hi : n
      return def.integer ? Math.round(c) : c
    }
    case 'color':
      return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : def.default
    case 'enum':
      return typeof value === 'string' && def.options?.includes(value) ? value : def.default
    case 'boolean':
      return typeof value === 'boolean' ? value : def.default
    case 'text':
      return typeof value === 'string' ? value.slice(0, def.maxLength ?? 200) : def.default
  }
}

/**
 * Every param of `kind`, clamped, defaults filled in, unknown names dropped.
 * `null` for a kind the registry does not know — the caller decides whether
 * that means "skip" (resolver, sanitizer) or "keep untouched" (document reader).
 */
export function clampEffectParams(kind: string, params: unknown): Effect['params'] | null {
  const def = EFFECT_REGISTRY.get(kind)
  if (!def) return null
  const source = params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
  const out: Effect['params'] = {}
  for (const [name, pd] of Object.entries(def.params)) out[name] = clampParam(pd, source[name])
  return out
}

/** The params a registered kind starts with. Empty for an unknown kind. */
export function defaultEffectParams(kind: string): Effect['params'] {
  return clampEffectParams(kind, {}) ?? {}
}

/**
 * A new effect entry with a fresh id and default params, optionally with a
 * preset applied. Throws on an unknown kind or preset — a programming error
 * at the call site, never reachable from stored data.
 */
export function createEffect(kind: string, presetId?: string): Effect {
  if (!EFFECT_REGISTRY.has(kind)) throw new Error(`Unknown effect kind: ${kind}`)
  const effect: Effect = { id: generateId(), kind, params: defaultEffectParams(kind) }
  return presetId ? applyEffectPreset(effect, presetId) : effect
}

/**
 * The effect with a preset's params laid over its current ones and the
 * preset recorded. Params the preset does not mention keep their values.
 * Throws on an unknown kind or preset id.
 */
export function applyEffectPreset(effect: Effect, presetId: string): Effect {
  const def = EFFECT_REGISTRY.get(effect.kind)
  if (!def) throw new Error(`Unknown effect kind: ${effect.kind}`)
  const preset = def.presets?.find((p) => p.id === presetId)
  if (!preset) throw new Error(`Unknown preset ${presetId} for ${effect.kind}`)
  const params = clampEffectParams(effect.kind, { ...effect.params, ...preset.params }) ?? {}
  return { ...effect, params, preset: preset.id }
}

/** Numeric param names of `kind` that a keyframe channel may drive. */
export function keyframeableParams(kind: string): string[] {
  const def = EFFECT_REGISTRY.get(kind)
  if (!def) return []
  return Object.entries(def.params)
    .filter(([, pd]) => pd.type === 'number' && pd.keyframeable)
    .map(([name]) => name)
}

/** Colour param names of `kind` that a `vec`-keyed channel may drive (PV-P5c). */
export function keyframeableColorParams(kind: string): string[] {
  const def = EFFECT_REGISTRY.get(kind)
  if (!def) return []
  return Object.entries(def.params)
    .filter(([, pd]) => pd.type === 'color' && pd.keyframeable)
    .map(([name]) => name)
}
