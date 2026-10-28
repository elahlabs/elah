/**
 * Keyframe sampling — pure, deterministic, DOM-free.
 *
 * Turns a clip's `keyframes` into the per-frame values the resolver folds into
 * the two channels every renderer already understands (`opacity`, `Transform`)
 * plus `volume` and `cornerRadius`. Renderers stay animation-unaware, so GPU
 * preview and the 2D export worker agree by construction — both call
 * `resolveTimeline`, which calls this.
 *
 * Contract with the rest of the animation system (see resolveTimeline.ts):
 *   1. base       = clip.transform ?? the clip type's renderer default
 *   2. keyframes  → ABSOLUTE per-channel override of base        → "rest"
 *   3. MotionSpec (textAnimation / shapeAnimation) layers on rest as a delta
 *   4. clip.opacity folds in via Math.min
 *   5. transitions last
 * Keyframes are absolute — the author's decision at a moment — where MotionSpec
 * is a delta because it is a template (types/index.ts, `MotionSpec`).
 *
 * Every input here is UNVALIDATED: `readClip` spreads stored clip fields
 * through untouched (projectDocument.ts), so `NaN`, `Infinity`, fractions,
 * unsorted and duplicate frames all reach us. `normalizeKeys` collapses each
 * of them to something finite before any arithmetic, mirroring
 * `resolveRampFrames` in textAnimation.ts. A wrong-looking curve is
 * recoverable; a thrown exception inside the resolver takes down every frame.
 */

import type {
  AnyKeyframeChannel,
  ClipKeyframes,
  ClipType,
  Keyframe,
  KeyframeChannel,
  KeyframeChannelTrack,
  Transform,
} from '../types'
import { generateId } from '../utils/id'
import { cubicBezier, isValidBezier } from './bezier'
import { isValidSpring, springProgress } from './spring'
import { DEFAULT_SHAPE_TRANSFORM, DEFAULT_TEXT_TRANSFORM, evaluateEasing } from './textAnimation'
import { formatColor, lerpColor, toRgba, vecToHex, type Rgba } from '../utils/color'
import { morphCubics, parsePathToCubics, reconcileCubics, serializeCubics, type CubicSubpath } from './pathMorph'

/** What one frame of a clip's keyframes resolves to. Absent = not keyed. */
export interface KeyframeSample {
  /** Present only when at least one transform channel is keyed. */
  transform?: Transform
  opacity?: number
  volume?: number
  cornerRadius?: number
}

export const TRANSFORM_CHANNELS: ReadonlyArray<
  Extract<KeyframeChannel, 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotation' | 'skewX' | 'skewY' | 'rotateX' | 'rotateY'>
> = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'rotateX', 'rotateY']

/** The nine builtin channels, in UI order. Extended channels are not listed. */
export const KEYFRAME_CHANNELS: ReadonlyArray<KeyframeChannel> = [
  ...TRANSFORM_CHANNELS,
  'opacity',
  'volume',
  'cornerRadius',
]

const BUILTIN_CHANNEL_SET: ReadonlySet<string> = new Set(KEYFRAME_CHANNELS)

/**
 * MC-2d: scalar channels that drive a clip field other than the nine builtins.
 * Text clips take the first two, shape clips the third, any clip with a
 * transform the anchor pair. They are sampled with the extended channels and
 * read back by the resolver; like `draw.start` they are not expression channels.
 */
export const TIER_B_CHANNELS = ['text.fontSize', 'text.letterSpacing', 'text.scramble', 'stroke.width', 'anchor.x', 'anchor.y', 'motion.progress'] as const
const TIER_B_CHANNEL_SET: ReadonlySet<string> = new Set(TIER_B_CHANNELS)

/** True for a Tier B channel name (`text.fontSize`, `text.letterSpacing`, `stroke.width`, `anchor.x`, `anchor.y`, `motion.progress`). */
export function isTierBChannel(name: string): boolean {
  return TIER_B_CHANNEL_SET.has(name)
}
const FX_CHANNEL_RE = /^fx\.[^.\s]+\.[^.\s]+$/
const MASK_CHANNEL_RE = /^mask\.(x|y|width|height|rotation|feather)$/
const GEN_CHANNEL_RE = /^gen\.[^.\s]+$/

