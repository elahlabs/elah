/**
 * Named cubic-bezier curves (EDX-P6) — the curve editor's preset row and the
 * vocabulary an agent uses for "smooth", "snappy", "overshoot". Stored on a
 * key as `easingBezier`; the named `easing` set stays for the simple picker.
 */

import type { BezierTuple } from '../resolver/bezier'
import type { TextAnimationEasing } from '../types'

export interface BezierPreset {
  id: string
  label: string
  bezier: BezierTuple
}

export const BEZIER_PRESETS: ReadonlyArray<BezierPreset> = [
  { id: 'ease', label: 'Ease', bezier: [0.25, 0.1, 0.25, 1] },
  { id: 'ease-in', label: 'Ease in', bezier: [0.42, 0, 1, 1] },
  { id: 'ease-out', label: 'Ease out', bezier: [0, 0, 0.58, 1] },
  { id: 'ease-in-out', label: 'Ease in-out', bezier: [0.42, 0, 0.58, 1] },
  { id: 'snappy', label: 'Snappy', bezier: [0.2, 0.9, 0.1, 1] },
  { id: 'smooth', label: 'Smooth', bezier: [0.65, 0, 0.35, 1] },
  { id: 'overshoot', label: 'Overshoot', bezier: [0.34, 1.56, 0.64, 1] },
  { id: 'anticipate', label: 'Anticipate', bezier: [0.36, -0.4, 0.6, 1] },
]

export type BezierPresetId = (typeof BEZIER_PRESETS)[number]['id']

export function findBezierPreset(id: string): BezierPreset | undefined {
  return BEZIER_PRESETS.find((p) => p.id === id)
}

/**
 * A bezier that approximates a named easing, so the curve editor can show
 * handles on a segment that has only a name and turn it into a custom curve
 * the moment a handle moves. Elastic and bounce have no cubic equivalent;
 * they start from CSS `ease`.
 */
export function approxBezierFor(easing: TextAnimationEasing): [number, number, number, number] {
  switch (easing) {
    case 'linear':
      return [0, 0, 1, 1]
    case 'quad-in':
      return [0.55, 0.085, 0.68, 0.53]
    case 'quad-out':
      return [0.25, 0.46, 0.45, 0.94]
    case 'quad-in-out':
      return [0.455, 0.03, 0.515, 0.955]
    case 'cubic-out':
      return [0.215, 0.61, 0.355, 1]
    case 'expo-out':
      return [0.19, 1, 0.22, 1]
    case 'back-in':
      return [0.6, -0.28, 0.735, 0.045]
    case 'back-out':
      return [0.175, 0.885, 0.32, 1.275]
    case 'sine-in':
      return [0.12, 0, 0.39, 0]
    case 'sine-out':
      return [0.61, 1, 0.88, 1]
    case 'sine-in-out':
      return [0.37, 0, 0.63, 1]
    case 'cubic-in':
      return [0.32, 0, 0.67, 0]
    case 'cubic-in-out':
      return [0.65, 0, 0.35, 1]
    case 'quart-in':
      return [0.5, 0, 0.75, 0]
    case 'quart-out':
      return [0.25, 1, 0.5, 1]
    case 'quart-in-out':
      return [0.76, 0, 0.24, 1]
    case 'quint-in':
      return [0.64, 0, 0.78, 0]
    case 'quint-out':
      return [0.22, 1, 0.36, 1]
    case 'quint-in-out':
      return [0.83, 0, 0.17, 1]
    case 'expo-in':
      return [0.7, 0, 0.84, 0]
    case 'expo-in-out':
      return [0.87, 0, 0.13, 1]
    case 'circ-in':
      return [0.55, 0, 1, 0.45]
    case 'circ-out':
      return [0, 0.55, 0.45, 1]
    case 'circ-in-out':
      return [0.85, 0, 0.15, 1]
    case 'back-in-out':
      return [0.68, -0.6, 0.32, 1.6]
    default:
      return [0.25, 0.1, 0.25, 1]
  }
}

/** The preset whose curve equals `b` (within 1e-3), if any. */
export function matchBezierPreset(b: BezierTuple | undefined): BezierPreset | undefined {
  if (!b) return undefined
  return BEZIER_PRESETS.find((p) => p.bezier.every((v, i) => Math.abs(v - b[i]!) < 1e-3))
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

/** The time-reverse of a cubic-bezier: `(x1,y1,x2,y2)` becomes `(1-x2, 1-y2, 1-x1, 1-y1)`. */
export function reverseBezier(b: BezierTuple): BezierTuple {
  return [round6(1 - b[2]), round6(1 - b[3]), round6(1 - b[0]), round6(1 - b[1])]
}

/**
 * The ease that plays a curve backwards (MOT-7 yoyo): `X-in` and `X-out` swap, `X-in-out` and `linear` map to
 * themselves, and a `cubic-bezier(x1,y1,x2,y2)` string or bezier preset id becomes the mirrored cubic
 * (`ease-in` and `ease-out` swap exactly; other presets come back as a `cubic-bezier(...)` string).
 * Anything else (a `spring:` id, `steps:n`, an unknown name) maps to itself: a spring has no time-reverse and
 * a staircase stays a staircase. Reversing twice returns the original for named and cubic-bezier input.
 */
export function reverseEase(ease: string): string {
  if (/-in-out$/.test(ease) || ease === 'linear') return ease
  if (/-in$/.test(ease) && !ease.startsWith('ease')) return ease.replace(/-in$/, '-out')
  if (/-out$/.test(ease) && !ease.startsWith('ease')) return ease.replace(/-out$/, '-in')
  const cubic = /^cubic-bezier\(([^)]*)\)$/.exec(ease)
  const preset = cubic ? undefined : findBezierPreset(ease)
  const tuple = cubic ? cubic[1].split(',').map((n) => parseFloat(n)) : preset ? [...preset.bezier] : undefined
  if (!tuple || tuple.length !== 4 || tuple.some((n) => !Number.isFinite(n))) return ease
  const r = reverseBezier(tuple as unknown as BezierTuple)
  const match = BEZIER_PRESETS.find((p) => p.bezier.every((v, i) => Math.abs(v - r[i]!) < 1e-6))
  if (match && !cubic) return match.id
  return `cubic-bezier(${r.join(',')})`
}
