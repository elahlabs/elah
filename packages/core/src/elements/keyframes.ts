/**
 * Keyframe WRITERS — the only way keys should enter a clip.
 *
 * Same contract as `applyTextTemplate`: every function returns a
 * `Partial<Clip>` patch for `engine.updateClip`, never touches the engine, and
 * has no React/DOM dependency. Everything downstream — GPU preview, the 2D
 * export worker, undo/redo, project save — already handles ordinary clip
 * fields, so keyframes inherit all of it by being ordinary clip fields.
 *
 * The one job these writers have that the sampler cannot do for itself is the
 * BASELINE. `clip.transform === undefined` does not mean identity: the
 * renderer substitutes a per-type default, and for video/image that default is
 * an object-fit-contain rect derived from the asset's natural size — which the
 * resolver never has (Project carries no asset registry; the media library is
 * a store the resolver is forbidden to import). So the first transform key on a
 * clip must be written TOGETHER with the concrete transform it overrides,
 * computed here where the content size is available. One patch, one undo
 * entry, and it becomes structurally impossible to persist keys on a clip whose
 * base the resolver would have to guess.
 */

import type {
  AnyKeyframeChannel,
  Clip,
  ClipKeyframes,
  Keyframe,
  KeyframeChannel,
  KeyframeSpring,
  TextAnimationEasing,
  Transform,
} from '../types'
import { generateId } from '../utils/id'
import {
  COLOR_CHANNELS,
  KEYFRAME_CHANNELS,
  isBuiltinKeyframeChannel,
  isExpressionChannel,
  normalizeKeys,
  parseEffectChannel,
  presentKeyframeChannels,
  sampleKeyframes,
  TRANSFORM_CHANNELS,
  typeDefaultTransform,
} from '../resolver/keyframes'
import { MAX_EXPRESSION_LENGTH } from '../resolver/expr/scope'
import { getEffectDefinition } from '../effects/registry'
import { isValidBezier, normalizeBezier, type BezierTuple } from '../resolver/bezier'
import { isValidSpring } from '../resolver/spring'
import { isValidSteps } from '../resolver/keyframes'
import { normalizeCrop, transformFromContainRect, type CropRect } from '../renderer/gpu/layers/drawRect'
import { DEFAULT_FONT_SIZE } from '../renderer/gpu/layers/textLayout'
import { formatColor, parseColor, toRgba } from '../utils/color'

/** What the writer needs to know about the world the clip is drawn in. */
export interface BaselineContext {
  stage: { width: number; height: number }
  /**
   * The asset's natural pixel size, when known. Video/image only; omit for
   * generated clips. When omitted (asset still probing) the stage size is
   * used, which reproduces the renderer's own `contentWidth ?? stageWidth`
   * fallback (drawRect.ts) so the bake is a visual no-op either way.
   */
  content?: { width: number; height: number }
}

/**
 * The transform a clip is drawn with right now, made explicit.
 *
 * - has one → returned as-is
 * - text / shape → the exact renderer default (textAnimation.ts constants)
 * - video / image → the contain placement of the CROPPED content, exactly as
 *   `MediaTransformOverlay` and `VideoClipProperties` already compute it
 * - audio / freehand → `undefined`; neither reads a transform
 */
export function baselineTransform(clip: Clip, ctx: BaselineContext): Transform | undefined {
  if (clip.transform) return clip.transform
  if (clip.type === 'text' || clip.type === 'shape') return typeDefaultTransform(clip.type)
  if (clip.type === 'video' || clip.type === 'image' || clip.type === 'sequence' || clip.type === 'compound') {
    const crop: CropRect = normalizeCrop(clip.crop)
    // A compound's natural size is its nested stage, exactly as an image's is its pixel size.
    const contentW = clip.type === 'compound' && clip.compound ? clip.compound.project.stage.width : (ctx.content?.width ?? ctx.stage.width)
    const contentH = clip.type === 'compound' && clip.compound ? clip.compound.project.stage.height : (ctx.content?.height ?? ctx.stage.height)
    return transformFromContainRect(
      contentW * crop.width,
      contentH * crop.height,
      ctx.stage.width,
      ctx.stage.height,
    )
  }
  return undefined
}

function isTransformChannel(channel: AnyKeyframeChannel): boolean {
  return (TRANSFORM_CHANNELS as ReadonlyArray<string>).includes(channel)
}

/**
 * The current authored value of an EXTENDED channel: an effect param's stored
 * value (else its registry default), a mask field, or the clip's source
 * in-point for `time`.
 */