/**
 * Colour channels a `vec` key drives (PV-P5c). All three are colours; a
 * future non-colour `vec` channel would need its own list.
 */
export const COLOR_CHANNELS = ['color', 'shape.fill', 'shape.stroke'] as const
/** Every typed channel: the colours plus the one `path`-keyed channel. */
export const TYPED_CHANNELS = [...COLOR_CHANNELS, 'shape.path'] as const
const TYPED_CHANNEL_SET: ReadonlySet<string> = new Set(TYPED_CHANNELS)

/** True for a channel keyed by a typed (`vec`/`path`) value rather than a scalar. */
export function isTypedChannelName(name: string): boolean {
  return TYPED_CHANNEL_SET.has(name)
}

/** True for a builtin channel name. */
export function isBuiltinKeyframeChannel(name: string): name is KeyframeChannel {
  return BUILTIN_CHANNEL_SET.has(name)
}

/**
 * True for any name a clip may store keys under: the nine builtins, `time`,
 * `fx.<effectId>.<param>` and `mask.<field>`. Anything else in a stored
 * `channels` object is junk and is ignored everywhere.
 */
export function isKeyframeChannelName(name: string): name is AnyKeyframeChannel {
  return (
    BUILTIN_CHANNEL_SET.has(name) ||
    name === 'time' ||
    name === 'draw' ||
    name === 'draw.start' ||
    TIER_B_CHANNEL_SET.has(name) ||
    FX_CHANNEL_RE.test(name) ||
    MASK_CHANNEL_RE.test(name) ||
    GEN_CHANNEL_RE.test(name) ||
    isTypedChannelName(name)
  )
}

/**
 * True for a channel an EXPRESSION may drive (PV-P5b).
 *
 * Every keyframable channel except `time` and `draw`. Those two are excluded on
 * purpose and not by accident: `time` is a source-frame remap, so an expression
 * there would be a speed curve the trim window cannot represent, and `draw` is
 * consumed by the draw-on animator rather than sampled as a scalar. Rejecting
 * them at parse and at write time is why a stored expression can never be one
 * the sampler would have to special-case.
 */
export function isExpressionChannel(name: string): name is AnyKeyframeChannel {
  return name !== 'time' && name !== 'draw' && name !== 'draw.start' && !TIER_B_CHANNEL_SET.has(name) && isKeyframeChannelName(name)
}

/**
 * The per-channel override the resolver passes to the samplers (PV-P5b).
 *
 * `keyed` is the channel's sampled keyframe value, or `undefined` when the
 * channel has no keys — an expression channel is allowed to have none, and the
 * expression's own `value` then falls back to the channel's authored value.
 * Returning `undefined` means "no expression here", and the caller keeps the
 * keyed value.
 *
 * Deliberately a plain callback rather than an expression engine reference: the
 * sampler must not know that expressions exist, and the panels that show the
 * AUTHORED value simply pass no hook.
 */
export type ChannelExpression = (channel: AnyKeyframeChannel, keyed: number | undefined) => number | undefined

/** The param of a `gen.<param>` channel (EDX-P9), or `undefined` for any other name. */
export function parseGeneratorChannel(name: string): string | undefined {
  return GEN_CHANNEL_RE.test(name) ? name.slice(4) : undefined
}

/** Split an `fx.<effectId>.<param>` channel, or `undefined` for any other name. */
export function parseEffectChannel(name: string): { effectId: string; param: string } | undefined {
  if (!FX_CHANNEL_RE.test(name)) return undefined
  const [, effectId, param] = name.split('.')
  return { effectId, param }
}

/** The channel name that keys one effect parameter. */
export function effectChannel(effectId: string, param: string): `fx.${string}.${string}` {
  return `fx.${effectId}.${param}`
}

