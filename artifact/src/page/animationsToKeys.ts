/**
 * CSS animation -> native keys (HF-3; PLAN-MOTION-CODE section 4.4).
 *
 * Input is, per channel, the browser's own per-frame value series (the ORACLE, produced by seeking the page and
 * reading computed style) plus the timing of the animations that drive the channel group. Output is native
 * keyframes:
 *
 *   1. Unroll delay, iterations and direction into key boundaries (every keyframe offset of every iteration,
 *      plus the start and end of the active phase), snap each boundary to a frame (floor or ceil, whichever the
 *      segment reproduces better), and write one key per boundary carrying the browser's value there and the
 *      CSS easing of the segment that arrives at it (`cubic-bezier` / named eases -> `easingBezier`,
 *      `steps(n)` jump-end -> `steps`, a reversed iteration -> the reversed bezier).
 *   2. Run the engine's own sampler (`sampleChannel`) over those keys and compare with the oracle at every
 *      frame. Within 0.5% of the channel's range -> keep them ("native"). Otherwise the channel's keys are
 *      replaced by per-frame samples thinned to 0.25% ("sampled") and the reason is reported.
 *
 * No matrix decomposition of keyframe lists happens here: the series already hold the browser's resolved value,
 * so a transform list that mismatches across keys, a 720 degree spin or an overshooting bezier is handled by the
 * same oracle check as everything else.
 */

import { cubicBezier, generateId, sampleChannel, type Keyframe } from '@elah/core'

export const NATIVE_TOLERANCE = 0.005
export const SAMPLED_TOLERANCE = 0.0025
/** More boundaries than this and the native attempt is skipped (a long ambient loop is just sampled). */
const MAX_BOUNDARIES = 160

export type Direction = 'normal' | 'reverse' | 'alternate' | 'alternate-reverse'

export interface TimingInfo {
  name: string
  /** Start of the active phase, ms from the page start (CSS `animation-delay`, may be negative). */
  startMs: number
  /** One iteration, ms. */
  durationMs: number
  iterations: number
  direction: Direction
  /** Length of the active phase, ms (Infinity for an infinite animation). */
  activeMs: number
  /** False when the effect itself carries a non-linear easing (CSS animations never do). */
  effectEasingLinear: boolean
  /** Keyframes of this animation that touch the channel group, sorted by offset. */
  keyframes: Array<{ offset: number; easing: string }>
}

export interface ChannelInput {
  channel: string
  /** The browser's value at every frame 0..frames-1. */
  series: number[]
  /** The value the channel holds statically (its clip's authored value). */
  baseline: number
  /** Differences below this are not animation. */
  eps: number
  /** The renderer clamps the channel to this range (opacity 0..1), so the oracle compares clamped values. */
  clamp?: [number, number]
}

export type ChannelMode = 'native' | 'sampled' | 'static' | 'unchanged'

export interface ChannelResult {
  channel: string
  keys: Keyframe[]
  mode: ChannelMode
  /** Worst error of the written keys against the oracle, as a fraction of the channel range. */
  maxErr: number
  reason?: string
}

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

export interface EaseSpec {
  easingBezier?: [number, number, number, number]
  steps?: number
}

const KEYWORDS: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
}
const LINEAR: EaseSpec = {}

/** A CSS `<easing-function>` as the engine can store it, or null (`linear()`, jump-start, ...). */
export function parseCssEasing(raw: string): EaseSpec | null {
  const e = raw.trim().toLowerCase()
  if (e === 'linear') return LINEAR
  if (KEYWORDS[e]) return { easingBezier: [...KEYWORDS[e]] as [number, number, number, number] }
  if (e === 'step-end') return { steps: 1 }
  const cb = /^cubic-bezier\(([^)]*)\)$/.exec(e)
  if (cb) {
    const n = cb[1].split(',').map((s) => parseFloat(s))
    if (n.length === 4 && n.every(Number.isFinite) && n[0] >= 0 && n[0] <= 1 && n[2] >= 0 && n[2] <= 1) return { easingBezier: [n[0], n[1], n[2], n[3]] }
    return null
  }
  const st = /^steps\(\s*(\d+)\s*(?:,\s*([a-z-]+)\s*)?\)$/.exec(e)
  if (st) {
    const n = parseInt(st[1], 10)
    const jump = st[2] ?? 'end'
    if ((jump === 'end' || jump === 'jump-end') && n >= 1 && n <= 64) return { steps: n }
    return null
  }
  return null
}

