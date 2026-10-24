/**
 * Lottie → editable keyframes. Two ways to write a channel (PQ-2a):
 *
 *  - NATIVE: a few keys at the Lottie key times, each carrying the engine's own
 *    `easingBezier` (or `hold`), wherever one Lottie property maps 1:1 onto the
 *    channel (`easing.ts`). A designer sees the keys they would have drawn.
 *  - SAMPLED: the original PV-P6c-3 fallback. Every output frame in the clip's
 *    range is sampled once — `sourceFrame = (spec.startFrame + localFrame) *
 *    spec.fr / spec.fps` — and stored as a `hold: true` key; consecutive equal
 *    values collapse into one key (a run-length encoding of the step function).
 *
 * The sampled series is always computed and stays the ORACLE: a native channel
 * is only written when the engine's own sampler, run over its keys, reproduces
 * the oracle within 0.5% of the channel range at every output frame. Anything
 * else falls back to the sampled keys, and `LottieImportReport.sampled` says
 * which channel and why.
 *
 * Unsupported cases (animated non-conformal/sheared transforms, animated
 * gradient stops, multi-item or transformed-inner path geometry, animated
 * stroke width, an unsupported time remap) retain the clip's first-frame pose
 * for that channel and report the feature once per clip.
 */
import type { AnyKeyframeChannel, Clip, Keyframe } from '../../types'
import type { Rgba } from '../../utils/color'
import { generateId } from '../../utils/id'
import { sampleChannel, sampleColorChannel } from '../../resolver/keyframes'
import { ellipsePath, multiply, pathToD, rectPath, transformPath, type PathSeg } from '../pathOps'
import { transformForBox } from '../place'
import { easingFields, segmentEasing, type SegmentEase } from './easing'
import { isAnimated, lottieKeys, sampleProp, samplePath } from './props'
import { animatedProps, transformOpacity } from './transform'
import type { LottieLayer, LottieShapeItem, LottieTransform } from './types'
import {
  ancestorHasAnimation,
  chainHasAnimation,
  chainMatrixAt,
  itemHasAnimatedProp,
  type ClipSpec,
  worldMatrix,
} from './convert'

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/** Total keys this module may write across one `lottieToClip` call. */
export const MAX_ANIMATION_KEYS = 100_000
/** Longest a single animated clip's own range may be, in output frames. */
export const MAX_ANIMATION_DURATION_FRAMES = 18_000
/** A native channel must reproduce the oracle within this fraction of the channel range. */
export const NATIVE_TOLERANCE = 0.005

let animationKeysUsed = 0

/** Called once at the top of `lottieToClip` so budgets don't leak between imports. */
export function resetAnimationBudget(): void {
  animationKeysUsed = 0
}

function reserveKeys(n: number, context: string): void {
  if (n <= 0) return
  if (animationKeysUsed + n > MAX_ANIMATION_KEYS) {
    throw new Error(`Lottie import exceeds the ${MAX_ANIMATION_KEYS}-key animation budget (while converting ${context})`)
  }
  animationKeysUsed += n
}

// ---------------------------------------------------------------------------
// Entry point — replaces PV-P6c-2's applyAnimation body
// ---------------------------------------------------------------------------

type Channels = Partial<Record<AnyKeyframeChannel, { source: { kind: 'keyframes' }; keys: Keyframe[] }>>

