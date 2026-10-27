/**
 * elements/common.ts — shared machinery every kind-specific builder uses
 * (AV-1): the base `Clip` fields, the transform/box model, colour and
 * layout resolution, and the motion/keys/expressions pass. Kept in one place
 * so "unknown preset/channel -> issue, nothing thrown" and the `clip("id")`
 * rewrite behave identically no matter which kind wrote them.
 */

import { BLEND_MODES } from '../../types'
import type {
  BlendMode,
  Clip,
  ClipLayout,
  Effect,
  Keyframe,
  KeyframeChannelTrack,
  LayoutAlign,
  LayoutEdge,
  Transform,
} from '../../types'
import { generateId } from '../../utils/id'
import { applyMotionPreset, MOTION_PRESET_NAMES, type MotionPresetName } from '../../elements/motionPresets'
import type { BaselineContext } from '../../elements/keyframes'
import { clampEffectParams, createEffect, EFFECT_REGISTRY } from '../../effects/registry'
import { resolveCurve } from '../curves'
import {
  clampIssue,
  isHexColor,
  OPACITY_RANGE,
  pixelBox,
  resolveToken,
  ROTATION_DEG_RANGE,
  SCALE_RANGE,
  toFrames,
  toRadians,
  type PixelSize,
  type StageSize,
} from '../units'
import {
  SPEC_ANCHOR_ALIGNS,
  SPEC_CHANNELS,
  SPEC_EDGES,
  SPEC_NON_EXPRESSION_CHANNELS,
  type SpecChannel,
  type SpecEffect,
  type SpecElement,
  type SpecIssue,
  type SpecLayout,
} from '../types'

/**
 * Everything a kind builder needs about the world it is compiling into, plus
 * the two id-rewrite hooks that make the whole ticket possible: a colour/font
 * token lookup and a same-level element-id -> clip-id resolver.
 */