/** The curve of a segment traversed backwards: g(s) = 1 - f(1 - s). */
export function reverseEase(s: EaseSpec | null): EaseSpec | null {
  if (!s) return null
  if (s.steps !== undefined) return null
  if (!s.easingBezier) return LINEAR
  const [x1, y1, x2, y2] = s.easingBezier
  return { easingBezier: [1 - x2, 1 - y2, 1 - x1, 1 - y1] }
}

// ---------------------------------------------------------------------------
// Boundaries and per-segment easing
// ---------------------------------------------------------------------------

function offsetsOf(a: TimingInfo): number[] {
  const set = new Set<number>([0, 1])
  for (const k of a.keyframes) if (k.offset >= 0 && k.offset <= 1) set.add(k.offset)
  return [...set].sort((x, y) => x - y)
}

const reversedAt = (dir: Direction, k: number): boolean => dir === 'reverse' || (dir === 'alternate' && k % 2 === 1) || (dir === 'alternate-reverse' && k % 2 === 0)

/** Every time (ms, within 0..maxMs) at which a segment's curve can change. */
export function boundaryTimes(timings: readonly TimingInfo[], maxMs: number): number[] {
  const out = new Set<number>([0, maxMs])
  const add = (t: number) => {
    if (t > 0 && t < maxMs) out.add(Math.round(t * 1e6) / 1e6)
  }
  for (const a of timings) {
    const offs = offsetsOf(a)
    const end = Number.isFinite(a.activeMs) ? a.startMs + a.activeMs : Infinity
    add(a.startMs)
    add(end)
    if (!(a.durationMs > 0)) continue
    const first = Math.max(0, Math.floor((0 - a.startMs) / a.durationMs))
    for (let k = first; ; k++) {
      const t0 = a.startMs + k * a.durationMs
      if (t0 > maxMs || t0 >= end) break
      for (const o of offs) {
        const p = reversedAt(a.direction, k) ? 1 - o : o
        const t = t0 + p * a.durationMs
        if (t < end) add(t)
      }
      if (out.size > MAX_BOUNDARIES * 3) break
    }
  }
  return [...out].sort((x, y) => x - y)
}

/** The curve of the segment around `tMs`: null when two animations overlap or the curve cannot be mapped. */
export function segmentEase(timings: readonly TimingInfo[], tMs: number): EaseSpec | null {
  const active = timings.filter((a) => tMs >= a.startMs && tMs < a.startMs + a.activeMs)
  if (active.length === 0) return LINEAR
  if (active.length > 1) return null
  const a = active[0]!
  if (!a.effectEasingLinear || !(a.durationMs > 0)) return null
  const local = tMs - a.startMs
  const k = Math.floor(local / a.durationMs)
  const p = (local - k * a.durationMs) / a.durationMs
  const rev = reversedAt(a.direction, k)
  const dp = rev ? 1 - p : p
  const kfs = a.keyframes
  if (kfs.length === 0) return null
  let i = -1
  for (let j = 0; j < kfs.length; j++) if (kfs[j]!.offset <= dp + 1e-9) i = j
  // Before the first specified keyframe the implicit one takes that keyframe's curve.
  const css = kfs[Math.max(0, i)]!.easing
  const spec = parseCssEasing(css)
  return rev ? reverseEase(spec) : spec
}

