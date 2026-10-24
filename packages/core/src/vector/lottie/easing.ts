/**
 * Lottie key handles → the engine's per-key easing (PQ-2a). Pure.
 *
 * A Lottie key's `o`/`i` handles describe the segment from that key to the
 * NEXT one; the engine stores the curve on the ARRIVING key. So the curve of
 * Lottie key `n` lands on engine key `n + 1`, and an `h:1` on key `n` is
 * `hold: true` on key `n`. Anything that is not exactly one curve for the whole
 * segment (different curves per dimension, an x handle outside 0..1) returns
 * `null`: the caller samples that channel instead.
 */
import type { LottieBezierHandle, LottieKey } from './types'

export type NativeEase =
  | { kind: 'linear' }
  | { kind: 'bezier'; bezier: [number, number, number, number] }

/** What the segment leaving Lottie key `n` becomes. */
export type SegmentEase = { hold: true } | { hold: false; ease: NativeEase }

function dims(h: number | number[] | undefined): number[] | null {
  if (h === undefined) return null
  const arr = Array.isArray(h) ? h : [h]
  if (arr.length === 0 || !arr.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  return arr
}

/** One number when every dimension agrees (within 1e-9), else null. */
function uniform(h: number | number[] | undefined): number | null {
  const arr = dims(h)
  if (!arr) return null
  const first = arr[0]!
  return arr.every((v) => Math.abs(v - first) < 1e-9) ? first : null
}

/**
 * The curve of the segment leaving `key`, or null when it is not 1:1.
 * A key with no handles at all is linear (that is what the Lottie sampler does).
 */
export function segmentEasing(key: LottieKey): SegmentEase | null {
  if (key.h === 1) return { hold: true }
  const o: LottieBezierHandle | undefined = key.o
  const i: LottieBezierHandle | undefined = key.i
  if (o === undefined && i === undefined) return { hold: false, ease: { kind: 'linear' } }
  if (o === undefined || i === undefined) return null
  const ox = uniform(o.x)
  const oy = uniform(o.y)
  const ix = uniform(i.x)
  const iy = uniform(i.y)
  if (ox === null || oy === null || ix === null || iy === null) return null
  if (ox < 0 || ox > 1 || ix < 0 || ix > 1) return null
  if (ox === 0 && oy === 0 && ix === 1 && iy === 1) return { hold: false, ease: { kind: 'linear' } }
  return { hold: false, ease: { kind: 'bezier', bezier: [ox, oy, ix, iy] } }
}

/** Put a segment's curve on the engine key that ARRIVES at it. */
export function easingFields(ease: NativeEase): { easing: 'linear'; easingBezier?: [number, number, number, number] } {
  return ease.kind === 'linear' ? { easing: 'linear' } : { easing: 'linear', easingBezier: ease.bezier }
}
