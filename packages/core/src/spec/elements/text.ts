/**
 * elements/text.ts — a `text` spec element -> a `Clip` literal (AV-1).
 */

import type { Clip, TextAnimator, TextSpan } from '../../types'
import { fontWeights, getFont } from '../../fonts/registry'
import { TEXT_ANIMATOR_KINDS, TEXT_ANIMATOR_PRESETS, TEXT_ANIMATOR_UNITS } from '../../elements/captions'
import { SPEC_ALIGNS, type SpecElement } from '../types'
import { toFrames } from '../units'
import { applyEffectsAndBlend, applyMotionAndKeyframes, baseClip, buildLayout, buildTransform, resolveColor, type BuildContext } from './common'

const DEFAULT_REVEAL_STAGGER_SEC = 0.05
const DEFAULT_REVEAL_DURATION_SEC = 0.3
const ALIGN_SET: ReadonlySet<string> = new Set(SPEC_ALIGNS)

/** Nearest of `weights` to `want`; `weights` is never empty for a registered font. */
function nearestWeight(want: number, weights: number[]): number {
  return weights.reduce((best, w) => (Math.abs(w - want) < Math.abs(best - want) ? w : best), weights[0]!)
}

function buildFontFields(el: SpecElement, ctx: BuildContext, path: string): Pick<Clip, 'fontId' | 'fontWeight' | 'fontStyle'> {
  const out: Pick<Clip, 'fontId' | 'fontWeight' | 'fontStyle'> = {}
  if (el.italic) out.fontStyle = 'italic'

  let weight = el.weight
  if (el.font !== undefined) {
    const raw = el.font.startsWith('$') ? ctx.fontTokens[el.font.slice(1)] : el.font
    if (raw === undefined) {
      ctx.issues.push({ severity: 'error', path: `${path}.font`, code: 'unknown-token', message: `unknown font role "${el.font}"` })
    } else {
      const def = getFont(raw)
      if (!def) {
        ctx.issues.push({ severity: 'error', path: `${path}.font`, code: 'unknown-font', message: `unknown font "${raw}"` })
      } else {
        out.fontId = def.id
        ctx.fontIds.add(def.id)
        if (typeof weight === 'number') {
          const weights = fontWeights(def)
          const nearest = nearestWeight(weight, weights)
          if (nearest !== weight) {
            ctx.issues.push({ severity: 'warn', path: `${path}.weight`, code: 'clamped', message: `weight ${weight} is not one of ${def.family}'s weights; using ${nearest}` })
          }
          weight = nearest
        }
      }
    }
  }
  if (typeof weight === 'number' || weight === 'normal' || weight === 'bold') out.fontWeight = weight
  else if (weight !== undefined) {
    ctx.issues.push({ severity: 'error', path: `${path}.weight`, code: 'bad-weight', message: `weight must be a number, "normal" or "bold", got "${weight}"` })
  }
  return out
}

function buildTextBox(el: SpecElement): Clip['textBox'] {
  if (el.maxWidth === undefined && el.letterSpacing === undefined && el.lineHeight === undefined) return undefined
  return {
    overflow: 'wrap',
    ...(el.maxWidth !== undefined ? { width: el.maxWidth } : {}),
    ...(el.letterSpacing !== undefined ? { letterSpacing: el.letterSpacing } : {}),
    ...(el.lineHeight !== undefined ? { lineHeight: el.lineHeight } : {}),
  }
}

function buildPill(el: SpecElement, ctx: BuildContext, path: string): Partial<Clip> {
  const pill = el.pill
  if (!pill) return {}
  const out: Partial<Clip> = {}
  const fill = resolveColor(pill.fill, ctx, `${path}.pill.fill`)
  if (fill !== undefined) out.backgroundColor = fill
  const stroke = resolveColor(pill.stroke, ctx, `${path}.pill.stroke`)
  if (stroke !== undefined) out.borderColor = stroke
  if (pill.strokeWidth !== undefined) out.borderWidth = pill.strokeWidth
  if (pill.radius !== undefined) out.borderRadius = pill.radius
  if (pill.padding !== undefined) out.padding = pill.padding
  return out
}

/**
 * `reveal.preset` accepts either a `TEXT_ANIMATOR_PRESETS` id — the names
 * `vocabulary.ts` actually offers the model (`word-rise`, `word-pop`, ...) —
 * or a bare `TEXT_ANIMATOR_KINDS` animator kind (`rise`, `pop`, ...), which
 * was the only accepted form before this fix and a spec may still contain.
 * A preset id expands to that preset's own `unit`/`stagger`/`duration`
 * defaults; the spec's own `unit`/`stagger`/`duration` override them when
 * given, exactly like a bare kind's seconds-based defaults do. Unknown in
 * both sets is the same `unknown-preset` issue either form already raised.
 */