/**
 * The valid channels present on a `channels` object: builtins first in
 * `KEYFRAME_CHANNELS` order, then every extended channel sorted by name, so
 * iteration order never depends on insertion order.
 */
export function presentKeyframeChannels(
  channels: ClipKeyframes['channels'] | undefined,
): AnyKeyframeChannel[] {
  if (!channels || typeof channels !== 'object') return []
  const builtins = KEYFRAME_CHANNELS.filter((c) => channels[c] !== undefined)
  const extended = Object.keys(channels)
    .filter((name) => !BUILTIN_CHANNEL_SET.has(name) && isKeyframeChannelName(name))
    .filter((name) => channels[name as AnyKeyframeChannel] !== undefined)
    .sort() as AnyKeyframeChannel[]
  return [...builtins, ...extended]
}

/** The identity every renderer reads a transform-less clip as, when no better
 *  default is known. For text/shape the real per-type default is used. */
const IDENTITY_TRANSFORM: Transform = {
  x: 0.5,
  y: 0.5,
  scale: 1,
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
}

/**
 * The transform the RESOLVER assumes for a clip with `transform === undefined`
 * when a keyframe needs something to override.
 *
 * Text and shape defaults are exact (textAnimation.ts). For video/image the
 * true default is an object-fit-contain rect the resolver cannot compute — it
 * has no asset registry, and the writer (`elements/keyframes.ts`) bakes the
 * real contain transform alongside the first key precisely so this fallback is
 * only ever reached by a hand-edited or agent-written document. The identity
 * here equals the renderer's unknown-content-size path (drawRect.ts
 * `contentWidth ?? stageWidth`), so it is at worst a full-stage placement,
 * never a crash.
 */
export function typeDefaultTransform(type: ClipType): Transform {
  if (type === 'text') return DEFAULT_TEXT_TRANSFORM
  if (type === 'shape') return DEFAULT_SHAPE_TRANSFORM
  return IDENTITY_TRANSFORM
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Collapse raw stored keys into a sampleable list: finite `frame` and `value`
 * only, integer frames, ascending, one key per frame (the LAST wins, so an
 * agent that appends a correction never has to find the old one first).
 * Returns a new array; never mutates its input.
 */
export function normalizeKeys(keys: ReadonlyArray<Keyframe> | undefined): Keyframe[] {
  if (!Array.isArray(keys) || keys.length === 0) return []
  const byFrame = new Map<number, Keyframe>()
  for (const k of keys) {
    if (!k || typeof k !== 'object') continue
    if (!Number.isFinite(k.frame) || !Number.isFinite(k.value)) continue
    const frame = Math.floor(k.frame)
    byFrame.set(frame, frame === k.frame ? k : { ...k, frame })
  }
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame)
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * Value of one channel at `localFrame`, or `undefined` if it has no keys.
 *
 * Holds the first key's value before it and the last key's after it — never
 * extrapolates. That is what makes a trim lossless: keys pushed outside the
 * clip by a left-edge trim keep contributing their end value and come back
 * intact when the trim is reversed.
 *
 * Between keys the segment's curve is the DESTINATION key's — its `spring`
 * (PV-P5a), else its `easingBezier`, else its `easing` — unless the source key
 * is a `hold`, which steps. See `segmentProgress`.
 */
export function sampleChannel(keys: ReadonlyArray<Keyframe>, localFrame: number): number | undefined {
  const sorted = normalizeKeys(keys)
  if (sorted.length === 0) return undefined
  const f = Number.isFinite(localFrame) ? localFrame : 0

  const first = sorted[0]
  if (f <= first.frame) return first.value
  const last = sorted[sorted.length - 1]
  if (f >= last.frame) return last.value

  // Linear scan: keyframe lists are a handful of entries. Revisit with a
  // binary search only if a profile ever says so.
  let i = 0
  while (i < sorted.length - 1 && sorted[i + 1].frame <= f) i++
  const a = sorted[i]
  const b = sorted[i + 1]
  if (a.hold) return a.value

  const span = b.frame - a.frame
  const t = span > 0 ? (f - a.frame) / span : 1
  const e = segmentProgress(b, t)
  return a.value + (b.value - a.value) * e
}

/**
 * Progress 0..1 (may overshoot) of the segment arriving at `b`, at segment time
 * `t` in 0..1: spring (PV-P5a) → cubic bezier (EDX-P6) → named easing.
 *
 * The precedence is the whole design: a spring is the most specific thing a
 * key can say about its segment, and a document that stores one must play the
 * same on every build. Shared by every sampler, so the curve drawer, the GPU
 * preview, the `time` remap and the export worker cannot disagree.
 *
 * `isValidSpring` is re-checked here rather than trusted: the spring is read
 * off a stored clip, so a hand-edited or agent-written document can hold
 * anything, and an invalid spring must fall through to the bezier or the named
 * easing rather than produce NaN.
 */
export function segmentProgress(b: Keyframe, t: number): number {
  if (isValidSpring(b.spring)) return springProgress(b.spring, t)
  if (isValidBezier(b.easingBezier)) return cubicBezier(b.easingBezier, t)
  if (isValidSteps(b.steps)) return stepsProgress(b.steps, t)
  return evaluateEasing(b.easing, t)
}

/** A usable `Keyframe.steps`: an integer 1..64. Anything else is ignored (falls to `easing`). */
export function isValidSteps(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 64
}

/** Jump-end staircase, like CSS and GSAP `steps(n)`: n equal jumps, landing on 1 at t = 1. */
function stepsProgress(n: number, t: number): number {
  if (!(t > 0)) return 0
  if (t >= 1) return 1
  return Math.floor(t * n) / n
}

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo
  return value < lo ? lo : value > hi ? hi : value
}