function currentExtendedValue(clip: Clip, channel: AnyKeyframeChannel): number {
  if (channel === 'time') return clip.sourceStartFrame ?? 0
  if (channel === 'draw') return clip.shapeDraw?.end ?? 1
  if (channel === 'draw.start') return clip.shapeDraw?.start ?? 0
  // MC-2d: the static field each Tier B channel overrides (text size default 48 is the renderer's).
  if (channel === 'text.fontSize') return clip.fontSize ?? DEFAULT_FONT_SIZE
  if (channel === 'text.letterSpacing') return clip.textBox?.letterSpacing ?? 0
  if (channel === 'text.scramble') return 1
  if (channel === 'stroke.width') return clip.shapeStrokeWidth ?? 2
  if (channel === 'anchor.x') return clip.transform?.anchor?.x ?? typeDefaultTransform(clip.type).anchor.x
  if (channel === 'anchor.y') return clip.transform?.anchor?.y ?? typeDefaultTransform(clip.type).anchor.y
  if (channel.startsWith('gen.')) {
    const stored = clip.generator?.params?.[channel.slice(4)]
    return typeof stored === 'number' && Number.isFinite(stored) ? stored : 0
  }
  const fx = parseEffectChannel(channel)
  if (fx) {
    const effect = clip.effects?.find((e) => e.id === fx.effectId)
    const stored = effect?.params?.[fx.param]
    if (typeof stored === 'number' && Number.isFinite(stored)) return stored
    const def = effect ? getEffectDefinition(effect.kind)?.params[fx.param] : undefined
    return typeof def?.default === 'number' ? def.default : 0
  }
  if (channel.startsWith('mask.')) {
    const field = channel.slice(5) as 'x' | 'y' | 'width' | 'height' | 'rotation' | 'feather'
    const stored = clip.mask?.[field]
    if (typeof stored === 'number' && Number.isFinite(stored)) return stored
    return field === 'width' || field === 'height' ? 1 : 0
  }
  return 0
}

/** The channel's current value as the properties panel would show it. */
function currentChannelValue(clip: Clip, channel: AnyKeyframeChannel, base: Transform | undefined): number {
  if (channel === 'anchor.x' || channel === 'anchor.y') return base?.anchor?.[channel === 'anchor.x' ? 'x' : 'y'] ?? 0.5
  if (!isBuiltinKeyframeChannel(channel)) return currentExtendedValue(clip, channel)
  switch (channel) {
    case 'opacity':
      return clip.opacity ?? 1
    case 'volume':
      return clip.volume ?? 1
    case 'cornerRadius':
      return clip.cornerRadius ?? 0
    case 'scaleX':
    case 'scaleY':
      return base?.[channel] ?? 1
    case 'skewX':
    case 'skewY':
    case 'rotateX':
    case 'rotateY':
      return base?.[channel] ?? 0
    default:
      return base?.[channel] ?? (channel === 'scale' ? 1 : channel === 'rotation' ? 0 : 0.5)
  }
}

// ---------------------------------------------------------------------------
// Typed channels (PV-P5c) — colour and path writers
// ---------------------------------------------------------------------------

export type ChannelValueKind = 'scalar' | 'color' | 'path'

/**
 * What kind of value `channel` is keyed with: `COLOR_CHANNELS` and an
 * `fx.<id>.<param>` whose registry param is `type: 'color'` are `'color'`;
 * `'shape.path'` is `'path'`; everything else, including an `fx.*` channel
 * whose effect is not on this clip, is `'scalar'`.
 */
export function channelValueKind(clip: Clip, channel: AnyKeyframeChannel): ChannelValueKind {
  if ((COLOR_CHANNELS as ReadonlyArray<string>).includes(channel)) return 'color'
  if (channel === 'shape.path') return 'path'
  const fx = parseEffectChannel(channel)
  if (fx) {
    const effect = clip.effects?.find((e) => e.id === fx.effectId)
    const def = effect ? getEffectDefinition(effect.kind)?.params[fx.param] : undefined
    if (def?.type === 'color') return 'color'
  }
  return 'scalar'
}

/**
 * The colour a colour channel shows when unkeyed — what the picker's swatch
 * reads before any diamond exists. `undefined` for a non-colour channel.
 */
export function authoredColor(clip: Clip, channel: AnyKeyframeChannel): string | undefined {
  if (channel === 'color') return clip.color ?? '#ffffff'
  if (channel === 'shape.fill') return clip.shapeFill ?? 'transparent'
  if (channel === 'shape.stroke') return clip.shapeStroke ?? '#ffffff'
  const fx = parseEffectChannel(channel)
  if (fx) {
    const effect = clip.effects?.find((e) => e.id === fx.effectId)
    const def = effect ? getEffectDefinition(effect.kind)?.params[fx.param] : undefined
    if (def?.type !== 'color') return undefined
    const stored = effect?.params?.[fx.param]
    return typeof stored === 'string' ? stored : (def.default as string)
  }
  return undefined
}

/**
 * Add or replace a colour key on `channel`, at floored `frame` (≥ 0). `color`
 * defaults to `authoredColor`; a string goes through `parseColor`, an array
 * through `toRgba`; anything unusable, or a non-colour channel, returns `{}`.
 * Mirrors `setKeyframe`'s shape exactly (id reuse, easing/bezier/spring/hold),
 * but stores `value: 0` and the parsed `vec` — never a scalar.
 */
