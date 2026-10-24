/**
 * clock-sweep (AV-8a) — a clock face with a sweeping hand, a drawn accent
 * arc, staggered tick marks and a couple of small dots orbiting the rim. See
 * `AV-MOTION-CRAFT.md`'s per-component table.
 *
 * What a viewer sees: a faint ring pops into place, then twelve ticks pop in
 * around it one at a time. An accent arc draws itself along the rim. A thin
 * hand pops in at the centre and immediately starts sweeping — continuously,
 * not just once — while one or two small accent dots drift around the rim on
 * their own slow orbit. An optional caption rises in below the face.
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { drawOn, exitOut, floatY, mergeKeys, popIn, riseIn, spin, staggerAt } from '../motion'
import { driftScaleX, pulseXY } from './idleMotion'

const CENTER_Y = 0.4
const FACE_RADIUS_PX = 260
const TICK_COUNT = 12
const CAPTION_SIZE = 44

export const clockSweep: ComponentDef = {
  name: 'clock-sweep',
  label: 'Clock Sweep',
  hint: 'A clock face with a continuously sweeping hand, a drawn accent arc and orbiting dots. Use for anything about time, speed, deadlines or duration.',
  duration: { min: 2.2, max: 6, default: 3.2 },
  build(component, ctx) {
    const id = component.id
    const duration = component.duration
    const caption = (component.text ?? '').trim()

    const parts: SpecElement[] = []
    const faceD = duration

    parts.push({
      id: `${id}-face`,
      kind: 'shape',
      shape: 'arc', // a partial stroke, per the craft brief's "partial circle stroke, muted"
      at: 0,
      duration: faceD,
      x: 0.5,
      y: CENTER_Y,
      w: FACE_RADIUS_PX * 2,
      h: FACE_RADIUS_PX * 2,
      stroke: ctx.color('muted'),
      strokeWidth: 6,
      opacity: 0.28,
      draw: { ...drawOn(ctx, 0, 0.6), to: 0.94 },
      keys: exitOut(ctx, faceD),
      expressions: pulseXY(0.012, 4.5, 0),
    })

    for (let i = 0; i < TICK_COUNT; i++) {
      const angle = (Math.PI * 2 * i) / TICK_COUNT - Math.PI / 2
      const cx = 0.5 + (Math.cos(angle) * (FACE_RADIUS_PX - 14)) / ctx.format.width
      const cy = CENTER_Y + (Math.sin(angle) * (FACE_RADIUS_PX - 14)) / ctx.format.height
      const at = staggerAt(ctx, ctx.t(0.15), i, 0.045)
      const d = Math.max(0.4, +(duration - at).toFixed(4))
      parts.push({
        id: `${id}-tick-${i}`,
        kind: 'shape',
        shape: 'rect',
        at,
        duration: d,
        x: cx,
        y: cy,
        rotation: (angle * 180) / Math.PI + 90,
        w: 5,
        h: 16,
        radius: 2,
        fill: ctx.color('muted'),
        keys: mergeKeys(popIn(ctx, { at: 0, from: 0.3 }), exitOut(ctx, d)),
        expressions: [driftScaleX(0.02, 2.6, i * 0.12)],
      })
    }

    const arcAt = ctx.t(0.5)
    const arcD = Math.max(0.6, +(duration - arcAt).toFixed(4))
    parts.push({
      id: `${id}-arc`,
      kind: 'shape',
      shape: 'arc',
      at: arcAt,
      duration: arcD,
      x: 0.5,
      y: CENTER_Y,
      w: FACE_RADIUS_PX * 2,
      h: FACE_RADIUS_PX * 2,
      stroke: ctx.color('accent'),
      strokeWidth: 9,
      cap: 'round',
      draw: { ...drawOn(ctx, 0, 0.9), to: 0.8 },
      keys: exitOut(ctx, arcD),
      expressions: [driftScaleX(0.01, 5, 0.3)],
    })

    const handAt = ctx.t(0.65)
    const handD = Math.max(0.6, +(duration - handAt).toFixed(4))
    parts.push({
      id: `${id}-hand`,
      kind: 'shape',
      shape: 'path',
      path: 'M 12 12 L 12 1.5',
      viewBox: { x: 0, y: 0, width: 24, height: 24 },
      at: handAt,
      duration: handD,
      x: 0.5,
      y: CENTER_Y,
      anchor: { x: 0.5, y: 0.5 },
      w: FACE_RADIUS_PX * 0.72,
      h: FACE_RADIUS_PX * 0.72,
      stroke: ctx.color('ink'),
      strokeWidth: 3,
      cap: 'round',
      keys: mergeKeys(popIn(ctx, { at: 0, from: 0.4 }), exitOut(ctx, handD)),
      // rotation is free (popIn/exitOut never touch it) — a real continuous sweep, not a one-shot key.
      expressions: [spin(38)],
    })

    const dotCount = 2
    for (let i = 0; i < dotCount; i++) {
      const at = ctx.t(0.8) + i * ctx.t(0.1)
      const d = Math.max(0.6, +(duration - at).toFixed(4))
      const period = 5 + i * 1.6
      const phase = i * Math.PI
      const radiusFracX = (FACE_RADIUS_PX + 34) / ctx.format.width
      const radiusFracY = (FACE_RADIUS_PX + 34) / ctx.format.height
      parts.push({
        id: `${id}-orbit-${i}`,
        kind: 'shape',
        shape: 'circle',
        at,
        duration: d,
        x: 0.5,
        y: CENTER_Y,
        w: 14,
        h: 14,
        fill: ctx.color('accent'),
        // x/y are free (popIn/exitOut only touch scale/opacity) — the orbit centres on the element's own static x/y.
        keys: mergeKeys(popIn(ctx, { at: 0, from: 0.3 }), exitOut(ctx, d)),
        expressions: [
          { channel: 'x', source: `value + cos(t * 2 * PI / ${period} + ${phase.toFixed(3)}) * ${radiusFracX.toFixed(5)}` },
          { channel: 'y', source: `value + sin(t * 2 * PI / ${period} + ${phase.toFixed(3)}) * ${radiusFracY.toFixed(5)}` },
        ],
      })
    }

    if (caption.length > 0) {
      const capAt = ctx.t(0.9)
      const capD = Math.max(0.5, +(duration - capAt).toFixed(4))
      const capY = CENTER_Y + (FACE_RADIUS_PX + 90) / ctx.format.height
      parts.push({
        id: `${id}-caption`,
        kind: 'text',
        text: caption,
        at: capAt,
        duration: capD,
        x: 0.5,
        y: capY,
        align: 'center',
        size: CAPTION_SIZE,
        font: ctx.font('sans'),
        color: ctx.color('ink'),
        keys: mergeKeys(riseIn(ctx, capY, { at: 0 }), exitOut(ctx, capD)),
        expressions: [driftScaleX(0.015, 3.4, 0.6)],
      })
    }

    return parts
  },
}
