/**
 * A layer's or shape group's affine matrix, sampled at property time t.
 * Order matches lottie-web's TransformProperty: translate(−anchor), scale,
 * rotate, translate(position), applied to points in that order — i.e.
 * M = T(p) · R(r) · S(s/100) · T(−a). Skew is out of scope (see `hasSkew`).
 */
import { type Affine, multiply, rotation, scaling, translation } from '../pathOps'
import { isAnimated, sampleProp } from './props'
import type { LottieProp, LottieSplitPosition, LottieTransform } from './types'

function isSplit(p: LottieTransform['p'] | undefined): p is LottieSplitPosition {
  return !!p && typeof p === 'object' && (p as { s?: unknown }).s === true
}

/** Sampled `[x, y]` of a transform's position (handles the split-position form). */
export function positionAt(tr: LottieTransform | undefined, t: number): [number, number] {
  const p = tr?.p
  if (isSplit(p)) {
    const x = sampleProp(p.x, t, [0])[0] ?? 0
    const y = sampleProp(p.y, t, [0])[0] ?? 0
    return [x, y]
  }
  const v = sampleProp(p, t, [0, 0])
  return [v[0] ?? 0, v[1] ?? 0]
}

/** M = T(p) · R(r) · S(s/100) · T(−a) at property time t; skew ignored. */
export function transformMatrix(tr: LottieTransform | undefined, t: number): Affine {
  const a = sampleProp(tr?.a, t, [0, 0])
  const [px, py] = positionAt(tr, t)
  const s = sampleProp(tr?.s, t, [100, 100])
  const rProp = tr?.r ?? tr?.rz
  const rVal = sampleProp(rProp, t, [0])[0] ?? 0

  const ax = a[0] ?? 0
  const ay = a[1] ?? 0
  const sx = (s[0] ?? 100) / 100
  const sy = (s[1] ?? 100) / 100

  return multiply(translation(px, py), multiply(rotation(rVal), multiply(scaling(sx, sy), translation(-ax, -ay))))
}

/** o/100 clamped 0..1; default 1. */
export function transformOpacity(tr: LottieTransform | undefined, t: number): number {
  const o = sampleProp(tr?.o, t, [100])[0] ?? 100
  return Math.min(1, Math.max(0, o / 100))
}

/** sk animated, or static and non-zero. */
export function hasSkew(tr: LottieTransform | undefined): boolean {
  const sk = tr?.sk
  if (sk === undefined) return false
  if (isAnimated(sk)) return true
  const v = sampleProp(sk, 0, [0])[0] ?? 0
  return v !== 0
}

/** Animated props among 'a' 'p' 's' 'r' 'o' (split position counts as 'p'). */
export function animatedProps(tr: LottieTransform | undefined): string[] {
  const result: string[] = []
  if (!tr) return result
  if (isAnimated(tr.a)) result.push('a')

  const p = tr.p
  if (isSplit(p)) {
    if (isAnimated(p.x) || isAnimated(p.y)) result.push('p')
  } else if (isAnimated(p as LottieProp | undefined)) {
    result.push('p')
  }

  if (isAnimated(tr.s)) result.push('s')
  if (isAnimated(tr.r ?? tr.rz)) result.push('r')
  if (isAnimated(tr.o)) result.push('o')
  return result
}