/** Smallest scale a keyframe may resolve to — a clip at scale 0 has no box to
 *  select in the overlay. Same floor as `MIN_ANIMATED_SCALE` in textAnimation. */
const MIN_KEYFRAMED_SCALE = 0.001

/**
 * Sample every keyed channel of a clip at `localFrame`.
 *
 * `base` is the transform the keyed channels override — `clip.transform`, or
 * `typeDefaultTransform(clip.type)` when the author never placed the clip.
 * The returned transform is a fresh object; `base` is never mutated. When no
 * transform channel is keyed the sample carries NO transform, so the caller
 * leaves `clip.transform` exactly as authored (including undefined, which the
 * renderer reads as "apply your own default" — scene.ts).
 */
export function sampleKeyframes(
  keyframes: ClipKeyframes | undefined,
  localFrame: number,
  base: Transform,
  expr?: ChannelExpression,
): KeyframeSample {
  const channels = keyframes?.channels
  if (!channels || typeof channels !== 'object') return {}

  const sample: KeyframeSample = {}
  let transform: Transform | undefined

  // The expression hook runs BEFORE the clamps below, never after: an expression
  // is author input like any other, and `opacity = 2` or `scale = 0` must be
  // clamped exactly as a keyed 2 or 0 is. A clamp that ran first would make
  // `scale = 0` permanently 0.001 with no way back.
  const read = (channel: AnyKeyframeChannel): number | undefined => {
    const keyed = sampleChannel(channelKeys(channels[channel]), localFrame)
    const over = expr?.(channel, keyed)
    return over !== undefined ? over : keyed
  }

  for (const channel of TRANSFORM_CHANNELS) {
    const v = read(channel)
    if (v === undefined) continue
    transform ??= { ...base, anchor: { ...base.anchor } }
    if (channel === 'scale' || channel === 'scaleX' || channel === 'scaleY') {
      transform[channel] = Math.max(MIN_KEYFRAMED_SCALE, v)
    } else {
      transform[channel] = v
    }
  }
  if (transform) sample.transform = transform

  const opacity = read('opacity')
  if (opacity !== undefined) sample.opacity = clamp(opacity, 0, 1)

  const volume = read('volume')
  if (volume !== undefined) sample.volume = clamp(volume, 0, 1)

  const cornerRadius = read('cornerRadius')
  if (cornerRadius !== undefined) sample.cornerRadius = clamp(cornerRadius, 0, 0.5)

  return sample
}

