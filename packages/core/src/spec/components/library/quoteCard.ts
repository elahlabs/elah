/**
 * quote-card (AV-8a) — a pull quote on a card: soft shadow, a giant quote
 * mark behind the text, the quote itself revealing line by line, and an
 * attribution that fades in after a short accent rule draws in front of it.
 * See `AV-MOTION-CRAFT.md`'s per-component table.
 *
 * What a viewer sees: a rounded card rises into place with a soft shadow
 * beneath it. Behind the top-left corner, a huge pale quote mark pops in.
 * The quote itself reveals one line at a time. Once it has landed, a short
 * accent rule draws in above the attribution, which then rises in beside it.
 *
 * The shadow's `gaussianBlur` effect is emitted per `AV-MOTION-CRAFT.md`'s
 * Layout section ("a soft shadow ... `gaussianBlur` effect") but is a no-op
 * until AV-7 wires `effects` into the compiler — see TICKET-AV-8a.md's
 * "two compiler facts" and this component's Result entry.
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { drawOn, exitOut, floatY, fy, mergeKeys, popIn, riseIn } from '../motion'
import { driftScaleX } from './idleMotion'

const CARD_W_FRAC = 0.84
const CARD_H_FRAC = 0.44
const CARD_Y = 0.48
const QUOTE_SIZE = 56
const MARK_SIZE = 220
const ATTR_SIZE = 34

export const quoteCard: ComponentDef = {
  name: 'quote-card',
  label: 'Quote Card',
  hint: 'A pull quote on a card with a giant quote mark, the text revealing line by line, and an attribution introduced by a drawn accent rule. Use for a testimonial or a single strong line worth framing.',
  duration: { min: 2.5, max: 7, default: 4.2 },
  build(component, ctx) {
    const id = component.id
    const duration = component.duration
    const quote = (component.text ?? '').trim()
    const attribution = (component.sub ?? '').trim()

    const cardW = ctx.format.width * CARD_W_FRAC
    const cardH = ctx.format.height * CARD_H_FRAC
    const padX = cardW * 0.09
    const shadowOffsetY = 14

    const parts: SpecElement[] = []

    // Soft shadow behind the surface — same rise, offset down, blurred (AV-7).
    parts.push({
      id: `${id}-shadow`,
      kind: 'shape',
      shape: 'rect',
      at: 0,
      duration,
      x: 0.5,
      y: CARD_Y + fy(ctx.format, shadowOffsetY),
      w: cardW,
      h: cardH,
      radius: 28,
      fill: ctx.color('ink'),
      opacity: 0.1,
      layer: (component.layer ?? 0) - 1,
      effects: [{ kind: 'gaussianBlur', params: [{ name: 'radius', value: 24 }] }],
      keys: mergeKeys(riseIn(ctx, CARD_Y + fy(ctx.format, shadowOffsetY), { at: 0 }), exitOut(ctx, duration)),
      expressions: [driftScaleX(0.012, 3.4, 0)],
    })

    parts.push({
      id: `${id}-surface`,
      kind: 'shape',
      shape: 'rect',
      at: 0,
      duration,
      x: 0.5,
      y: CARD_Y,
      w: cardW,
      h: cardH,
      radius: 28,
      fill: ctx.color('surface'),
      keys: mergeKeys(riseIn(ctx, CARD_Y, { at: 0 }), exitOut(ctx, duration)),
      expressions: [driftScaleX(0.012, 3.4, 0.15)],
    })

    const markAt = ctx.t(0.2)
    const markD = Math.max(0.6, +(duration - markAt).toFixed(4))
    parts.push({
      id: `${id}-mark`,
      kind: 'text',
      text: '“',
      at: markAt,
      duration: markD,
      x: 0.5 - (cardW * 0.5 - padX * 1.2) / ctx.format.width,
      y: CARD_Y - fy(ctx.format, cardH * 0.34),
      align: 'left',
      size: MARK_SIZE,
      font: ctx.font('serif'),
      italic: true,
      color: ctx.color('accentSoft'),
      keys: mergeKeys(popIn(ctx, { at: 0, from: 0.6 }), exitOut(ctx, markD)),
      expressions: [floatY(ctx, 4, 3.8, 0)],
    })

    const quoteAt = ctx.t(0.35)
    const quoteD = Math.max(0.8, +(duration - quoteAt).toFixed(4))
    const chars = Math.max(1, quote.length)
    const lineStagger = Math.min(ctx.t(0.12), (quoteD * 0.5) / Math.max(1, Math.ceil(chars / 28)))
    parts.push({
      id: `${id}-quote`,
      kind: 'text',
      text: quote,
      at: quoteAt,
      duration: quoteD,
      x: 0.5,
      y: CARD_Y - fy(ctx.format, cardH * 0.06),
      align: 'center',
      size: QUOTE_SIZE,
      font: ctx.font('serif'),
      color: ctx.color('ink'),
      maxWidth: cardW - padX * 2,
      lineHeight: 1.3,
      reveal: { preset: 'rise', unit: 'line', stagger: Math.max(0.08, lineStagger), duration: ctx.t(0.35) },
      keys: exitOut(ctx, quoteD),
      expressions: [floatY(ctx, 3, 4.2, 0.3)],
    })

    if (attribution.length > 0) {
      const ruleAt = ctx.t(0.9)
      const ruleD = Math.max(0.5, +(duration - ruleAt).toFixed(4))
      const ruleW = 90
      parts.push({
        id: `${id}-rule`,
        kind: 'shape',
        shape: 'line',
        at: ruleAt,
        duration: ruleD,
        x: 0.5,
        y: CARD_Y + fy(ctx.format, cardH * 0.32),
        w: ruleW,
        h: 4,
        stroke: ctx.color('accent'),
        strokeWidth: 4,
        draw: drawOn(ctx, 0, 0.4),
        keys: exitOut(ctx, ruleD),
        expressions: [driftScaleX(0.03, 3, 0.4)],
      })

      const attrAt = ruleAt + ctx.t(0.4)
      const attrD = Math.max(0.4, +(duration - attrAt).toFixed(4))
      const attrY = CARD_Y + fy(ctx.format, cardH * 0.4)
      parts.push({
        id: `${id}-attribution`,
        kind: 'text',
        text: attribution,
        at: attrAt,
        duration: attrD,
        x: 0.5,
        y: attrY,
        align: 'center',
        size: ATTR_SIZE,
        font: ctx.font('sans'),
        color: ctx.color('muted'),
        keys: mergeKeys(riseIn(ctx, attrY, { at: 0 }), exitOut(ctx, attrD)),
        expressions: [driftScaleX(0.015, 3.2, 0.5)],
      })
    }

    return parts
  },
}
