/**
 * comparison (AV-8b) — craft brief: "A vertical divider draws; left column
 * (`items` with style `muted`) and right column (style `accent`) headers
 * pop, then rows rise in alternating left/right; an `x` icon on the left
 * rows and a `check` on the right."
 *
 * `component.text` is the left header, `component.sub` the right header.
 * An item's `style` picks its column (`muted` -> left, `accent` -> right);
 * an item with neither alternates by position, so an author who does not
 * care still gets a balanced two-column comparison.
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { exitOut, floatY, fy, mergeKeys, popIn, riseIn, staggerAt } from '../motion'
import { LAYER, clampCenter, pxToScale } from './dataKit'

interface Row {
  text: string
  column: 'left' | 'right'
}

export const comparisonDef: ComponentDef = {
  name: 'comparison',
  label: 'Comparison',
  hint: 'Two columns either side of a drawn divider, rows rising in alternating left/right with an x or a check — before/after or us/them.',
  items: { min: 2, max: 8, hint: 'one per row: text, style "muted" for the left column or "accent" for the right' },
  duration: { min: 3, max: 6, default: 4.5 },
  build(component, ctx) {
    const id = component.id
    const items = component.items ?? []
    const cx = component.x ?? 0.5
    const top = component.y ?? 0.3
    const total = component.duration
    const colOffset = 0.2
    const leftX = clampCenter(cx - colOffset, 0.16)
    const rightX = clampCenter(cx + colOffset, 0.16)

    const rows: Row[] = items.map((item, i) => ({
      text: item.text ?? '',
      column: item.style === 'muted' ? 'left' : item.style === 'accent' ? 'right' : i % 2 === 0 ? 'left' : 'right',
    }))
    const leftRows = rows.filter((r) => r.column === 'left')
    const rightRows = rows.filter((r) => r.column === 'right')

    // Interleave left/right so the reveal alternates sides regardless of column sizes.
    const order: Row[] = []
    const maxLen = Math.max(leftRows.length, rightRows.length)
    for (let i = 0; i < maxLen; i++) {
      if (leftRows[i]) order.push(leftRows[i]!)
      if (rightRows[i]) order.push(rightRows[i]!)
    }

    const dividerDrawDur = ctx.t(0.5)
    const headerAt = dividerDrawDur * 0.6
    const headerPopDur = ctx.t(0.4)
    const rowsStartAt = headerAt + headerPopDur
    const rowGap = 116

    const parts: SpecElement[] = []

    // The divider: a thin vertical rule that grows down from the top via
    // `scaleY` (anchor top) — a `line` shape only ever paints horizontally
    // (see `shapePaint.ts`'s `paintLine`), so a vertical rule is a rect, not
    // a rotated line.
    const dividerH = rowGap * (Math.max(leftRows.length, rightRows.length) + 1.6)
    parts.push({
      id: `${id}-divider`,
      kind: 'shape',
      shape: 'rect',
      x: cx,
      y: top - fy(ctx.format, 20),
      anchor: { x: 0.5, y: 0 },
      w: 4,
      h: dividerH,
      fill: ctx.color('muted'),
      strokeWidth: 0,
      at: 0,
      duration: total,
      layer: LAYER.back + 1,
      keys: mergeKeys(
        [
          { channel: 'opacity', at: 0, value: 1 },
          { channel: 'scaleY', at: 0, value: 0 },
          { channel: 'scaleY', at: dividerDrawDur, value: pxToScale(dividerH, ctx.format), curve: 'cubic-out' },
        ],
        exitOut(ctx, total),
      ),
    })

    // Headers, popping in above each column.
    const headerY = top
    parts.push({
      id: `${id}-header-left`,
      kind: 'text',
      text: component.text ?? '',
      font: ctx.font('sans'),
      weight: 700,
      size: 44,
      color: ctx.color('muted'),
      align: 'center',
      x: leftX,
      y: headerY,
      maxWidth: 320,
      at: headerAt,
      duration: total - headerAt,
      layer: LAYER.label,
      keys: mergeKeys(popIn(ctx, { at: 0, duration: headerPopDur, from: 0.6 }), exitOut(ctx, total - headerAt)),
    })
    parts.push({
      id: `${id}-header-right`,
      kind: 'text',
      text: component.sub ?? '',
      font: ctx.font('sans'),
      weight: 700,
      size: 44,
      color: ctx.color('accent'),
      align: 'center',
      x: rightX,
      y: headerY,
      maxWidth: 320,
      at: headerAt + ctx.t(0.1),
      duration: total - headerAt - ctx.t(0.1),
      layer: LAYER.label,
      keys: mergeKeys(popIn(ctx, { at: 0, duration: headerPopDur, from: 0.6 }), exitOut(ctx, total - headerAt - ctx.t(0.1))),
    })

    const leftRunIndex = new Map<Row, number>()
    const rightRunIndex = new Map<Row, number>()
    let li = 0
    let ri = 0
    for (const r of order) {
      if (r.column === 'left') leftRunIndex.set(r, li++)
      else rightRunIndex.set(r, ri++)
    }

    order.forEach((row, orderIndex) => {
      const isLeft = row.column === 'left'
      const rowIndex = isLeft ? leftRunIndex.get(row)! : rightRunIndex.get(row)!
      const rowY = headerY + fy(ctx.format, rowGap * (rowIndex + 1.4))
      const colX = isLeft ? leftX : rightX
      const at = staggerAt(ctx, rowsStartAt, orderIndex, 0.18)
      const dur = total - at

      parts.push({
        id: `${id}-icon-${isLeft ? 'l' : 'r'}-${rowIndex}`,
        kind: 'icon',
        icon: isLeft ? 'x' : 'check',
        x: colX - fy(ctx.format, 130),
        y: rowY,
        w: 34,
        h: 34,
        color: isLeft ? ctx.color('muted') : ctx.color('accent'),
        stroke: isLeft ? ctx.color('muted') : ctx.color('accent'),
        strokeWidth: 3,
        at,
        duration: dur,
        layer: LAYER.front,
        keys: mergeKeys(popIn(ctx, { at: 0, from: 0.3 }), exitOut(ctx, dur)),
      })

      parts.push({
        id: `${id}-text-${isLeft ? 'l' : 'r'}-${rowIndex}`,
        kind: 'text',
        text: row.text,
        font: ctx.font('sans'),
        size: 36,
        color: isLeft ? ctx.color('ink') : ctx.color('ink'),
        align: isLeft ? 'right' : 'left',
        x: isLeft ? colX - fy(ctx.format, 70) : colX + fy(ctx.format, 70),
        y: rowY,
        maxWidth: 260,
        at,
        duration: dur,
        layer: LAYER.label,
        keys: mergeKeys(riseIn(ctx, rowY, { at: 0 }), exitOut(ctx, dur)),
        expressions: [floatY(ctx, 3, 3.2, orderIndex * 0.25)],
      })
    })

    return parts
  },
}
