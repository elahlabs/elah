/**
 * curves.ts — one curve name, the engine's three ways of saying it (AV-1).
 *
 * A `SpecKey.curve` / `SpecDraw.curve` is one of:
 *   - a named easing (`TEXT_ANIMATION_EASINGS`, e.g. `cubic-out`)     -> `easing`
 *   - a `BEZIER_PRESETS` id (e.g. `overshoot`)                       -> `easingBezier`
 *   - `spring:<SPRING_PRESETS id>` (e.g. `spring:bouncy`)            -> `spring`
 *
 * Mirrors how `ops/apply.ts`'s `setKeyframes` op resolves its own `curve`
 * field (`ops/sanitize.ts`'s `CURVES` list is built from the same three
 * registries), so a spec and an assistant plan can never disagree about what
 * a curve name means.
 *
 * An unknown name is an `error` issue and the key keeps `easing: 'linear'`
 * rather than being dropped — a key with no curve at all would be a
 * discontinuity, where a linear one is merely not what the author asked for.
 */

import type { BezierTuple } from '../resolver/bezier'
import type { KeyframeSpring, TextAnimationEasing } from '../types'
import { TEXT_ANIMATION_EASINGS } from '../resolver/textAnimation'
import { findBezierPreset } from '../elements/easingPresets'
import { findSpringPreset } from '../elements/springPresets'
import type { SpecIssue } from './types'

export interface ResolvedCurve {
  easing: TextAnimationEasing
  easingBezier?: BezierTuple
  spring?: KeyframeSpring
}

const NAMED_EASINGS: ReadonlySet<string> = new Set(TEXT_ANIMATION_EASINGS)
const SPRING_PREFIX = 'spring:'

/** `undefined` (no curve authored) resolves to plain `linear`, no issue. */
export function resolveCurve(curve: string | undefined, path: string, issues: SpecIssue[]): ResolvedCurve {
  if (curve === undefined) return { easing: 'linear' }

  if (curve.startsWith(SPRING_PREFIX)) {
    const id = curve.slice(SPRING_PREFIX.length)
    const preset = findSpringPreset(id)
    if (preset) return { easing: 'linear', spring: preset.spring }
    issues.push({ severity: 'error', path, code: 'unknown-curve', message: `unknown spring preset "${id}"` })
    return { easing: 'linear' }
  }

  if (NAMED_EASINGS.has(curve)) return { easing: curve as TextAnimationEasing }

  const bezier = findBezierPreset(curve)
  if (bezier) return { easing: 'linear', easingBezier: bezier.bezier }

  issues.push({ severity: 'error', path, code: 'unknown-curve', message: `unknown curve "${curve}"` })
  return { easing: 'linear' }
}