/**
 * Sample every EXTENDED channel (`time`, `fx.*`, `mask.*`) at `localFrame`,
 * by channel name. Values are raw: the consumer clamps them (effect params by
 * the registry, mask fields by the mask resolver), which keeps this sampler
 * free of any registry knowledge. Channels with no usable key are absent.
 */
export function sampleExtendedChannels(
  keyframes: ClipKeyframes | undefined,
  localFrame: number,
  expr?: ChannelExpression,
): Record<string, number> {
  const channels = keyframes?.channels
  const out: Record<string, number> = {}
  for (const channel of presentKeyframeChannels(channels)) {
    if (isBuiltinKeyframeChannel(channel)) continue
    // Typed channels (PV-P5c) are not numbers — their samplers live below and
    // are called separately by the resolver. An `fx.*` colour channel still
    // stores a placeholder 0 (`value` is unused for a typed key) and yields it
    // here; `resolveEffects` ignores a numeric key on a colour param, so that
    // is harmless.
    if (isTypedChannelName(channel)) continue
    const keyed = sampleChannel(channelKeys(channels![channel]), localFrame)
    const over = expr?.(channel, keyed)
    const v = over !== undefined ? over : keyed
    if (v !== undefined) out[channel] = v
  }
  return out
}

/** A track's keys, tolerating a missing/corrupt track and any `source` kind.
 *  An unknown kind, and `'track'` until track assets exist, read as keyframes —
 *  forward compatibility by construction. */
function channelKeys(track: KeyframeChannelTrack | undefined): Keyframe[] {
  if (!track || typeof track !== 'object') return []
  return Array.isArray(track.keys) ? track.keys : []
}

// ---------------------------------------------------------------------------
// Typed channels (PV-P5c) — colour (`vec`) and path (`path`) keys
// ---------------------------------------------------------------------------

/** `normalizeKeys`, then only keys whose `vec` parses (padded to 4 with alpha 1). */
export function normalizeVecKeys(keys: ReadonlyArray<Keyframe> | undefined): Keyframe[] {
  const out: Keyframe[] = []
  for (const k of normalizeKeys(keys)) {
    const rgba = toRgba(k.vec)
    if (rgba) out.push({ ...k, vec: rgba })
  }
  return out
}

/** `normalizeKeys`, then only keys with a non-blank string `path`. */
export function normalizePathKeys(keys: ReadonlyArray<Keyframe> | undefined): Keyframe[] {
  return normalizeKeys(keys).filter((k) => typeof k.path === 'string' && k.path.trim() !== '')
}

/**
 * Value of a colour channel at `localFrame`, walking keys exactly like
 * `sampleChannel` (hold before the first key and after the last, the
 * destination key's curve via `segmentProgress` between). Returns a COPY of
 * the endpoint `vec` outside/at holds; between keys, a plain component-wise
 * lerp by default, or the premultiplied lerp (`lerpColor`) when
 * `opts.premultiplied` is `true` — which is what `sampleColorChannel` always
 * asks for, since a straight component-wise lerp of `transparent → red`
 * passes visibly through dark red.
 */
export function sampleVecChannel(
  keys: ReadonlyArray<Keyframe>,
  localFrame: number,
  opts?: { premultiplied?: boolean },
): number[] | undefined {
  const sorted = normalizeVecKeys(keys)
  if (sorted.length === 0) return undefined
  const f = Number.isFinite(localFrame) ? localFrame : 0

  const first = sorted[0]!
  if (f <= first.frame) return [...(first.vec as number[])]
  const last = sorted[sorted.length - 1]!
  if (f >= last.frame) return [...(last.vec as number[])]

  let i = 0
  while (i < sorted.length - 1 && sorted[i + 1]!.frame <= f) i++
  const a = sorted[i]!
  const b = sorted[i + 1]!
  if (a.hold) return [...(a.vec as number[])]

  const span = b.frame - a.frame
  const t = span > 0 ? (f - a.frame) / span : 1
  const e = segmentProgress(b, t)
  const av = a.vec as number[]
  const bv = b.vec as number[]
  if (opts?.premultiplied) return lerpColor(av, bv, e)
  return av.map((v, idx) => v + ((bv[idx] as number) - v) * e)
}