function buildReveal(el: SpecElement, ctx: BuildContext, path: string): TextAnimator | undefined {
  const reveal = el.reveal
  if (!reveal) return undefined

  const presetDef = TEXT_ANIMATOR_PRESETS.find((p) => p.id === reveal.preset)
  let kind: TextAnimator['preset']
  let defaultUnit: TextAnimator['unit']
  let defaultStaggerFrames: number
  let defaultDurationFrames: number

  if (presetDef) {
    kind = presetDef.animator.preset
    defaultUnit = presetDef.animator.unit
    defaultStaggerFrames = presetDef.animator.staggerFrames
    defaultDurationFrames = presetDef.animator.durationFrames
  } else if ((TEXT_ANIMATOR_KINDS as ReadonlyArray<string>).includes(reveal.preset)) {
    kind = reveal.preset as TextAnimator['preset']
    defaultUnit = 'char'
    defaultStaggerFrames = Math.max(0, toFrames(DEFAULT_REVEAL_STAGGER_SEC, ctx.fps))
    defaultDurationFrames = Math.max(1, toFrames(DEFAULT_REVEAL_DURATION_SEC, ctx.fps))
  } else {
    ctx.issues.push({ severity: 'error', path: `${path}.reveal.preset`, code: 'unknown-preset', message: `unknown reveal preset "${reveal.preset}"` })
    return undefined
  }

  let unit = reveal.unit ?? defaultUnit
  if (!(TEXT_ANIMATOR_UNITS as ReadonlyArray<string>).includes(unit)) {
    ctx.issues.push({ severity: 'error', path: `${path}.reveal.unit`, code: 'unknown-unit', message: `unknown reveal unit "${unit}"` })
    unit = 'char'
  }

  return {
    unit: unit as TextAnimator['unit'],
    preset: kind,
    staggerFrames: reveal.stagger === undefined ? defaultStaggerFrames : Math.max(0, toFrames(reveal.stagger, ctx.fps)),
    durationFrames: reveal.duration === undefined ? defaultDurationFrames : Math.max(1, toFrames(reveal.duration, ctx.fps)),
  }
}

function buildSpans(spans: SpecElement['spans'], ctx: BuildContext, path: string): TextSpan[] | undefined {
  if (!spans || spans.length === 0) return undefined
  return spans.map((s, i) => {
    const out: TextSpan = { start: s.start, end: s.end }
    if (typeof s.weight === 'number' || s.weight === 'normal' || s.weight === 'bold') out.fontWeight = s.weight
    else if (s.weight !== undefined) {
      ctx.issues.push({ severity: 'error', path: `${path}.spans[${i}].weight`, code: 'bad-weight', message: `weight must be a number, "normal" or "bold", got "${s.weight}"` })
    }
    if (s.italic !== undefined) out.fontStyle = s.italic ? 'italic' : 'normal'
    const color = resolveColor(s.color, ctx, `${path}.spans[${i}].color`)
    if (color !== undefined) out.color = color
    return out
  })
}

export function buildTextClip(
  el: SpecElement,
  input: { id: string; trackId: string; startFrame: number; durationFrames: number },
  ctx: BuildContext,
  path: string,
): Clip {
  const transform = buildTransform(el, ctx, path)
  let clip: Clip = {
    ...baseClip({ ...input, type: 'text', name: el.name ?? (el.text ?? 'text').slice(0, 40), transform }, el, ctx, path),
    content: el.text ?? '',
    transformModel: 'v2',
    ...buildFontFields(el, ctx, path),
    ...(el.size !== undefined ? { fontSize: el.size } : {}),
    ...buildPill(el, ctx, path),
  }

  if (el.align !== undefined) {
    if (ALIGN_SET.has(el.align)) clip.textAlign = el.align as 'left' | 'center' | 'right'
    else ctx.issues.push({ severity: 'error', path: `${path}.align`, code: 'unknown-align', message: `unknown align "${el.align}"` })
  }

  const spans = buildSpans(el.spans, ctx, path)
  if (spans) clip.spans = spans

  const color = resolveColor(el.color, ctx, `${path}.color`)
  if (color !== undefined) clip.color = color

  const textBox = buildTextBox(el)
  if (textBox) clip.textBox = textBox

  const textAnimator = buildReveal(el, ctx, path)
  if (textAnimator) clip.textAnimator = textAnimator

  if (el.spans && el.reveal) {
    ctx.issues.push({
      severity: 'warn',
      path,
      code: 'spans-with-reveal',
      message: 'spans are ignored while a reveal animator runs; the emphasis will not show',
    })
  }

  if (el.outline) {
    const outlineColor = resolveColor(el.outline.color, ctx, `${path}.outline.color`) ?? '#000000'
    clip.textOutline = { color: outlineColor, width: el.outline.width ?? 4 }
  }
  if (el.shadow) {
    const shadowColor = resolveColor(el.shadow.color, ctx, `${path}.shadow.color`) ?? '#000000'
    clip.textShadow = { color: shadowColor, blur: el.shadow.blur ?? 12, offsetX: el.shadow.offsetX ?? 0, offsetY: el.shadow.offsetY ?? 4 }
  }

  const layout = buildLayout(el.layout, ctx, path)
  if (layout) clip.layout = layout

  clip = applyMotionAndKeyframes(clip, el, ctx, path)
  clip = applyEffectsAndBlend(clip, el, ctx, path)
  return clip
}
