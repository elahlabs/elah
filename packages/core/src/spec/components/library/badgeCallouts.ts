/**
 * badge-callouts (AV-8b) — craft brief: "Badges (variant `hexagon` =
 * `polygon` sides 6 / `circle`) in accent with a white icon, popping in one
 * by one (0.35 s apart); for each, an elbow callout line draws from the badge
 * toward its label, then the label rises in at the line's end. Arrange 2–4
 * badges in a pleasing asymmetric layout (not a straight row)."
 *
 * The arrangement is organic (`ctx.random()`-jittered around a hand-placed
 * asymmetric pattern per count), so it is part of the determinism contract:
 * same seed -> same layout, a different seed nudges it.
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { elbowPath, exitOut, floatY, mergeKeys, popIn, riseIn } from '../motion'
import { LAYER, clampCenter, disappearFrom, jitter } from './dataKit'

/** Hand-placed asymmetric offsets (fraction of stage), before jitter. Never a straight row. */
const ARRANGEMENTS: Record<number, Array<{ dx: number; dy: number }>> = {
  2: [
    { dx: -0.17, dy: -0.07 },
    { dx: 0.15, dy: 0.09 },
  ],
  3: [
    { dx: -0.23, dy: -0.09 },
    { dx: 0.02, dy: 0.12 },
    { dx: 0.22, dy: -0.05 },
  ],
  4: [
    { dx: -0.25, dy: -0.12 },
    { dx: -0.05, dy: 0.1 },
    { dx: 0.14, dy: -0.08 },
    { dx: 0.27, dy: 0.09 },
  ],
}

export const badgeCalloutsDef: ComponentDef = {
  name: 'badge-callouts',
  label: 'Badge callouts',
  hint: '2–4 accent badges in an asymmetric cluster, each with an elbow line drawing out to its label — features or credentials.',
  items: { min: 2, max: 4, hint: 'one per badge: icon and text as the label' },
  variants: ['hexagon', 'circle'],
  duration: { min: 3, max: 6, default: 4.5 },
  build(component, ctx) {
    const id = component.id
    const items = component.items ?? []
    const n = Math.max(2, Math.min(4, items.length))
    const arrangement = ARRANGEMENTS[n]!
    const cx = component.x ?? 0.5
    const cy = component.y ?? 0.42
    const badgeSize = 108
    const total = component.duration
    const isHex = component.variant !== 'circle'

    const parts: SpecElement[] = []

    items.slice(0, n).forEach((item, i) => {
      const off = arrangement[i]!
      const bx = clampCenter(cx + off.dx + jitter(ctx.random, 0.012), 0.09)
      const by = Math.min(0.85, Math.max(0.15, cy + off.dy + jitter(ctx.random, 0.012)))
      const labelDx = off.dx >= 0 ? 0.1 : -0.1
      const labelDy = 0.1
      const lx = clampCenter(bx + labelDx, 0.16)
      const ly = Math.min(0.92, by + labelDy)

      const at = ctx.t(0.35) * i
      const popDur = ctx.t(0.4)
      const elbowAt = at + popDur + ctx.t(0.1)
      const elbowDur = ctx.t(0.5)
      const labelAt = elbowAt + elbowDur * 0.6

      // Primary: the badge surface.
      parts.push({
        id: `${id}-badge-${i}`,
        kind: 'shape',
        shape: isHex ? 'polygon' : 'circle',
        ...(isHex ? { sides: 6 } : {}),
        x: bx,
        y: by,
        w: badgeSize,
        h: badgeSize,
        fill: ctx.color('accent'),
        strokeWidth: 0,
        at,
        duration: total - at,
        layer: LAYER.mid,
        keys: mergeKeys(popIn(ctx, { at: 0, duration: popDur, from: 0.35 }), exitOut(ctx, total - at)),
        expressions: [floatY(ctx, 5, 3 + i * 0.2, i * 0.4)],
      })

      // Primary: the white icon on the badge.
      parts.push({
        id: `${id}-icon-${i}`,
        kind: 'icon',
        icon: item.icon ?? 'star',
        x: bx,
        y: by,
        w: badgeSize * 0.45,
        h: badgeSize * 0.45,
        color: '#ffffff',
        stroke: '#ffffff',
        strokeWidth: 3,
        at,
        duration: total - at,
        layer: LAYER.front,
        keys: mergeKeys(popIn(ctx, { at: 0, duration: popDur, from: 0.35 }), exitOut(ctx, total - at)),
        expressions: [floatY(ctx, 5, 3 + i * 0.2, i * 0.4)],
      })

      // Decoration: the elbow line drawn from badge toward label.
      const dx = lx - bx
      const dy = ly - by
      const wPx = Math.max(4, Math.abs(dx) * ctx.format.width)
      const hPx = Math.max(4, Math.abs(dy) * ctx.format.height)
      const dir = dy < 0 ? (dx < 0 ? 'up-left' : 'up-right') : dx < 0 ? 'down-left' : 'down-right'
      const originX = Math.min(bx, lx)
      const originY = Math.min(by, ly)
      parts.push({
        id: `${id}-elbow-${i}`,
        kind: 'shape',
        shape: 'path',
        path: elbowPath(wPx, hPx, dir),
        viewBox: { x: 0, y: 0, width: wPx, height: hPx },
        x: originX,
        y: originY,
        anchor: { x: 0, y: 0 },
        w: wPx,
        h: hPx,
        fill: 'transparent',
        stroke: ctx.color('muted'),
        strokeWidth: 3,
        cap: 'round',
        join: 'round',
        at: elbowAt,
        duration: total - elbowAt,
        layer: LAYER.back + 1,
        draw: { at: 0, duration: elbowDur, curve: 'cubic-out' },
        keys: mergeKeys([{ channel: 'opacity', at: 0, value: 1 }], disappearFrom(ctx, 1, total - elbowAt)),
      })

      // The label, rising in at the line's end.
      parts.push({
        id: `${id}-label-${i}`,
        kind: 'text',
        text: item.text ?? '',
        font: ctx.font('sans'),
        size: 40,
        color: ctx.color('ink'),
        align: dx < 0 ? 'right' : 'left',
        x: lx,
        y: ly,
        maxWidth: 320,
        at: labelAt,
        duration: total - labelAt,
        layer: LAYER.label,
        keys: mergeKeys(riseIn(ctx, ly, { at: 0 }), exitOut(ctx, total - labelAt)),
        expressions: [floatY(ctx, 3, 3.2, i * 0.3)],
      })
    })

    return parts
  },
}
