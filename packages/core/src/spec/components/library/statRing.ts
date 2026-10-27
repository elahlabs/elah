/**
 * stat-ring (AV-8b) — craft brief: "Track ring (muted, 15% opacity) appears;
 * accent arc draws to value/100 of the circle (or full); a `counter`
 * generator counts from 0 to value in sync; `text` caption types in below;
 * ring breathes gently after landing."
 *
 * Depends on `effects` (the soft glow behind the ring uses `gaussianBlur`):
 * until AV-7 lands, the glow is a flat soft circle instead of a blur.
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { exitOut, floatY, fx, fy, mergeKeys, popIn } from '../motion'
import { LAYER, appearTo, clampCenter, counterParams, disappearFrom } from './dataKit'

export const statRingDef: ComponentDef = {
  name: 'stat-ring',
  label: 'Stat ring',
  hint: 'A ring that draws to a percentage while a big number counts up inside it, with a caption below — one headline stat.',
  items: { min: 1, max: 1, hint: 'one stat: value 0–100 (percent of the ring unless variant is "full"), text as the caption' },
  variants: ['percent', 'full'],
  duration: { min: 2.5, max: 5, default: 3.5 },
  build(component, ctx) {
    const id = component.id
    const item = component.items?.[0]
    const value = item?.value ?? 0
    const caption = item?.text ?? component.text ?? ''
    const diameterPx = Math.min(component.w ?? 420, component.h ?? 420)
    const R = diameterPx / 2
    const cx = clampCenter(component.x ?? 0.5, fx(ctx.format, R + 20))
    const cy = component.y ?? 0.4
    const fraction = component.variant === 'full' ? 1 : Math.max(0, Math.min(1, value / 100))
    const total = component.duration

    const arcAt = ctx.t(0.25)
    const arcDrawDur = ctx.t(1.1)
    const captionAt = Math.min(total * 0.7, arcAt + arcDrawDur * 0.4)
    const glowTarget = 0.35
    const trackTarget = 0.15

    const parts: SpecElement[] = []

    // Decoration: a soft blurred glow behind everything.
    parts.push({
      id: `${id}-glow`,
      kind: 'shape',
      shape: 'circle',
      x: cx,
      y: cy,
      w: diameterPx * 1.35,
      h: diameterPx * 1.35,
      fill: ctx.color('accentSoft'),
      strokeWidth: 0,
      at: 0,
      duration: total,
      layer: LAYER.back,
      keys: mergeKeys(appearTo(ctx, glowTarget, { fromScale: 0.8 }), disappearFrom(ctx, glowTarget, total)),
      expressions: [{ channel: 'scale', source: 'value * (1 + 0.03 * sin(t * 2 * PI / 3.4))' }],
      effects: [{ kind: 'gaussianBlur', params: [{ name: 'radius', value: 40 }] }],
    })

    // Secondary: the muted track ring, resting at 15% opacity, breathing once landed.
    parts.push({
      id: `${id}-track`,
      kind: 'shape',
      shape: 'circle',
      x: cx,
      y: cy,
      w: diameterPx,
      h: diameterPx,
      fill: 'transparent',
      stroke: ctx.color('muted'),
      strokeWidth: 16,
      at: 0,
      duration: total,
      layer: LAYER.mid,
      keys: mergeKeys(appearTo(ctx, trackTarget, { fromScale: 0.9 }), disappearFrom(ctx, trackTarget, total)),
      expressions: [{ channel: 'scale', source: 'value * (1 + 0.012 * sin(t * 2 * PI / 4.2))' }],
    })

    // Primary: the accent arc, drawing to `fraction` of the circle.
    parts.push({
      id: `${id}-arc`,
      kind: 'shape',
      shape: 'arc',
      x: cx,
      y: cy,
      w: diameterPx,
      h: diameterPx,
      stroke: ctx.color('accent'),
      strokeWidth: 18,
      cap: 'round',
      at: 0,
      duration: total,
      layer: LAYER.mid + 1,
      draw: { at: arcAt, duration: arcDrawDur, to: fraction, curve: 'cubic-out' },
      keys: mergeKeys(
        [
          { channel: 'opacity', at: arcAt, value: 0 },
          { channel: 'opacity', at: arcAt + ctx.t(0.2), value: 1, curve: 'cubic-out' },
        ],
        disappearFrom(ctx, 1, total),
      ),
      expressions: [{ channel: 'scale', source: 'value * (1 + 0.015 * sin((t + 0.6) * 2 * PI / 4))' }],
    })

    // Decoration: two small accent dots by the ring, popping in after the arc lands.
    ;[-40, 200].forEach((deg, i) => {
      const rad = (deg * Math.PI) / 180
      const dotR = R + 34
      const dx = cx + fx(ctx.format, Math.cos(rad) * dotR)
      const dy = cy + fy(ctx.format, Math.sin(rad) * dotR)
      const at = Math.min(total - ctx.t(0.4), arcAt + arcDrawDur * 0.7 + ctx.t(0.08) * i)
      parts.push({
        id: `${id}-dot-${i}`,
        kind: 'shape',
        shape: 'circle',
        x: dx,
        y: dy,
        w: 14,
        h: 14,
        fill: ctx.color('accent'),
        strokeWidth: 0,
        at,
        duration: total - at,
        layer: LAYER.accent,
        keys: mergeKeys(popIn(ctx, { at: 0, from: 0.3 }), exitOut(ctx, total - at)),
        expressions: [floatY(ctx, 5, 2.6, i * 0.5)],
      })
    })

    // Primary: the counter, centred in the ring, counting in sync with the arc.
    const counterAt = arcAt
    parts.push({
      id: `${id}-counter`,
      kind: 'generator',
      generator: 'counter',
      x: cx,
      y: cy - fy(ctx.format, 6),
      w: diameterPx * 0.8,
      h: diameterPx * 0.5,
      at: counterAt,
      duration: total - counterAt,
      layer: LAYER.front,
      params: counterParams(value, {
        fontSize: Math.round(diameterPx * 0.34),
        color: ctx.color('ink'),
        countFraction: Math.min(1, arcDrawDur * 1.05 / Math.max(0.1, total - counterAt)),
      }),
      keys: mergeKeys(popIn(ctx, { at: 0, duration: ctx.t(0.5), from: 0.6 }), exitOut(ctx, total - counterAt)),
    })

    // The caption: types in below the ring, holds to be read, exits with the rest.
    const captionDuration = total - captionAt
    parts.push({
      id: `${id}-caption`,
      kind: 'text',
      text: caption,
      font: ctx.font('sans'),
      size: Math.round(diameterPx * 0.11),
      color: ctx.color('muted'),
      align: 'center',
      x: cx,
      y: cy + fy(ctx.format, R + 70),
      maxWidth: diameterPx * 1.6,
      at: captionAt,
      duration: captionDuration,
      layer: LAYER.label,
      reveal: { preset: 'typewriter', unit: 'char' },
      keys: exitOut(ctx, captionDuration),
    })
    return parts
  },
}
