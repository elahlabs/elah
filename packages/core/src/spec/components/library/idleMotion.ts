/**
 * Idle-motion expressions that avoid a channel collision.
 *
 * A spec channel holds exactly ONE source — keyframes or an expression, never
 * both (`elements/common.ts`'s `applyMotionAndKeyframes` writes `el.keys`
 * first, then `el.expressions`, and an expression on a channel that already
 * has keys REPLACES them: `channels[expr.channel] = { source: { kind:
 * 'expression' }, keys: [] }`. There is no merge). So an element whose
 * arrival is `riseIn` (keys `y` + `opacity`) cannot also take `floatY` (an
 * expression on `y`) without silently losing the rise — the expression wins
 * and the element just fades in at rest. Likewise `popIn`/`exitOut` both key
 * `scale`, so `breathe` (an expression on `scale`) cannot follow them either.
 *
 * These helpers give a component "nothing is ever perfectly still" (craft
 * rule 1) on a channel the arrival/exit keys never touch — `scaleX`/`scaleY`
 * for a `riseIn`-and-or-`popIn` element (both leave the box's two axis
 * scales alone), `rotation` for the rare element that has claimed those too
 * (e.g. `circled-phrase`'s marker sweep, which keys `scaleX` as its reveal).
 *
 * WISH for the shared toolkit (recorded in TICKET-AV-8a.md's Result): a
 * version of `floatY`/`breathe` that could sit ALONGSIDE existing keys on the
 * same channel — by adding to the keyed value every frame rather than
 * replacing the channel's source — would remove the need for this file and
 * let every component reach for one obvious idle helper instead of picking
 * between four depending on which channels its arrival already spent.
 */

import type { SpecExpression } from '../../types'

/** A faint, slow breathing pulse spread across BOTH box axes — reads as "alive" without touching `scale`, `y` or `opacity`. */
export function pulseXY(amount = 0.02, period = 3.6, phase = 0): SpecExpression[] {
  const p = +phase.toFixed(3)
  const src = `value * (1 + ${amount} * sin((t + ${p}) * 2 * PI / ${period}))`
  return [
    { channel: 'scaleX', source: src },
    { channel: 'scaleY', source: src },
  ]
}

/** The same idea on one axis only, when the other is already spoken for. */
export function driftScaleX(amount = 0.02, period = 3.6, phase = 0): SpecExpression {
  return { channel: 'scaleX', source: `value * (1 + ${amount} * sin((t + ${phase.toFixed(3)}) * 2 * PI / ${period}))` }
}

/** `driftScaleX`'s mirror, for when `scaleX` itself is the one already keyed (e.g. a marker sweep's reveal). */
export function driftScaleY(amount = 0.02, period = 3.6, phase = 0): SpecExpression {
  return { channel: 'scaleY', source: `value * (1 + ${amount} * sin((t + ${phase.toFixed(3)}) * 2 * PI / ${period}))` }
}

/** A very small rotational wobble (degrees of amplitude), written in radians for the engine — for the rare element with no scale axis left free. */
export function driftRotation(amountDeg = 1.4, period = 4.4, phase = 0): SpecExpression {
  const amp = +(amountDeg / 180).toFixed(5)
  return { channel: 'rotation', source: `value + sin((t + ${phase.toFixed(3)}) * 2 * PI / ${period}) * ${amp} * PI` }
}