/** `sampleVecChannel` premultiplied, typed as `Rgba`. */
export function sampleColorChannel(keys: ReadonlyArray<Keyframe>, localFrame: number): Rgba | undefined {
  const v = sampleVecChannel(keys, localFrame, { premultiplied: true })
  return v as Rgba | undefined
}

/** A path parse cache, cleared once it grows past 256 entries (a document has a handful of drawn shapes). */
const PATH_CUBICS_CACHE = new Map<string, CubicSubpath[] | null>()

function cubicsFor(d: string): CubicSubpath[] | null {
  const cached = PATH_CUBICS_CACHE.get(d)
  if (cached !== undefined) return cached
  if (PATH_CUBICS_CACHE.size >= 256) PATH_CUBICS_CACHE.clear()
  const parsed = parsePathToCubics(d)
  PATH_CUBICS_CACHE.set(d, parsed)
  return parsed
}

/** A reconciled-pair cache keyed by the two path strings (NUL-joined), cleared once it grows past 128 entries. `null` is a pair that cannot reconcile. */
const PATH_RECONCILED_CACHE = new Map<string, { a: CubicSubpath[]; b: CubicSubpath[] } | null>()

function reconciledFor(da: string, db: string, pa: CubicSubpath[], pb: CubicSubpath[]): { a: CubicSubpath[]; b: CubicSubpath[] } | null {
  const key = `${da}\0${db}`
  const cached = PATH_RECONCILED_CACHE.get(key)
  if (cached !== undefined) return cached
  if (PATH_RECONCILED_CACHE.size >= 128) PATH_RECONCILED_CACHE.clear()
  const r = reconcileCubics(pa, pb)
  const pair = r.ok ? { a: r.a, b: r.b } : null
  PATH_RECONCILED_CACHE.set(key, pair)
  return pair
}

/**
 * Value of a `shape.path` channel at `localFrame`. Outside the keys, at a
 * hold, and exactly ON a key frame, returns that key's ORIGINAL `path`
 * string — never a re-serialized one, so a clip parked on a key paints
 * exactly what was authored.
 *
 * Between two keys, AGN-P27 RECONCILES the pair first (`reconcileCubics`: exact
 * de Casteljau splits, explicit closing, ring rotation and winding) and morphs the
 * reconciled pair — including when the structure already matches, because a closed
 * pair differing only in start corner or winding collapses to a point under a plain
 * index-by-index lerp. An unparseable or irreconcilable pair still HOLDS the source
 * key's path until the destination key's frame (by design). Reconciliation is a
 * between-frames concern only: a key frame itself still returns its original string.
 */
export function samplePathChannel(keys: ReadonlyArray<Keyframe>, localFrame: number): string | undefined {
  const sorted = normalizePathKeys(keys)
  if (sorted.length === 0) return undefined
  const f = Number.isFinite(localFrame) ? localFrame : 0

  const first = sorted[0]!
  if (f <= first.frame) return first.path
  const last = sorted[sorted.length - 1]!
  if (f >= last.frame) return last.path

  let i = 0
  while (i < sorted.length - 1 && sorted[i + 1]!.frame <= f) i++
  const a = sorted[i]!
  const b = sorted[i + 1]!
  if (a.hold || f === a.frame) return a.path

  const pa = cubicsFor(a.path as string)
  const pb = cubicsFor(b.path as string)
  if (!pa || !pb) return a.path
  const pair = reconciledFor(a.path as string, b.path as string, pa, pb)
  if (!pair) return a.path
  const ma = pair.a
  const mb = pair.b

  const span = b.frame - a.frame
  const t = span > 0 ? (f - a.frame) / span : 1
  const e = segmentProgress(b, t)
  return serializeCubics(morphCubics(ma, mb, e))
}

