/**
 * swarm (MI-P3) — N copies of one template multiply across a region.
 *
 * "Notifications that multiply and bounce": the model names the thing once and
 * the count; code scatters them on a jittered grid (never a pure grid, never
 * pure random: craft rule in AV-MOTION-CRAFT), pops each in on a bouncy spring
 * a beat after the last, lets it wobble on a `wiggle` expression, and sends the
 * lot out on the quick exit curve.
 */

import type { SpecElement, SpecExpression, SpecKey } from '../types'
import { exitOut, fx, fy, mergeKeys, popIn } from '../components/motion'
import type { SystemDef } from './types'
import { boolParam, clamp, cloneAs, numParam, r5 } from './util'

/** The shortest a copy lives, so it can arrive, be seen and leave. */
const MIN_LIFE = 0.8

/** Fisher–Yates on a seeded `random`, so cell order is a function of the seed alone. */
function shuffled(n: number, random: () => number): number[] {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/** Scale the VALUE of every `scale`/`opacity` key by the template's own authored scale/opacity, so a 0.8-scale template still arrives at 0.8. */
function relativeTo(keys: SpecKey[], scale: number, opacity: number): SpecKey[] {
  return keys.map((k) => (k.channel === 'scale' ? { ...k, value: r5(k.value * scale) } : k.channel === 'opacity' ? { ...k, value: r5(k.value * opacity) } : k))
}

export const swarm: SystemDef = {
  name: 'swarm',
  hint: 'copies of `template` multiply across the region x,y,w,h (centre as 0..1, size px; default whole stage), each popping in a beat after the last, bouncing, then leaving together; life 0 = until the system ends',
  targets: false,
  template: true,
  duration: { min: 1, max: 60 },
  params: [
    { name: 'count', kind: 'number', default: 12, min: 3, max: 60 },
    { name: 'jitter', kind: 'number', default: 0.6, min: 0, max: 1 },
    { name: 'bounce', kind: 'boolean', default: true },
    { name: 'stagger', kind: 'number', default: 0.06, min: 0.01, max: 0.5, unit: 's' },
    { name: 'life', kind: 'number', default: 0, min: 0, max: 60, unit: 's' },
  ],
  apply({ system, params, template, ctx }) {
    if (!template) return { emit: [], update: [], remove: [] }
    const { format } = ctx
    const count = Math.round(numParam(params, 'count'))
    const jitter = numParam(params, 'jitter')
    const bounce = boolParam(params, 'bounce')
    const life = numParam(params, 'life')

    // The region, in px on the stage.
    const regionW = clamp(system.w ?? format.width, 1, format.width * 2)
    const regionH = clamp(system.h ?? format.height, 1, format.height * 2)
    const cx = (system.x ?? 0.5) * format.width
    const cy = (system.y ?? 0.5) * format.height
    const left = cx - regionW / 2
    const top = cy - regionH / 2

    // A grid whose cells have the region's aspect, visited in a seeded order.
    const cols = Math.max(1, Math.round(Math.sqrt((count * regionW) / regionH)))
    const rows = Math.ceil(count / cols)
    const cellW = regionW / cols
    const cellH = regionH / rows
    const order = shuffled(cols * rows, ctx.random)

    // Squeeze the stagger so even the last copy gets a readable life inside the system's duration.
    const step = count > 1 ? Math.max(0, Math.min(numParam(params, 'stagger'), (system.duration - MIN_LIFE) / (count - 1))) : 0
    const base = template.rotation ?? 0
    const baseScale = template.scale ?? 1
    const baseOpacity = template.opacity ?? 1
    const taken = new Set((template.expressions ?? []).map((e) => e.channel))

    const emit: SpecElement[] = []
    for (let i = 0; i < count; i++) {
      const cell = order[i]!
      const col = cell % cols
      const row = Math.floor(cell / cols)
      const px = left + (col + 0.5) * cellW + (ctx.random() - 0.5) * jitter * cellW
      const py = top + (row + 0.5) * cellH + (ctx.random() - 0.5) * jitter * cellH
      const tilt = (ctx.random() - 0.5) * 2 * jitter * 10
      const freq = 1.1 + ctx.random() * 1.2
      const ampX = fx(format, 8 + ctx.random() * 8)
      const ampY = fy(format, 10 + ctx.random() * 10)

      const offset = i * step
      const dur = life > 0 ? Math.max(MIN_LIFE, life) : Math.max(MIN_LIFE, system.duration - offset)
      const copy = cloneAs(template, `${system.id}-${i + 1}`)
      delete copy.enter
      delete copy.exit
      delete copy.enterDuration
      delete copy.exitDuration

      const expressions: SpecExpression[] = [...(copy.expressions ?? [])]
      if (bounce) {
        if (!taken.has('x')) expressions.push({ channel: 'x', source: `wiggle(${r5(freq)}, ${r5(ampX)})` })
        if (!taken.has('y')) expressions.push({ channel: 'y', source: `wiggle(${r5(freq * 0.8)}, ${r5(ampY)})` })
      }

      emit.push({
        ...copy,
        at: r5(system.at + offset),
        duration: r5(dur),
        x: r5(px / format.width),
        y: r5(py / format.height),
        rotation: r5(base + tilt),
        ...(system.layer !== undefined ? { layer: system.layer } : {}),
        keys: mergeKeys(copy.keys ?? [], relativeTo([...popIn(ctx, { at: 0 }), ...exitOut(ctx, dur)], baseScale, baseOpacity)),
        ...(expressions.length > 0 ? { expressions } : {}),
      })
    }
    return { emit, update: [], remove: [] }
  },
}
