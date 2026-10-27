/**
 * arrange (MI-P3) — targets snap into a layout, one after another, on a spring.
 *
 * Slots are computed from each target's BOX (`w`/`h` px, else 120): a grid's
 * cell is the biggest box plus `gap`, so nothing overlaps. A text element has no
 * box here (its width needs a `TextMeasurer`, which a pure spec pass does not
 * have), so text targets are laid on the default cell; wrap text in a sized
 * shape or group first, or set `w`/`h`.
 *
 * Positions are the element's anchor in stage fractions. `from: scatter` starts
 * the targets at seeded positions inside the stage margin, so the snap is a
 * gather; `from: authored` (default) starts where the author put them.
 */

import type { SpecElement, SpecFormat, SpecKey } from '../types'
import { fx, fy } from '../components/motion'
import { SPRING_PRESETS } from '../../elements/springPresets'
import type { SystemDef } from './types'
import { addKeys, anchorOf, boolParam, keyTime, numParam, r5, strParam } from './util'

/** The cell a target without a `w`/`h` is given. */
const DEFAULT_BOX = 120

export interface Slot {
  x: number
  y: number
}

/** Slot centres, in stage fractions, for `n` boxes of at most `cellW` x `cellH` px. Exposed for tests. */
export function layoutSlots(
  layout: string,
  n: number,
  cell: { w: number; h: number },
  opts: { origin: { x: number; y: number }; format: SpecFormat; cols: number; gap: number; radius: number },
): Slot[] {
  const { origin, format, gap } = opts
  const slots: Slot[] = []
  if (layout === 'ring') {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(1, n)
      slots.push({ x: origin.x + fx(format, Math.cos(a) * opts.radius), y: origin.y + fy(format, Math.sin(a) * opts.radius) })
    }
    return slots
  }
  const cols = layout === 'row' ? n : Math.max(1, Math.min(n, Math.round(opts.cols)))
  const rows = Math.ceil(n / cols)
  const pitchX = cell.w + gap
  const pitchY = cell.h + gap
  for (let i = 0; i < n; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    slots.push({
      x: origin.x + fx(format, (col - (cols - 1) / 2) * pitchX),
      y: origin.y + fy(format, (row - (rows - 1) / 2) * pitchY),
    })
  }
  return slots
}

export const arrange: SystemDef = {
  name: 'arrange',
  hint: 'targets snap into a layout around x,y (0..1, default centre) on a spring, staggered; a grid reads left to right, top to bottom in the order of `targets`',
  targets: true,
  template: false,
  duration: { min: 0.2, max: 10 },
  params: [
    { name: 'layout', kind: 'enum', default: 'grid', options: ['grid', 'ring', 'row'] },
    { name: 'cols', kind: 'number', default: 3, min: 1, max: 12 },
    { name: 'gap', kind: 'number', default: 40, min: 0, max: 400, unit: 'px' },
    { name: 'radius', kind: 'number', default: 320, min: 40, max: 2000, unit: 'px' },
    { name: 'spring', kind: 'enum', default: 'snappy', options: SPRING_PRESETS.map((p) => p.id) },
    { name: 'stagger', kind: 'number', default: 0.07, min: 0, max: 0.5, unit: 's' },
    { name: 'from', kind: 'enum', default: 'authored', options: ['authored', 'scatter'] },
    { name: 'settle', kind: 'boolean', default: true },
  ],
  apply({ system, params, targets, ctx }) {
    const { format } = ctx
    const origin = { x: system.x ?? 0.5, y: system.y ?? 0.5 }
    const cell = {
      w: Math.max(DEFAULT_BOX, ...targets.map((t) => t.w ?? 0)),
      h: Math.max(DEFAULT_BOX, ...targets.map((t) => t.h ?? 0)),
    }
    const slots = layoutSlots(strParam(params, 'layout') ?? 'grid', targets.length, cell, {
      origin,
      format,
      cols: numParam(params, 'cols'),
      gap: numParam(params, 'gap'),
      radius: numParam(params, 'radius'),
    })
    const curve = `spring:${strParam(params, 'spring') ?? 'snappy'}`
    const scatter = strParam(params, 'from') === 'scatter'
    const settle = boolParam(params, 'settle')
    const stagger = numParam(params, 'stagger')

    const update: SpecElement[] = []
    targets.forEach((target, i) => {
      const path = `${ctx.path}.targets[${i}]`
      const slot = slots[i]!
      const here = anchorOf(target)
      const start = scatter ? { x: 0.1 + ctx.random() * 0.8, y: 0.1 + ctx.random() * 0.8 } : here
      const s = keyTime(target, system.at + i * stagger)
      const end = r5(s + system.duration)
      const keys: SpecKey[] = [
        { channel: 'x', at: s, value: r5(start.x) },
        { channel: 'x', at: end, value: r5(slot.x), curve },
        { channel: 'y', at: s, value: r5(start.y) },
        { channel: 'y', at: end, value: r5(slot.y), curve },
      ]
      if (settle) {
        const rest = target.scale ?? 1
        keys.push({ channel: 'scale', at: s, value: r5(rest * 0.9) }, { channel: 'scale', at: end, value: r5(rest), curve })
      }
      // The first key holds before it, so a scattered element waits at its scattered start until its turn.
      update.push(addKeys(target, keys, ctx.issues, path, 'arrange'))
    })
    return { emit: [], update, remove: [] }
  },
}
