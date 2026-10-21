/**
 * Effect bundles (EDX-P9): named looks made of several registry effects —
 * the PDF's "retro" family. A bundle is sugar: applying one appends ordinary
 * effects (each keeps its own id, params and keyframeable channels), so it
 * renders, exports, undoes and can be tweaked like effects added by hand.
 */

import type { Effect } from '../types'
import { clampEffectParams, createEffect, type EffectParamValue } from './registry'

export interface EffectBundle {
  id: string
  label: string
  hint: string
  effects: ReadonlyArray<{ kind: string; params?: Record<string, EffectParamValue> }>
}

export const EFFECT_BUNDLES: ReadonlyArray<EffectBundle> = [
  {
    id: 'vhs-90s',
    label: 'VHS ’90s',
    hint: 'Tape jitter, bleed and snow over a washed grade',
    effects: [
      { kind: 'colorGrade', params: { contrast: 0.9, saturation: 0.8, lift: 0.05, temperature: 0.08 } },
      { kind: 'vhs', params: { amount: 0.7 } },
      { kind: 'grain', params: { amount: 0.15 } },
    ],
  },
  {
    id: 'super-8',
    label: 'Super 8',
    hint: 'Warm, soft, heavy grain, dark corners',
    effects: [
      { kind: 'colorGrade', params: { contrast: 1.05, saturation: 0.85, temperature: 0.25, lift: 0.04, gamma: 1.05 } },
      { kind: 'grain', params: { amount: 0.4, size: 2.2 } },
      { kind: 'vignette', params: { amount: 0.55, radius: 0.7 } },
      { kind: 'gaussianBlur', params: { radius: 1 } },
    ],
  },
  {
    id: 'crt-arcade',
    label: 'CRT arcade',
    hint: 'Curved glass, scanlines and a glow',
    effects: [
      { kind: 'crt', params: { curvature: 0.15, scanlines: 0.45 } },
      { kind: 'bloom', params: { threshold: 0.6, intensity: 0.6, radius: 12 } },
    ],
  },
  {
    id: 'noir-film',
    label: 'Noir film',
    hint: 'Hard black and white with grain',
    effects: [
      { kind: 'colorGrade', params: { contrast: 1.35, saturation: 0, lift: -0.04, gamma: 0.95 } },
      { kind: 'grain', params: { amount: 0.3 } },
      { kind: 'vignette', params: { amount: 0.5 } },
    ],
  },
  {
    id: 'dreamy',
    label: 'Dreamy glow',
    hint: 'Soft bloom and lifted pastels',
    effects: [
      { kind: 'colorGrade', params: { contrast: 0.9, saturation: 0.9, lift: 0.06, temperature: 0.05 } },
      { kind: 'bloom', params: { threshold: 0.5, intensity: 1.1, radius: 40 } },
    ],
  },
  {
    id: 'digital-glitch',
    label: 'Digital glitch',
    hint: 'Blocks, tear and RGB split',
    effects: [
      { kind: 'glitchBlocks', params: { amount: 0.6 } },
      { kind: 'rgbSplit', params: { amount: 0.006 } },
      { kind: 'scanlines', params: { intensity: 0.15 } },
    ],
  },
]

export function findEffectBundle(id: string): EffectBundle | undefined {
  return EFFECT_BUNDLES.find((b) => b.id === id)
}

/** Fresh effect entries for a bundle (new ids, clamped params). Empty for an unknown id. */
export function bundleEffects(id: string): Effect[] {
  const bundle = findEffectBundle(id)
  if (!bundle) return []
  return bundle.effects.map(({ kind, params }) => {
    const e = createEffect(kind)
    return { ...e, params: clampEffectParams(kind, { ...e.params, ...params }) ?? e.params }
  })
}
