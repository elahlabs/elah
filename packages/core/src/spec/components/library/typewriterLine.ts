/**
 * typewriter-line (AV-8a) — a line that types itself in, with a blinking
 * caret at the end and an optional larger, near-invisible "ghost" word
 * breathing behind it. See `AV-MOTION-CRAFT.md`'s per-component table.
 *
 * What a viewer sees: (optionally) a big pale ghost word breathes faintly
 * behind everything from the start. The line types itself in character by
 * character. The instant it finishes, a thin caret pops in beside the last
 * character and blinks there until the beat ends, when caret, line and ghost
 * all fade together.
 *
 * Channel note: a spec channel holds keys OR an expression, never both (see
 * `idleMotion.ts`'s doc comment), so every idle expression below lives on
 * `scaleX`/`scaleY` rather than `scale`, which `exitOut` already keys on
 * every part here. The caret's blink is a SELF-CONTAINED opacity expression
 * (fade-in envelope × blink × fade-out envelope, built from `t`/`duration`)
 * rather than a mix of opacity keys and an opacity expression — the second
 * would silently discard the first (the expression replaces the channel).
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { exitOut, mergeKeys, popIn } from '../motion'
import { pulseXY } from './idleMotion'
import { estTextWidth } from './textMetrics'

const LINE_SIZE = 72
const GHOST_SIZE = 220
const CARET_W = 10
const LEFT_MARGIN_FRAC = 0.08
const LINE_Y = 0.48

export const typewriterLine: ComponentDef = {
  name: 'typewriter-line',
  label: 'Typewriter Line',
  hint: 'One line that types itself in with a blinking caret, optionally over a huge faint "ghost" word breathing behind it. Good for a single sharp statement.',
  duration: { min: 1.4, max: 5, default: 2.6 },
  build(component, ctx) {
    const id = component.id
    const duration = component.duration
    const text = (component.text ?? '').trim()
    const chars = Math.max(1, text.length)

    const parts: SpecElement[] = []

    if (component.sub && component.sub.trim().length > 0) {
      const at = 0
      const d = duration
      parts.push({
        id: `${id}-ghost`,
        kind: 'text',
        text: component.sub.trim(),
        at,
        duration: d,
        x: 0.5,
        y: LINE_Y,
        align: 'center',
        size: GHOST_SIZE,
        font: ctx.font('display'),
        color: ctx.color('muted'),
        opacity: 0,
        layer: (component.layer ?? 0) - 1,
        keys: mergeKeys([{ channel: 'opacity', at: 0, value: 0 }, { channel: 'opacity', at: ctx.t(0.5), value: 0.12, curve: 'cubic-out' }], exitOut(ctx, d)),
        expressions: pulseXY(0.03, 4.5, 0),
      })
    }

    // Typing speed: energy-scaled seconds per character, budgeted against the beat.
    const perChar = Math.min(ctx.t(0.06), (duration * 0.55) / chars)
    const typeStagger = Math.max(0.015, perChar)
    const typeUnitDuration = Math.max(0.03, typeStagger * 0.8)
    const typingTotal = typeStagger * Math.max(0, chars - 1) + typeUnitDuration

    const lineAt = 0
    const lineD = duration
    parts.push({
      id: `${id}-line`,
      kind: 'text',
      text,
      at: lineAt,
      duration: lineD,
      x: LEFT_MARGIN_FRAC,
      y: LINE_Y,
      align: 'left',
      anchor: { x: 0, y: 0.5 },
      size: LINE_SIZE,
      font: ctx.font('mono'),
      color: ctx.color('ink'),
      reveal: { preset: 'typewriter', unit: 'char', stagger: typeStagger, duration: typeUnitDuration },
      keys: exitOut(ctx, lineD),
      expressions: pulseXY(0.006, 5, 0),
    })

    const caretAt = Math.min(duration - 0.3, typingTotal)
    const caretD = Math.max(0.3, +(duration - caretAt).toFixed(4))
    const caretX = LEFT_MARGIN_FRAC + estTextWidth(text, LINE_SIZE) / ctx.format.width
    const fadeIn = Math.min(ctx.t(0.12), caretD * 0.3)
    const fadeOut = Math.min(ctx.t(0.18), caretD * 0.3)
    parts.push({
      id: `${id}-caret`,
      kind: 'shape',
      shape: 'rect',
      at: caretAt,
      duration: caretD,
      x: caretX,
      y: LINE_Y,
      anchor: { x: 0, y: 0.5 },
      w: CARET_W,
      h: LINE_SIZE * 0.9,
      fill: ctx.color('accent'),
      // Scale is the arrival (a quick pop); opacity is a self-contained
      // fade-in * blink * fade-out envelope — see the file doc comment for why
      // these cannot both be keys on the same channel as a blink expression.
      keys: popIn(ctx, { at: 0, from: 0.4, duration: ctx.t(0.15) }).filter((k) => k.channel === 'scale'),
      expressions: [
        {
          channel: 'opacity',
          source: `smoothstep(0, ${fadeIn.toFixed(3)}, t) * smoothstep(${caretD.toFixed(3)}, ${(caretD - fadeOut).toFixed(3)}, t) * pulse(t, 0.55, 0.5)`,
        },
      ],
    })

    return parts
  },
}
