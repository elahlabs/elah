/**
 * One key of a `setKeyframes` op, written through the engine's writer for its kind.
 * Moved out of `apply.ts` unchanged (MC-1b) so the HTML scene converter's
 * `data-motion` clauses lower to exactly the keys `setKeyframes` writes.
 */

import type { Clip, AnyKeyframeChannel } from '../types'
import type { BaselineContext } from '../elements/keyframes'
import { setColorKeyframe, setKeyframe, setPathKeyframe } from '../elements/keyframes'
import { findBezierPreset } from '../elements/easingPresets'
import { findSpringPreset } from '../elements/springPresets'
import { isValidSteps } from '../resolver/keyframes'
import { TEXT_ANIMATION_EASINGS } from '../resolver/textAnimation'
import type { KeyOp } from './types'

/** How a keyframe's curve becomes `setKeyframe` options. */
export function keyOptions(k: KeyOp) {
  const bezier = k.curve ? findBezierPreset(k.curve)?.bezier : undefined
  const named = k.curve && (TEXT_ANIMATION_EASINGS as ReadonlyArray<string>).includes(k.curve) ? (k.curve as (typeof TEXT_ANIMATION_EASINGS)[number]) : undefined
  // `spring:<id>` is namespaced so it can never be read as the bezier
  // preset of the same name; the two lookups below both miss on it.
  const spring = k.curve?.startsWith('spring:') ? findSpringPreset(k.curve.slice('spring:'.length))?.spring : undefined
  // `steps:<n>` is namespaced like `spring:`; an out-of-range or non-integer n writes nothing.
  const stepsN = k.curve?.startsWith('steps:') ? Number(k.curve.slice('steps:'.length)) : undefined
  const steps = stepsN !== undefined && isValidSteps(stepsN) ? stepsN : undefined
  return {
    ...(named ? { easing: named } : {}),
    ...(bezier ? { easingBezier: [...bezier] as [number, number, number, number] } : {}),
    ...(spring ? { spring: { ...spring } } : {}),
    ...(steps !== undefined ? { steps } : {}),
    ...(k.hold ? { hold: true as const } : {}),
  }
}

/**
 * One key of a `setKeyframes` op through the engine's writer for its kind
 * (AGN-P21): a `vec` key via `setColorKeyframe`, a `path` key via
 * `setPathKeyframe`, anything else via `setKeyframe`. Each writer refuses a clip
 * that cannot take the key by returning `{}`, so an empty patch is a skip.
 */
export function keyPatch(clip: Clip, channel: string, frame: number, k: KeyOp, ctx: BaselineContext): Partial<Clip> {
  const ch = channel as AnyKeyframeChannel
  if (k.vec) return setColorKeyframe(clip, ch, frame, k.vec, keyOptions(k))
  if (k.path !== undefined) return setPathKeyframe(clip, frame, k.path, keyOptions(k))
  return setKeyframe(clip, ch as Parameters<typeof setKeyframe>[1], frame, ctx, k.value, keyOptions(k))
}