export function applyAnimationKeyframes(clip: Clip, spec: ClipSpec, skip: (feature: string) => void): void {
  if (!isClipAnimated(spec)) return

  if (spec.durationFrames > MAX_ANIMATION_DURATION_FRAMES) {
    throw new Error(
      `Lottie layer "${spec.layer.nm ?? spec.kind}" animates over ${spec.durationFrames} output frames, ` +
        `above the ${MAX_ANIMATION_DURATION_FRAMES}-frame budget`,
    )
  }

  const reported = new Set<string>()
  const skipOnce = (feature: string): void => {
    if (!reported.has(feature)) {
      reported.add(feature)
      skip(feature)
    }
  }

  const count = spec.durationFrames
  const st = spec.layer.st ?? 0
  const compTimeOf = (localFrame: number): number => ((spec.startFrame + localFrame) * spec.fr) / spec.fps
  const layerName = spec.layer.nm ?? spec.kind

  const channels: Channels = {}
  let addedAny = false

  const write = (name: AnyKeyframeChannel, keys: Keyframe[]): void => {
    reserveKeys(keys.length, `${spec.kind} layer "${spec.layer.nm ?? ''}" channel ${name}`)
    channels[name] = { source: { kind: 'keyframes' }, keys }
    addedAny = true
  }
  const addNative = (name: AnyKeyframeChannel, keys: Keyframe[]): void => {
    write(name, keys)
    spec.report.native++
  }
  const addSampled = (name: AnyKeyframeChannel, keys: Keyframe[], reason: string): void => {
    if (keys.length === 0) return
    write(name, keys)
    spec.report.sampled.push({ layer: layerName, channel: name, reason })
  }

  // --- Transform (x/y/scale/rotation) ---------------------------------
  const layerOrAncestorAnimated = animatedProps(spec.layer.ks).length > 0 || ancestorHasAnimation(spec.layer, spec.byInd)
  const chainAnimated = spec.drawable ? chainHasAnimation(spec.drawable.chain) : false
  if (layerOrAncestorAnimated || chainAnimated) {
    if (spec.baked) {
      skipOnce('non-uniform-transform-animation')
    } else {
      const series = sampleTransformSeries(spec, count, st, compTimeOf, skipOnce)
      if (!series) {
        skipOnce('non-uniform-transform-animation')
      } else {
        const gate = planTransform(spec)
        const names = ['x', 'y', 'scale', 'rotation'] as const
        for (const name of names) {
          const values = series[name]
          const sampledKeys = buildScalarKeys(values)
          if (sampledKeys.length === 0) continue
          if ('reason' in gate) {
            addSampled(name, sampledKeys, gate.reason)
            continue
          }
          const valueAt = transformValueAt(spec, gate, name, st, compTimeOf, skipOnce)
          const built = valueAt ? buildNativeScalar(gate.plan, valueAt, values, name === 'rotation') : null
          if (built) addNative(name, built)
          else addSampled(name, sampledKeys, 'differs from the sampled series')
        }
      }
    }
  }

  // --- Opacity ---------------------------------------------------------
  const layerOpacityAnimated = isAnimated(spec.layer.ks?.o)
  const chainOpacityAnimated = spec.drawable ? spec.drawable.chain.some((tr) => isAnimated(tr.o)) : false
  if (layerOpacityAnimated || chainOpacityAnimated) {
    const values = sampleOpacitySeries(spec, count, st, compTimeOf)
    const sampledKeys = buildScalarKeys(values)
    if (sampledKeys.length > 0) {
      if (chainOpacityAnimated) {
        addSampled('opacity', sampledKeys, layerOpacityAnimated ? 'multiple-animated-properties' : 'animated-group-opacity')
      } else {
        const plan = planFromProp(spec.layer.ks?.o, spec)
        const valueAt = (f: number): number => sampleOpacityAt(spec, f, st, compTimeOf)
        const built = 'plan' in plan ? buildNativeScalar(plan.plan, valueAt, values, false) : null
        if (built) addNative('opacity', built)
        else addSampled('opacity', sampledKeys, 'reason' in plan ? plan.reason : 'differs from the sampled series')
      }
    }
  }

  // --- Colour and path (shapes only) ------------------------------------
  if (spec.kind === 'shape' && spec.drawable) {
    const colour = (item: LottieShapeItem | undefined, name: 'shape.fill' | 'shape.stroke'): void => {
      if (!item || !isAnimated(item.c)) return
      const values = sampleColorSeries(item, count, st, compTimeOf)
      const sampledKeys = buildColorKeys(values)
      if (sampledKeys.length === 0) return
      if (isAnimated(item.o)) {
        addSampled(name, sampledKeys, 'animated-opacity-with-colour')
        return
      }
      const plan = planFromProp(item.c, spec)
      const built = 'plan' in plan ? buildNativeColor(plan.plan, (f) => sampleColorAt(item, f, st, compTimeOf), values) : null
      if (built) addNative(name, built)
      else addSampled(name, sampledKeys, 'reason' in plan ? plan.reason : 'differs from the sampled series')
    }
    colour(findStyleItem(spec.drawable.styles, 'fl'), 'shape.fill')
    const strokeItem = findStyleItem(spec.drawable.styles, 'st')
    colour(strokeItem, 'shape.stroke')
    if (strokeItem && isAnimated(strokeItem.w)) skipOnce('stroke-width-animation')
    const gfItem = findStyleItem(spec.drawable.styles, 'gf')
    if (gfItem && gradientAnimated(gfItem)) skipOnce('gradient-stop-animation')

    // Trim paths: `s` is the window start, `e` its end, both percent.
    const trim = spec.drawable.trim
    if (trim) {
      const trimChannel = (key: 's' | 'e', name: 'draw.start' | 'draw'): void => {
        if (!isAnimated(trim[key])) return
        const at = (f: number): number => clamp01((sampleProp(trim[key], compTimeOf(f) - st, [key === 's' ? 0 : 100])[0] ?? 0) / 100)
        const values: number[] = new Array(count)
        for (let f = 0; f < count; f++) values[f] = at(f)
        const sampledKeys = buildScalarKeys(values)
        if (sampledKeys.length === 0) return
        const plan = planFromProp(trim[key], spec)
        const built = 'plan' in plan ? buildNativeScalar(plan.plan, at, values, false) : null
        if (built) addNative(name, built)
        else addSampled(name, sampledKeys, 'reason' in plan ? plan.reason : 'differs from the sampled series')
      }
      trimChannel('s', 'draw.start')
      trimChannel('e', 'draw')
    }

    if (!spec.baked) {
      const geometry = spec.drawable.geometry
      if (geometry.length === 1 && geometry[0] && innerIsStatic(geometry[0].inner) && itemGeometryAnimated(geometry[0].item)) {
        const values = samplePathSeries(geometry[0].item, geometry[0].inner, count, st, compTimeOf)
        if (values) addSampled('shape.path', buildPathKeys(values), 'path morph is sampled per frame')
        else skipOnce('path-animation-unsupported')
      } else if (geometry.some((g) => itemGeometryAnimated(g.item) || chainHasAnimation(g.inner))) {
        skipOnce('path-animation-unsupported')
      }
    }
  }

  // --- Precomp time remap ------------------------------------------------
  if (spec.kind === 'compound' && isAnimated(spec.layer.tm)) {
    const values = sampleTimeSeries(spec, count, st, compTimeOf)
    addSampled('time', buildScalarKeys(values), 'time remap is sampled per frame')
  }

  if (addedAny) {
    clip.keyframes = { channels: { ...clip.keyframes?.channels, ...channels } }
  }
}

