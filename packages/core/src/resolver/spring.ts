/**
 * Spring easing for keyframes (PV-P5a), solved in closed form.
 *
 * A spring is a real second-order system, so its shape is a function of TIME,
 * not of a 0..1 segment parameter. An editor curve has no independent duration
 * — the destination key's frame is the duration — so `springProgress` solves
 * the spring on its own clock and then STRETCHES that clock onto the segment.
 * The consequence, and the whole point of the design: whatever the key spacing,
 * the value lands exactly on the destination key's value on the destination
 * key's frame. A spring therefore behaves like every other curve in the editor
 * (move the keys, the timing moves) instead of fighting the timeline.
 *
 * Two representations, one maths:
 *   - `springDisplacement` / `springSettleSeconds` / `springProgress` are the
 *     normalised, fps-free curve the sampler uses. Time is real seconds but is
 *     then mapped onto 0..1 of the segment.
 *   - `physicalSpring` is the un-normalised, real-time progress, for
 *     expressions in PV-P5b where the spring sets its own duration.
 *
 * Every entry point is total: a stored spring is UNVALIDATED (`readClip`
 * spreads raw clip fields through), so `isValidSpring` gates reads and
 * `normalizeSpring` clamps before any arithmetic. A thrown exception inside the
 * resolver would take down every frame.
 */

import type { KeyframeSpring } from '../types'

/** Envelope height at which a spring counts as settled: 0.5 % of the step. */
export const SPRING_EPSILON = 0.005

/** Clamp bounds. `stiffness` and `mass` are floored/ceiled so omega0 stays
 *  finite and positive; `velocity` is bounded so a typo cannot launch a clip. */
const K_MIN = 1
const K_MAX = 10000
const M_MIN = 0.01
const M_MAX = 100
const V_MIN = -100
const V_MAX = 100

/** Floor on the damping ratio, so a zero-damping key cannot ring for hundreds
 *  of oscillations inside one segment. 0.05 is the usual "bouncy" ceiling. */
const MIN_DAMPING_RATIO = 0.1 // multiplier on 2*sqrt(k*m)

/** Clamped, defaulted spring parameters — the only form the solver sees. */
export interface SpringParams {
  stiffness: number
  damping: number
  mass: number
  velocity: number
}

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo
  return value < lo ? lo : value > hi ? hi : value
}

/**
 * Whether a stored `spring` is usable. An object with finite `stiffness > 0`
 * and `damping >= 0`, and finite `mass`/`velocity` when present. Anything else
 * is false, and the key falls back to its bezier or named easing — a bad
 * spring is a wrong-looking curve, which is recoverable.
 */
export function isValidSpring(s: unknown): s is KeyframeSpring {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false
  const raw = s as Record<string, unknown>
  if (typeof raw.stiffness !== 'number' || !Number.isFinite(raw.stiffness) || raw.stiffness <= 0) return false
  if (typeof raw.damping !== 'number' || !Number.isFinite(raw.damping) || raw.damping < 0) return false
  if (raw.mass !== undefined && (typeof raw.mass !== 'number' || !Number.isFinite(raw.mass))) return false
  if (raw.velocity !== undefined && (typeof raw.velocity !== 'number' || !Number.isFinite(raw.velocity))) return false
  return true
}

/**
 * Clamp a stored spring into the range the solver is defined over: k in
 * 1..10000, m in 0.01..100 (default 1), v in -100..100 (default 0), and the
 * damping raised until the damping ratio is at least `MIN_DAMPING_RATIO`.
 */
export function normalizeSpring(s: KeyframeSpring): SpringParams {
  const stiffness = clamp(s.stiffness, K_MIN, K_MAX)
  const mass = clamp(s.mass ?? 1, M_MIN, M_MAX)
  const damping = Math.max(s.damping, MIN_DAMPING_RATIO * Math.sqrt(stiffness * mass))
  const velocity = clamp(s.velocity ?? 0, V_MIN, V_MAX)
  return { stiffness, damping, mass, velocity }
}

/**
 * Closed-form displacement of a unit step from the target, at `seconds` of
 * spring time. `x(0) === 1` (all the way off target) and the value tends to 0
 * as the spring settles. `velocity` is initial velocity TOWARD the target, so
 * `x'(0) === -velocity`; a positive value starts moving the right way and
 * pre-empts a bounce.
 *
 * All three damping regimes are handled, because the presets deliberately span
 * over-, critical- and under-damped and a generic formulation would be a
 * different function in each third of the range.
 */
export function springDisplacement(p: SpringParams, seconds: number): number {
  const tau = Number.isFinite(seconds) ? seconds : 0
  if (tau <= 0) return 1
  const { stiffness: k, damping: c, mass: m } = p
  const x0 = 1
  const v0 = -p.velocity
  const w0 = Math.sqrt(k / m)
  const zeta = c / (2 * Math.sqrt(k * m))

  if (Math.abs(zeta - 1) < 1e-6) {
    // Critically damped: the repeated root -w0.
    return Math.exp(-w0 * tau) * (x0 + (v0 + w0 * x0) * tau)
  }
  if (zeta < 1) {
    // Under-damped: a decaying sinusoid.
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    return (
      Math.exp(-zeta * w0 * tau) *
      (x0 * Math.cos(wd * tau) + ((v0 + zeta * w0 * x0) / wd) * Math.sin(wd * tau))
    )
  }
  // Over-damped: a sum of two decaying exponentials.
  const s = w0 * Math.sqrt(zeta * zeta - 1)
  const r1 = -zeta * w0 + s
  const r2 = -zeta * w0 - s
  const c1 = (v0 - r2 * x0) / (r1 - r2)
  const c2 = x0 - c1
  return c1 * Math.exp(r1 * tau) + c2 * Math.exp(r2 * tau)
}

