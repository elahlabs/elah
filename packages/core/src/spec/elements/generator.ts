/**
 * elements/generator.ts — a `generator` spec element -> a `Clip` literal (AV-1).
 *
 * `generator`/`preset`/`params` validated against `GENERATOR_REGISTRY` with
 * the registry's own `clampParam`, so a spec and the Inspector's own sliders
 * can never disagree about a param's range. An unknown kind falls back to a
 * plain rect badge — the same "element kept, badly" rule `icon.ts` uses for
 * an unknown icon name — rather than a `generator` clip with nothing to paint.
 */

import type { Clip } from '../../types'
import { clampParam, type EffectParamValue } from '../../effects/registry'
import { getGeneratorDefinition } from '../../generators/registry'
import type { SpecElement } from '../types'
import { applyEffectsAndBlend, applyMotionAndKeyframes, baseClip, buildTransform, type BuildContext } from './common'

const DEFAULT_GENERATOR_SIZE = 400

export function buildGeneratorClip(
  el: SpecElement,
  input: { id: string; trackId: string; startFrame: number; durationFrames: number },
  ctx: BuildContext,
  path: string,
): Clip {
  const kind = el.generator ?? ''
  const def = getGeneratorDefinition(kind)
  const w = el.w ?? DEFAULT_GENERATOR_SIZE
  const h = el.h ?? DEFAULT_GENERATOR_SIZE
  const transform = buildTransform(el, ctx, path, def?.placed ? { w, h } : { w, h })

  if (!def) {
    ctx.issues.push({ severity: 'error', path: `${path}.generator`, code: 'unknown-generator', message: `unknown generator "${kind}"` })
    let clip: Clip = {
      ...baseClip({ ...input, type: 'shape', name: el.name ?? 'generator', transform }, el, ctx, path),
      shapeKind: 'rect',
      shapeFill: '#808080',
      shapeStrokeWidth: 0,
    }
    clip = applyMotionAndKeyframes(clip, el, ctx, path)
    clip = applyEffectsAndBlend(clip, el, ctx, path)
    return clip
  }

  const preset = el.preset ? def.presets?.find((p) => p.id === el.preset) : undefined
  if (el.preset && !preset) {
    ctx.issues.push({ severity: 'error', path: `${path}.preset`, code: 'unknown-preset', message: `unknown preset "${el.preset}" for generator "${kind}"` })
  }

  const values: Record<string, unknown> = { ...preset?.params }
  for (const p of el.params ?? []) {
    if (!(p.name in def.params)) {
      ctx.issues.push({ severity: 'error', path: `${path}.params.${p.name}`, code: 'unknown-param', message: `generator "${kind}" has no param "${p.name}"` })
      continue
    }
    values[p.name] = p.value
  }
  const params: Record<string, EffectParamValue> = {}
  for (const [name, pd] of Object.entries(def.params)) params[name] = clampParam(pd, values[name])

  let clip: Clip = {
    ...baseClip({ ...input, type: 'generator', name: el.name ?? def.label, transform }, el, ctx, path),
    generator: { kind, params },
  }

  clip = applyMotionAndKeyframes(clip, el, ctx, path)
  clip = applyEffectsAndBlend(clip, el, ctx, path)
  return clip
}
