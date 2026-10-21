/**
 * big-number (AV-8b) — craft brief: "A huge `counter` (200+ px, display font)
 * counts up with overshoot; `text` label rises in beside or below; an accent
 * underline draws under the number; small decorative plus-signs/dots float
 * nearby."
 *
 * The counter generator has no overshoot of its own (it only counts); the
 * "overshoot" is a scale bounce on the counter's own transform timed to land
 * just after the count finishes, the same spring the rest of the toolkit pops
 * with.
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { exitOut, floatY, fx, fy, mergeKeys, popIn, riseIn } from '../motion'
import { LAYER, clampCenter, counterParams, pxToScale } from './dataKit'

export const bigNumberDef: ComponentDef = {
  name: 'big-number',
  label: 'Big number',
  hint: 'One huge number counting up with a label — a single headline metric, no ring or bars.',
  items: { min: 1, max: 1, hint: 'one stat: value to count to, text as the label' },
  variants: ['below', 'beside'],
  duration: { min: 2, max: 4, default: 3 },
  build(component, ctx) {
    const id = component.id
    const item = component.items?.[0]
    const value = item?.value ?? 0
    const label = item?.text ?? component.text ?? ''
    const below = component.variant !== 'beside'
    const cx = clampCenter(component.x ?? 0.5, 0.32)
    const cy = component.y ?? 0.44
    const total = component.duration
    const fontSize = 220
    const numberW = fontSize * 2.6

    const countAt = ctx.t(0.1)
    const countDur = ctx.t(1.1)
    const countEnd = countAt + countDur
    const labelAt = countEnd - ctx.t(0.15)
    const underlineAt = countEnd + ctx.t(0.05)

    const parts: SpecElement[] = []

    parts.push({
      id: `${id}-counter`,
      kind: 'generator',
      generator: 'counter',
      x: cx,
      y: cy,
      w: numberW,
      h: fontSize * 1.3,
      at: 0,
      duration: total,
      layer: LAYER.front,
      params: counterParams(value, {
        fontSize,
        color: ctx.color('ink'),
        countFraction: Math.min(1, countDur / total),
      }),
      keys: mergeKeys(
        popIn(ctx, { at: 0, duration: countDur, from: 0.5 }),
        [
          { channel: 'scale', at: countEnd, value: 1.1, curve: 'spring:bouncy' },
          { channel: 'scale', at: countEnd + ctx.t(0.2), value: 1, curve: 'spring:snappy' },
        ],
        exitOut(ctx, total),
      ),
    })

    // A drawn-not-shown underline: grows from the left edge via scaleX, not a fade.
    const underlineY = cy + fy(ctx.format, fontSize * 0.62)
    const underlineDrawDur = ctx.t(0.6)
    parts.push({
      id: `${id}-underline`,
      kind: 'shape',
      shape: 'rect',
      x: cx - fx(ctx.format, numberW * 0.275),
      y: underlineY,
      anchor: { x: 0, y: 0.5 },
      w: numberW * 0.55,
      h: 8,
      radius: 4,
      fill: ctx.color('accent'),
      strokeWidth: 0,
      at: underlineAt,
      duration: total - underlineAt,
      layer: LAYER.mid,
      keys: mergeKeys(
        [
          { channel: 'opacity', at: 0, value: 1 },
          { channel: 'scaleX', at: 0, value: 0 },
          { channel: 'scaleX', at: underlineDrawDur, value: pxToScale(numberW * 0.55, ctx.format), curve: 'cubic-out' },
        ],
        exitOut(ctx, total - underlineAt),
      ),
    })

    const labelY = below ? cy + fy(ctx.format, fontSize * 0.85) : cy
    const labelX = below ? cx : clampCenter(cx + 0.24, 0.2)
    parts.push({
      id: `${id}-label`,
      kind: 'text',
      text: label,
      font: ctx.font('sans'),
      size: 52,
      color: ctx.color('muted'),
      align: 'center',
      x: labelX,
      y: labelY,
      maxWidth: numberW * 1.2,
      at: labelAt,
      duration: total - labelAt,
      layer: LAYER.label,
      keys: mergeKeys(riseIn(ctx, labelY, { at: 0 }), exitOut(ctx, total - labelAt)),
      expressions: [floatY(ctx, 4, 3.4, 0.2)],
    })

    const decorAt = ctx.t(0.15)
    const decor: Array<{ dx: number; dy: number; kind: 'plus' | 'dot'; size: number }> = [
      { dx: -numberW * 0.62, dy: -fontSize * 0.55, kind: 'plus', size: 26 },
      { dx: numberW * 0.58, dy: -fontSize * 0.32, kind: 'dot', size: 14 },
      { dx: numberW * 0.5, dy: fontSize * 0.5, kind: 'dot', size: 10 },
    ]
    decor.forEach((d, i) => {
      const dx = cx + (d.dx / ctx.format.width)
      const dy = cy + (d.dy / ctx.format.height)
      const at = decorAt + ctx.t(0.06) * i
      if (d.kind === 'plus') {
        parts.push({
          id: `${id}-decor-${i}`,
          kind: 'icon',
          icon: 'plus',
          x: dx,
          y: dy,
          w: d.size,
          h: d.size,
          color: ctx.color('accent'),
          stroke: ctx.color('accent'),
          strokeWidth: 4,
          at,
          duration: total - at,
          layer: LAYER.accent,
          keys: mergeKeys(popIn(ctx, { at: 0, from: 0.3 }), exitOut(ctx, total - at)),
          expressions: [floatY(ctx, 6, 2.8, i * 0.4)],
        })
      } else {
        parts.push({
          id: `${id}-decor-${i}`,
          kind: 'shape',
          shape: 'circle',
          x: dx,
          y: dy,
          w: d.size,
          h: d.size,
          fill: ctx.color('accentSoft'),
          strokeWidth: 0,
          at,
          duration: total - at,
          layer: LAYER.accent,
          keys: mergeKeys(popIn(ctx, { at: 0, from: 0.3 }), exitOut(ctx, total - at)),
          expressions: [floatY(ctx, 6, 3, i * 0.4)],
        })
      }
    })

    return parts
  },
}
