/**
 * camera (MI-P3) — one virtual camera over a set of elements.
 *
 * The targets move into a `group` that spans their union in time; the camera
 * move is keys on the GROUP (its transform pivots on the stage centre), so every
 * target is moved as one frame and keeps its own keys. Children are re-timed
 * relative to the group; their positions are stage fractions and do not change.
 *
 *   push     scale 1 -> 1 + amount, slow and smooth         (`cameraPush`)
 *   zoomOut  scale 1 + amount -> 1: starts tight, pulls back to the full frame
 *   pan      x 0.5 -> 0.5 - amount (content slides left for amount > 0)
 *   whip     a fast pan, with a gaussian-blur radius peaking mid-move (`blur` px)
 *
 * References between a target and an element that is NOT moved with it (an
 * `anchorTo`, a `clip("id")`) stop resolving, because a reference only reaches
 * the same nesting level; name every element that points at each other.
 */

import type { SpecElement, SpecKey } from '../types'
import { cameraPush } from '../components/motion'
import type { SpecFxKey, SystemDef } from './types'
import { clamp, numParam, r5, strParam } from './util'

export const camera: SystemDef = {
  name: 'camera',
  hint: 'wraps targets in one group and moves it like a camera: push (slow zoom in), zoomOut (starts tight, pulls back to full frame), pan (slide, amount < 0 to go the other way), whip (fast pan with a blur peak); amount is a zoom fraction for push/zoomOut and stage widths for pan/whip',
  targets: true,
  template: false,
  duration: { min: 0.1, max: 30 },
  params: [
    { name: 'move', kind: 'enum', default: 'push', options: ['push', 'pan', 'zoomOut', 'whip'] },
    { name: 'amount', kind: 'number', default: 0.12, min: -1, max: 1 },
    { name: 'blur', kind: 'number', default: 40, min: 0, max: 100, unit: 'px' },
  ],
  apply({ system, params, targets }) {
    if (targets.length === 0) return { emit: [], update: [], remove: [] }
    const move = strParam(params, 'move') ?? 'push'
    const amount = numParam(params, 'amount')
    const blur = numParam(params, 'blur')

    const start = Math.min(...targets.map((t) => t.at))
    const end = Math.max(...targets.map((t) => t.at + t.duration))
    const s = clamp(r5(system.at - start), 0, Math.max(0, end - start))
    const d = system.duration
    const layers = targets.map((t) => t.layer ?? 0)

    let keys: SpecKey[] = []
    let fxKeys: SpecFxKey[] | undefined
    let effects: SpecElement['effects']
    if (move === 'push') {
      keys = cameraPush(d, amount).map((k) => ({ ...k, at: r5(k.at + s), value: r5(k.value) }))
    } else if (move === 'zoomOut') {
      keys = [
        { channel: 'scale', at: s, value: r5(1 + Math.abs(amount)) },
        { channel: 'scale', at: r5(s + d), value: 1, curve: 'smooth' },
      ]
    } else {
      const whip = move === 'whip'
      keys = [
        { channel: 'x', at: s, value: 0.5 },
        { channel: 'x', at: r5(s + d), value: r5(0.5 - amount), curve: whip ? 'snappy' : 'smooth' },
      ]
      if (whip && blur > 0) {
        effects = [{ kind: 'gaussianBlur', params: [{ name: 'radius', value: 0 }] }]
        fxKeys = [
          { effect: 'gaussianBlur', param: 'radius', at: s, value: 0 },
          { effect: 'gaussianBlur', param: 'radius', at: r5(s + d / 2), value: blur, curve: 'cubic-out' },
          { effect: 'gaussianBlur', param: 'radius', at: r5(s + d), value: 0, curve: 'quad-in' },
        ]
      }
    }

    const rig: SpecElement & { fxKeys?: SpecFxKey[] } = {
      id: `${system.id}-cam`,
      kind: 'group',
      name: 'Camera',
      at: r5(start),
      duration: r5(end - start),
      layer: system.layer ?? Math.max(...layers),
      keys,
      ...(effects ? { effects } : {}),
      ...(fxKeys ? { fxKeys } : {}),
      children: targets.map((t) => ({ ...t, at: r5(t.at - start) })),
    }
    return { emit: [rig], update: [], remove: targets.map((t) => t.id) }
  },
}