// ---------------------------------------------------------------------------
// "Is anything here animated at all" — the same gate PV-P6c-2 used to decide
// whether to report the collapsed 'animation' skip.
// ---------------------------------------------------------------------------

function isClipAnimated(spec: ClipSpec): boolean {
  let animated = animatedProps(spec.layer.ks).length > 0 || ancestorHasAnimation(spec.layer, spec.byInd)

  if (!animated && spec.drawable) {
    animated = chainHasAnimation(spec.drawable.chain)
    if (!animated) {
      for (const s of spec.drawable.styles) {
        if (itemHasAnimatedProp(s)) {
          animated = true
          break
        }
      }
    }
    if (!animated && spec.drawable.trim && itemHasAnimatedProp(spec.drawable.trim)) animated = true
    if (!animated) {
      for (const g of spec.drawable.geometry) {
        if (itemHasAnimatedProp(g.item) || chainHasAnimation(g.inner)) {
          animated = true
          break
        }
      }
    }
  }

  if (!animated && spec.kind === 'compound' && isAnimated(spec.layer.tm)) animated = true

  return animated
}

// ---------------------------------------------------------------------------
// Native key plans
// ---------------------------------------------------------------------------

/** Where the native keys go and what curve each segment has. */
interface KeyPlan {
  frames: number[]
  /** segs[n] is the segment leaving key n (length = frames.length - 1). */
  segs: SegmentEase[]
}

type PlanResult = { plan: KeyPlan } | { reason: string }

function hasNonzero(arr: number[] | undefined): boolean {
  return Array.isArray(arr) && arr.some((n) => n !== 0)
}

