/**
 * Seeded, deterministic 1-D value noise for shake and handheld presets.
 *
 * Deterministic on purpose: a preset expands into keyframes that are stored in
 * the document, so the same seed must produce the same keys on every machine
 * and every run — `Math.random` would make "apply the same preset twice" give
 * two different clips and make tests meaningless. Integer hashing only, no
 * platform-dependent maths beyond IEEE doubles.
 */

/** A 32-bit integer hash of (seed, i), mapped to [-1, 1]. */
function lattice(seed: number, i: number): number {
  let h = (Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(i | 0, 0x165667b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return (h / 0xffffffff) * 2 - 1
}

/**
 * Smooth noise at position `t` (in lattice units), in [-1, 1]. Lattice points
 * are one unit apart and blended with a smoothstep, so the curve is continuous
 * with no corners — what reads as a camera rather than a glitch.
 */
export function noise1(seed: number, t: number): number {
  const x = Number.isFinite(t) ? t : 0
  const i = Math.floor(x)
  const f = x - i
  const s = f * f * (3 - 2 * f)
  const a = lattice(seed, i)
  const b = lattice(seed, i + 1)
  return a + (b - a) * s
}

export interface ShakeOptions {
  /** Lattice cells per frame: 0.25 = a new direction every 4 frames. */
  frequency: number
  /** Peak offset; output is in [-amplitude, amplitude]. */
  amplitude: number
}

/** One noise offset per frame `0..frames-1`. */
export function shakeSamples(seed: number, frames: number, opts: ShakeOptions): number[] {
  const n = Math.max(0, Math.floor(Number.isFinite(frames) ? frames : 0))
  const out = new Array<number>(n)
  for (let f = 0; f < n; f++) out[f] = noise1(seed, f * opts.frequency) * opts.amplitude
  return out
}