export interface BuildContext {
  fps: number
  stage: StageSize
  colorTokens: Readonly<Record<string, string>>
  fontTokens: Readonly<Record<string, string>>
  issues: SpecIssue[]
  /** Every bundled font a `text` element resolves is added here, for `CompileResult.fontIds`. */
  fontIds: Set<string>
  /**
   * Resolve an author-written element id to the clip id it compiled to, AT
   * THIS NESTING LEVEL ONLY (layout and `clip("id")` resolve per level — a
   * reference into a different compound is out of scope, per the ticket).
   * Pushes a `bad-reference` error issue and returns `undefined` when the id
   * does not exist at this level.
   */
  resolveRef: (elementId: string, path: string) => string | undefined
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Resolve a spec colour: `$token` through `ctx.colorTokens`, else a literal
 * (hex or any CSS colour the canvas accepts — spec text stays permissive
 * about literals, matching `types.ts`'s "COLOUR is #rgb/#rrggbb, or a
 * $token"; only a `$name` with no entry is rejected). `undefined` in,
 * `undefined` out, no issue.
 */
export function resolveColor(value: string | undefined, ctx: BuildContext, path: string): string | undefined {
  if (value === undefined) return undefined
  const resolved = resolveToken(value, ctx.colorTokens)
  if (resolved === undefined) {
    ctx.issues.push({ severity: 'error', path, code: 'unknown-token', message: `unknown colour token "${value}"` })
    return undefined
  }
  if (resolved.startsWith('#') && !isHexColor(resolved)) {
    ctx.issues.push({ severity: 'error', path, code: 'bad-color', message: `not a hex colour: "${resolved}"` })
    return undefined
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Base clip fields + transform
// ---------------------------------------------------------------------------

export interface BaseClipInput {
  id: string
  trackId: string
  type: Clip['type']
  name: string
  startFrame: number
  durationFrames: number
  /** Omitted for kinds with no picture (audio). */
  transform?: Transform
}

/** Fields every `Clip`, of every kind, carries — the literal `createClip` would have written, minus what it drops. */
export function baseClip(input: BaseClipInput, el: SpecElement, ctx: BuildContext, path: string): Clip {
  const opacity = el.opacity === undefined ? 1 : clampIssue(el.opacity, OPACITY_RANGE[0], OPACITY_RANGE[1], `${path}.opacity`, ctx.issues)
  return {
    id: input.id,
    trackId: input.trackId,
    type: input.type,
    name: input.name,
    startFrame: input.startFrame,
    durationFrames: input.durationFrames,
    sourceStartFrame: 0,
    sourceDurationFrames: input.durationFrames,
    volume: 1,
    opacity,
    locked: false,
    disabled: false,
    ...(input.transform ? { transform: input.transform } : {}),
  }
}

/**
 * The spec's placement fields (`x`/`y`/`anchor`/`scale`/`rotation`) as a
 * `Transform`, with `box` (stage px) folded into `scaleX`/`scaleY` via
 * `pixelBox` for kinds that have one (shape, icon, image). Text has no box —
 * it sizes by `fontSize` — so it is built with `scale`/`rotation` only.
 */
export function buildTransform(el: SpecElement, ctx: BuildContext, path: string, box?: PixelSize): Transform {
  const rotation = el.rotation === undefined ? 0 : clampIssue(el.rotation, ROTATION_DEG_RANGE[0], ROTATION_DEG_RANGE[1], `${path}.rotation`, ctx.issues)
  const scale = el.scale === undefined ? 1 : clampIssue(el.scale, SCALE_RANGE[0], SCALE_RANGE[1], `${path}.scale`, ctx.issues)
  const base: Transform = {
    x: el.x ?? 0.5,
    y: el.y ?? 0.5,
    scale,
    rotation: toRadians(rotation),
    anchor: el.anchor ?? { x: 0.5, y: 0.5 },
  }
  if (!box) return base
  const b = pixelBox(box, ctx.stage)
  return { ...base, scaleX: b.scaleX, scaleY: b.scaleY }
}

// ---------------------------------------------------------------------------
// Layout (anchorTo / pin / fitTo) — text and shape/icon clips only
// ---------------------------------------------------------------------------

const EDGE_SET: ReadonlySet<string> = new Set(SPEC_EDGES)
const ALIGN_SET: ReadonlySet<string> = new Set(SPEC_ANCHOR_ALIGNS)

export function buildLayout(layout: SpecLayout | undefined, ctx: BuildContext, path: string): ClipLayout | undefined {
  if (!layout) return undefined
  const out: ClipLayout = {}
  if (layout.anchorTo) {
    const anchorPath = `${path}.anchorTo`
    const clipRef = ctx.resolveRef(layout.anchorTo.element, `${anchorPath}.element`)
    if (!EDGE_SET.has(layout.anchorTo.edge)) {
      ctx.issues.push({ severity: 'error', path: `${anchorPath}.edge`, code: 'unknown-edge', message: `unknown edge "${layout.anchorTo.edge}"` })
    } else if (clipRef) {
      const align = layout.anchorTo.align
      if (align !== undefined && !ALIGN_SET.has(align)) {
        ctx.issues.push({ severity: 'error', path: `${anchorPath}.align`, code: 'unknown-align', message: `unknown align "${align}"` })
      }
      out.anchorTo = {
        clip: clipRef,
        edge: layout.anchorTo.edge as LayoutEdge,
        ...(align !== undefined && ALIGN_SET.has(align) ? { align: align as LayoutAlign } : {}),
        ...(layout.anchorTo.gap !== undefined ? { gap: layout.anchorTo.gap } : {}),
      }
    }
  }
  if (layout.pin) out.pin = { ...layout.pin }
  if (layout.fitTo) {
    const clipRef = ctx.resolveRef(layout.fitTo.element, `${path}.fitTo.element`)
    if (clipRef) out.fitTo = { clip: clipRef, ...(layout.fitTo.padding !== undefined ? { padding: layout.fitTo.padding } : {}) }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// ---------------------------------------------------------------------------
// Motion, keys and expressions
// ---------------------------------------------------------------------------

const SPEC_CHANNEL_SET: ReadonlySet<string> = new Set(SPEC_CHANNELS)
const NON_EXPRESSION_SET: ReadonlySet<string> = new Set(SPEC_NON_EXPRESSION_CHANNELS)

/** `clip("id")` / `clip('id')` — no escapes in the expression grammar, so a plain non-greedy scan is exact. */
const CLIP_REF_RE = /\bclip\(\s*(["'])((?:(?!\1)[^\n\r])*)\1\s*\)/g

/**
 * Rewrite every `clip("<element id>")` in `source` to `clip("<clip id>")`.
 * `undefined` when any reference cannot be resolved at this level — the
 * caller drops the whole expression rather than write a half-rewritten one
 * that would resolve to the wrong clip or nothing.
 */
function rewriteExpressionRefs(source: string, ctx: BuildContext, path: string): string | undefined {
  let ok = true
  const rewritten = source.replace(CLIP_REF_RE, (whole, quote: string, elementId: string) => {
    const clipId = ctx.resolveRef(elementId, path)
    if (!clipId) {
      ok = false
      return whole
    }
    return `clip(${quote}${clipId}${quote})`
  })
  return ok ? rewritten : undefined
}

const MOTION_PRESET_SET: ReadonlySet<string> = new Set(MOTION_PRESET_NAMES)

/** BaselineContext for `applyMotionPreset` — stage only; no content probe for generated clips. */
function baselineCtx(ctx: BuildContext): BaselineContext {
  return { stage: ctx.stage }
}

/**
 * A `keys[].value` in the SPEC's own unit -> the engine's unit for that
 * channel, mirroring the conversions `buildTransform` already applies to the
 * element's OWN (non-keyed) fields — a keyed channel must land in the same
 * unit a static one does, or the two disagree about what "90" means on the
 * same channel.
 *
 *   - `rotation`: degrees (the contract's own "ANGLE is degrees, clockwise")
 *     -> radians, exactly `toRadians` below el.rotation itself.
 *   - `cornerRadius`: px (the contract's "SIZE ... is PIXELS"), matching
 *     `shape.ts`'s own `el.radius` field -> a 0..0.5 fraction of the stage's
 *     shorter side, exactly the same `/ shortSide` `shape.ts` already does
 *     for the non-keyed field. Clamped with the same issue code a static
 *     value gets, so an out-of-range keyed radius reads the same way.
 *   - every other channel is already in the engine's own unit (a fraction,
 *     a scale multiplier, 0..1 opacity/volume, 0..1 draw) — passed through.
 *
 * An EXPRESSION on the same channel is deliberately NOT converted here (or
 * anywhere): the compiler cannot rewrite arbitrary maths, so an expression
 * author writes engine units directly (radians, via the `PI` the grammar
 * already offers) — see the ticket's Result for the vocabulary line this
 * still owes.
 */
function keyChannelValue(channel: SpecChannel, value: number, ctx: BuildContext, path: string): number {
  if (channel === 'rotation') return toRadians(value)
  if (channel === 'cornerRadius') {
    const short = Math.min(ctx.stage.width, ctx.stage.height)
    const fraction = Number.isFinite(short) && short > 0 ? value / short : 0
    return clampIssue(fraction, 0, 0.5, path, ctx.issues)
  }
  return value
}

/**
 * Apply `enter`/`exit` motion presets, explicit `keys` and `expressions` to
 * `clip`, in that order — motion first so explicit keys can override a
 * preset's ramp on the same channel, matching how a person would build the
 * same clip by hand (drop a preset, then nudge a key).
 */
export function applyMotionAndKeyframes(clip: Clip, el: SpecElement, ctx: BuildContext, path: string): Clip {
  let working = clip

  const applyEnd = (name: string | undefined, rampSeconds: number | undefined, fieldPath: string) => {
    if (name === undefined) return
    if (!MOTION_PRESET_SET.has(name)) {
      ctx.issues.push({ severity: 'error', path: fieldPath, code: 'unknown-preset', message: `unknown motion preset "${name}"` })
      return
    }
    const rampFrames = rampSeconds === undefined ? undefined : Math.max(1, toFrames(rampSeconds, ctx.fps))
    const patch = applyMotionPreset(working, name as MotionPresetName, { rampFrames }, baselineCtx(ctx))
    working = { ...working, ...patch }
  }
  applyEnd(el.enter, el.enterDuration, `${path}.enter`)
  applyEnd(el.exit, el.exitDuration, `${path}.exit`)

  // --- explicit keys, grouped by channel --------------------------------
  const byChannel = new Map<SpecChannel, Keyframe[]>()
  for (const [i, key] of (el.keys ?? []).entries()) {
    const keyPath = `${path}.keys[${i}]`
    if (!SPEC_CHANNEL_SET.has(key.channel)) {
      ctx.issues.push({ severity: 'error', path: keyPath, code: 'unknown-channel', message: `unknown channel "${key.channel}"` })
      continue
    }
    const channel = key.channel as SpecChannel
    const curve = resolveCurve(key.curve, `${keyPath}.curve`, ctx.issues)
    const frame = Math.max(0, Math.min(Math.max(0, working.durationFrames - 1), toFrames(key.at, ctx.fps)))
    const built: Keyframe = {
      id: generateId(),
      frame,
      value: keyChannelValue(channel, key.value, ctx, `${keyPath}.value`),
      easing: curve.easing,
      ...(curve.easingBezier ? { easingBezier: [...curve.easingBezier] as [number, number, number, number] } : {}),
      ...(curve.spring ? { spring: curve.spring } : {}),
      ...(key.hold ? { hold: true as const } : {}),
    }
    const list = byChannel.get(channel)
    if (list) list.push(built)
    else byChannel.set(channel, [built])
  }
  if (byChannel.size > 0) {
    const channels = { ...working.keyframes?.channels }
    for (const [channel, keys] of byChannel) {
      const existing = channels[channel]
      const merged = [...(existing?.keys ?? []), ...keys].sort((a, b) => a.frame - b.frame)
      channels[channel] = { source: { kind: 'keyframes' }, keys: merged } as KeyframeChannelTrack
    }
    working = { ...working, keyframes: { ...working.keyframes, channels } }
  }

  // --- expressions --------------------------------------------------------
  for (const [i, expr] of (el.expressions ?? []).entries()) {
    const exprPath = `${path}.expressions[${i}]`
    if (!SPEC_CHANNEL_SET.has(expr.channel)) {
      ctx.issues.push({ severity: 'error', path: exprPath, code: 'unknown-channel', message: `unknown channel "${expr.channel}"` })
      continue
    }
    if (NON_EXPRESSION_SET.has(expr.channel as SpecChannel)) {
      ctx.issues.push({
        severity: 'error',
        path: exprPath,
        code: 'expression-not-allowed',
        message: `channel "${expr.channel}" cannot take an expression`,
      })
      continue
    }
    const source = expr.source.length > 512 ? expr.source.slice(0, 512) : expr.source
    if (source.length !== expr.source.length) {
      ctx.issues.push({ severity: 'warn', path: exprPath, code: 'clamped', message: 'expression truncated to 512 characters' })
    }
    const rewritten = rewriteExpressionRefs(source, ctx, exprPath)
    if (rewritten === undefined) {
      ctx.issues.push({ severity: 'error', path: exprPath, code: 'bad-reference', message: 'expression references an element that does not exist at this level' })
      continue
    }
    const channels = { ...working.keyframes?.channels }
    // KEEP any keys already on this channel. The engine samples the keys first
    // and hands the result to the expression as `value` (`ChannelExpression` in
    // `resolver/keyframes.ts`: "`keyed` is the channel's sampled keyframe
    // value"), so an expression on a keyed channel MODIFIES the animation
    // rather than replacing it — which is what makes `riseIn` plus a `floatY`
    // idle read as "rises in, then drifts" instead of silently losing the rise.
    // Emptying `keys` here discarded the arrival, with no issue and no error:
    // the quietest possible way to ruin a piece's motion.
    const existing = channels[expr.channel as SpecChannel]
    channels[expr.channel as SpecChannel] = { source: { kind: 'expression', source: rewritten }, keys: existing?.keys ?? [] }
    working = { ...working, keyframes: { ...working.keyframes, channels } }
  }

  return working
}

// ---------------------------------------------------------------------------
// Effects and blend (AV-1 left these to `raw`; AV-7 wires them up)
// ---------------------------------------------------------------------------

const BLEND_MODE_SET: ReadonlySet<string> = new Set(BLEND_MODES)

/**
 * `SpecElement.effects` -> `Clip.effects`, validated against `EFFECT_REGISTRY`
 * with the registry's own param clamping and preset resolution. Built the
 * same way `ops/apply.ts`'s `addEffect` op builds one effect entry
 * (`createEffect` for the defaults/preset, `clampEffectParams` merged over
 * them for any explicit params), so a spec-authored effect and a live
 * assistant edit can never disagree about the shape of an `Effect`.
 */
export function buildEffects(effects: SpecEffect[] | undefined, ctx: BuildContext, path: string): Effect[] | undefined {
  if (!effects || effects.length === 0) return undefined
  const out: Effect[] = []
  effects.forEach((se, i) => {
    const p = `${path}.effects[${i}]`
    const def = EFFECT_REGISTRY.get(se.kind)
    if (!def) {
      ctx.issues.push({ severity: 'error', path: `${p}.kind`, code: 'unknown-effect', message: `unknown effect "${se.kind}"` })
      return
    }
    const preset = se.preset !== undefined && def.presets?.some((pr) => pr.id === se.preset) ? se.preset : undefined
    if (se.preset !== undefined && preset === undefined) {
      ctx.issues.push({ severity: 'error', path: `${p}.preset`, code: 'unknown-preset', message: `unknown preset "${se.preset}" for effect "${se.kind}"` })
    }
    const e = createEffect(se.kind, preset)
    const overrides: Record<string, unknown> = {}
    for (const prm of se.params ?? []) {
      if (!(prm.name in def.params)) {
        ctx.issues.push({ severity: 'error', path: `${p}.params.${prm.name}`, code: 'unknown-param', message: `effect "${se.kind}" has no param "${prm.name}"` })
        continue
      }
      overrides[prm.name] = prm.value
    }
    const params = Object.keys(overrides).length > 0 ? (clampEffectParams(se.kind, { ...e.params, ...overrides }) ?? e.params) : e.params
    out.push({ ...e, params })
  })
  return out.length > 0 ? out : undefined
}

/**
 * `SpecElement.blend` -> `Clip.blend`, validated against `BLEND_MODES`.
 * `"normal"` compiles to `undefined`, matching the engine's own convention
 * (`Clip.blend`'s doc comment: "Omitted = normal") and `setBlend`'s op.
 */
export function buildBlend(blend: string | undefined, ctx: BuildContext, path: string): BlendMode | undefined {
  if (blend === undefined) return undefined
  if (!BLEND_MODE_SET.has(blend)) {
    ctx.issues.push({ severity: 'error', path: `${path}.blend`, code: 'unknown-blend', message: `unknown blend mode "${blend}"` })
    return undefined
  }
  return blend === 'normal' ? undefined : (blend as BlendMode)
}

/** Applies `buildEffects`/`buildBlend` to `clip` — the one call every visual kind builder makes. */
export function applyEffectsAndBlend(clip: Clip, el: SpecElement, ctx: BuildContext, path: string): Clip {
  const effects = buildEffects(el.effects, ctx, path)
  const blend = buildBlend(el.blend, ctx, path)
  return { ...clip, ...(effects ? { effects } : {}), ...(blend ? { blend } : {}) }
}