/** The sub-curve of a CSS easing between interval progress `ua` and `ub` (ua < ub), renormalised to 0..1 (de Casteljau). */
export function subBezier(b: Bez, ua: number, ub: number): Bez | null {
  const [x1, y1, x2, y2] = b
  const X = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t
  const solve = (u: number): number => {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2
      if (X(m) < u) lo = m
      else hi = m
    }
    return (lo + hi) / 2
  }
  type P = [number, number]
  const lerp = (a: P, c: P, t: number): P => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]
  const split = (p: [P, P, P, P], t: number): [[P, P, P, P], [P, P, P, P]] => {
    const a = lerp(p[0], p[1], t)
    const bb = lerp(p[1], p[2], t)
    const c = lerp(p[2], p[3], t)
    const d = lerp(a, bb, t)
    const e = lerp(bb, c, t)
    const f = lerp(d, e, t)
    return [[p[0], a, d, f], [f, e, c, p[3]]]
  }
  const ta = solve(Math.min(1, Math.max(0, ua)))
  const tb = solve(Math.min(1, Math.max(0, ub)))
  if (!(tb - ta > 1e-9)) return null
  const full: [P, P, P, P] = [[0, 0], [x1, y1], [x2, y2], [1, 1]]
  const left = split(full, tb)[0]
  const q = split(left, ta / tb)[1]
  const dx = q[3][0] - q[0][0]
  const dy = q[3][1] - q[0][1]
  if (Math.abs(dx) < 1e-9 || Math.abs(dy) < 1e-9) return null
  const nx = (v: number) => Math.min(1, Math.max(0, (v - q[0][0]) / dx))
  const ny = (v: number) => (v - q[0][1]) / dy
  return [nx(q[1][0]), ny(q[1][1]), nx(q[2][0]), ny(q[2][1])]
}

/**
 * The exact curve of the engine segment [ma, mb] (ms): the part of the CSS keyframe interval's easing that the
 * segment covers, as a bezier. null when the segment is not inside one interval of a single animation.
 */
export function exactSegmentEase(timings: readonly TimingInfo[], ma: number, mb: number): EaseSpec | null {
  const mid = (ma + mb) / 2
  const active = timings.filter((a) => mid >= a.startMs && mid < a.startMs + a.activeMs)
  if (active.length !== 1) return null
  const a = active[0]!
  if (!a.effectEasingLinear || !(a.durationMs > 0) || a.keyframes.length === 0) return null
  const local = mid - a.startMs
  const k = Math.floor(local / a.durationMs)
  const rev = reversedAt(a.direction, k)
  const dpAt = (t: number): number => {
    const p = (t - a.startMs - k * a.durationMs) / a.durationMs
    return rev ? 1 - p : p
  }
  const dpMid = dpAt(mid)
  const kfs = a.keyframes
  let i = -1
  for (let j = 0; j < kfs.length; j++) if (kfs[j]!.offset <= dpMid + 1e-9) i = j
  const off0 = i < 0 ? 0 : kfs[i]!.offset
  const off1 = (i + 1 < kfs.length ? kfs[i + 1]!.offset : 1) as number
  if (!(off1 - off0 > 1e-9)) return null
  const spec = parseCssEasing(kfs[Math.max(0, i)]!.easing)
  if (!spec || spec.steps !== undefined) return null
  if (!spec.easingBezier) return LINEAR
  const ua = (dpAt(ma) - off0) / (off1 - off0)
  const ub = (dpAt(mb) - off0) / (off1 - off0)
  const lo = Math.min(ua, ub)
  const hi = Math.max(ua, ub)
  if (lo < -0.02 || hi > 1.02) return null
  const sub = subBezier(spec.easingBezier, lo, hi)
  if (!sub) return null
  const forward: EaseSpec = { easingBezier: sub }
  return ub < ua ? reverseEase(forward) : forward
}

// ---------------------------------------------------------------------------
// Key construction
// ---------------------------------------------------------------------------

function makeKey(frame: number, value: number, ease: EaseSpec | null): Keyframe {
  const e = ease ?? LINEAR
  return {
    id: generateId(),
    frame,
    value,
    easing: 'linear',
    ...(e.easingBezier ? { easingBezier: [...e.easingBezier] as [number, number, number, number] } : {}),
    ...(e.steps !== undefined ? { steps: e.steps } : {}),
  }
}

function rangeOf(series: readonly number[]): number {
  let lo = Infinity
  let hi = -Infinity
  for (const v of series) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return hi - lo
}