/** The typed channels sampled for one frame, spread into an Active clip. */
export interface TypedSample {
  color?: string
  fill?: string
  stroke?: string
  path?: string
}

/**
 * `color`/`shape.fill`/`shape.stroke`/`shape.path` sampled at `localFrame`.
 * A channel absent when it has no usable key; `{}` for a clip with no
 * keyframes at all.
 */
export function sampleTypedChannels(keyframes: ClipKeyframes | undefined, localFrame: number): TypedSample {
  const channels = keyframes?.channels
  if (!channels || typeof channels !== 'object') return {}
  const out: TypedSample = {}

  const color = sampleColorChannel(channelKeys(channels.color), localFrame)
  if (color) out.color = formatColor(color)
  const fill = sampleColorChannel(channelKeys(channels['shape.fill']), localFrame)
  if (fill) out.fill = formatColor(fill)
  const stroke = sampleColorChannel(channelKeys(channels['shape.stroke']), localFrame)
  if (stroke) out.stroke = formatColor(stroke)
  const path = samplePathChannel(channelKeys(channels['shape.path']), localFrame)
  if (path !== undefined) out.path = path

  return out
}

/** `fx.<id>.<param>` → `'#rrggbb'` for every effect channel whose keys carry `vec`. */
export function sampleEffectColors(
  keyframes: ClipKeyframes | undefined,
  localFrame: number,
): Record<string, string> {
  const channels = keyframes?.channels
  const out: Record<string, string> = {}
  if (!channels || typeof channels !== 'object') return out
  for (const channel of presentKeyframeChannels(channels)) {
    if (!FX_CHANNEL_RE.test(channel)) continue
    const keys = normalizeVecKeys(channelKeys(channels[channel]))
    if (keys.length === 0) continue
    const v = sampleColorChannel(keys, localFrame)
    if (v) out[channel] = vecToHex(v)
  }
  return out
}