/** The Lottie keys of ONE animated property as engine key frames and curves, or why that is not 1:1. */
function planFromProp(prop: unknown, spec: ClipSpec): PlanResult {
  if (spec.sampledOnly) return { reason: 'sampled only (requested)' }
  const keys = lottieKeys(prop)
  if (keys.length < 2) return { reason: 'fewer than two keys' }
  const st = spec.layer.st ?? 0
  const frames = keys.map((k) => Math.round(((k.t + st) * spec.fps) / spec.fr) - spec.startFrame)
  for (let i = 1; i < frames.length; i++) {
    if (frames[i]! <= frames[i - 1]!) return { reason: 'two keys land on one output frame' }
  }
  if (frames[0]! < 0 || frames[frames.length - 1]! > spec.durationFrames) return { reason: 'a key falls outside the clip' }

  const segs: SegmentEase[] = []
  for (let n = 0; n < keys.length - 1; n++) {
    const key = keys[n]!
    if (hasNonzero(key.to) || hasNonzero(key.ti)) return { reason: 'spatial tangent' }
    const seg = segmentEasing(key)
    if (!seg) return { reason: 'per-dimension easing' }
    segs.push(seg)
  }
  return { plan: { frames, segs } }
}

function transformPropsAnimated(tr: LottieTransform | undefined): string[] {
  return animatedProps(tr).filter((p) => p !== 'o')
}

function ancestorTransformAnimated(layer: LottieLayer, byInd: Map<number, LottieLayer>): boolean {
  let cur = layer
  let steps = 0
  while (cur.parent !== undefined && steps < 16) {
    const parent = byInd.get(cur.parent)
    if (!parent) break
    if (transformPropsAnimated(parent.ks).length > 0) return true
    cur = parent
    steps++
  }
  return false
}

interface TransformGate {
  plan: KeyPlan
  /** The one animated layer property driving every transform channel. */
  driver: 'a' | 'p' | 's' | 'r'
}

/** Native only when ONE animated property of the layer's own `ks` drives the transform. */
function planTransform(spec: ClipSpec): TransformGate | { reason: string } {
  if (spec.sampledOnly) return { reason: 'sampled only (requested)' }
  if (ancestorTransformAnimated(spec.layer, spec.byInd)) return { reason: 'animated parent' }
  if (spec.drawable && spec.drawable.chain.some((tr) => transformPropsAnimated(tr).length > 0)) {
    return { reason: 'animated group transform' }
  }
  const props = transformPropsAnimated(spec.layer.ks)
  if (props.length === 0) return { reason: 'no animated transform property' }
  if (props.length > 1) return { reason: 'several animated transform properties' }
  const driver = props[0] as 'a' | 'p' | 's' | 'r'
  const ks = spec.layer.ks as LottieTransform

  let result: PlanResult
  if (driver === 'p') {
    const p = ks.p
    if (p && typeof p === 'object' && (p as { s?: unknown }).s === true) {
      const split = p as { x: unknown; y: unknown }
      const px = isAnimated(split.x) ? planFromProp(split.x, spec) : undefined
      const py = isAnimated(split.y) ? planFromProp(split.y, spec) : undefined
      if (px && py) {
        if ('reason' in px) result = px
        else if ('reason' in py) result = py
        else if (JSON.stringify(px.plan) !== JSON.stringify(py.plan)) result = { reason: 'split position keys differ' }
        else result = px
      } else {
        result = (px ?? py) as PlanResult
      }
    } else {
      result = planFromProp(p, spec)
    }
  } else if (driver === 's') {
    result = planFromProp(ks.s, spec)
    if ('plan' in result) {
      for (const k of lottieKeys(ks.s)) {
        const v = Array.isArray(k.s) ? k.s : Array.isArray(k.e) ? k.e : undefined
        if (v && v.length >= 2 && Math.abs((v[0] ?? 0) - (v[1] ?? 0)) > 1e-9) return { reason: 'non-uniform scale' }
      }
    }
  } else if (driver === 'r') {
    result = planFromProp(ks.r ?? ks.rz, spec)
  } else {
    result = planFromProp(ks.a, spec)
  }
  return 'plan' in result ? { plan: result.plan, driver } : result
}

