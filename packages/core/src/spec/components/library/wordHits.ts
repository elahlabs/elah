/**
 * word-hits (AV-8a) — single words punching in one after another, each
 * holding its reading time and exiting up-and-out as the next one lands. See
 * `AV-MOTION-CRAFT.md`'s per-component table.
 *
 * What a viewer sees: one huge word slams in with a bounce, sits, then flicks
 * up and away as the next word bounces in over the last 150 ms of its exit —
 * a punchy, unbroken sequence, never a gap. A faint accent ring pulses behind
 * each hit. `serif` items italicise in the serif face; `accent` items take
 * the accent colour; items with no style alternate automatically so a plain
 * word list still reads as designed, not dumped.
 */

import type { SpecElement, SpecKey } from '../../types'
import type { ComponentContext, ComponentDef, ComponentItem } from '../types'
import { EXIT_SEC, exitOut, fy, mergeKeys, popIn } from '../motion'
import { driftScaleX, pulseXY } from './idleMotion'

const WORD_SIZE = 140
const RING_SIZE = 320
const MIN_SLOT_SEC = 0.5
/** How far a word travels on its way out, stage px. */
const EXIT_TRAVEL_PX = 60

type Style = 'ink' | 'serif' | 'accent'

function styleFor(item: ComponentItem, i: number): Style {
  if (item.style === 'serif' || item.style === 'accent') return item.style
  return i % 2 === 0 ? 'ink' : 'accent'
}

/** The word's own exit: up-and-out, quicker than the arrival, easing in — `exitOut`'s curve, plus a rise. */
function exitUp(ctx: ComponentContext, endAt: number, baseY: number): SpecKey[] {
  const d = ctx.t(EXIT_SEC)
  const at = Math.max(0, endAt - d)
  const travel = fy(ctx.format, EXIT_TRAVEL_PX)
  return [
    { channel: 'y', at, value: baseY },
    { channel: 'y', at: endAt, value: baseY - travel, curve: 'quad-in' },
  ]
}

export const wordHits: ComponentDef = {
  name: 'word-hits',
  label: 'Word Hits',
  hint: 'A rapid sequence of single huge words, each punching in and flicking away as the next lands. High energy, high density for a beat that needs impact, not explanation.',
  items: { min: 1, max: 8, hint: 'One word or very short phrase per item; set style "serif" or "accent" to break the alternation.' },
  duration: { min: 1.2, max: 12, default: 4 },
  build(component, ctx) {
    const id = component.id
    const duration = component.duration
    const items = (component.items ?? []).slice(0, 8).filter((it) => (it.text ?? '').trim().length > 0)
    if (items.length === 0) {
      ctx.issues.push({ severity: 'warn', path: ctx.path, code: 'no-items', message: 'word-hits has no items with text; nothing to show' })
      return []
    }

    const n = items.length
    const overlap = ctx.t(0.15)
    const slot = Math.max(duration / n, MIN_SLOT_SEC)
    const baseY = 0.46

    const parts: SpecElement[] = []
    items.forEach((item, i) => {
      const word = (item.text ?? '').trim()
      const at = Math.max(0, i === 0 ? 0 : i * slot - overlap)
      const rawEnd = i === n - 1 ? duration : Math.min(duration, (i + 1) * slot)
      const end = Math.max(at + MIN_SLOT_SEC, rawEnd)
      const d = +(end - at).toFixed(4)
      const style = styleFor(item, i)

      const ringId = `${id}-ring-${i}`
      const wordId = `${id}-word-${i}`

      parts.push({
        id: ringId,
        kind: 'shape',
        shape: 'circle',
        at,
        duration: d,
        x: 0.5,
        y: baseY,
        w: RING_SIZE,
        h: RING_SIZE,
        fill: 'transparent',
        stroke: ctx.color('accentSoft'),
        strokeWidth: 5,
        layer: (component.layer ?? 0) - 1,
        opacity: 0,
        // popIn+exitOut both key `scale`, so the pulse lives on scaleX/scaleY instead (see idleMotion.ts).
        keys: mergeKeys(popIn(ctx, { at: 0, from: 0.7 }), exitOut(ctx, d)),
        expressions: pulseXY(0.08, 1.5, i * 0.2),
      })

      parts.push({
        id: wordId,
        kind: 'text',
        text: word,
        at,
        duration: d,
        x: 0.5,
        y: baseY,
        align: 'center',
        size: WORD_SIZE,
        italic: style === 'serif',
        font: style === 'serif' ? ctx.font('serif') : ctx.font('display'),
        color: style === 'accent' ? ctx.color('accent') : ctx.color('ink'),
        // scale and y are both spoken for (popIn/exitOut, exitUp); idle life lives on scaleX.
        keys: mergeKeys(popIn(ctx, { at: 0, from: 0.6 }), exitOut(ctx, d), exitUp(ctx, d, baseY)),
        expressions: [driftScaleX(0.015, 2.2, i * 0.15)],
      })
    })

    return parts
  },
}
