/**
 * crossMorph (MI-P3) — one element becomes another: a card turning into its icon.
 *
 * Always a crossfade with a small scale hand-off, so any pair reads. When BOTH
 * ends are `path` shapes with the same `viewBox`, `from` also carries a
 * `pathMorph` field; `lowering.ts` turns it into two `shape.path` keys on the
 * compiled `from` clip (its own path, then `to`'s). The two paths only tween
 * well if they share a command structure, which the renderer does not promise:
 * that is why `to` still fades in itself, so an unreconcilable pair degrades to
 * the crossfade instead of a mangled shape.
 *
 * Both opacity ramps use the same symmetric curve, so at `at + duration / 2`
 * the two are exactly equal (0.5 / 0.5).
 */

import type { SpecElement, SpecKey } from '../types'
import type { SystemDef } from './types'
import { addKeys, keyTime, r5, strParam } from './util'

const SHRUNK = 0.85

const sameViewBox = (a: SpecElement['viewBox'], b: SpecElement['viewBox']): boolean =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

export const crossMorph: SystemDef = {
  name: 'crossMorph',
  hint: 'element `from` becomes element `to` (both siblings): from fades and shrinks out while to fades and grows in; two path shapes with the same viewBox also morph their outline',
  targets: false,
  template: false,
  duration: { min: 0.2, max: 5 },
  params: [
    { name: 'from', kind: 'id', default: undefined },
    { name: 'to', kind: 'id', default: undefined },
  ],
  apply({ system, params, level, ctx }) {
    const none = { emit: [], update: [], remove: [] }
    const fromId = strParam(params, 'from')
    const toId = strParam(params, 'to')
    let bad = false
    for (const [name, id] of [['from', fromId], ['to', toId]] as const) {
      if (id === undefined) {
        ctx.issues.push({ severity: 'error', path: `${ctx.path}.params`, code: 'missing-param', message: `crossMorph needs a "${name}" param naming an element` })
        bad = true
      }
    }
    if (bad) return none
    if (fromId === toId) {
      ctx.issues.push({ severity: 'error', path: `${ctx.path}.params`, code: 'bad-param', message: 'crossMorph: from and to must be different elements' })
      return none
    }
    const from = level.find((e) => e.id === fromId)
    const to = level.find((e) => e.id === toId)
    for (const [name, id, el] of [['from', fromId, from], ['to', toId, to]] as const) {
      if (!el) {
        ctx.issues.push({ severity: 'error', path: `${ctx.path}.params`, code: 'unknown-target', message: `crossMorph ${name}: no element "${String(id)}" at this level` })
        bad = true
      }
    }
    if (bad || !from || !to) return none

    const d = system.duration
    const morph = from.shape === 'path' && to.shape === 'path' && !!from.path && !!to.path && sameViewBox(from.viewBox, to.viewBox)

    const fromStart = keyTime(from, system.at)
    const fromRest = from.scale ?? 1
    const fromKeys: SpecKey[] = [
      { channel: 'opacity', at: fromStart, value: r5(from.opacity ?? 1) },
      { channel: 'opacity', at: r5(fromStart + d), value: 0, curve: 'quad-in-out' },
      { channel: 'scale', at: fromStart, value: r5(fromRest) },
      { channel: 'scale', at: r5(fromStart + d), value: r5(fromRest * SHRUNK), curve: 'quad-in' },
    ]

    const toStart = keyTime(to, system.at)
    const toRest = to.scale ?? 1
    const toKeys: SpecKey[] = [
      { channel: 'opacity', at: toStart, value: 0 },
      { channel: 'opacity', at: r5(toStart + d), value: r5(to.opacity ?? 1), curve: 'quad-in-out' },
    ]
    if (!morph) {
      toKeys.push({ channel: 'scale', at: toStart, value: r5(toRest * SHRUNK) }, { channel: 'scale', at: r5(toStart + d), value: r5(toRest), curve: 'cubic-out' })
    }

    const out = addKeys(from, fromKeys, ctx.issues, `${ctx.path}.params`, 'crossMorph')
    const update: SpecElement[] = [
      morph ? ({ ...out, pathMorph: { to: to.id, at: fromStart, duration: d } } as SpecElement) : out,
      addKeys(to, toKeys, ctx.issues, `${ctx.path}.params`, 'crossMorph'),
    ]
    return { emit: [], update, remove: [] }
  },
}