/** The oracle value of a transform channel at output frame `f` (any integer, in or out of the clip). */
function transformValueAt(
  spec: ClipSpec,
  gate: TransformGate,
  name: 'x' | 'y' | 'scale' | 'rotation',
  st: number,
  compTimeOf: (f: number) => number,
  skip: (feature: string) => void,
): ((f: number) => number) | null {
  const at = (f: number): number | null => {
    const t = transformAt(spec, f, st, compTimeOf, skip)
    return t ? t[name] : null
  }
  if (name !== 'rotation' || gate.driver !== 'r') {
    return (f) => at(f) ?? 0
  }
  // A turning layer: write the rotation unwrapped (0 → 360° is two keys 2π apart,
  // not the 0 → 0 that atan2 would give), anchored to the oracle at the first key.
  const ks = spec.layer.ks as LottieTransform
  const keys = lottieKeys(ks.r ?? ks.rz)
  const first = keys[0]
  if (!first) return null
  const f0 = gate.plan.frames[0]!
  const oracle0 = at(f0)
  if (oracle0 === null) return null
  const r0 = ((sampleProp(ks.r ?? ks.rz, first.t, [0])[0] ?? 0) * Math.PI) / 180
  const off = wrapPi(oracle0 - r0)
  return (f) => {
    const idx = gate.plan.frames.indexOf(f)
    const key = keys[idx]
    if (!key) return at(f) ?? 0
    return off + ((sampleProp(ks.r ?? ks.rz, key.t, [0])[0] ?? 0) * Math.PI) / 180
  }
}

