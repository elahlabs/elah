/**
 * Sample any Lottie animated property at any time exactly as lottie-web does:
 * bezier easing per dimension (the resolver's `cubicBezier`, since a Lottie
 * key's `o`/`i` handles ARE a CSS-style bezier tuple), holds, the pre-5.5 `e`
 * end-value format, and spatial position curves sampled by arc length.
 *
 * DOM-free, dependency-free (PV-P6c-1).
 */
import { cubicBezier } from '../../resolver/bezier'
import type { LottieBezierHandle, LottieKey, LottiePathValue } from './types'

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isVec(v: unknown): v is number[] {
  return Array.isArray(v) && v.length > 0 && v.every(isFiniteNumber)
}

function isKeyObject(v: unknown): v is LottieKey {
  return !!v && typeof v === 'object' && isFiniteNumber((v as { t?: unknown }).t)
}

/** p.a === 1 and k is a non-empty array of key objects. */
export function isAnimated(p: unknown): boolean {
  if (!p || typeof p !== 'object') return false
  const prop = p as { a?: unknown; k?: unknown }
  if (prop.a !== 1) return false
  return Array.isArray(prop.k) && prop.k.length > 0 && isKeyObject(prop.k[0])
}

/** typeof p.x === 'string' */
export function hasExpression(p: unknown): boolean {
  if (!p || typeof p !== 'object') return false
  return typeof (p as { x?: unknown }).x === 'string'
}

function sortedKeys(p: unknown): LottieKey[] {
  if (!isAnimated(p)) return []
  const k = (p as { k: unknown[] }).k
  return (k.filter(isKeyObject) as LottieKey[]).slice().sort((a, b) => a.t - b.t)
}

/** The animated prop's key objects sorted by `t`; `[]` when static (PQ-2a: the native key planner reads these). */
export function lottieKeys(p: unknown): LottieKey[] {
  return sortedKeys(p)
}

/** Sorted `t` of an animated prop; `[]` when static. */
export function keyTimes(p: unknown): number[] {
  return sortedKeys(p).map((k) => k.t)
}

function pick(v: number | number[] | undefined, d: number): number {
  if (v === undefined) return 0
  if (Array.isArray(v)) return v[d] ?? v[0] ?? 0
  return v
}

function handleTuple(o: LottieBezierHandle | undefined, i: LottieBezierHandle | undefined, d: number): [number, number, number, number] | undefined {
  if (o === undefined || i === undefined) return undefined
  return [pick(o.x, d), pick(o.y, d), pick(i.x, d), pick(i.y, d)]
}

/** Easing of the segment ENDING at key index i (i ≥ 1), from key i−1, for dimension d. */
export function segmentEase(p: unknown, i: number, d: number): { bezier?: [number, number, number, number]; hold: boolean } {
  const keys = sortedKeys(p)
  const k = keys[i - 1]
  if (!k) return { hold: false }
  const bezier = handleTuple(k.o, k.i, d)
  return bezier ? { bezier, hold: k.h === 1 } : { hold: k.h === 1 }
}

/** Value at property time t (layer time: comp time − layer.st). Scalars come back as [n]. */
export function sampleProp(p: unknown, t: number, fallback: number[]): number[] {
  if (p === null || p === undefined || typeof p !== 'object') return fallback
  if (!isAnimated(p)) {
    const k = (p as { k?: unknown }).k
    if (isFiniteNumber(k)) return [k]
    if (isVec(k)) return [...k]
    return fallback
  }

  const keys = sortedKeys(p)
  if (keys.length === 0) return fallback

  const startAt = (i: number): number[] => {
    const s = keys[i]!.s
    if (isVec(s)) return s
    if (i > 0) {
      const e = keys[i - 1]!.e
      if (isVec(e)) return e
    }
    return fallback
  }
  const endAt = (i: number): number[] => {
    if (i + 1 < keys.length) {
      const s2 = keys[i + 1]!.s
      if (isVec(s2)) return s2
    }
    const e = keys[i]!.e
    if (isVec(e)) return e
    return startAt(i)
  }

  const last = keys.length - 1
  if (t <= keys[0]!.t) return startAt(0)
  if (t >= keys[last]!.t) return startAt(last)

  let i = 0
  for (let k = 0; k < last; k++) {
    if (keys[k]!.t <= t && t < keys[k + 1]!.t) {
      i = k
      break
    }
  }

  if (keys[i]!.h === 1) return startAt(i)

  const start = startAt(i)
  const end = endAt(i)
  const ti = keys[i]!.t
  const ti1 = keys[i + 1]!.t
  const u = ti1 === ti ? 0 : (t - ti) / (ti1 - ti)

  const dims = Math.max(start.length, end.length)
  const result: number[] = []
  let easeDim0 = u
  for (let d = 0; d < dims; d++) {
    const sv = start[d] ?? start[0] ?? 0
    const ev = end[d] ?? end[0] ?? sv
    const bezier = handleTuple(keys[i]!.o, keys[i]!.i, d)
    const e = bezier ? cubicBezier(bezier, u) : u
    if (d === 0) easeDim0 = e
    result[d] = sv + (ev - sv) * e
  }

  if (start.length >= 2) {
    const to = keys[i]!.to
    const ti_ = keys[i]!.ti
    const hasNonzero = (arr: number[] | undefined): boolean => Array.isArray(arr) && arr.some((n) => n !== 0)
    if (hasNonzero(to) || hasNonzero(ti_)) {
      const toX = to?.[0] ?? 0
      const toY = to?.[1] ?? 0
      const tiX = ti_?.[0] ?? 0
      const tiY = ti_?.[1] ?? 0
      const P0: [number, number] = [start[0]!, start[1]!]
      const P1: [number, number] = [start[0]! + toX, start[1]! + toY]
      const P2: [number, number] = [end[0]! + tiX, end[1]! + tiY]
      const P3: [number, number] = [end[0]!, end[1]!]
      const eClamped = Math.max(0, Math.min(1, easeDim0))
      const [px, py] = sampleCubicByArcLength(P0, P1, P2, P3, eClamped)
      result[0] = px
      result[1] = py
    }
  }

  return result
}