/** Worst |engine - oracle| over the series, as a fraction of `range` (or absolute when range ~ 0). */
function worstError(keys: Keyframe[], series: readonly number[], from = 0, to = series.length - 1, clamp?: [number, number]): { err: number; frame: number } {
  let worst = 0
  let at = from
  for (let f = from; f <= to; f++) {
    let got = sampleChannel(keys, f)
    if (clamp && got !== undefined) got = Math.min(clamp[1], Math.max(clamp[0], got))
    const d = got === undefined || !Number.isFinite(got) ? Infinity : Math.abs(got - series[f]!)
    if (d > worst) {
      worst = d
      at = f
    }
  }
  return { err: worst, frame: at }
}

/** Greedy furthest-reaching thinning: the frames whose linear interpolation stays within `tol` of the series. */
export function thinFrames(series: readonly number[], tol: number): number[] {
  const n = series.length
  if (n === 0) return []
  const keep = [0]
  let a = 0
  while (a < n - 1) {
    let best = a + 1
    for (let b = a + 2; b < n; b++) {
      let ok = true
      for (let i = a + 1; i < b; i++) {
        const lerp = series[a]! + ((series[b]! - series[a]!) * (i - a)) / (b - a)
        if (Math.abs(lerp - series[i]!) > tol) {
          ok = false
          break
        }
      }
      if (!ok) break
      best = b
    }
    keep.push(best)
    a = best
  }
  return keep
}

function sampledKeys(series: readonly number[], range: number): Keyframe[] {
  const tol = Math.max(range * SAMPLED_TOLERANCE, 1e-9)
  return thinFrames(series, tol).map((f) => makeKey(f, series[f]!, LINEAR))
}

/** Remove interior keys while the engine still reproduces the series within `tol`. */
function prune(keys: Keyframe[], series: readonly number[], tol: number, clamp?: [number, number]): Keyframe[] {
  let cur = keys
  for (let i = 1; i < cur.length - 1; ) {
    const trial = cur.filter((_, k) => k !== i)
    if (worstError(trial, series, 0, series.length - 1, clamp).err <= tol) cur = trial
    else i++
  }
  return cur
}
type Bez = [number, number, number, number]

/**
 * Fit a cubic-bezier to `(s, progress)` samples (Nelder-Mead on the max error). Used when snapping a boundary to a
 * whole frame leaves the CSS curve a fraction of a frame off: the key times are integers, so the curve is bent to
 * pass through what the browser showed at those frames. x handles stay in 0..1 (the engine clamps them).
 */
export function fitBezier(pts: ReadonlyArray<{ s: number; p: number }>, init: Bez): { bez: Bez; err: number } {
  const clampB = (b: Bez): Bez => [Math.min(1, Math.max(0, b[0])), Math.max(-1.5, Math.min(2.5, b[1])), Math.min(1, Math.max(0, b[2])), Math.max(-1.5, Math.min(2.5, b[3]))]
  const cost = (b: Bez): number => {
    const c = clampB(b)
    let worst = 0
    for (const { s, p } of pts) worst = Math.max(worst, Math.abs(cubicBezier(c, s) - p))
    return worst
  }
  const simplex: Array<{ v: Bez; c: number }> = [{ v: clampB(init), c: 0 }]
  simplex[0]!.c = cost(simplex[0]!.v)
  for (let i = 0; i < 4; i++) {
    const v = [...simplex[0]!.v] as Bez
    v[i] += i % 2 === 0 ? 0.15 : 0.3
    const c = clampB(v)
    simplex.push({ v: c, c: cost(c) })
  }
  for (let iter = 0; iter < 260; iter++) {
    simplex.sort((a, b) => a.c - b.c)
    if (simplex[0]!.c < 1e-5) break
    const worst = simplex[4]!
    const centroid = [0, 0, 0, 0]
    for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) centroid[k]! += simplex[i]!.v[k]! / 4
    const along = (t: number): Bez => clampB(centroid.map((c, k) => c + t * (worst.v[k]! - c)) as Bez)
    const refl = along(-1)
    const rc = cost(refl)
    if (rc < simplex[0]!.c) {
      const exp = along(-2)
      const ec = cost(exp)
      simplex[4] = ec < rc ? { v: exp, c: ec } : { v: refl, c: rc }
    } else if (rc < simplex[3]!.c) simplex[4] = { v: refl, c: rc }
    else {
      const con = along(rc < worst.c ? -0.5 : 0.5)
      const cc = cost(con)
      if (cc < Math.min(rc, worst.c)) simplex[4] = { v: con, c: cc }
      else {
        const best = simplex[0]!.v
        for (let i = 1; i < 5; i++) {
          const v = clampB(simplex[i]!.v.map((x, k) => best[k]! + 0.5 * (x - best[k]!)) as Bez)
          simplex[i] = { v, c: cost(v) }
        }
      }
    }
  }
  simplex.sort((a, b) => a.c - b.c)
  return { bez: clampB(simplex[0]!.v), err: simplex[0]!.c }
}