export function setColorKeyframe(
  clip: Clip,
  channel: AnyKeyframeChannel,
  frame: number,
  color?: string | ReadonlyArray<number>,
  opts: SetKeyframeOptions = {},
): Partial<Clip> {
  if (channelValueKind(clip, channel) !== 'color') return {}
  const rgba =
    color === undefined
      ? parseColor(authoredColor(clip, channel))
      : typeof color === 'string'
        ? parseColor(color)
        : toRgba(color)
  if (!rgba) return {}

  const at = Math.max(0, Math.floor(Number.isFinite(frame) ? frame : 0))
  const existing = clip.keyframes?.channels?.[channel]
  const prior = normalizeKeys(existing?.keys).filter((k) => k.frame !== at)
  const key: Keyframe = {
    id: opts.id ?? existing?.keys?.find((k) => k.frame === at)?.id ?? generateId(),
    frame: at,
    value: 0,
    vec: [...rgba],
    easing: opts.easing ?? 'linear',
    ...(opts.easingBezier && isValidBezier(opts.easingBezier) ? { easingBezier: normalizeBezier(opts.easingBezier) } : {}),
    ...(opts.spring && isValidSpring(opts.spring) ? { spring: { ...opts.spring } } : {}),
    ...(isValidSteps(opts.steps) ? { steps: opts.steps } : {}),
    ...(opts.hold ? { hold: true as const } : {}),
  }

  return {
    keyframes: {
      ...clip.keyframes,
      channels: {
        ...clip.keyframes?.channels,
        [channel]: { source: { kind: 'keyframes' }, ...existing, keys: normalizeKeys([...prior, key]) },
      },
    },
  }
}

/**
 * Add or replace a `shape.path` key, at floored `frame` (≥ 0). `path`
 * defaults to `clip.shapePath`; a non-`path` shape, or a blank path, returns
 * `{}`. Same shape as `setColorKeyframe`, storing `value: 0` and `path`.
 */
export function setPathKeyframe(
  clip: Clip,
  frame: number,
  path?: string,
  opts: SetKeyframeOptions = {},
): Partial<Clip> {
  if (clip.type !== 'shape' || clip.shapeKind !== 'path') return {}
  const p = path === undefined ? clip.shapePath : path
  if (typeof p !== 'string' || p.trim() === '') return {}

  const channel: AnyKeyframeChannel = 'shape.path'
  const at = Math.max(0, Math.floor(Number.isFinite(frame) ? frame : 0))
  const existing = clip.keyframes?.channels?.[channel]
  const prior = normalizeKeys(existing?.keys).filter((k) => k.frame !== at)
  const key: Keyframe = {
    id: opts.id ?? existing?.keys?.find((k) => k.frame === at)?.id ?? generateId(),
    frame: at,
    value: 0,
    path: p,
    easing: opts.easing ?? 'linear',
    ...(opts.easingBezier && isValidBezier(opts.easingBezier) ? { easingBezier: normalizeBezier(opts.easingBezier) } : {}),
    ...(opts.spring && isValidSpring(opts.spring) ? { spring: { ...opts.spring } } : {}),
    ...(isValidSteps(opts.steps) ? { steps: opts.steps } : {}),
    ...(opts.hold ? { hold: true as const } : {}),
  }

  return {
    keyframes: {
      ...clip.keyframes,
      channels: {
        ...clip.keyframes?.channels,
        [channel]: { source: { kind: 'keyframes' }, ...existing, keys: normalizeKeys([...prior, key]) },
      },
    },
  }
}

export interface SetKeyframeOptions {
  easing?: TextAnimationEasing
  /** Custom curve into this key; wins over `easing` when set (EDX-P6). */
  easingBezier?: [number, number, number, number]
  /** Spring into this key (PV-P5a); wins over `easingBezier` and `easing`. */
  spring?: KeyframeSpring
  /** Staircase into this key (integer 1..64); wins over `easing`, loses to `spring` and `easingBezier`. */
  steps?: number
  hold?: true
  /** Reuse an id (an agent updating a key it created). Defaults to a fresh one. */
  id?: string
}

/**
 * Write one key: add it, or replace the key already on that frame.
 *
 * `value` defaults to the channel's current authored value, which is what the
 * CapCut "click the diamond" gesture means — "remember what it is now, here".
 * If this is the first TRANSFORM key on a clip that has no transform, the patch
 * also carries the baked baseline (`baselineTransform`) so the two land in one
 * `updateClip`.
 */
export function setKeyframe(
  clip: Clip,
  channel: AnyKeyframeChannel,
  frame: number,
  ctx: BaselineContext,
  value?: number,
  opts: SetKeyframeOptions = {},
): Partial<Clip> {
  // A scalar key on a typed (colour/path) channel would be invisible to the
  // typed samplers (PV-P5c) — the colour/path pickers write through
  // `setColorKeyframe`/`setPathKeyframe` instead.
  if (channelValueKind(clip, channel) !== 'scalar') return {}
  if (!tierBChannelFits(clip, channel)) return {}
  const base = baselineTransform(clip, ctx)
  const at = Math.max(0, Math.floor(Number.isFinite(frame) ? frame : 0))
  const v = value !== undefined && Number.isFinite(value) ? value : currentChannelValue(clip, channel, base)

  const existing = clip.keyframes?.channels?.[channel]
  const prior = normalizeKeys(existing?.keys).filter((k) => k.frame !== at)
  const key: Keyframe = {
    id: opts.id ?? existing?.keys?.find((k) => k.frame === at)?.id ?? generateId(),
    frame: at,
    value: v,
    easing: opts.easing ?? 'linear',
    ...(opts.easingBezier && isValidBezier(opts.easingBezier) ? { easingBezier: normalizeBezier(opts.easingBezier) } : {}),
    ...(opts.spring && isValidSpring(opts.spring) ? { spring: { ...opts.spring } } : {}),
    ...(isValidSteps(opts.steps) ? { steps: opts.steps } : {}),
    ...(opts.hold ? { hold: true as const } : {}),
  }

  const keyframes: ClipKeyframes = {
    ...clip.keyframes,
    channels: {
      ...clip.keyframes?.channels,
      [channel]: { source: { kind: 'keyframes' }, ...existing, keys: normalizeKeys([...prior, key]) },
    },
  }

  const patch: Partial<Clip> = { keyframes }
  // MC-2d: an anchor key overrides one half of `transform.anchor`, so it bakes the transform like a transform key does.
  if ((isTransformChannel(channel) || channel === 'anchor.x' || channel === 'anchor.y') && !clip.transform && base) patch.transform = base
  return patch
}

