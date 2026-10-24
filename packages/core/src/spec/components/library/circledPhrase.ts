/**
 * circled-phrase (AV-8a) — a lead-in phrase types in muted, then the real
 * phrase pops in bold and gets circled, underlined or marker-swept. See
 * `AV-MOTION-CRAFT.md`'s per-component table.
 *
 * What a viewer sees: a small muted line types itself in above ("she said:"),
 * then the phrase itself pops in bold and large. A third of a second later,
 * hand-drawn decoration reveals around it — a wobbly circle, a scribbled
 * underline, or a flat accent rect sweeping in from the left behind the
 * words. The `circle` variant finishes with a little burst of accent dots
 * where the loop closes.
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { drawOn, exitOut, floatY, fy, handEllipsePath, mergeKeys, popIn, underlinePath } from '../motion'
import { driftScaleY, pulseXY } from './idleMotion'
import { estTextWidth } from './textMetrics'

const LEAD_SIZE = 36
const PHRASE_SIZE = 84
const PHRASE_Y = 0.48
const LEAD_Y = 0.36

export const circledPhrase: ComponentDef = {
  name: 'circled-phrase',
  label: 'Circled Phrase',
  hint: 'A short phrase that pops in and then gets hand-drawn attention: a wobbly circle, a scribbled underline, or an accent marker sweep. Use to call out one phrase inside a beat.',
  variants: ['circle', 'underline', 'marker'],
  duration: { min: 1.8, max: 5, default: 2.8 },
  build(component, ctx) {
    const id = component.id
    const duration = component.duration
    const variant = (component.variant ?? 'circle') as 'circle' | 'underline' | 'marker'
    const phrase = (component.text ?? '').trim()
    const lead = (component.sub ?? '').trim()

    const parts: SpecElement[] = []
    let phraseDelay = 0

    if (lead.length > 0) {
      const chars = Math.max(1, lead.length)
      const stagger = Math.min(ctx.t(0.045), (duration * 0.3) / chars)
      parts.push({
        id: `${id}-lead`,
        kind: 'text',
        text: lead,
        at: 0,
        duration,
        x: 0.5,
        y: LEAD_Y,
        align: 'center',
        size: LEAD_SIZE,
        font: ctx.font('sans'),
        color: ctx.color('muted'),
        reveal: { preset: 'typewriter', unit: 'char', stagger, duration: Math.max(0.03, stagger * 0.8) },
        keys: exitOut(ctx, duration),
        expressions: pulseXY(0.02, 4, 0),
      })
      phraseDelay = ctx.t(0.5)
    }

    const phraseAt = phraseDelay
    const phraseD = Math.max(0.6, +(duration - phraseAt).toFixed(4))
    parts.push({
      id: `${id}-phrase`,
      kind: 'text',
      text: phrase,
      at: phraseAt,
      duration: phraseD,
      x: 0.5,
      y: PHRASE_Y,
      align: 'center',
      size: PHRASE_SIZE,
      weight: 700, // Inter's heaviest static weight
      font: ctx.font('sans'),
      color: ctx.color('ink'),
      keys: mergeKeys(popIn(ctx, { at: 0, from: 0.55 }), exitOut(ctx, phraseD)),
      expressions: [floatY(ctx, 4, 3.4, 0)],
    })

    const phraseWidthPx = Math.max(80, estTextWidth(phrase, PHRASE_SIZE))
    const decoAt = phraseAt
    const decoD = phraseD
    const drawAt = ctx.t(0.3)
    const drawDuration = 0.7

    if (variant === 'circle') {
      const loopW = phraseWidthPx * 1.28
      const loopH = PHRASE_SIZE * 2.1
      parts.push({
        id: `${id}-loop`,
        kind: 'shape',
        shape: 'path',
        path: handEllipsePath(ctx.random),
        viewBox: { x: 0, y: 0, width: 100, height: 40 },
        at: decoAt,
        duration: decoD,
        x: 0.5,
        y: PHRASE_Y,
        w: loopW,
        h: loopH,
        stroke: ctx.color('accent'),
        strokeWidth: 8,
        cap: 'round',
        draw: drawOn(ctx, drawAt, drawDuration),
        keys: exitOut(ctx, decoD),
        expressions: [floatY(ctx, 4, 3.6, 0.2)],
      })

      // Global time (from the component's own start), not local to the loop element.
      const burstAt = decoAt + drawAt + ctx.t(drawDuration)
      const burstCount = 4
      for (let i = 0; i < burstCount; i++) {
        const angle = (Math.PI * 2 * i) / burstCount + ctx.random() * 0.4
        const radius = loopW * 0.5 + 26
        const dx = (Math.cos(angle) * radius) / ctx.format.width
        const dy = (Math.sin(angle) * radius) / ctx.format.height
        const dAt = Math.min(burstAt, Math.max(0, duration - 0.4))
        const dD = Math.max(0.4, +(duration - dAt).toFixed(4))
        parts.push({
          id: `${id}-burst-${i}`,
          kind: 'shape',
          shape: 'circle',
          at: dAt,
          duration: dD,
          x: 0.5 + dx,
          y: PHRASE_Y + dy,
          w: 16,
          h: 16,
          fill: ctx.color('accent'),
          keys: mergeKeys(popIn(ctx, { at: 0, from: 0.2 }), exitOut(ctx, dD)),
          expressions: [driftScaleY(0.03, 2.4, i * 0.2)],
        })
      }
    } else if (variant === 'underline') {
      const lineW = phraseWidthPx * 1.1
      parts.push({
        id: `${id}-underline`,
        kind: 'shape',
        shape: 'path',
        path: underlinePath(ctx.random),
        viewBox: { x: 0, y: 0, width: 100, height: 12 },
        at: decoAt,
        duration: decoD,
        x: 0.5,
        y: PHRASE_Y + fy(ctx.format, PHRASE_SIZE * 0.62),
        w: lineW,
        h: PHRASE_SIZE * 0.14,
        stroke: ctx.color('accent'),
        strokeWidth: 7,
        cap: 'round',
        draw: drawOn(ctx, drawAt, drawDuration),
        keys: exitOut(ctx, decoD),
        expressions: [floatY(ctx, 4, 3.6, 0.2)],
      })
    } else {
      const markerW = phraseWidthPx * 1.16
      const markerH = PHRASE_SIZE * 1.35
      const sweepD = ctx.t(0.45)
      parts.push({
        id: `${id}-marker`,
        kind: 'shape',
        shape: 'rect',
        at: decoAt,
        duration: decoD,
        x: 0.5 - phraseWidthPx * 0.58 / ctx.format.width,
        y: PHRASE_Y,
        anchor: { x: 0, y: 0.5 },
        w: markerW,
        h: markerH,
        radius: 10,
        fill: ctx.color('accentSoft'),
        layer: (component.layer ?? 0) - 1,
        keys: mergeKeys(
          [
            { channel: 'scaleX', at: 0, value: 0 },
            { channel: 'scaleX', at: sweepD, value: 1, curve: 'cubic-out' },
          ],
          exitOut(ctx, decoD),
        ),
        // scaleX is the reveal itself; idle life lives on scaleY instead (see idleMotion.ts).
        expressions: [driftScaleY(0.02, 3.4, 0.2)],
      })
    }

    return parts
  },
}
