/**
 * freeze (MI-P3) — stop the targets dead at `system.at`.
 *
 * For every keyed channel that still has keys at or after the freeze: keep the
 * keys before it, drop the rest, and put ONE `hold` key at the freeze whose
 * value is what the channel was at that instant. Expressions are removed (an
 * idle `floatY` would keep the "frozen" frame alive) with one `warn` per
 * channel, so the author sees what stopped.
 *
 * The value at the freeze is the engine's own segment maths in the spec's units
 * (`segmentProgress`, the sampler every renderer shares), not a linear guess:
 * a `cubic-out` segment frozen halfway holds the eased value. Spec units are
 * linear images of engine units (degrees for radians, px for a cornerRadius
 * fraction), so interpolating in them is exact. Two honest limits: time is
 * continuous seconds where the engine quantises to frames (an error under one
 * frame of motion), and the segment that ARRIVES at the frozen key keeps the
 * original curve over a shorter span, so the approach is slightly faster than
 * the unfrozen one; the held value itself is exact.
 *
 * Not touched: `enter`/`exit` presets and text `reveal` (they are applied at
 * compile time and cannot be sampled here), and an element that has not started
 * or has already ended at the freeze.
 */

import type { Keyframe } from '../../types'
import { segmentProgress } from '../../resolver/keyframes'
import { resolveCurve } from '../curves'
import type { SpecElement, SpecIssue, SpecKey } from '../types'
import type { SystemDef } from './types'
import { activeAt } from './util'

/** The value `keys` (one channel, sorted by `at`) takes at `t`, by the engine's own segment rules. */
export function sampleSpecKeys(keys: ReadonlyArray<SpecKey>, t: number): number {
  const first = keys[0]!
  if (t <= first.at) return first.value
  const last = keys[keys.length - 1]!
  if (t >= last.at) return last.value
  let i = 0
  while (i < keys.length - 1 && keys[i + 1]!.at <= t) i++
  const a = keys[i]!
  const b = keys[i + 1]!
  if (a.hold) return a.value
  const span = b.at - a.at
  const p = span > 0 ? (t - a.at) / span : 1
  const curve = resolveCurve(b.curve, '', [])
  const shape: Keyframe = { id: '', frame: 0, value: 0, easing: curve.easing, ...(curve.easingBezier ? { easingBezier: [...curve.easingBezier] as [number, number, number, number] } : {}), ...(curve.spring ? { spring: curve.spring } : {}) }
  return a.value + (b.value - a.value) * segmentProgress(shape, p)
}

/** `el` frozen at `t` seconds on its parent's clock. Returns the same object when nothing needed changing. */
function freezeElement(el: SpecElement, t: number, issues: SpecIssue[], path: string): SpecElement {
  const local = t - el.at
  if (local <= 1e-9 || local >= el.duration) return el

  let out = el
  const byChannel = new Map<string, SpecKey[]>()
  for (const k of el.keys ?? []) {
    const list = byChannel.get(k.channel)
    if (list) list.push(k)
    else byChannel.set(k.channel, [k])
  }
  const keep: SpecKey[] = []
  let changed = false
  for (const [channel, list] of byChannel) {
    const sorted = [...list].sort((a, b) => a.at - b.at)
    if (!sorted.some((k) => k.at >= local - 1e-9)) {
      keep.push(...sorted) // all behind the freeze: the last value already holds
      continue
    }
    changed = true
    keep.push(...sorted.filter((k) => k.at < local - 1e-9))
    keep.push({ channel, at: local, value: sampleSpecKeys(sorted, local), hold: true })
  }
  if (changed) out = { ...out, keys: keep }

  if (el.expressions?.length) {
    for (const e of el.expressions) {
      issues.push({ severity: 'warn', path, code: 'freeze-expression-removed', message: `freeze: the "${e.channel}" expression on "${el.id}" was removed so the frame stays frozen` })
    }
    const { expressions: _drop, ...rest } = out
    out = rest as SpecElement
  }

  if (el.children?.length) {
    const kids = el.children.map((c, i) => freezeElement(c, local, issues, `${path}.children[${i}]`))
    if (kids.some((k, i) => k !== el.children![i])) out = { ...out, children: kids }
  }
  return out
}

export const freeze: SystemDef = {
  name: 'freeze',
  hint: 'at `at`, stop every target (and what is inside a target group) exactly where it is: later keys are dropped, the value at that instant is held, expressions are removed',
  targets: true,
  template: false,
  duration: { min: 0.1, max: 60 },
  params: [],
  apply({ system, targets, ctx }) {
    const update: SpecElement[] = []
    targets.forEach((target, i) => {
      const path = `${ctx.path}.targets[${i}]`
      const frozen = freezeElement(target, system.at, ctx.issues, path)
      if (!activeAt(target, system.at)) {
        ctx.issues.push({
          severity: 'info',
          path,
          code: 'freeze-target-idle',
          message: `freeze: "${target.id}" is not on screen at ${system.at}s (it starts later or has ended); left alone`,
        })
        return
      }
      if (frozen !== target) update.push(frozen)
    })
    return { emit: [], update, remove: [] }
  },
}