/** Remove one key by id. A channel left with no keys is dropped entirely, so
 *  `hasKeyframes` reports it honestly and the resolver skips it — UNLESS the
 *  channel is driven by an expression (PV-P5b), where the keys were optional and
 *  the expression IS the channel. Dropping it would make the last diamond on a
 *  clip silently delete its animation. */
export function removeKeyframe(clip: Clip, channel: AnyKeyframeChannel, keyId: string): Partial<Clip> {
  const existing = clip.keyframes?.channels?.[channel]
  if (!existing) return {}
  const keys = normalizeKeys(existing.keys).filter((k) => k.id !== keyId)
  const keep = keys.length > 0 || existing.source?.kind === 'expression'
  return { keyframes: withChannel(clip.keyframes, channel, keep ? { ...existing, keys } : undefined) }
}

/** Drop every key on a channel — the "un-diamond" gesture. The clip keeps
 *  whatever `transform` was baked, so nothing jumps. */
export function clearKeyframeChannel(clip: Clip, channel: AnyKeyframeChannel): Partial<Clip> {
  if (!clip.keyframes?.channels?.[channel]) return {}
  return { keyframes: withChannel(clip.keyframes, channel, undefined) }
}

// ---------------------------------------------------------------------------
// Gesture routing — how a preview drag writes to a KEYED clip
// ---------------------------------------------------------------------------

/** A transform with every optional channel filled in, for gesture arithmetic. */
export type FilledTransform = Transform & { scaleX: number; scaleY: number }

/** Fill a transform's optional channels from `fallback`, so no term is undefined. */
export function editableTransform(
  t: Transform | undefined,
  fallback: Transform,
): FilledTransform {
  return {
    x: t?.x ?? fallback.x,
    y: t?.y ?? fallback.y,
    scale: t?.scale ?? fallback.scale,
    rotation: t?.rotation ?? fallback.rotation,
    anchor: t?.anchor ?? fallback.anchor,
    scaleX: t?.scaleX ?? fallback.scaleX ?? 1,
    scaleY: t?.scaleY ?? fallback.scaleY ?? 1,
    // MOT-8: carried only when set, so a gesture on an unskewed clip writes the object it always did.
    ...((t?.skewX ?? fallback.skewX) !== undefined ? { skewX: t?.skewX ?? fallback.skewX } : {}),
    ...((t?.skewY ?? fallback.skewY) !== undefined ? { skewY: t?.skewY ?? fallback.skewY } : {}),
    // MOT-8 phase B: same rule for the 3D tilt and its eye distance.
    ...((t?.rotateX ?? fallback.rotateX) !== undefined ? { rotateX: t?.rotateX ?? fallback.rotateX } : {}),
    ...((t?.rotateY ?? fallback.rotateY) !== undefined ? { rotateY: t?.rotateY ?? fallback.rotateY } : {}),
    ...((t?.perspective ?? fallback.perspective) !== undefined ? { perspective: t?.perspective ?? fallback.perspective } : {}),
  }
}

/**
 * Where a stage gesture should START from: the authored transform with every
 * KEYED channel replaced by its sampled value at `localFrame`.
 *
 * This is the fix for a real defect. The overlays seed a drag from the authored
 * transform, on the reasoning that "rendered == authored + animation offset",
 * so adding the pointer delta to the authored value moves the painted clip by
 * exactly that delta. That holds for `MotionSpec` ramps, which ARE an offset.
 * It is false for keyframes, which are absolute: a keyed `x` replaces the
 * authored one outright, so the rendered position bears no fixed relation to it
 * and the clip jumps to the authored spot on the first pointermove.
 */
export function gestureBaseTransform(
  clip: Clip,
  localFrame: number,
  ctx: BaselineContext,
  fallback: Transform,
): FilledTransform {
  const authored = editableTransform(clip.transform ?? baselineTransform(clip, ctx), fallback)
  const sample = sampleKeyframes(clip.keyframes, localFrame, authored)
  if (!sample.transform) return authored
  return editableTransform(sample.transform, authored)
}

/**
 * Route a gesture's whole-transform write: keyed channels become a key at the
 * playhead, everything else stays the static `transform`.
 *
 * `channels` is what the gesture actually drives — a move declares x and y, a
 * rotate declares rotation. A keyed channel the gesture does not touch gets no
 * key, so dragging a clip sideways never sprinkles keys on its rotation.
 *
 * With no keyed channel at all this returns `{ transform: next }`, byte for
 * byte what the overlays wrote before keyframes existed, which is the parity
 * guarantee for every unkeyed clip.
 *
 * Safe to call on every pointermove: `setKeyframe` reuses the id of a key
 * already on that frame, so the first move creates the key and every later one
 * replaces it in place. One `commitInteraction` folds the lot into one entry.
 */