/** True when the clip has at least one usable key on any channel. */
export function hasKeyframes(keyframes: ClipKeyframes | undefined): boolean {
  const channels = keyframes?.channels
  if (!channels || typeof channels !== 'object') return false
  for (const channel of presentKeyframeChannels(channels)) {
    if (normalizeKeys(channelKeys(channels[channel])).length > 0) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Remapping — keeps clip-relative frames honest across timeline edits
// ---------------------------------------------------------------------------

/**
 * Shift and/or scale every key's frame. Used by `trimClip` (shift by the
 * negated start delta) and `setClipSpeed` (scale by new÷old duration).
 *
 * Frames are rounded back to integers afterwards; two keys that land on the
 * same frame collapse to the LATER one in source order, matching
 * `normalizeKeys`. Out-of-range keys are kept on purpose — see `sampleChannel`.
 * Returns `undefined` for `undefined` input so callers can assign straight
 * back to `clip.keyframes`.
 */
export function remapKeyframes(
  keyframes: ClipKeyframes | undefined,
  opts: { shift?: number; scale?: number },
): ClipKeyframes | undefined {
  if (!keyframes?.channels) return keyframes
  const shift = Number.isFinite(opts.shift) ? (opts.shift as number) : 0
  const scale = Number.isFinite(opts.scale) && (opts.scale as number) > 0 ? (opts.scale as number) : 1
  if (shift === 0 && scale === 1) return keyframes

  const channels: ClipKeyframes['channels'] = {}
  for (const channel of presentKeyframeChannels(keyframes.channels)) {
    const track = keyframes.channels[channel]
    if (!track) continue
    const keys = normalizeKeys(channelKeys(track)).map((k) => ({
      ...k,
      frame: Math.round((k.frame + shift) * scale),
    }))
    channels[channel] = { ...track, keys: normalizeKeys(keys) }
  }
  return { ...keyframes, channels }
}

/**
 * Divide keyframes at `cutFrame` (clip-relative) into the two halves a split
 * produces, so the split is a visual no-op: each half gets a boundary key at
 * the cut carrying the value the curve had there.
 *
 *   left  — keys before the cut, plus a boundary key AT the cut. Its easing is
 *           the incoming segment's, so the left half still eases into the cut.
 *   right — keys after the cut shifted by -cut, plus a boundary key at 0. It
 *           inherits `hold` from the segment it lands inside, so a held value
 *           stays held.
 * A key exactly on the cut goes to both halves.
 */
/**
 * The typed value (PV-P5c) a boundary key synthesized by `splitKeyframes`
 * should carry at `cut`, or `{}` for a scalar channel. `keys` is the
 * channel's full (already-normalized) key list; `normalizeVecKeys`/
 * `normalizePathKeys` filter it down to nothing for a channel that carries
 * no typed keys, so this is a no-op there — the parity guarantee for every
 * clip this ticket did not touch.
 */
function typedAt(keys: Keyframe[], cut: number): { vec?: Rgba; path?: string } {
  const vecKeys = normalizeVecKeys(keys)
  if (vecKeys.length > 0) {
    const v = sampleColorChannel(vecKeys, cut)
    if (v) return { vec: v }
  }
  const pathKeys = normalizePathKeys(keys)
  if (pathKeys.length > 0) {
    const p = samplePathChannel(pathKeys, cut)
    if (p !== undefined) return { path: p }
  }
  return {}
}

export function splitKeyframes(
  keyframes: ClipKeyframes | undefined,
  cutFrame: number,
): { left: ClipKeyframes | undefined; right: ClipKeyframes | undefined } {
  if (!keyframes?.channels) return { left: keyframes, right: keyframes }
  const cut = Math.floor(cutFrame)

  const left: ClipKeyframes['channels'] = {}
  const right: ClipKeyframes['channels'] = {}

  for (const channel of presentKeyframeChannels(keyframes.channels)) {
    const track = keyframes.channels[channel]
    if (!track) continue
    const keys = normalizeKeys(channelKeys(track))
    if (keys.length === 0) {
      // An expression channel may hold no keys at all (PV-P5b) — the keys are
      // optional, the expression is the point. Dropping it here would delete the
      // animation from BOTH halves of a split, the one thing a split must never
      // do. Carried across verbatim: it is already clip-relative-independent, and
      // its local time restarts at 0 on the right half.
      //
      // Narrow on purpose. A keyless KEYFRAMES channel is dead weight and was
      // dropped here before this ticket; preserving it would be a behaviour
      // change nobody asked for.
      if (track.source?.kind === 'expression') {
        left[channel] = { ...track, keys: [] }
        right[channel] = { ...track, keys: [] }
      }
      continue
    }

    const value = sampleChannel(keys, cut) as number
    const exact = keys.find((k) => k.frame === cut)
    // The segment the cut falls inside: [a, b). Used for the boundary keys'
    // easing/hold so neither half changes how the curve behaves around the cut.
    let a: Keyframe | undefined
    let b: Keyframe | undefined
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].frame <= cut) a = keys[i]
      else {
        b = keys[i]
        break
      }
    }

    const leftKeys = keys.filter((k) => k.frame < cut)
    leftKeys.push(
      exact ?? {
        id: generateId(),
        frame: cut,
        value,
        easing: b?.easing ?? a?.easing ?? 'linear',
        ...(b && isValidSteps(b.steps) ? { steps: b.steps } : {}),
        ...(a?.hold ? { hold: true as const } : {}),
        ...typedAt(keys, cut),
      },
    )

    const rightKeys = keys
      .filter((k) => k.frame > cut)
      .map((k) => ({ ...k, frame: k.frame - cut }))
    rightKeys.unshift(
      exact
        ? { ...exact, frame: 0 }
        : {
            id: generateId(),
            frame: 0,
            value,
            easing: 'linear',
            ...(a?.hold ? { hold: true as const } : {}),
            ...typedAt(keys, cut),
          },
    )

    left[channel] = { ...track, keys: normalizeKeys(leftKeys) }
    right[channel] = { ...track, keys: normalizeKeys(rightKeys) }
  }

  return {
    left: { ...keyframes, channels: left },
    right: { ...keyframes, channels: right },
  }
}