function cubicPoint(P0: [number, number], P1: [number, number], P2: [number, number], P3: [number, number], u: number): [number, number] {
  const mt = 1 - u
  const mt2 = mt * mt
  const u2 = u * u
  const x = mt2 * mt * P0[0] + 3 * mt2 * u * P1[0] + 3 * mt * u2 * P2[0] + u2 * u * P3[0]
  const y = mt2 * mt * P0[1] + 3 * mt2 * u * P1[1] + 3 * mt * u2 * P2[1] + u2 * u * P3[1]
  return [x, y]
}

/**
 * Sample the cubic at 64 uniform parameter steps, accumulate chord lengths,
 * and find the point at arc length `e × total` by linear interpolation
 * between samples.
 */
function sampleCubicByArcLength(P0: [number, number], P1: [number, number], P2: [number, number], P3: [number, number], e: number): [number, number] {
  const N = 64
  const pts: Array<[number, number]> = [P0]
  const lens: number[] = [0]
  let total = 0
  let prev = P0
  for (let k = 1; k <= N; k++) {
    const p = cubicPoint(P0, P1, P2, P3, k / N)
    total += Math.hypot(p[0] - prev[0], p[1] - prev[1])
    pts.push(p)
    lens.push(total)
    prev = p
  }
  const target = e * total
  if (target <= 0) return P0
  if (target >= total) return P3
  for (let k = 1; k <= N; k++) {
    if (lens[k]! >= target) {
      const segLen = lens[k]! - lens[k - 1]!
      const frac = segLen === 0 ? 0 : (target - lens[k - 1]!) / segLen
      const a = pts[k - 1]!
      const b = pts[k]!
      return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]
    }
  }
  return P3
}

function isPathValue(v: unknown): v is LottiePathValue {
  return !!v && typeof v === 'object' && Array.isArray((v as { v?: unknown }).v) && Array.isArray((v as { i?: unknown }).i) && Array.isArray((v as { o?: unknown }).o)
}

function pathOf(raw: unknown): LottiePathValue | undefined {
  if (isPathValue(raw)) return raw
  if (Array.isArray(raw) && raw.length > 0 && isPathValue(raw[0])) return raw[0]
  return undefined
}

/** Path value at t; vertex-wise interpolation when the two keys have the same vertex count, else hold. */
export function samplePath(p: unknown, t: number): LottiePathValue | undefined {
  if (!p || typeof p !== 'object') return undefined
  if (!isAnimated(p)) return pathOf((p as { k?: unknown }).k)

  const keys = sortedKeys(p)
  if (keys.length === 0) return undefined

  const startPath = (i: number): LottiePathValue | undefined => {
    const s = pathOf(keys[i]!.s)
    if (s) return s
    if (i > 0) {
      const e = pathOf(keys[i - 1]!.e)
      if (e) return e
    }
    return undefined
  }
  const endPath = (i: number): LottiePathValue | undefined => {
    if (i + 1 < keys.length) {
      const s2 = pathOf(keys[i + 1]!.s)
      if (s2) return s2
    }
    const e = pathOf(keys[i]!.e)
    if (e) return e
    return startPath(i)
  }

  const last = keys.length - 1
  if (t <= keys[0]!.t) return startPath(0)
  if (t >= keys[last]!.t) return startPath(last)

  let i = 0
  for (let k = 0; k < last; k++) {
    if (keys[k]!.t <= t && t < keys[k + 1]!.t) {
      i = k
      break
    }
  }

  if (keys[i]!.h === 1) return startPath(i)

  const start = startPath(i)
  if (!start) return undefined
  const end = endPath(i)
  if (!end) return start
  if (start.v.length !== end.v.length) return start

  const ti = keys[i]!.t
  const ti1 = keys[i + 1]!.t
  const u = ti1 === ti ? 0 : (t - ti) / (ti1 - ti)
  const bezier = handleTuple(keys[i]!.o, keys[i]!.i, 0)
  const e = bezier ? cubicBezier(bezier, u) : u

  const n = start.v.length
  const v: number[][] = []
  const iArr: number[][] = []
  const oArr: number[][] = []
  for (let k = 0; k < n; k++) {
    v.push([start.v[k]![0] + (end.v[k]![0] - start.v[k]![0]) * e, start.v[k]![1] + (end.v[k]![1] - start.v[k]![1]) * e])
    iArr.push([start.i[k]![0] + (end.i[k]![0] - start.i[k]![0]) * e, start.i[k]![1] + (end.i[k]![1] - start.i[k]![1]) * e])
    oArr.push([start.o[k]![0] + (end.o[k]![0] - start.o[k]![0]) * e, start.o[k]![1] + (end.o[k]![1] - start.o[k]![1]) * e])
  }
  return { v, i: iArr, o: oArr, c: start.c }
}
