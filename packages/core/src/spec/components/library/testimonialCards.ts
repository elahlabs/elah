/**
 * testimonial-cards (AV-8b) — craft brief: "2–3 cards at slight rotations
 * (±3–6°), each a surface with soft shadow: avatar circle (accentSoft with
 * initials or a user icon), name (bold), 5 accent stars (star `polygon`),
 * quote text (muted, wraps via `maxWidth`). Cards drift in from different
 * directions staggered and float; one sits slightly in front (`layer`)."
 *
 * Depends on `effects` (each card's soft shadow uses `gaussianBlur`): until
 * AV-7 lands the shadow is a flat translucent rect instead of a blur.
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { EXIT_SEC, exitOut, floatY, flyInX, fy, mergeKeys, popIn, riseIn } from '../motion'
import { LAYER, clampCenter, jitter } from './dataKit'

const CARD_ARRIVE_SEC = 0.7

const ARRANGEMENTS: Record<number, Array<{ dx: number; dy: number; fromX: number; rot: number }>> = {
  2: [
    { dx: -0.2, dy: -0.02, fromX: -0.25, rot: -5 },
    { dx: 0.2, dy: 0.03, fromX: 0.25, rot: 4 },
  ],
  3: [
    { dx: -0.28, dy: 0.02, fromX: -0.3, rot: -6 },
    { dx: 0, dy: -0.03, fromX: 0, rot: 3 },
    { dx: 0.28, dy: 0.02, fromX: 0.3, rot: 5 },
  ],
}

export const testimonialCardsDef: ComponentDef = {
  name: 'testimonial-cards',
  label: 'Testimonial cards',
  hint: '2–3 floating quote cards with an avatar, name and star rating, drifting in from different directions — social proof.',
  items: { min: 2, max: 3, hint: 'one per card: text as the quote, sub as the name, value 1–5 as the star rating' },
  duration: { min: 3.5, max: 7, default: 5 },
  build(component, ctx) {
    const id = component.id
    const items = component.items ?? []
    const n = Math.max(2, Math.min(3, items.length))
    const arrangement = ARRANGEMENTS[n]!
    const cx = component.x ?? 0.5
    const cy = component.y ?? 0.46
    const total = component.duration
    const cardW = 420
    const cardH = 460

    let frontIndex = items.findIndex((it) => it.style === 'highlight')
    if (frontIndex < 0) frontIndex = Math.floor((n - 1) / 2)

    const parts: SpecElement[] = []

    items.slice(0, n).forEach((item, i) => {
      const a = arrangement[i]!
      const isFront = i === frontIndex
      const bx = clampCenter(cx + a.dx, fy(ctx.format, cardW) / 2)
      const by = Math.min(0.72, Math.max(0.25, cy + a.dy))
      const rot = a.rot + jitter(ctx.random, 1.2)
      const at = ctx.t(0.22) * i
      const arriveDur = ctx.t(CARD_ARRIVE_SEC)
      const cardLayer = isFront ? LAYER.front : LAYER.mid

      // Decoration: the card's soft shadow, offset down.
      parts.push({
        id: `${id}-shadow-${i}`,
        kind: 'shape',
        shape: 'rect',
        x: bx,
        y: by + fy(ctx.format, 14),
        rotation: rot,
        w: cardW,
        h: cardH,
        radius: 28,
        fill: ctx.color('ink'),
        strokeWidth: 0,
        at,
        duration: total - at,
        layer: cardLayer - 1 < 0 ? 0 : cardLayer - 1,
        keys: mergeKeys(
          [
            { channel: 'opacity', at: 0, value: 0 },
            { channel: 'opacity', at: arriveDur, value: 0.1, curve: 'cubic-out' },
          ],
          [
            { channel: 'opacity', at: total - at - ctx.t(EXIT_SEC), value: 0.1 },
            { channel: 'opacity', at: total - at, value: 0, curve: 'quad-in' },
          ],
        ),
        effects: [{ kind: 'gaussianBlur', params: [{ name: 'radius', value: 18 }] }],
      })

      // Primary: the card surface, drifting in from its own direction.
      parts.push({
        id: `${id}-card-${i}`,
        kind: 'shape',
        shape: 'rect',
        x: bx,
        y: by,
        rotation: rot,
        w: cardW,
        h: cardH,
        radius: 28,
        fill: ctx.color('surface'),
        strokeWidth: 0,
        at,
        duration: total - at,
        layer: cardLayer,
        keys: mergeKeys(flyInX(ctx, bx, bx + a.fromX, { at: 0, duration: arriveDur }), exitOut(ctx, total - at)),
        expressions: [floatY(ctx, 5, 3.6 + i * 0.2, i * 0.5)],
      })

      const avatarY = by - fy(ctx.format, cardH * 0.32)
      parts.push({
        id: `${id}-avatar-${i}`,
        kind: 'shape',
        shape: 'circle',
        x: bx,
        y: avatarY,
        rotation: rot,
        w: 84,
        h: 84,
        fill: ctx.color('accentSoft'),
        strokeWidth: 0,
        at: at + arriveDur * 0.5,
        duration: total - (at + arriveDur * 0.5),
        layer: cardLayer + 1,
        keys: mergeKeys(popIn(ctx, { at: 0, from: 0.4 }), exitOut(ctx, total - (at + arriveDur * 0.5))),
      })
      parts.push({
        id: `${id}-avatar-icon-${i}`,
        kind: 'icon',
        icon: 'user',
        x: bx,
        y: avatarY,
        rotation: rot,
        w: 40,
        h: 40,
        color: ctx.color('accent'),
        stroke: ctx.color('accent'),
        strokeWidth: 3,
        at: at + arriveDur * 0.55,
        duration: total - (at + arriveDur * 0.55),
        layer: cardLayer + 2,
        keys: mergeKeys(popIn(ctx, { at: 0, from: 0.4 }), exitOut(ctx, total - (at + arriveDur * 0.55))),
      })

      const nameY = by - fy(ctx.format, cardH * 0.1)
      const nameAt = at + arriveDur * 0.75
      parts.push({
        id: `${id}-name-${i}`,
        kind: 'text',
        text: item.sub ?? '',
        font: ctx.font('sans'),
        weight: 700,
        size: 36,
        color: ctx.color('ink'),
        align: 'center',
        x: bx,
        y: nameY,
        rotation: rot,
        maxWidth: cardW * 0.8,
        at: nameAt,
        duration: total - nameAt,
        layer: cardLayer + 1,
        keys: mergeKeys(riseIn(ctx, nameY, { at: 0 }), exitOut(ctx, total - nameAt)),
      })

      const starCount = Math.max(1, Math.min(5, Math.round(item.value ?? 5)))
      const starY = by - fy(ctx.format, cardH * 0.01)
      const starGap = 34
      for (let s = 0; s < 5; s++) {
        const starAt = nameAt + ctx.t(0.06) * (s + 1)
        const sx = bx + fy(ctx.format, (s - 2) * starGap)
        parts.push({
          id: `${id}-star-${i}-${s}`,
          kind: 'shape',
          shape: 'polygon',
          sides: 5,
          innerRatio: 0.45,
          x: sx,
          y: starY,
          rotation: rot,
          w: 26,
          h: 26,
          fill: s < starCount ? ctx.color('accent') : ctx.color('muted'),
          strokeWidth: 0,
          at: starAt,
          duration: total - starAt,
          layer: cardLayer + 1,
          keys: mergeKeys(popIn(ctx, { at: 0, duration: ctx.t(0.3), from: 0.2 }), exitOut(ctx, total - starAt)),
        })
      }

      const quoteAt = nameAt + ctx.t(0.35)
      const quoteY = by + fy(ctx.format, cardH * 0.2)
      parts.push({
        id: `${id}-quote-${i}`,
        kind: 'text',
        text: item.text ?? '',
        font: ctx.font('sans'),
        size: 30,
        color: ctx.color('muted'),
        align: 'center',
        x: bx,
        y: quoteY,
        rotation: rot,
        maxWidth: cardW * 0.82,
        lineHeight: 1.3,
        at: quoteAt,
        duration: total - quoteAt,
        layer: cardLayer + 1,
        keys: mergeKeys(riseIn(ctx, quoteY, { at: 0 }), exitOut(ctx, total - quoteAt)),
      })
    })

    return parts
  },
}
