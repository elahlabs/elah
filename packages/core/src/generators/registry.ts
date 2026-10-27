/**
 * Generator registry (EDX-P9) — what every `Clip.generator.kind` means.
 *
 * A generator clip makes its own picture from params and time: particles,
 * energy lines, light leaks, a lens flare, an animated gradient, counters and
 * simple charts. Same shape as the effect registry (flat typed params, one
 * `clamp` gate), so the Inspector draws controls from it and the agent's op
 * schema is generated from it. The painter lives in
 * `renderer/gpu/layers/generatorPaint.ts`, shared by preview and export.
 */

import type { BlendMode, ClipGenerator } from '../types'
import { clampParam, type EffectParamValue, type ParamDef } from '../effects/registry'

export type GeneratorCategory = 'particles' | 'light' | 'background' | 'data'

export interface GeneratorDefinition {
  kind: string
  label: string
  category: GeneratorCategory
  hint: string
  params: Record<string, ParamDef>
  /** Placed generators (counter, charts) use the clip transform; the rest fill the stage. */
  placed: boolean
  /** Blend a new clip of this kind starts with (light is added, not painted over). */
  blend?: BlendMode
  /**
   * Named starting points shown as their own cards (Confetti, Snow…). The
   * agent can name one too; params still clamp through the registry.
   */
  presets?: ReadonlyArray<{ id: string; label: string; params: Record<string, EffectParamValue> }>
}

const n = (d: number, min: number, max: number, step: number, label: string, extra: Partial<ParamDef> = {}): ParamDef => ({
  type: 'number',
  default: d,
  min,
  max,
  step,
  keyframeable: true,
  label,
  ...extra,
})
const color = (d: string, label: string): ParamDef => ({ type: 'color', default: d, keyframeable: false, label })
const text = (d: string, label: string, maxLength = 40): ParamDef => ({ type: 'text', default: d, keyframeable: false, label, maxLength })
const choice = (d: string, options: string[], label: string): ParamDef => ({ type: 'enum', default: d, options, keyframeable: false, label })

