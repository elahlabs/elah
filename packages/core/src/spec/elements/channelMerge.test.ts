import { describe, expect, it } from 'vitest'
import { compileVideoSpec } from '../compile'
import type { SpecElement } from '../types'

/**
 * An expression on a channel that also has keys must MODIFY the keyed
 * animation, not replace it.
 *
 * The engine already works this way: `resolver/keyframes.ts` samples the keys
 * and hands the result to the expression as `value` (`ChannelExpression`:
 * "`keyed` is the channel's sampled keyframe value"). The compiler used to
 * write `keys: []` alongside the expression, which silently deleted the
 * arrival — an element given `riseIn` plus an idle `floatY` just faded in at
 * rest, with no issue raised. AV-8a found it while building components and
 * worked around it by parking idle motion on unused channels; this is the fix
 * at the source.
 */
function compileOne(el: Partial<SpecElement>) {
  const { project, issues } = compileVideoSpec({
    format: { width: 1080, height: 1920, fps: 30 },
    duration: 3,
    elements: [{ id: 't', kind: 'text', text: 'Hi', size: 80, at: 0, duration: 3, x: 0.5, y: 0.5, ...el } as SpecElement],
  })
  const clip = Object.values(project.clips).flat()[0]
  return { clip, issues }
}

const RISE = [
  { channel: 'y', at: 0, value: 0.6 },
  { channel: 'y', at: 0.45, value: 0.5, curve: 'spring:snappy' },
]

describe('an expression on a keyed channel modifies the keys, never replaces them', () => {
  it('keeps the arrival keys when an idle expression lands on the same channel', () => {
    const { clip, issues } = compileOne({ keys: RISE as never, expressions: [{ channel: 'y', source: 'value + sin(t) * 0.01' }] })
    const y = clip.keyframes?.channels?.y
    expect(y?.source.kind).toBe('expression')
    expect(y?.keys).toHaveLength(2)
    expect(y?.keys.map((k) => k.value)).toEqual([0.6, 0.5])
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('still writes an expression channel with no keys when there are none', () => {
    const { clip } = compileOne({ expressions: [{ channel: 'scale', source: 'value * 1.1' }] })
    const scale = clip.keyframes?.channels?.scale
    expect(scale?.source.kind).toBe('expression')
    expect(scale?.keys).toEqual([])
  })

  it('leaves other channels’ keys untouched', () => {
    const { clip } = compileOne({
      keys: [...RISE, { channel: 'opacity', at: 0, value: 0 }, { channel: 'opacity', at: 0.3, value: 1 }] as never,
      expressions: [{ channel: 'y', source: 'value + 0.01' }],
    })
    expect(clip.keyframes?.channels?.opacity?.source.kind).toBe('keyframes')
    expect(clip.keyframes?.channels?.opacity?.keys).toHaveLength(2)
  })
})