export function routeTransformPatch(
  clip: Clip,
  next: FilledTransform,
  channels: ReadonlyArray<KeyframeChannel>,
  localFrame: number,
  ctx: BaselineContext,
): Partial<Clip> {
  const keyed = TRANSFORM_CHANNELS.filter((ch) => channelKeys(clip, ch).length > 0)
  if (keyed.length === 0) return { transform: next }

  // Keyed channels keep their AUTHORED value in `transform`: the keys decide
  // what renders, so moving the static value underneath them would change
  // nothing on screen now and everything if the keys were later removed.
  const transform: FilledTransform = { ...next }
  for (const ch of keyed) {
    const authored = clip.transform?.[ch]
    if (authored !== undefined) transform[ch] = authored
  }

  let working: Clip = { ...clip, transform }
  let patch: Partial<Clip> = { transform }
  for (const ch of keyed) {
    if (!channels.includes(ch)) continue
    const p = setKeyframe(working, ch, localFrame, ctx, next[ch])
    working = { ...working, ...p }
    patch = { ...patch, ...p }
  }
  return patch
}

/** The playhead as a clip-relative frame, clamped into the clip. */
export function clampLocalFrame(
  clip: Pick<Clip, 'startFrame' | 'durationFrames'>,
  currentFrame: number,
): number {
  const local = Math.floor(currentFrame) - clip.startFrame
  return Math.min(Math.max(0, local), Math.max(0, clip.durationFrames - 1))
}

// ---------------------------------------------------------------------------
// Queries — what the panel and the timeline lane both need to ask
// ---------------------------------------------------------------------------

/** A clip's keys on one channel, normalized. Empty when the channel is unkeyed. */
export function channelKeys(clip: Clip, channel: AnyKeyframeChannel): Keyframe[] {
  return normalizeKeys(clip.keyframes?.channels?.[channel]?.keys)
}

/**
 * Every BUILTIN channel that carries at least one key, in `KEYFRAME_CHANNELS`
 * order. Builtins only because the UI treats the result as that list; use
 * `allKeyedChannels` for effect, mask and time channels too.
 */
export function keyedChannels(clip: Clip): KeyframeChannel[] {
  return KEYFRAME_CHANNELS.filter((c) => channelKeys(clip, c).length > 0)
}

/** Every channel of any kind that carries at least one key: builtins first. */
export function allKeyedChannels(clip: Clip): AnyKeyframeChannel[] {
  return clipChannels(clip).filter((c) => channelKeys(clip, c).length > 0)
}

/** The valid channels present on a clip, builtins first. */
function clipChannels(clip: Clip): AnyKeyframeChannel[] {
  return presentKeyframeChannels(clip.keyframes?.channels)
}

/**
 * Frame → CSS colour of the first colour key on it, for the timeline's key
 * lane (`COLOR_CHANNELS` order, then any `fx.*` colour channel by name).
 */
export function keyFrameSwatches(clip: Clip): Map<number, string> {
  const colorChannels = clipChannels(clip).filter((c) => channelValueKind(clip, c) === 'color')
  const ordered = [
    ...COLOR_CHANNELS.filter((c) => colorChannels.includes(c)),
    ...colorChannels.filter((c) => !(COLOR_CHANNELS as ReadonlyArray<string>).includes(c)).sort(),
  ]
  const byFrame = new Map<number, string>()
  for (const channel of ordered) {
    for (const key of channelKeys(clip, channel)) {
      if (byFrame.has(key.frame)) continue
      const rgba = toRgba(key.vec)
      if (rgba) byFrame.set(key.frame, formatColor(rgba))
    }
  }
  return new Map([...byFrame.entries()].sort((a, b) => a[0] - b[0]))
}

/**
 * The distinct frames that carry a key on ANY channel, ascending.
 *
 * The timeline draws one diamond per frame rather than per key, and prev/next
 * navigation steps between frames, because a user who keyed Position sees one
 * marker — not one for x and one for y sitting on the same pixel.
 */
export function keyFrameUnion(clip: Clip): number[] {
  const frames = new Set<number>()
  for (const channel of clipChannels(clip)) {
    for (const key of channelKeys(clip, channel)) frames.add(key.frame)
  }
  return [...frames].sort((a, b) => a - b)
}

/** True when `localFrame` carries a key on any channel. */
export function hasKeyAtFrame(clip: Clip, localFrame: number): boolean {
  return keyFrameUnion(clip).includes(Math.floor(localFrame))
}

/** The nearest keyed frame strictly before `localFrame`, or undefined. */
export function prevKeyFrame(clip: Clip, localFrame: number): number | undefined {
  const frames = keyFrameUnion(clip).filter((f) => f < localFrame)
  return frames.length ? frames[frames.length - 1] : undefined
}

/** The nearest keyed frame strictly after `localFrame`, or undefined. */
export function nextKeyFrame(clip: Clip, localFrame: number): number | undefined {
  return keyFrameUnion(clip).find((f) => f > localFrame)
}

