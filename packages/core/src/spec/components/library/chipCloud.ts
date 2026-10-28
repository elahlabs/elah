/**
 * chip-cloud (AV-8b) — craft brief: "Pills (`pill` text), `filled` (accent
 * fill, white text) or `outline` (ink stroke, ink text), flying in one at a
 * time from alternating sides (`flyInX`) and settling into a loose cloud
 * (rows with jittered offsets). A large blurred accentSoft ring breathes
 * behind the cloud. Each chip floats with its own phase."
 *
 * The cloud is built from the centre outward (layout rule): chips are placed
 * into a grid of slots sorted by distance from the cloud's centre, then
 * `items[0]` lands in the most central slot — not authoring order left to
 * right — with a deterministic jitter from `ctx.random()`.
 *
 * Depends on `effects` (the blurred ring behind the cloud): until AV-7 lands
 * it is a flat soft circle instead of a blur.
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { exitOut, floatY, flyInX, mergeKeys, staggerAt } from '../motion'
import { LAYER, appearTo, clampCenter, disappearFrom, estimateTextWidth, jitter } from './dataKit'

export const chipCloudDef: ComponentDef = {
  name: 'chip-cloud',
  label: 'Chip cloud',
  hint: 'A loose cloud of 3–8 pill chips flying in from alternating sides — a tag list, feature set or keyword cluster.',
  items: { min: 3, max: 8, hint: 'one per chip: text, style "filled" (accent) or "outline" (ink)' },
  duration: { min: 3, max: 6, default: 4.5 },
  build(component, ctx) {
    const id = component.id
    const items = component.items ?? []
    const n = items.length
    const cx = component.x ?? 0.5
    const cy = component.y ?? 0.46
    const total = component.duration
    const size = 38
    const padding = 20

    const widths = items.map((it) => estimateTextWidth(it.text ?? '', size, padding))
    const maxWidth = Math.max(...widths, 140)
    const cols = Math.min(3, n)
    const rows = Math.ceil(n / cols)
    const colGap = maxWidth + 40
    const rowGap = 108

    // Grid cells, centred on (0,0) in px, row-major, sorted centre-first.
    const cells: Array<{ dx: number; dy: number }> = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols && cells.length < n; c++) {
        cells.push({ dx: (c - (cols - 1) / 2) * colGap, dy: (r - (rows - 1) / 2) * rowGap })
      }
    }
    cells.sort((a, b) => a.dx * a.dx + a.dy * a.dy - (b.dx * b.dx + b.dy * b.dy))

    const parts: SpecElement[] = []

    // Decoration: a large blurred accentSoft ring breathing behind the cloud.
    const ringSize = Math.max(colGap * cols, rowGap * rows) * 1.1
    parts.push({
      id: `${id}-glow`,
      kind: 'shape',
      shape: 'circle',
      x: cx,
      y: cy,
      w: ringSize,
      h: ringSize,
      fill: ctx.color('accentSoft'),
      strokeWidth: 0,
      at: 0,
      duration: total,
      layer: LAYER.back,
      keys: mergeKeys(appearTo(ctx, 0.3, { fromScale: 0.85 }), disappearFrom(ctx, 0.3, total)),
      expressions: [{ channel: 'scale', source: 'value * (1 + 0.025 * sin(t * 2 * PI / 4.5))' }],
      effects: [{ kind: 'gaussianBlur', params: [{ name: 'radius', value: 60 }] }],
    })

    items.forEach((item, i) => {
      const cell = cells[i]!
      const w = widths[i]!
      const jx = jitter(ctx.random, 14)
      const jy = jitter(ctx.random, 10)
      const bx = clampCenter(cx + (cell.dx + jx) / ctx.format.width, w / 2 / ctx.format.width)
      const by = Math.min(0.9, Math.max(0.1, cy + (cell.dy + jy) / ctx.format.height))
      const fromLeft = i % 2 === 0
      const fromX = fromLeft ? -0.2 : 1.2
      const at = staggerAt(ctx, ctx.t(0.12), i, 0.16)
      const filled = item.style === 'outline' ? false : true

      parts.push({
        id: `${id}-chip-${i}`,
        kind: 'text',
        text: item.text ?? '',
        font: ctx.font('sans'),
        size,
        color: filled ? '#ffffff' : ctx.color('ink'),
        align: 'center',
        x: bx,
        y: by,
        at,
        duration: total - at,
        layer: LAYER.front,
        pill: filled
          ? { fill: ctx.color('accent'), radius: size, padding }
          : { stroke: ctx.color('ink'), strokeWidth: 2, radius: size, padding },
        keys: mergeKeys(flyInX(ctx, bx, fromX, { at: 0 }), exitOut(ctx, total - at)),
        expressions: [floatY(ctx, 4, 2.8 + (i % 3) * 0.3, i * 0.35)],
      })
    })

    return parts
  },
}
