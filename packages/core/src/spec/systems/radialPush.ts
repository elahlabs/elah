/**
 * radialPush (MI-P3) — a pulse that shoves everything outward from a point.
 *
 * Each target travels along the ray from `center` through its own authored
 * position, `distance` px further out, fading as it goes. Distances are
 * measured in PIXELS and the ray is taken in pixel space, so on a portrait
 * stage a target at 45 degrees leaves at 45 degrees, not along the stage's
 * diagonal. A ring expands from the centre as the pulse itself.
 */

import type { SpecElement, SpecKey } from '../types'
import { fx, fy } from '../components/motion'
import type { SystemDef } from './types'
import { addKeys, anchorOf, boolParam, clamp, keyTime, numParam, r5, strParam } from './util'

export const radialPush: SystemDef = {
  name: 'radialPush',
  hint: 'a pulse at x,y (0..1, default centre): every target is pushed outward along the ray from there, `distance` px, fading if `fade`; a ring expands from the centre',
  targets: true,
  template: false,
  duration: { min: 0.2, max: 5 },
  params: [
    { name: 'distance', kind: 'number', default: 600, min: 50, max: 3000, unit: 'px' },
    { name: 'fade', kind: 'boolean', default: true },
    { name: 'curve', kind: 'enum', default: 'expo-out', options: ['expo-out', 'cubic-out', 'quad-out', 'smooth', 'snappy'] },
  ],
  apply({ system, params, targets, ctx }) {
    const { format } = ctx
    const center = { x: system.x ?? 0.5, y: system.y ?? 0.5 }
    const distance = numParam(params, 'distance')
    const fade = boolParam(params, 'fade')
    const curve = strParam(params, 'curve') ?? 'expo-out'
    const d = system.duration

    const update: SpecElement[] = []
    targets.forEach((target, i) => {
      const path = `${ctx.path}.targets[${i}]`
      if (target.at + target.duration <= system.at) {
        ctx.issues.push({ severity: 'warn', path, code: 'target-not-active', message: `radialPush: "${target.id}" ends before the push at ${system.at}s; left alone` })
        return
      }
      const here = anchorOf(target)
      // The ray, in px. A target sitting on the centre has no direction of its own: pick one, seeded.
      let dx = (here.x - center.x) * format.width
      let dy = (here.y - center.y) * format.height
      let len = Math.hypot(dx, dy)
      if (len < 1e-6) {
        const a = ctx.random() * Math.PI * 2
        dx = Math.cos(a)
        dy = Math.sin(a)
        len = 1
      }
      const ux = dx / len
      const uy = dy / len
      const s = keyTime(target, system.at)
      const end = r5(s + d)
      const keys: SpecKey[] = [
        { channel: 'x', at: s, value: r5(here.x) },
        { channel: 'x', at: end, value: r5(here.x + fx(format, ux * distance)), curve },
        { channel: 'y', at: s, value: r5(here.y) },
        { channel: 'y', at: end, value: r5(here.y + fy(format, uy * distance)), curve },
      ]
      if (fade) {
        keys.push({ channel: 'opacity', at: s, value: r5(target.opacity ?? 1) }, { channel: 'opacity', at: end, value: 0, curve: 'quad-in' })
      }
      update.push(addKeys(target, keys, ctx.issues, path, 'radialPush'))
    })

    // The pulse: a ring that grows from the centre to the push distance while it thins out.
    const ringPx = 120
    const toScale = clamp((distance * 2) / ringPx, 1.5, 60)
    const pulse: SpecElement = {
      id: `${system.id}-pulse`,
      kind: 'shape',
      shape: 'circle',
      name: 'Pulse',
      at: system.at,
      duration: r5(d + 0.1),
      x: r5(center.x),
      y: r5(center.y),
      w: ringPx,
      h: ringPx,
      fill: 'transparent',
      stroke: ctx.color('accent'),
      strokeWidth: 5,
      ...(system.layer !== undefined ? { layer: system.layer } : {}),
      keys: [
        { channel: 'scale', at: 0, value: 0.2 },
        { channel: 'scale', at: r5(d), value: r5(toScale), curve },
        { channel: 'opacity', at: 0, value: 1 },
        { channel: 'opacity', at: r5(d * 0.35), value: 0.9 },
        { channel: 'opacity', at: r5(d), value: 0, curve: 'quad-in' },
      ],
    }
    return { emit: [pulse], update, remove: [] }
  },
}
