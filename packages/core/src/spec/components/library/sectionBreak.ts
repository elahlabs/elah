/**
 * section-break (AV-8a) — a full-frame accent wipe carrying one word across
 * the screen, used between acts. See `AV-MOTION-CRAFT.md`'s per-component
 * table.
 *
 * What a viewer sees: a solid accent panel sweeps in from off-frame left,
 * covers the whole picture for an instant with one word riding along it in
 * background colour, and continues out to the right — 0.6-1.0 s total, the
 * shortest and simplest component in the library. It never stops moving for
 * even a frame, so — unlike every other component here — it gets no
 * float/breathe idle expression: there is no moment for it to hold still in.
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'

const PANEL_W_FACTOR = 1.3
const WORD_SIZE = 68

export const sectionBreak: ComponentDef = {
  name: 'section-break',
  label: 'Section Break',
  hint: 'A full-frame accent panel that wipes across carrying one word, used to cut cleanly between acts. Short — under a second.',
  duration: { min: 0.5, max: 1.2, default: 0.8 },
  build(component, ctx) {
    const id = component.id
    const duration = component.duration
    const word = (component.text ?? '').trim()

    const arriveAt = duration * 0.42
    const panelW = ctx.format.width * PANEL_W_FACTOR
    const offLeft = -0.5 - PANEL_W_FACTOR / 2
    const offRight = 1.5 + PANEL_W_FACTOR / 2

    const xKeys: SpecElement['keys'] = [
      { channel: 'x', at: 0, value: offLeft },
      { channel: 'x', at: arriveAt, value: 0.5, curve: 'cubic-out' },
      { channel: 'x', at: duration, value: offRight, curve: 'quad-in' },
    ]

    return [
      {
        id: `${id}-panel`,
        kind: 'shape',
        shape: 'rect',
        at: 0,
        duration,
        x: offLeft,
        y: 0.5,
        w: panelW,
        h: ctx.format.height,
        fill: ctx.color('accent'),
        keys: xKeys,
      },
      {
        id: `${id}-word`,
        kind: 'text',
        text: word,
        at: 0,
        duration,
        x: offLeft,
        y: 0.5,
        align: 'center',
        size: WORD_SIZE,
        weight: 700,
        font: ctx.font('sans'),
        color: ctx.color('bg'),
        keys: xKeys.map((k) => ({ ...k })),
      },
    ]
  },
}
