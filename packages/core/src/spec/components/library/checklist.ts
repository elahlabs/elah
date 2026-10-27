/**
 * checklist (AV-8b) — craft brief: "Items arrive top to bottom; for each, a
 * circle outline draws, then the check icon pops in accent, then the text
 * rises in. The last item gets the accent emphasis."
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { exitOut, floatY, fy, mergeKeys, popIn, riseIn } from '../motion'
import { LAYER, clampCenter } from './dataKit'

export const checklistDef: ComponentDef = {
  name: 'checklist',
  label: 'Checklist',
  hint: 'A vertical list of 2–6 items, each checked off top to bottom — the last one gets the accent emphasis.',
  items: { min: 2, max: 6, hint: 'one per row: text' },
  duration: { min: 3, max: 6, default: 4.5 },
  build(component, ctx) {
    const id = component.id
    const items = component.items ?? []
    const n = items.length
    const cx = component.x ?? 0.5
    const cyCenter = component.y ?? 0.46
    const total = component.duration
    const rowGapPx = 128
    const circleSize = 56
    const blockWidth = component.w ?? ctx.format.width * 0.72
    const iconColX = clampCenter(cx - blockWidth / (2 * ctx.format.width), fy(ctx.format, circleSize) / 2)
    const textLeftFrac = iconColX + fy(ctx.format, circleSize) / 2 + 0.02
    const startY = cyCenter - fy(ctx.format, (rowGapPx * (n - 1)) / 2)

    const itemGap = ctx.t(0.55)

    const parts: SpecElement[] = []

    items.forEach((item, i) => {
      const isLast = i === n - 1
      const rowY = startY + fy(ctx.format, rowGapPx * i)
      const at = itemGap * i
      const dur = total - at
      const circleDrawDur = ctx.t(0.4)
      const checkAt = circleDrawDur * 0.7
      const checkPopDur = ctx.t(0.35)
      const textAt = checkAt + checkPopDur * 0.55
      const stroke = isLast ? ctx.color('accent') : ctx.color('muted')

      // Secondary: the circle outline, drawing on.
      parts.push({
        id: `${id}-circle-${i}`,
        kind: 'shape',
        shape: 'circle',
        x: iconColX,
        y: rowY,
        w: circleSize,
        h: circleSize,
        fill: 'transparent',
        stroke,
        strokeWidth: isLast ? 5 : 4,
        at,
        duration: dur,
        layer: LAYER.mid,
        draw: { at: 0, duration: circleDrawDur, curve: 'cubic-out' },
        keys: mergeKeys([{ channel: 'opacity', at: 0, value: 1 }], exitOut(ctx, dur)),
      })

      // Primary: the check icon, popping in accent once the circle has drawn.
      parts.push({
        id: `${id}-check-${i}`,
        kind: 'icon',
        icon: 'check',
        x: iconColX,
        y: rowY,
        w: circleSize * 0.55,
        h: circleSize * 0.55,
        color: ctx.color('accent'),
        stroke: ctx.color('accent'),
        strokeWidth: isLast ? 4 : 3,
        at: at + checkAt,
        duration: dur - checkAt,
        layer: LAYER.front,
        keys: mergeKeys(popIn(ctx, { at: 0, duration: checkPopDur, from: 0.3 }), exitOut(ctx, dur - checkAt)),
      })

      // The row's text, rising in once the check has landed.
      parts.push({
        id: `${id}-text-${i}`,
        kind: 'text',
        text: item.text ?? '',
        font: ctx.font('sans'),
        weight: isLast ? 700 : 500,
        size: isLast ? 46 : 42,
        color: isLast ? ctx.color('accent') : ctx.color('ink'),
        align: 'left',
        anchor: { x: 0, y: 0.5 },
        x: textLeftFrac,
        y: rowY,
        maxWidth: blockWidth * 0.82,
        at: at + textAt,
        duration: dur - textAt,
        layer: LAYER.label,
        keys: mergeKeys(riseIn(ctx, rowY, { at: 0 }), exitOut(ctx, dur - textAt)),
        expressions: [floatY(ctx, 3, 3.4, i * 0.3)],
      })
    })

    return parts
  },
}