/**
 * Upper bound on |displacement| that only decreases from `tau` on, for the
 * critical and over-damped regimes. Under-damped `x` is a sinusoid, so its
 * pointwise |x| is not monotonic and a bound is needed to define "settled".
 */
function envelope(p: SpringParams, tau: number): number {
  const { stiffness: k, damping: c, mass: m } = p
  const x0 = 1
  const v0 = -p.velocity
  const w0 = Math.sqrt(k / m)
  const zeta = c / (2 * Math.sqrt(k * m))
  if (Math.abs(zeta - 1) < 1e-6) return (Math.abs(x0) + Math.abs(v0 + w0 * x0) * tau) * Math.exp(-w0 * tau)
  const s = w0 * Math.sqrt(zeta * zeta - 1)
  const r1 = -zeta * w0 + s
  const r2 = -zeta * w0 - s
  const c1 = (v0 - r2 * x0) / (r1 - r2)
  const c2 = x0 - c1
  return Math.abs(c1) * Math.exp(r1 * tau) + Math.abs(c2) * Math.exp(r2 * tau)
}

const BISECT_ITERATIONS = 60
const MAX_DOUBLINGS = 60

/**
 * Spring time at which the ENVELOPE has decayed to `SPRING_EPSILON` — the
 * smallest time after which |displacement| never exceeds the epsilon again.
 * This is the duration `springProgress` stretches onto a segment.
 *
 * Under-damped it is closed form; the other two regimes bisect, because their
 * envelope is a sum of exponentials with no invertible closed form. The
 * bracket starts at a known-monotonic region (`lo` is chosen where the
 * over-damped envelope is already decreasing, or just past the peak for the
 * critical one) and `hi` is doubled until it straddles the root.
 */
export function springSettleSeconds(p: SpringParams): number {
  const { stiffness: k, damping: c, mass: m } = p
  const x0 = 1
  const v0 = -p.velocity
  const w0 = Math.sqrt(k / m)
  const zeta = c / (2 * Math.sqrt(k * m))
  if (Math.abs(zeta - 1) >= 1e-6 && zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    const a = Math.hypot(x0, (v0 + zeta * w0 * x0) / wd)
    return Math.max(a <= 0 ? 1e-6 : Math.log(a / SPRING_EPSILON) / (zeta * w0), 1e-6)
  }

  // Over-damped decays monotonically from 0; critically damped peaks at
  // 1/w0 - x0/|v0 + w0*x0| (0 when that denominator vanishes).
  const slopeTerm = Math.abs(v0 + w0 * x0)
  let lo =
    Math.abs(zeta - 1) < 1e-6
      ? Math.max(0, 1 / w0 - (slopeTerm === 0 ? 0 : Math.abs(x0) / slopeTerm))
      : 0
  let hi = lo + 1 / w0
  let doublings = 0
  while (envelope(p, hi) > SPRING_EPSILON && doublings < MAX_DOUBLINGS) {
    hi *= 2
    doublings++
  }
  for (let i = 0; i < BISECT_ITERATIONS; i++) {
    const mid = (lo + hi) / 2
    if (envelope(p, mid) > SPRING_EPSILON) lo = mid
    else hi = mid
  }
  return Math.max(hi, 1e-6)
}

/** Normalised params plus the two numbers springProgress needs from them. */
interface Solved {
  p: SpringParams
  T: number
  xT: number
}

const solvedCache = new Map<string, Solved>()

/**
 * `springProgress` and `springSettleSeconds` are called once per key per
 * channel per frame, always with the same few springs, and the settle time is a
 * 60-iteration bisection. Key the result by the NORMALISED params so two
 * structurally equal springs share it. Bounded: a document can name a spring
 * per key, and an unbounded cache would grow with the keyframe count.
 */
function solve(s: KeyframeSpring): Solved {
  const p = normalizeSpring(s)
  const key = `${p.stiffness},${p.damping},${p.mass},${p.velocity}`
  const hit = solvedCache.get(key)
  if (hit) return hit
  const T = springSettleSeconds(p)
  const entry: Solved = { p, T, xT: springDisplacement(p, T) }
  if (solvedCache.size > 256) solvedCache.clear()
  solvedCache.set(key, entry)
  return entry
}

/**
 * Progress 0..1 (it MAY overshoot past 1 — that is the point of a bouncy
 * spring) of the segment arriving at a key carrying `s`, at segment time `t`.
 *
 * Exactly 0 at t = 0 and exactly 1 at t >= 1. The second guarantee is load
 * bearing: the sampler relies on "the value at the key's frame is the key's
 * value", and a spring that arrived at 1 ± 1e-9 would make a bouncy key drift.
 * It is bought by subtracting the residual: without the `- t * xT` term the
 * curve would end at `1 - xT`, which is off by up to the epsilon, and simply
 * clamping it would put a visible kink in the last frame.
 */
export function springProgress(s: KeyframeSpring, t: number): number {
  if (!(t > 0)) return 0
  if (t >= 1) return 1
  const { p, T, xT } = solve(s)
  return 1 - (springDisplacement(p, t * T) - t * xT)
}

/**
 * Un-normalised, real-time spring progress: how far a unit step has travelled
 * `seconds` after release, with the spring setting its OWN duration. This is
 * the Remotion `spring()` shape, and the entry point expressions use
 * (PV-P5b) — it is exported here because the maths must not be written twice.
 */
export function physicalSpring(seconds: number, stiffness = 100, damping = 10, mass = 1): number {
  if (!(seconds > 0)) return 0
  return 1 - springDisplacement(normalizeSpring({ stiffness, damping, mass }), seconds)
}