// ---------------------------------------------------------------------------
// Frame-level edits — a "keyframe" to the user is every channel at one frame
// ---------------------------------------------------------------------------

/**
 * How far a key at `fromFrame` may be dragged before it would collide.
 *
 * Returns the open interval between its neighbours on EVERY channel keyed at
 * that frame, intersected with the clip. Collisions are blocked rather than
 * merged: `normalizeKeys` keeps the last key on a frame, so letting a drag
 * cross a neighbour would silently delete it mid-gesture and commit a merge the
 * user never saw.
 */
export function keyDragRange(clip: Clip, fromFrame: number): { min: number; max: number } {
  const at = Math.floor(fromFrame)
  let min = 0
  let max = Math.max(0, clip.durationFrames - 1)

  for (const channel of clipChannels(clip)) {
    const keys = channelKeys(clip, channel)
    if (!keys.some((k) => k.frame === at)) continue
    for (const key of keys) {
      if (key.frame < at) min = Math.max(min, key.frame + 1)
      else if (key.frame > at) max = Math.min(max, key.frame - 1)
    }
  }
  return { min, max: Math.max(min, max) }
}

/** Frames a dragged key should snap to: the other keys, plus the clip's ends. */
export function keySnapFrames(clip: Clip, fromFrame: number, playheadLocal?: number): number[] {
  const at = Math.floor(fromFrame)
  const frames = new Set<number>(keyFrameUnion(clip).filter((f) => f !== at))
  frames.add(0)
  frames.add(Math.max(0, clip.durationFrames - 1))
  if (playheadLocal !== undefined && Number.isFinite(playheadLocal)) {
    frames.add(Math.floor(playheadLocal))
  }
  return [...frames].sort((a, b) => a - b)
}

/**
 * Move every key sitting on `fromFrame` to `toFrame`, on all channels at once.
 *
 * Always computed against the clip passed in, never against a clip this
 * function returned — a drag calls it once per pointermove with the SAME
 * gesture-start clip, so the key does not run away from the cursor.
 *
 * Returns `{}` when nothing would change, which lets `previewClip`'s identity
 * check short-circuit the re-render.
 */
export function moveKeysAtFrame(clip: Clip, fromFrame: number, toFrame: number): Partial<Clip> {
  const from = Math.floor(fromFrame)
  const to = Math.max(0, Math.min(Math.floor(toFrame), Math.max(0, clip.durationFrames - 1)))
  if (from === to) return {}

  const channels = { ...clip.keyframes?.channels }
  let touched = false
  for (const channel of clipChannels(clip)) {
    const track = clip.keyframes?.channels?.[channel]
    if (!track) continue
    const keys = normalizeKeys(track.keys)
    if (!keys.some((k) => k.frame === from)) continue
    touched = true
    channels[channel] = {
      ...track,
      keys: normalizeKeys(
        keys
          .filter((k) => k.frame !== to)
          .map((k) => (k.frame === from ? { ...k, frame: to } : k)),
      ),
    }
  }
  return touched ? { keyframes: { ...clip.keyframes, channels } } : {}
}

/**
 * Move every key sitting on any of `frames` by `delta` frames, on all
 * channels at once — dragging several selected keyframe diamonds (PV-T1).
 *
 * The delta is clamped so every moved key stays inside the clip. Keys that
 * would land on a key that is NOT moving make the whole move a no-op
 * (`{}`), for the same reason `keyDragRange` blocks collisions: a merge the
 * user never saw would silently delete a key. Keys outside the clip (left by
 * a trim) are not draggable, so frames outside it also return `{}`.
 */
export function moveKeysAtFrames(clip: Clip, frames: ReadonlyArray<number>, delta: number): Partial<Clip> {
  const from = new Set(frames.filter((f) => Number.isFinite(f)).map((f) => Math.floor(f)))
  const d = Math.round(delta)
  if (from.size === 0 || !Number.isFinite(d) || d === 0) return {}
  const last = Math.max(0, clip.durationFrames - 1)
  const lo = Math.min(...from)
  const hi = Math.max(...from)
  if (lo < 0 || hi > last) return {}
  const shift = Math.max(-lo, Math.min(last - hi, d))
  if (shift === 0) return {}

  const channels = { ...clip.keyframes?.channels }
  let touched = false
  for (const channel of clipChannels(clip)) {
    const track = clip.keyframes?.channels?.[channel]
    if (!track) continue
    const keys = normalizeKeys(track.keys)
    const moving = keys.filter((k) => from.has(k.frame))
    if (moving.length === 0) continue
    const staying = keys.filter((k) => !from.has(k.frame))
    const occupied = new Set(staying.map((k) => k.frame))
    if (moving.some((k) => occupied.has(k.frame + shift))) return {}
    touched = true
    channels[channel] = {
      ...track,
      keys: normalizeKeys([...staying, ...moving.map((k) => ({ ...k, frame: k.frame + shift }))]),
    }
  }
  return touched ? { keyframes: { ...clip.keyframes, channels } } : {}
}

