/**
 * Transition registry (EDX-P9c) — every `Transition.kind`, in picker order.
 *
 * Pure data: the document reader, the timeline picker, the Browser's
 * Transitions tab and the agent's op schema all read this list, so a new
 * kind is added in one place. The GPU implementation (one shader, a
 * `uKind` switch) lives in `renderer/gpu/transitions.ts`.
 */

import type { TransitionKind } from '../types'

export interface TransitionDefinition {
  kind: TransitionKind
  label: string
  hint: string
  /** Takes a direction (left/right/up/down). */
  directional: boolean
  /** Drawable by the Canvas2D export fallback (no WebGL2). */
  canvas2d: boolean
  /** Version-1/2 builds know it (projectDocument's version stamp). */
  legacy: boolean
}

export const TRANSITION_REGISTRY: ReadonlyArray<TransitionDefinition> = [
  { kind: 'fade', label: 'Cross-fade', hint: 'Dissolve from one clip to the next', directional: false, canvas2d: true, legacy: true },
  { kind: 'slide', label: 'Slide', hint: 'The outgoing clip slides away', directional: true, canvas2d: true, legacy: true },
  { kind: 'wipe', label: 'Wipe', hint: 'A hard edge sweeps across', directional: false, canvas2d: true, legacy: true },
  { kind: 'zoom', label: 'Zoom', hint: 'Punch through into the next clip', directional: false, canvas2d: false, legacy: false },
  { kind: 'spin', label: 'Spin', hint: 'Rotate out, rotate in', directional: false, canvas2d: false, legacy: false },
  { kind: 'whip', label: 'Whip pan', hint: 'A fast blurred pan between clips', directional: true, canvas2d: false, legacy: false },
  { kind: 'glitchCut', label: 'Glitch cut', hint: 'A burst of digital glitch at the cut', directional: false, canvas2d: false, legacy: false },
  { kind: 'warpDissolve', label: 'Warp dissolve', hint: 'A noisy, melting dissolve', directional: false, canvas2d: false, legacy: false },
  { kind: 'lumaWipe', label: 'Luma fade', hint: 'Dark areas give way first', directional: false, canvas2d: false, legacy: false },
]

export const TRANSITION_KINDS: ReadonlyArray<TransitionKind> = TRANSITION_REGISTRY.map((t) => t.kind)

export function getTransitionDefinition(kind: string): TransitionDefinition | undefined {
  return TRANSITION_REGISTRY.find((t) => t.kind === kind)
}

export function isTransitionKind(kind: unknown): kind is TransitionKind {
  return typeof kind === 'string' && TRANSITION_REGISTRY.some((t) => t.kind === kind)
}
