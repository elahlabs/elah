/**
 * Per-frame resolution of a clip's effect stack, blend, mask and matte.
 *
 * Pure and registry-driven. The keyframe sampler hands us the raw values of
 * the extended channels (`fx.<id>.<param>`, `mask.<field>`) by name; this
 * module lays them over the static values and clamps everything, so a
 * renderer receives only numbers it can use.
 *
 * The parity rule: a clip with none of these fields resolves to `{}`, so
 * spreading the result into an Active clip leaves that object exactly as it
 * was before effects existed. `GoldenFrameHash` and `GeometryParity` rely on it.
 */

import type { BlendMode, Clip, ClipMask, ClipMatte, Effect } from '../types'
import { BLEND_MODES } from '../types'
import { clampParam, getEffectDefinition, type EffectParamValue } from './registry'

/** One enabled, known effect with its params sampled and clamped for a frame. */
export interface ResolvedEffect {
  id: string
  kind: string
  params: Record<string, EffectParamValue>
}

export interface ResolvedMatte {
  sourceClipId: string
  kind: 'alpha' | 'luma'
  invert: boolean
}

/** The compositing fields an Active clip carries; every key is optional. */
export interface ResolvedCompositing {
  effects?: ResolvedEffect[]
  blend?: BlendMode
  mask?: ClipMask
  matte?: ResolvedMatte
}

/**
 * The effects that actually run this frame, in stack order. Unknown kinds and
 * `enabled: false` entries are left out here — never removed from the
 * document. `fx.<id>.<param>` keys override numeric params, then every value
 * is clamped by the registry.
 */
export function resolveEffects(
  effects: ReadonlyArray<Effect> | undefined,
  extended: Readonly<Record<string, number>> = {},
  colors: Readonly<Record<string, string>> = {},
): ResolvedEffect[] {
  if (!Array.isArray(effects) || effects.length === 0) return []
  const out: ResolvedEffect[] = []
  for (const effect of effects) {
    if (!effect || typeof effect !== 'object' || typeof effect.id !== 'string') continue
    if (effect.enabled === false) continue
    const def = getEffectDefinition(effect.kind)
    if (!def) continue
    const stored = effect.params && typeof effect.params === 'object' ? effect.params : {}
    const params: Record<string, EffectParamValue> = {}
    for (const [name, pd] of Object.entries(def.params)) {
      const keyed = extended[`fx.${effect.id}.${name}`]
      const keyedColor = colors[`fx.${effect.id}.${name}`]
      const raw =
        pd.type === 'number' && pd.keyframeable && keyed !== undefined
          ? keyed
          : pd.type === 'color' && pd.keyframeable && keyedColor !== undefined
            ? keyedColor
            : stored[name]
      params[name] = clampParam(pd, raw)
    }
    out.push({ id: effect.id, kind: effect.kind, params })
  }
  return out
}

const MASK_KINDS: ReadonlySet<string> = new Set(['rect', 'ellipse', 'path', 'gradient'])

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * The mask for this frame with `mask.<field>` keys applied, or `undefined`
 * when the stored mask is unusable. Box fields are normalized to the clip's
 * draw box; position may sit outside it (a mask sliding in), size may not be
 * negative, feather is 0..1.
 */
export function resolveMask(
  mask: ClipMask | undefined,
  extended: Readonly<Record<string, number>> = {},
): ClipMask | undefined {
  if (!mask || typeof mask !== 'object' || !MASK_KINDS.has(mask.kind)) return undefined
  const pick = (field: 'x' | 'y' | 'width' | 'height' | 'rotation' | 'feather', fallback: number) =>
    finiteOr(extended[`mask.${field}`], finiteOr(mask[field], fallback))

  const resolved: ClipMask = {
    kind: mask.kind,
    x: clamp(pick('x', 0), -2, 3),
    y: clamp(pick('y', 0), -2, 3),
    width: clamp(pick('width', 1), 0, 4),
    height: clamp(pick('height', 1), 0, 4),
  }
  const rotation = pick('rotation', 0)
  if (rotation !== 0) resolved.rotation = rotation
  const feather = clamp(pick('feather', 0), 0, 1)
  if (feather !== 0) resolved.feather = feather
  if (mask.invert === true) resolved.invert = true
  if (mask.kind === 'path' && typeof mask.path === 'string') {
    resolved.path = mask.path
    if (mask.viewBox) resolved.viewBox = mask.viewBox
  }
  if (mask.kind === 'gradient') resolved.angle = finiteOr(mask.angle, 0)
  return resolved
}

/** A usable non-default blend mode, or `undefined` (normal is the default). */
export function resolveBlend(blend: BlendMode | undefined): BlendMode | undefined {
  if (!blend || blend === 'normal') return undefined
  return (BLEND_MODES as ReadonlyArray<string>).includes(blend) ? blend : undefined
}

/** A usable matte reference, or `undefined`. A clip cannot matte itself. */
export function resolveMatte(matte: ClipMatte | undefined, selfId: string): ResolvedMatte | undefined {
  if (!matte || typeof matte !== 'object') return undefined
  if (typeof matte.sourceClipId !== 'string' || !matte.sourceClipId) return undefined
  if (matte.sourceClipId === selfId) return undefined
  if (matte.kind !== 'alpha' && matte.kind !== 'luma') return undefined
  return { sourceClipId: matte.sourceClipId, kind: matte.kind, invert: matte.invert === true }
}

/**
 * Everything compositing-related for one clip at one frame, as an object to
 * spread into its Active clip. `{}` when the clip uses none of it.
 */
export function resolveCompositing(
  clip: Pick<Clip, 'id' | 'effects' | 'blend' | 'mask' | 'matte'>,
  extended: Readonly<Record<string, number>> = {},
  colors: Readonly<Record<string, string>> = {},
): ResolvedCompositing {
  if (!clip.effects && !clip.blend && !clip.mask && !clip.matte) return {}
  const out: ResolvedCompositing = {}
  const effects = resolveEffects(clip.effects, extended, colors)
  if (effects.length) out.effects = effects
  const blend = resolveBlend(clip.blend)
  if (blend) out.blend = blend
  const mask = resolveMask(clip.mask, extended)
  if (mask) out.mask = mask
  const matte = resolveMatte(clip.matte, clip.id)
  if (matte) out.matte = matte
  return out
}
