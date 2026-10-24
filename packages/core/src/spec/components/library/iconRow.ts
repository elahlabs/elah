/**
 * icon-row (AV-8b) — craft brief: "N icons in a row (3–7), each in a soft
 * circle surface; they pop in staggered from the centre outward. The
 * `highlight` item is larger, ink or accent, and bracket corners draw around
 * it after the row lands; the others dim slightly to 60%. Idle float with
 * offset phases."
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { bracketCorners, exitOut, floatY, fx, mergeKeys, popIn, staggerAt } from '../motion'
import { LAYER, appearTo, centerOutRank, disappearFrom, rowCenters } from './dataKit'

export const iconRowDef: ComponentDef = {
  name: 'icon-row',
  label: 'Icon row',
  hint: 'A row of 3–7 icons in soft circles, one highlighted with bracket corners — a feature list or capability strip.',
  items: { min: 3, max: 7, hint: 'one per icon: icon name, style "highlight" for the one item that matters' },
  duration: { min: 2.5, max: 5, default: 3.5 },
  build(component, ctx) {
    const id = component.id
    const items = component.items ?? []
    const n = items.length
    const cx = (component.x ?? 0.5) * ctx.format.width
    const cy = component.y ?? 0.46

    let highlightIndex = items.findIndex((it) => it.style === 'highlight')
    if (highlightIndex < 0) highlightIndex = Math.floor((n - 1) / 2)

    const baseSize = 96
    const highlightSize = 132
    const gap = 34
    const widths = items.map((_, i) => (i === highlightIndex ? highlightSize : baseSize))
    const centersPx = rowCenters(widths, gap, cx)

    const rowLandAt = ctx.t(0.15) + ctx.t(0.07) * (n - 1) + ctx.t(0.45)
    const total = component.duration

    const parts: SpecElement[] = []

    items.forEach((item, i) => {
      const size = widths[i]!
      const isHighlight = i === highlightIndex
      const rank = centerOutRank(n, i)
      const at = staggerAt(ctx, ctx.t(0.15), rank)
      const cxFrac = fx(ctx.format, centersPx[i]!)

      // Secondary: the soft circle surface behind the glyph.
      parts.push({
        id: `${id}-surface-${i}`,
        kind: 'shape',
        shape: 'circle',
        x: cxFrac,
        y: cy,
        w: size,
        h: size,
        fill: isHighlight ? ctx.color('accentSoft') : ctx.color('surface'),
        strokeWidth: 0,
        at,
        duration: total - at,
        layer: LAYER.mid,
        keys: mergeKeys(popIn(ctx, { at: 0, from: 0.4 }), exitOut(ctx, total - at)),
        expressions: [floatY(ctx, 5, 3 + i * 0.15, i * 0.35)],
      })

      // Primary: the glyph itself, dimming to 60% once landed unless it is the highlight.
      const restOpacity = isHighlight ? 1 : 0.6
      const popDur = ctx.t(0.45)
      const dimAt = popDur + ctx.t(0.1)
      const dimDur = ctx.t(0.3)
      const opacityKeys = isHighlight
        ? [{ channel: 'opacity', at: 0, value: 0 }, { channel: 'opacity', at: popDur * 0.35, value: 1, curve: 'cubic-out' as const }]
        : [
            { channel: 'opacity', at: 0, value: 0 },
            { channel: 'opacity', at: popDur * 0.35, value: 1, curve: 'cubic-out' as const },
            { channel: 'opacity', at: dimAt, value: 1, curve: 'cubic-out' as const },
            { channel: 'opacity', at: dimAt + dimDur, value: restOpacity, curve: 'cubic-out' as const },
          ]
      parts.push({
        id: `${id}-icon-${i}`,
        kind: 'icon',
        icon: item.icon ?? 'circle-check',
        x: cxFrac,
        y: cy,
        w: size * 0.5,
        h: size * 0.5,
        color: isHighlight ? ctx.color('accent') : ctx.color('ink'),
        stroke: isHighlight ? ctx.color('accent') : ctx.color('ink'),
        strokeWidth: 3,
        at,
        duration: total - at,
        layer: LAYER.front,
        keys: mergeKeys(
          [
            { channel: 'scale', at: 0, value: 0.4 },
            { channel: 'scale', at: popDur, value: 1, curve: isHighlight ? 'spring:bouncy' : 'spring:snappy' },
          ],
          opacityKeys,
          isHighlight ? exitOut(ctx, total - at) : disappearFrom(ctx, restOpacity, total - at),
        ),
        expressions: [floatY(ctx, isHighlight ? 6 : 4, 3 + i * 0.15, i * 0.35)],
      })
    })

    // Decoration: bracket corners drawing on around the highlight after the row lands.
    const highlightCx = fx(ctx.format, centersPx[highlightIndex]!)
    const box = { x: highlightCx, y: cy, w: highlightSize + 28, h: highlightSize + 28 }
    const bracketAt = rowLandAt
    const brackets = bracketCorners(`${id}-bracket`, box, ctx.format, { at: bracketAt, duration: total - bracketAt }, 22)
    brackets.forEach((b, i) => {
      parts.push({
        ...b,
        stroke: ctx.color('accent'),
        strokeWidth: 5,
        layer: LAYER.accent,
        draw: { at: ctx.t(0.05) * i, duration: ctx.t(0.35), curve: 'cubic-out' },
        keys: mergeKeys(appearTo(ctx, 1, { at: 0, duration: ctx.t(0.15) }), disappearFrom(ctx, 1, total - bracketAt)),
      })
    })

    return parts
  },
}