/** Drop interior keys that sit on a flat linear run (same value either side). */
function dedupe(keys: Keyframe[]): Keyframe[] {
  const out: Keyframe[] = []
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!
    const prev = keys[i - 1]
    const next = keys[i + 1]
    const flat = prev && next && Math.abs(prev.value - k.value) < 1e-9 && Math.abs(next.value - k.value) < 1e-9 && next.easingBezier === undefined && next.steps === undefined
    if (!flat) out.push(k)
  }
  return out
}

/**
 * Native keys for a channel group from shared boundaries. `series[c]` are the oracle series of the group's
 * channels, all `frames` long. Returns, per channel, keys that already passed or failed the oracle.
 */
export function buildGroup(fps: number, frames: number, timings: readonly TimingInfo[], channels: readonly ChannelInput[]): ChannelResult[] {
  const last = frames - 1
  const results: ChannelResult[] = []
  const ranges = channels.map((c) => rangeOf(c.series))

  // Channels that do not move need no keys (or one, when the constant differs from the authored value).
  const moving: number[] = []
  channels.forEach((c, i) => {
    if (ranges[i]! > c.eps) moving.push(i)
  })

  const planned = new Map<number, ChannelResult>()
  if (moving.length > 0 && last > 0) {
    const maxMs = (last / fps) * 1000
    const times = boundaryTimes(timings, maxMs)
    let nativeOk = times.length <= MAX_BOUNDARIES
    const bf = times.map((t) => (t / 1000) * fps)
    const eases: Array<EaseSpec | null> = [null]
    for (let j = 1; j < times.length; j++) eases.push(segmentEase(timings, (times[j - 1]! + times[j]!) / 2))
    const chosen: number[] = [0]
    const chosenEase: Array<EaseSpec | null> = [null]
    const curved: boolean[] = [false]
    if (nativeOk) {
      // Every boundary lands on a whole frame. A boundary between frames gets BOTH neighbours as keys (a one-frame
      // linear step between them), so the curve after it can be bent to start from the frame after the true start.
      for (let j = 1; j < bf.length; j++) {
        // B = the first frame at or after the boundary; A = the last frame before it (the curve arrives there).
        // (A boundary on a whole frame still belongs to the earlier phase there: the browser shows an iteration
        // wrap one frame late, so the later key goes on the next frame.)
        const after = Math.ceil(bf[j]! + 1e-6)
        const ce = Math.min(last, after)
        const fl = Math.min(last, after - 1)
        const arrived = fl > chosen[chosen.length - 1]!
        if (arrived) {
          chosen.push(fl)
          chosenEase.push(eases[j] ?? null)
          curved.push(true)
        }
        if (ce > chosen[chosen.length - 1]!) {
          chosen.push(ce)
          chosenEase.push(arrived ? LINEAR : (eases[j] ?? null))
          curved.push(!arrived)
        }
        if (chosen.length > MAX_BOUNDARIES) {
          nativeOk = false
          break
        }
      }
      if (nativeOk && chosen[chosen.length - 1] !== last) {
        chosen.push(last)
        chosenEase.push(LINEAR)
        curved.push(false)
      }
      // The exact curve of each snapped segment: the part of the CSS interval's easing it covers.
      for (let j = 1; j < chosen.length; j++) {
        if (!curved[j]) continue
        const ex = exactSegmentEase(timings, (chosen[j - 1]! / fps) * 1000, (chosen[j]! / fps) * 1000)
        if (ex) chosenEase[j] = ex
      }
    }
    if (nativeOk) {
      // Snapping boundaries to whole frames leaves some segments a fraction of a frame off (and a loop cut by the
      // end of the video is only part of its curve): bend those segments' beziers to what the browser showed.
      for (let j = 1; j < chosen.length; j++) {
        const fa = chosen[j - 1]!
        const fb = chosen[j]!
        const cur = chosenEase[j] ?? null
        if (cur && cur.steps !== undefined) continue
        let e = 0
        for (const ci of moving) {
          const c = channels[ci]!
          const rg = Math.max(ranges[ci]!, c.eps)
          e = Math.max(e, worstError([makeKey(fa, c.series[fa]!, null), makeKey(fb, c.series[fb]!, cur)], c.series, fa, fb, c.clamp).err / rg)
        }
        if (e <= 0.0015 || fb - fa < 2) continue
        let dom = -1
        let domSpan = 0
        for (const ci of moving) {
          const c = channels[ci]!
          const span = Math.abs(c.series[fb]! - c.series[fa]!) / Math.max(ranges[ci]!, c.eps)
          if (span > domSpan) {
            domSpan = span
            dom = ci
          }
        }
        if (dom < 0 || domSpan < 1e-3) continue
        const c = channels[dom]!
        const va = c.series[fa]!
        const vb = c.series[fb]!
        const pts: Array<{ s: number; p: number }> = []
        for (let f = fa; f <= fb; f++) pts.push({ s: (f - fa) / (fb - fa), p: (c.series[f]! - va) / (vb - va) })
        const fit = fitBezier(pts, cur?.easingBezier ?? [1 / 3, 1 / 3, 2 / 3, 2 / 3])
        if ((fit.err * Math.abs(vb - va)) / Math.max(ranges[dom]!, c.eps) <= 0.002) chosenEase[j] = { easingBezier: fit.bez }
      }
    }
    for (const ci of moving) {
      const c = channels[ci]!
      const range = ranges[ci]!
      const tol = Math.max(range * NATIVE_TOLERANCE, 1e-9)
      let reason: string | undefined
      let keys: Keyframe[] | null = null
      if (!nativeOk) reason = `more than ${MAX_BOUNDARIES} key boundaries (long loop)`
      else {
        // A segment whose curve cannot be mapped is only acceptable while the channel is flat across it.
        let blocked: string | undefined
        const built: Keyframe[] = []
        for (let j = 0; j < chosen.length; j++) {
          const f = chosen[j]!
          const ease = chosenEase[j] ?? null
          if (j > 0 && ease === null) {
            const flat = Math.abs(c.series[f]! - c.series[chosen[j - 1]!]!) <= tol
            if (!flat) blocked = 'easing not representable (overlapping animations, jump-start or linear())'
          }
          built.push(makeKey(f, c.series[f]!, ease))
        }
        if (blocked) reason = blocked
        else {
          const cand = prune(dedupe(built), c.series, tol * 0.7, c.clamp)
          const w = worstError(cand, c.series, 0, c.series.length - 1, c.clamp)
          if (w.err <= tol) {
            planned.set(ci, { channel: c.channel, keys: cand, mode: 'native', maxErr: range > 0 ? w.err / range : 0 })
            continue
          }
          reason = `oracle: worst ${(100 * (w.err / range)).toFixed(2)}% of range at frame ${w.frame}`
        }
      }
      keys = sampledKeys(c.series, range)
      const w = worstError(keys, c.series, 0, c.series.length - 1, c.clamp)
      planned.set(ci, { channel: c.channel, keys, mode: 'sampled', maxErr: range > 0 ? w.err / range : 0, reason })
    }
  }

  channels.forEach((c, i) => {
    const got = planned.get(i)
    if (got) {
      results.push(got)
      return
    }
    // Not moving: leave it alone, or pin the constant when it differs from the authored value.
    const v = c.series[0] ?? c.baseline
    if (Math.abs(v - c.baseline) > c.eps) results.push({ channel: c.channel, keys: [makeKey(0, v, null)], mode: 'static', maxErr: 0 })
    else results.push({ channel: c.channel, keys: [], mode: 'unchanged', maxErr: 0 })
  })
  return results
}