const DEFINITIONS: GeneratorDefinition[] = [
  {
    kind: 'particles',
    label: 'Particles',
    category: 'particles',
    hint: 'Confetti, sparks, snow, dust, bokeh or embers',
    placed: false,
    params: {
      style: choice('confetti', ['confetti', 'sparks', 'snow', 'dust', 'bokeh', 'embers'], 'Style'),
      count: n(120, 5, 500, 1, 'Count', { integer: true, keyframeable: false }),
      size: n(10, 1, 60, 0.5, 'Size', { unit: 'px' }),
      speed: n(1, 0, 4, 0.05, 'Speed'),
      color: color('#ffffff', 'Colour'),
    },
    presets: [
      { id: 'confetti', label: 'Confetti', params: { style: 'confetti', count: 160, size: 18 } },
      { id: 'snow', label: 'Snow', params: { style: 'snow', count: 220, size: 16, speed: 1 } },
      { id: 'sparks', label: 'Sparks', params: { style: 'sparks', count: 140, size: 14, color: '#ffd27a', speed: 1.2 } },
      { id: 'embers', label: 'Embers', params: { style: 'embers', count: 90, size: 16, color: '#ff8a3d', speed: 0.8 } },
      { id: 'bokeh', label: 'Bokeh', params: { style: 'bokeh', count: 40, size: 16, color: '#ffe8c2', speed: 1 } },
      { id: 'dust', label: 'Floating dust', params: { style: 'dust', count: 160, size: 12, speed: 1 } },
    ],
  },
  {
    kind: 'energyLines',
    label: 'Speed lines',
    category: 'particles',
    hint: 'Anime speed lines rushing to the centre',
    placed: false,
    params: {
      count: n(60, 5, 200, 1, 'Lines', { integer: true, keyframeable: false }),
      thickness: n(6, 1, 40, 0.5, 'Thickness', { unit: 'px' }),
      inner: n(0.35, 0, 0.9, 0.01, 'Clear centre'),
      flicker: n(12, 0, 30, 1, 'Flicker per second'),
      color: color('#ffffff', 'Colour'),
    },
  },
  {
    kind: 'lightLeak',
    label: 'Light leak',
    category: 'light',
    hint: 'Warm film light drifting across the frame',
    placed: false,
    blend: 'screen',
    params: {
      colorA: color('#ff7a18', 'Colour A'),
      colorB: color('#ff2d75', 'Colour B'),
      intensity: n(0.7, 0, 1, 0.01, 'Intensity'),
      speed: n(0.4, 0, 3, 0.05, 'Speed'),
    },
    presets: [
      { id: 'warm', label: 'Warm leak', params: { colorA: '#ff7a18', colorB: '#ff2d75' } },
      { id: 'cool', label: 'Cool leak', params: { colorA: '#3ec5ff', colorB: '#8a5cff' } },
    ],
  },
  {
    kind: 'lensFlare',
    label: 'Lens flare',
    category: 'light',
    hint: 'A sun flare with ghosts across the lens',
    placed: false,
    blend: 'screen',
    params: {
      x: n(0.78, 0, 1, 0.01, 'Position X'),
      y: n(0.22, 0, 1, 0.01, 'Position Y'),
      intensity: n(0.9, 0, 1.5, 0.01, 'Intensity'),
      color: color('#ffd9a0', 'Colour'),
    },
  },
  {
    kind: 'gradientBackground',
    label: 'Gradient background',
    category: 'background',
    hint: 'A two-colour background that can slowly turn',
    placed: false,
    params: {
      colorA: color('#1e3c72', 'Colour A'),
      colorB: color('#e94e77', 'Colour B'),
      angle: n(135, -360, 360, 1, 'Angle', { unit: '°' }),
      spin: n(0, -90, 90, 1, 'Turn per second', { unit: '°' }),
    },
  },
  {
    kind: 'counter',
    label: 'Counter',
    category: 'data',
    hint: 'A number that counts up — stats, prices, followers',
    placed: true,
    params: {
      from: n(0, -1e9, 1e9, 1, 'From'),
      to: n(1000, -1e9, 1e9, 1, 'To'),
      decimals: n(0, 0, 3, 1, 'Decimals', { integer: true, keyframeable: false }),
      countFraction: n(0.7, 0.05, 1, 0.01, 'Counts over', { keyframeable: false }),
      separator: { type: 'boolean', default: true, keyframeable: false, label: 'Thousands separator' },
      prefix: text('', 'Prefix'),
      suffix: text('+', 'Suffix'),
      fontSize: n(160, 12, 600, 1, 'Size', { unit: 'px' }),
      color: color('#ffffff', 'Colour'),
    },
    presets: [
      { id: 'followers', label: 'Followers', params: { from: 0, to: 250000, suffix: '+', prefix: '' } },
      { id: 'price', label: 'Price', params: { from: 0, to: 49.99, decimals: 2, prefix: '$', suffix: '' } },
      { id: 'percent', label: 'Percentage', params: { from: 0, to: 87, suffix: '%', prefix: '' } },
    ],
  },
  {
    kind: 'barChart',
    label: 'Bar chart',
    category: 'data',
    hint: 'Bars that grow in, one after another',
    placed: true,
    params: {
      values: text('40, 65, 52, 90', 'Values (comma separated)', 200),
      color: color('#4ade80', 'Bar colour'),
      width: n(0.5, 0.1, 1, 0.01, 'Width'),
      height: n(0.35, 0.05, 1, 0.01, 'Height'),
      growFraction: n(0.5, 0.05, 1, 0.01, 'Grows over', { keyframeable: false }),
      showValues: { type: 'boolean', default: true, keyframeable: false, label: 'Show values' },
    },
  },
  {
    kind: 'progressBar',
    label: 'Progress bar',
    category: 'data',
    hint: 'A bar that fills across the clip',
    placed: true,
    params: {
      from: n(0, 0, 1, 0.01, 'From'),
      to: n(1, 0, 1, 0.01, 'To'),
      width: n(0.6, 0.05, 1, 0.01, 'Width'),
      thickness: n(18, 2, 120, 1, 'Thickness', { unit: 'px' }),
      color: color('#38bdf8', 'Fill'),
      track: color('#ffffff', 'Track'),
    },
  },
]

export const GENERATOR_REGISTRY: ReadonlyMap<string, GeneratorDefinition> = new Map(DEFINITIONS.map((d) => [d.kind, d]))

export const GENERATOR_CATEGORIES: ReadonlyArray<{ id: GeneratorCategory; label: string }> = [
  { id: 'particles', label: 'Particles' },
  { id: 'light', label: 'Light' },
  { id: 'background', label: 'Backgrounds' },
  { id: 'data', label: 'Data' },
]

export function getGeneratorDefinition(kind: string): GeneratorDefinition | undefined {
  return GENERATOR_REGISTRY.get(kind)
}

/** Every param of `kind`, clamped, defaults filled, unknown names dropped. Null for an unknown kind. */
export function clampGeneratorParams(kind: string, params: unknown): Record<string, EffectParamValue> | null {
  const def = GENERATOR_REGISTRY.get(kind)
  if (!def) return null
  const source = params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
  const out: Record<string, EffectParamValue> = {}
  for (const [name, pd] of Object.entries(def.params)) out[name] = clampParam(pd, source[name])
  return out
}

/** A new generator spec with defaults (plus overrides) and a seed. Throws on an unknown kind. */
export function createGenerator(kind: string, params: Record<string, unknown> = {}, seed = 1): ClipGenerator {
  const clamped = clampGeneratorParams(kind, params)
  if (!clamped) throw new Error(`Unknown generator kind: ${kind}`)
  return { kind, params: clamped, seed: Math.max(0, Math.floor(seed)) }
}

/** Param names of `kind` a `gen.<param>` keyframe channel may drive. */
export function keyframeableGeneratorParams(kind: string): string[] {
  const def = GENERATOR_REGISTRY.get(kind)
  if (!def) return []
  return Object.entries(def.params)
    .filter(([, pd]) => pd.type === 'number' && pd.keyframeable)
    .map(([name]) => name)
}
