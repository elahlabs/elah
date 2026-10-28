/**
 * logo-outro (AV-8a) — a wordmark pop, an expanding accent ring, a radial
 * dot burst and a tagline underneath. See `AV-MOTION-CRAFT.md`'s
 * per-component table.
 *
 * What a viewer sees: the wordmark pops in at the centre. An accent ring
 * draws itself around it, then keeps expanding outward while fading to
 * nothing. A handful of small dots burst outward from the centre and fade as
 * they go. A tagline rises in underneath. The wordmark and tagline then hold
 * — per the brief, this component ends the piece, so nothing on the main
 * content exits; only the ring and the dot burst, which are one-shot
 * flourishes, animate all the way to invisible.
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { drawOn, floatY, popIn, riseIn } from '../motion'
import { driftScaleX } from './idleMotion'
import { estTextWidth } from './textMetrics'

const WORDMARK_SIZE = 104
const TAGLINE_SIZE = 40
const WORDMARK_Y = 0.46

export const logoOutro: ComponentDef = {
  name: 'logo-outro',
  label: 'Logo Outro',
  hint: 'A wordmark pop with an expanding accent ring, a radial dot burst and a tagline. The closing beat of a piece — it holds at the end rather than exiting.',
  duration: { min: 1.8, max: 5, default: 2.6 },
  build(component, ctx) {
    const id = component.id
    const duration = component.duration
    const wordmark = (component.text ?? '').trim()
    const tagline = (component.sub ?? '').trim()

    const parts: SpecElement[] = []

    // The wordmark pops in and HOLDS — no exit; this component ends the piece.
    parts.push({
      id: `${id}-wordmark`,
      kind: 'text',
      text: wordmark,
      at: 0,
      duration,
      x: 0.5,
      y: WORDMARK_Y,
      align: 'center',
      size: WORDMARK_SIZE,
      // No explicit weight: bebas-neue (the default `display` role) ships one weight only.
      font: ctx.font('display'),
      color: ctx.color('ink'),
      keys: popIn(ctx, { at: 0, from: 0.5 }),
      expressions: [floatY(ctx, 3, 4, 0)],
    })

    const markWidthPx = Math.max(120, estTextWidth(wordmark, WORDMARK_SIZE))
    const ringSize = markWidthPx * 0.9
    const ringAt = ctx.t(0.15)
    const ringD = Math.max(0.6, +(duration - ringAt).toFixed(4))
    const expandStart = ctx.t(0.5)
    parts.push({
      id: `${id}-ring`,
      kind: 'shape',
      shape: 'circle',
      at: ringAt,
      duration: ringD,
      x: 0.5,
      y: WORDMARK_Y,
      w: ringSize,
      h: ringSize,
      fill: 'transparent',
      stroke: ctx.color('accent'),
      strokeWidth: 5,
      layer: (component.layer ?? 0) - 1,
      draw: drawOn(ctx, 0, 0.5),
      // Its own "exit": keeps growing while it fades, rather than the usual shrink-and-fade.
      keys: [
        { channel: 'scale', at: expandStart, value: 1 },
        { channel: 'scale', at: ringD, value: 1.5, curve: 'cubic-out' },
        { channel: 'opacity', at: expandStart, value: 1 },
        { channel: 'opacity', at: ringD, value: 0, curve: 'quad-in' },
      ],
    })

    const burstCount = 8
    const burstAt = ctx.t(0.35)
    const burstD = Math.max(0.5, +(duration - burstAt).toFixed(4))
    const burstTravel = ctx.t(0.55)
    for (let i = 0; i < burstCount; i++) {
      const angle = (Math.PI * 2 * i) / burstCount + ctx.random() * 0.3
      const radius = ringSize * 0.62
      const dx = (Math.cos(angle) * radius) / ctx.format.width
      const dy = (Math.sin(angle) * radius) / ctx.format.height
      parts.push({
        id: `${id}-burst-${i}`,
        kind: 'shape',
        shape: 'circle',
        at: burstAt,
        duration: burstD,
        x: 0.5,
        y: WORDMARK_Y,
        w: 12,
        h: 12,
        fill: ctx.color('accent'),
        // A one-shot radial burst: x/y key OUT from the centre while opacity fades — its own arrival and exit at once.
        keys: [
          { channel: 'x', at: 0, value: 0.5 },
          { channel: 'x', at: burstTravel, value: 0.5 + dx, curve: 'cubic-out' },
          { channel: 'y', at: 0, value: WORDMARK_Y },
          { channel: 'y', at: burstTravel, value: WORDMARK_Y + dy, curve: 'cubic-out' },
          { channel: 'opacity', at: 0, value: 1 },
          { channel: 'opacity', at: burstTravel, value: 1 },
          { channel: 'opacity', at: burstD, value: 0, curve: 'quad-in' },
          { channel: 'scale', at: 0, value: 0.4 },
          { channel: 'scale', at: burstTravel * 0.6, value: 1, curve: 'spring:bouncy' },
        ],
      })
    }

    if (tagline.length > 0) {
      const tagAt = ctx.t(0.75)
      const tagD = Math.max(0.5, +(duration - tagAt).toFixed(4))
      const tagY = WORDMARK_Y + 0.06
      parts.push({
        id: `${id}-tagline`,
        kind: 'text',
        text: tagline,
        at: tagAt,
        duration: tagD,
        x: 0.5,
        y: tagY,
        align: 'center',
        size: TAGLINE_SIZE,
        font: ctx.font('sans'),
        color: ctx.color('muted'),
        letterSpacing: 2,
        // Also holds, per the brief — the tagline is part of the same clean ending as the wordmark.
        keys: riseIn(ctx, tagY, { at: 0 }),
        expressions: [driftScaleX(0.015, 3.6, 0.2)],
      })
    }

    return parts
  },
}