/** Remove every key on `localFrame`, across all channels. The "delete key" gesture. */
export function removeKeysAtFrame(clip: Clip, localFrame: number): Partial<Clip> {
  const at = Math.floor(localFrame)
  let working: Clip = clip
  let patch: Partial<Clip> = {}
  for (const channel of clipChannels(clip)) {
    const key = channelKeys(working, channel).find((k) => k.frame === at)
    if (!key) continue
    const p = removeKeyframe(working, channel, key.id)
    working = { ...working, ...p }
    patch = { ...patch, ...p }
  }
  return patch
}

/**
 * Rewrite every key on `localFrame` (on every channel, or only `only`).
 * Shared by the easing / bezier / hold writers.
 */
function mapKeysAtFrame(
  clip: Clip,
  localFrame: number,
  fn: (k: Keyframe) => Keyframe,
  only?: AnyKeyframeChannel,
): Partial<Clip> {
  const at = Math.floor(localFrame)
  const channels = { ...clip.keyframes?.channels }
  let touched = false
  for (const channel of clipChannels(clip)) {
    if (only && channel !== only) continue
    const track = clip.keyframes?.channels?.[channel]
    if (!track) continue
    const keys = normalizeKeys(track.keys)
    if (!keys.some((k) => k.frame === at)) continue
    touched = true
    channels[channel] = {
      ...track,
      keys: keys.map((k) => (k.frame === at ? fn(k) : k)),
    }
  }
  return touched ? { keyframes: { ...clip.keyframes, channels } } : {}
}

/**
 * Set the easing of every key on `localFrame`. The curve picker's write. A
 * named easing replaces any custom bezier on those keys — and any spring
 * (PV-P5a), because a spring would otherwise keep winning and the pick would
 * look like it did nothing.
 */
export function setKeysEasingAtFrame(
  clip: Clip,
  localFrame: number,
  easing: TextAnimationEasing,
  only?: AnyKeyframeChannel,
): Partial<Clip> {
  return mapKeysAtFrame(
    clip,
    localFrame,
    (k) => {
      const { easingBezier: _drop, spring: _spring, steps: _steps, ...rest } = k
      return { ...rest, easing }
    },
    only,
  )
}

/**
 * Give every key on `localFrame` a custom cubic-bezier curve (or clear it with
 * `null`, falling back to the key's named easing). The curve editor's write.
 * Like the easing writer, a spring is dropped: the two are different curves
 * and the one just chosen has to be the one that plays.
 */
export function setKeysBezierAtFrame(
  clip: Clip,
  localFrame: number,
  bezier: BezierTuple | null,
  only?: AnyKeyframeChannel,
): Partial<Clip> {
  if (bezier && !isValidBezier(bezier)) return {}
  return mapKeysAtFrame(
    clip,
    localFrame,
    (k) => {
      const { easingBezier: _drop, spring: _spring, steps: _steps, ...rest } = k
      return bezier ? { ...rest, easingBezier: normalizeBezier(bezier) } : rest
    },
    only,
  )
}

/**
 * Give every key on `localFrame` a spring curve, or clear it with `null` so the
 * key's `easing`/`easingBezier` applies again. The curve picker's spring write.
 *
 * Setting a spring drops that key's `easingBezier`: the spring is the curve
 * now, and leaving a stale bezier behind would mean clearing the spring later
 * silently restoring a curve the author never asked for. `easing` is KEPT, so
 * clearing a spring returns the key to the last named curve rather than to
 * linear.
 */
export function setKeysSpringAtFrame(
  clip: Clip,
  localFrame: number,
  spring: KeyframeSpring | null,
  only?: AnyKeyframeChannel,
): Partial<Clip> {
  if (spring && !isValidSpring(spring)) return {}
  return mapKeysAtFrame(
    clip,
    localFrame,
    (k) => {
      const { spring: _drop, easingBezier: _bezier, steps: _steps, ...rest } = k
      return spring ? { ...rest, spring: { ...spring } } : rest
    },
    only,
  )
}

/**
 * Give every key on `localFrame` a staircase curve (`n` equal jumps, integer
 * 1..64), or clear it with `null`. A staircase replaces any bezier and spring on
 * those keys; clearing returns the key to its named `easing`.
 */
export function setKeysStepsAtFrame(
  clip: Clip,
  localFrame: number,
  steps: number | null,
  only?: AnyKeyframeChannel,
): Partial<Clip> {
  if (steps !== null && !isValidSteps(steps)) return {}
  return mapKeysAtFrame(
    clip,
    localFrame,
    (k) => {
      const { easingBezier: _bezier, spring: _spring, steps: _drop, ...rest } = k
      return steps === null ? rest : { ...rest, steps }
    },
    only,
  )
}

/** Toggle hold (step) on every key on `localFrame`. */
export function setKeysHoldAtFrame(
  clip: Clip,
  localFrame: number,
  hold: boolean,
  only?: AnyKeyframeChannel,
): Partial<Clip> {
  return mapKeysAtFrame(
    clip,
    localFrame,
    (k) => {
      const { hold: _drop, ...rest } = k
      return hold ? { ...rest, hold: true } : rest
    },
    only,
  )
}

/**
 * Move one key (by id) on one channel to a new frame and value — the curve
 * editor's drag. A key already on the target frame is replaced.
 */
