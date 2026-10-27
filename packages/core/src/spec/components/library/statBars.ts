/**
 * stat-bars (AV-8b) — craft brief: "Baseline rule draws first; bars (rounded
 * rects) grow from the baseline via `scaleY` with anchor at the bottom,
 * staggered, `spring:snappy`; value labels pop above each bar as it lands;
 * the highlight item in accent, others muted."
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { exitOut, floatY, fx, fy, mergeKeys, popIn, riseIn, staggerAt } from '../motion'
import { LAYER, pxToScale, rowCenters } from './dataKit'

export const statBarsDef: ComponentDef = {
  name: 'stat-bars',
  label: 'Stat bars',
  hint: 'A small bar chart (2–6 bars) growing from a drawn baseline, one highlighted in accent — a comparison of values.',
  items: { min: 2, max: 6, hint: 'one per bar: text as the label, value as the height, style "highlight" for the accent bar' },
  duration: { min: 3, max: 6, default: 4.5 },
  build(component, ctx) {
    const id = component.id
    const items = component.items ?? []
    const n = items.length
    const cx = (component.x ?? 0.5) * ctx.format.width
    const baselineY = component.y ?? 0.56
    const total = component.duration
    const maxValue = Math.max(1, ...items.map((it) => it.value ?? 0))
    const maxBarH = 340
    const barW = 84
    const gap = 30

    const widths = items.map(() => barW)
    const centersPx = rowCenters(widths, gap, cx)
    const baselineWidth = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, n - 1) + 40

    const baselineDrawDur = ctx.t(0.5)
    const barsStartAt = baselineDrawDur * 0.6

    const parts: SpecElement[] = []

    // The baseline: draws first, left to right.
    parts.push({
      id: `${id}-baseline`,
      kind: 'shape',
      shape: 'line',
      x: fx(ctx.format, cx - baselineWidth / 2),
      y: baselineY,
      anchor: { x: 0, y: 0.5 },
      w: baselineWidth,
      h: 4,
      fill: 'transparent',
      stroke: ctx.color('ink'),
      strokeWidth: 4,
      at: 0,
      duration: total,
      layer: LAYER.mid,
      draw: { at: 0, duration: baselineDrawDur, curve: 'cubic-out' },
      keys: mergeKeys([{ channel: 'opacity', at: 0, value: 1 }], exitOut(ctx, total)),
    })

    items.forEach((item, i) => {
      const isHighlight = item.style === 'highlight'
      const value = Math.max(0, item.value ?? 0)
      const fraction = Math.max(0.03, value / maxValue)
      const bxFrac = fx(ctx.format, centersPx[i]!)
      const at = staggerAt(ctx, barsStartAt, i, 0.11)
      const growDur = ctx.t(0.5)
      const landAt = at + growDur
      const color = isHighlight ? ctx.color('accent') : ctx.color('muted')

      // Primary: the bar, growing up from the baseline.
      parts.push({
        id: `${id}-bar-${i}`,
        kind: 'shape',
        shape: 'rect',
        x: bxFrac,
        y: baselineY,
        anchor: { x: 0.5, y: 1 },
        w: barW,
        h: maxBarH,
        radius: 14,
        fill: color,
        strokeWidth: 0,
        at,
        duration: total - at,
        layer: LAYER.mid + 1,
        keys: mergeKeys(
          [
            { channel: 'opacity', at: 0, value: 0 },
            { channel: 'opacity', at: growDur * 0.3, value: 1, curve: 'cubic-out' },
            { channel: 'scaleY', at: 0, value: 0 },
            { channel: 'scaleY', at: growDur, value: pxToScale(maxBarH * fraction, ctx.format), curve: 'spring:snappy' },
          ],
          exitOut(ctx, total - at),
        ),
      })

      // The value label, popping above the bar as it lands.
      const labelY = baselineY - fy(ctx.format, maxBarH * fraction + 46)
      parts.push({
        id: `${id}-value-${i}`,
        kind: 'text',
        text: Number.isInteger(value) ? String(value) : value.toFixed(1),
        font: ctx.font('sans'),
        weight: 700,
        size: 38,
        color,
        align: 'center',
        x: bxFrac,
        y: labelY,
        maxWidth: barW * 2.2,
        at: landAt,
        duration: total - landAt,
        layer: LAYER.label,
        keys: mergeKeys(popIn(ctx, { at: 0, duration: ctx.t(0.3), from: 0.4 }), exitOut(ctx, total - landAt)),
        expressions: [floatY(ctx, 3, 3.2, i * 0.3)],
      })

      // Decoration: the category label below the baseline.
      const capY = baselineY + fy(ctx.format, 34)
      const capAt = at
      parts.push({
        id: `${id}-label-${i}`,
        kind: 'text',
        text: item.text ?? '',
        font: ctx.font('sans'),
        size: 28,
        color: ctx.color('muted'),
        align: 'center',
        x: bxFrac,
        y: capY,
        maxWidth: barW * 2.4,
        at: capAt,
        duration: total - capAt,
        layer: LAYER.label,
        keys: mergeKeys(riseIn(ctx, capY, { at: 0, duration: ctx.t(0.35) }), exitOut(ctx, total - capAt)),
      })
    })

    return parts
  },
}