function wrapPi(a: number): number {
  const twoPi = Math.PI * 2
  return ((((a + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI
}

function angleDiff(a: number, b: number): number {
  return Math.abs(wrapPi(a - b))
}

function nativeKeys(plan: KeyPlan, valueAt: (f: number) => number, vecAt?: (f: number) => number[]): Keyframe[] {
  const last = plan.frames.length - 1
  return plan.frames.map((frame, i) => {
    const incoming = i > 0 ? plan.segs[i - 1]! : undefined
    const key: Keyframe = {
      id: generateId(),
      frame,
      value: vecAt ? 0 : valueAt(frame),
      easing: 'linear',
      ...(vecAt ? { vec: vecAt(frame) } : {}),
    }
    if (incoming && !incoming.hold) Object.assign(key, easingFields(incoming.ease))
    if (i < last && plan.segs[i]!.hold) key.hold = true
    return key
  })
}

/** Native keys for a scalar channel, or null when the engine's sampler cannot reproduce the oracle. */
function buildNativeScalar(plan: KeyPlan, valueAt: (f: number) => number, oracle: number[], circular: boolean): Keyframe[] | null {
  const keys = nativeKeys(plan, valueAt)
  let min = Infinity
  let max = -Infinity
  for (const v of oracle) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const tol = Math.max((max - min) * NATIVE_TOLERANCE, 1e-9)
  for (let f = 0; f < oracle.length; f++) {
    const got = sampleChannel(keys, f)
    if (got === undefined || !Number.isFinite(got)) return null
    const diff = circular ? angleDiff(got, oracle[f]!) : Math.abs(got - oracle[f]!)
    if (diff > tol) return null
  }
  return keys
}

/** Native colour keys, verified component-wise against the oracle (each 0..1). */
function buildNativeColor(plan: KeyPlan, colorAt: (f: number) => Rgba, oracle: Rgba[]): Keyframe[] | null {
  const keys = nativeKeys(plan, () => 0, (f) => [...colorAt(f)])
  for (let f = 0; f < oracle.length; f++) {
    const got = sampleColorChannel(keys, f)
    if (!got) return null
    for (let c = 0; c < 4; c++) {
      if (Math.abs((got[c] ?? 0) - oracle[f]![c]!) > NATIVE_TOLERANCE) return null
    }
  }
  return keys
}

// ---------------------------------------------------------------------------
// Per-frame sampling (the oracle, and the fallback)
// ---------------------------------------------------------------------------

interface TransformSeries {
  x: number[]
  y: number[]
  scale: number[]
  rotation: number[]
}

function transformAt(
  spec: ClipSpec,
  f: number,
  st: number,
  compTimeOf: (f: number) => number,
  skip: (feature: string) => void,
): { x: number; y: number; scale: number; rotation: number } | null {
  const T = compTimeOf(f)
  const t0 = T - st
  const world = worldMatrix(spec.layer, T, spec.byInd, skip)
  const M = spec.drawable ? multiply(world, chainMatrixAt(spec.drawable.chain, t0)) : world
  const { transform, exact } = transformForBox(M, spec.box, spec.compStage, spec.kind)
  if (!exact) return null
  return { x: transform.x, y: transform.y, scale: transform.scale, rotation: transform.rotation }
}

function sampleTransformSeries(
  spec: ClipSpec,
  count: number,
  st: number,
  compTimeOf: (f: number) => number,
  skip: (feature: string) => void,
): TransformSeries | null {
  const x: number[] = new Array(count)
  const y: number[] = new Array(count)
  const scale: number[] = new Array(count)
  const rotation: number[] = new Array(count)

  for (let f = 0; f < count; f++) {
    const t = transformAt(spec, f, st, compTimeOf, skip)
    if (!t) return null
    x[f] = t.x
    y[f] = t.y
    scale[f] = t.scale
    rotation[f] = t.rotation
  }

  return { x, y, scale, rotation }
}

function sampleOpacityAt(spec: ClipSpec, f: number, st: number, compTimeOf: (f: number) => number): number {
  const t0 = compTimeOf(f) - st
  let o = transformOpacity(spec.layer.ks, t0)
  if (spec.drawable) {
    for (const tr of spec.drawable.chain) o *= transformOpacity(tr, t0)
  }
  return Math.min(1, Math.max(0, o))
}

function sampleOpacitySeries(spec: ClipSpec, count: number, st: number, compTimeOf: (f: number) => number): number[] {
  const out: number[] = new Array(count)
  for (let f = 0; f < count; f++) out[f] = sampleOpacityAt(spec, f, st, compTimeOf)
  return out
}

function sampleTimeSeries(spec: ClipSpec, count: number, st: number, compTimeOf: (f: number) => number): number[] {
  const out: number[] = new Array(count)
  for (let f = 0; f < count; f++) {
    const t0 = compTimeOf(f) - st
    const seconds = sampleProp(spec.layer.tm, t0, [0])[0] ?? 0
    out[f] = seconds * spec.fps
  }
  return out
}

function findStyleItem(styles: LottieShapeItem[], ty: string): LottieShapeItem | undefined {
  return styles.find((s) => s.ty === ty)
}

function gradientAnimated(item: LottieShapeItem): boolean {
  const g = item.g as { k?: unknown } | undefined
  return isAnimated(g?.k) || isAnimated(item.s) || isAnimated(item.e) || isAnimated(item.h)
}

function innerIsStatic(inner: LottieTransform[]): boolean {
  return !chainHasAnimation(inner)
}

function itemGeometryAnimated(item: LottieShapeItem): boolean {
  if (item.ty === 'rc') return isAnimated(item.p) || isAnimated(item.s) || isAnimated(item.r)
  if (item.ty === 'el') return isAnimated(item.p) || isAnimated(item.s)
  if (item.ty === 'sh') return isAnimated(item.ks)
  return false
}

function sampleColorAt(item: LottieShapeItem, f: number, st: number, compTimeOf: (f: number) => number): Rgba {
  const t = compTimeOf(f) - st
  const c = sampleProp(item.c, t, [0, 0, 0])
  const alpha = sampleProp(item.o, t, [100])[0] ?? 100
  return lottieRgba(c, alpha / 100)
}

function sampleColorSeries(item: LottieShapeItem, count: number, st: number, compTimeOf: (f: number) => number): Rgba[] {
  const out: Rgba[] = new Array(count)
  for (let f = 0; f < count; f++) out[f] = sampleColorAt(item, f, st, compTimeOf)
  return out
}

function lottieRgba(c: number[], alphaMul: number): Rgba {
  const scale = c.some((v) => v > 1) ? 1 / 255 : 1
  const r = clamp01((c[0] ?? 0) * scale)
  const g = clamp01((c[1] ?? 0) * scale)
  const b = clamp01((c[2] ?? 0) * scale)
  const a = clamp01((c[3] ?? 1) * alphaMul)
  return [r, g, b, a]
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** Mirrors P6c-1's documented `sh` branch: M v0, then L/C per edge, Z when closed. */
function pathFromLottieValue(pv: { v: number[][]; i: number[][]; o: number[][]; c: boolean }): PathSeg[] {
  if (pv.v.length === 0) return []
  const v0 = pv.v[0]!
  const segs: PathSeg[] = [{ c: 'M', x: v0[0] ?? 0, y: v0[1] ?? 0 }]
  const n = pv.v.length
  const last = pv.c ? n : n - 1
  for (let k = 0; k < last; k++) {
    const k1 = (k + 1) % n
    const p0 = pv.v[k]!
    const p1 = pv.v[k1]!
    const o = pv.o[k] ?? [0, 0]
    const i = pv.i[k1] ?? [0, 0]
    const ox = o[0] ?? 0
    const oy = o[1] ?? 0
    const ix = i[0] ?? 0
    const iy = i[1] ?? 0
    if (ox === 0 && oy === 0 && ix === 0 && iy === 0) {
      segs.push({ c: 'L', x: p1[0] ?? 0, y: p1[1] ?? 0 })
    } else {
      segs.push({
        c: 'C',
        x1: (p0[0] ?? 0) + ox,
        y1: (p0[1] ?? 0) + oy,
        x2: (p1[0] ?? 0) + ix,
        y2: (p1[1] ?? 0) + iy,
        x: p1[0] ?? 0,
        y: p1[1] ?? 0,
      })
    }
  }
  if (pv.c) segs.push({ c: 'Z' })
  return segs
}

function samplePathSeries(
  item: LottieShapeItem,
  inner: LottieTransform[],
  count: number,
  st: number,
  compTimeOf: (f: number) => number,
): string[] | null {
  if (item.ty !== 'rc' && item.ty !== 'el' && item.ty !== 'sh') return null
  const innerM = chainMatrixAt(inner, 0)
  const out: string[] = new Array(count)
  for (let f = 0; f < count; f++) {
    const t = compTimeOf(f) - st
    let segs: PathSeg[]
    if (item.ty === 'rc') {
      const p = sampleProp(item.p, t, [0, 0])
      const s = sampleProp(item.s, t, [0, 0])
      const r = sampleProp(item.r, t, [0])[0] ?? 0
      segs = rectPath((p[0] ?? 0) - (s[0] ?? 0) / 2, (p[1] ?? 0) - (s[1] ?? 0) / 2, s[0] ?? 0, s[1] ?? 0, r, r)
    } else if (item.ty === 'el') {
      const p = sampleProp(item.p, t, [0, 0])
      const s = sampleProp(item.s, t, [0, 0])
      segs = ellipsePath(p[0] ?? 0, p[1] ?? 0, (s[0] ?? 0) / 2, (s[1] ?? 0) / 2)
    } else {
      const pv = samplePath(item.ks, t)
      if (!pv) return null
      segs = pathFromLottieValue(pv)
    }
    out[f] = pathToD(transformPath(segs, innerM))
  }
  return out
}

// ---------------------------------------------------------------------------
// Run-length key builders — each sample is a `hold` key; identical
// consecutive output-frame values collapse into one key; an entirely
// constant channel gets no keys at all.
// ---------------------------------------------------------------------------

function buildScalarKeys(values: number[]): Keyframe[] {
  if (values.length === 0) return []
  const first = values[0]!
  if (values.every((v) => v === first)) return []
  const keys: Keyframe[] = []
  let last: number | undefined
  for (let f = 0; f < values.length; f++) {
    const v = values[f]!
    if (v !== last) {
      keys.push({ id: generateId(), frame: f, value: v, easing: 'linear', hold: true })
      last = v
    }
  }
  return keys
}

function rgbaEqual(a: Rgba, b: Rgba): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

function buildColorKeys(values: Rgba[]): Keyframe[] {
  if (values.length === 0) return []
  const first = values[0]!
  if (values.every((v) => rgbaEqual(v, first))) return []
  const keys: Keyframe[] = []
  let last: Rgba | undefined
  for (let f = 0; f < values.length; f++) {
    const v = values[f]!
    if (!last || !rgbaEqual(v, last)) {
      keys.push({ id: generateId(), frame: f, value: 0, vec: [...v], easing: 'linear', hold: true })
      last = v
    }
  }
  return keys
}

function buildPathKeys(values: string[]): Keyframe[] {
  if (values.length === 0) return []
  const first = values[0]!
  if (values.every((v) => v === first)) return []
  const keys: Keyframe[] = []
  let last: string | undefined
  for (let f = 0; f < values.length; f++) {
    const v = values[f]!
    if (v !== last) {
      keys.push({ id: generateId(), frame: f, value: 0, path: v, easing: 'linear', hold: true })
      last = v
    }
  }
  return keys
}