export function moveKeyframe(
  clip: Clip,
  channel: AnyKeyframeChannel,
  keyId: string,
  frame: number,
  value: number,
): Partial<Clip> {
  const track = clip.keyframes?.channels?.[channel]
  if (!track || !Number.isFinite(value)) return {}
  const keys = normalizeKeys(track.keys)
  const key = keys.find((k) => k.id === keyId)
  if (!key) return {}
  const at = Math.max(0, Math.floor(Number.isFinite(frame) ? frame : key.frame))
  const moved: Keyframe = { ...key, frame: at, value }
  const next = keys.filter((k) => k.id !== keyId && k.frame !== at)
  return { keyframes: withChannel(clip.keyframes, channel, { ...track, keys: normalizeKeys([...next, moved]) }) }
}

/** Drop every key on every channel — "remove all motion", one undo entry. */
export function clearAllKeyframes(clip: Clip): Partial<Clip> {
  return clip.keyframes ? { keyframes: undefined } : {}
}

function withChannel(
  keyframes: ClipKeyframes | undefined,
  channel: AnyKeyframeChannel,
  track: ClipKeyframes['channels'][AnyKeyframeChannel],
): ClipKeyframes | undefined {
  const channels = { ...keyframes?.channels }
  if (track) channels[channel] = track
  else delete channels[channel]
  if (Object.keys(channels).length === 0) return undefined
  return { ...keyframes, channels }
}

// ---------------------------------------------------------------------------
// Expression writers (PV-P5b-2)
// ---------------------------------------------------------------------------

/** The expression driving `channel`, or `undefined` for a keyed channel. */
export function channelExpression(clip: Clip, channel: AnyKeyframeChannel): string | undefined {
  const source = clip.keyframes?.channels?.[channel]?.source
  return source?.kind === 'expression' ? source.source : undefined
}

/** Every channel driven by an expression, in `presentKeyframeChannels` order
 *  (builtins first, then extended sorted) so a list of them is stable. */
export function expressionChannels(clip: Clip): AnyKeyframeChannel[] {
  const channels = clip.keyframes?.channels
  if (!channels) return []
  return presentKeyframeChannels(channels).filter((c) => channels[c]?.source?.kind === 'expression')
}

/**
 * Drive `channel` by an expression (trimmed; ≤ `MAX_EXPRESSION_LENGTH`
 * characters), or remove it with `null`/`''`. One `updateClip` patch.
 *
 * Removing keeps the channel's keys and puts `source` back to `'keyframes'`; a
 * keyless channel is dropped entirely. The first expression on a TRANSFORM
 * channel of a transform-less clip bakes the baseline, exactly as `setKeyframe`
 * does — without it the resolver would be left guessing a base transform.
 *
 * Deliberately does NOT validate the syntax. The panel shows the parse error and
 * the resolver falls back to the keyed value, so a half-typed expression is
 * never lost on the way to being finished; refusing to store it would mean
 * retyping it.
 */
export function setChannelExpression(
  clip: Clip,
  channel: AnyKeyframeChannel,
  source: string | null,
  ctx: BaselineContext,
): Partial<Clip> {
  // `time` is a source-frame remap and `draw` is consumed by the animator;
  // neither is a scalar, so neither takes an expression. Rejecting at write time
  // is why the sampler needs no special case.
  if (!isExpressionChannel(channel)) return {}

  const text = (source ?? '').trim()
  const existing = clip.keyframes?.channels?.[channel]

  if (text === '') {
    if (existing?.source?.kind !== 'expression') return {}
    const keys = normalizeKeys(existing.keys)
    return {
      keyframes: withChannel(
        clip.keyframes,
        channel,
        keys.length ? { ...existing, source: { kind: 'keyframes' }, keys } : undefined,
      ),
    }
  }

  if (text.length > MAX_EXPRESSION_LENGTH) return {}
  if (existing?.source?.kind === 'expression' && existing.source.source === text) return {}

  const keyframes: ClipKeyframes = {
    ...clip.keyframes,
    channels: {
      ...clip.keyframes?.channels,
      [channel]: { source: { kind: 'expression', source: text }, keys: normalizeKeys(existing?.keys) },
    },
  }
  const patch: Partial<Clip> = { keyframes }
  if (isTransformChannel(channel) && !clip.transform) {
    const base = baselineTransform(clip, ctx)
    if (base) patch.transform = base
  }
  return patch
}

/**
 * MC-2d: whether `clip` is the kind that reads a Tier B channel. Text size and
 * tracking are text-only, stroke width shape-only, and anchor needs a clip that
 * has a transform (everything but audio). Every other channel fits any clip.
 *
 * MC-1g: tracking is also refused on text with styled `spans` and no `textBox`:
 * a tracking key gives such a clip a boxed layout, which does not apply spans.
 */
export function tierBChannelFits(clip: Clip, channel: AnyKeyframeChannel): boolean {
  if (channel === 'text.letterSpacing') return clip.type === 'text' && !((clip.spans?.length ?? 0) > 0 && !clip.textBox)
  if (channel === 'text.fontSize') return clip.type === 'text'
  // MOT-5: scramble keys plain text only; a timed caption is refused.
  if (channel === 'text.scramble') return clip.type === 'text' && !(clip.words?.length && clip.captionMode && clip.captionMode !== 'static')
  if (channel === 'stroke.width') return clip.type === 'shape'
  if (channel === 'anchor.x' || channel === 'anchor.y') return clip.type !== 'audio'
  return true
}
