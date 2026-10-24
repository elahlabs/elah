import { describe, expect, it } from 'vitest'
import { sampleChannel } from '../../resolver/keyframes'
import { build, byId, deepClips, errorsOf, expand, keysOn, square, sys } from './testSupport'

const mover = (extra = {}) =>
  square('m', 0.2, 0.5, {
    at: 0,
    duration: 8,
    keys: [
      { channel: 'x', at: 0, value: 0.2 },
      { channel: 'x', at: 4, value: 0.8 },
      { channel: 'x', at: 6, value: 0.9 },
      { channel: 'opacity', at: 0, value: 0 },
      { channel: 'opacity', at: 0.5, value: 1 },
    ],
    ...extra,
  })
const freezeAt = (at: number, targets = ['m']) => sys('fr', 'freeze', { at, duration: 1, targets })

describe('freeze', () => {
  it('is deterministic', () => {
    expect(expand([mover(), freezeAt(2)])).toEqual(expand([mover(), freezeAt(2)]))
  })

  it('compiles with 0 errors', () => {
    expect(errorsOf(build([mover(), freezeAt(2)]).issues)).toEqual([])
  })

  it('keeps no key after the freeze and puts one hold key at it, holding the interpolated value', () => {
    const el = byId(expand([mover(), freezeAt(2)]).spec.elements, 'm')
    const x = keysOn(el, 'x')
    expect(x.map((k) => k.at)).toEqual([0, 2])
    expect(x.every((k) => k.at <= 2)).toBe(true)
    // linear 0.2 -> 0.8 over 4 s: halfway through is 0.5
    expect(Math.abs(x[1]!.value - 0.5)).toBeLessThan(1e-6)
    expect(x[1]!.hold).toBe(true)
  })

  it('leaves a channel whose keys are all behind the freeze alone', () => {
    const el = byId(expand([mover(), freezeAt(2)]).spec.elements, 'm')
    expect(keysOn(el, 'opacity')).toEqual([
      { channel: 'opacity', at: 0, value: 0 },
      { channel: 'opacity', at: 0.5, value: 1 },
    ])
  })

  it('holds the EASED value, not a linear guess, across a curved segment', () => {
    const eased = mover({ keys: [{ channel: 'x', at: 0, value: 0 }, { channel: 'x', at: 4, value: 1, curve: 'cubic-out' }] })
    const x = keysOn(byId(expand([eased, freezeAt(2)]).spec.elements, 'm'), 'x')
    // cubic-out at 0.5 = 1 - 0.5^3
    expect(x[1]!.value).toBeCloseTo(0.875, 6)
  })

  it('steps through an author hold key rather than interpolating over it', () => {
    const held = mover({ keys: [{ channel: 'x', at: 0, value: 0.1, hold: true }, { channel: 'x', at: 4, value: 0.9 }] })
    expect(keysOn(byId(expand([held, freezeAt(2)]).spec.elements, 'm'), 'x')[1]!.value).toBe(0.1)
  })

  it('freezing before the first key holds the first key value', () => {
    const late = mover({ keys: [{ channel: 'x', at: 3, value: 0.4 }, { channel: 'x', at: 5, value: 0.9 }] })
    const x = keysOn(byId(expand([late, freezeAt(1)]).spec.elements, 'm'), 'x')
    expect(x).toEqual([{ channel: 'x', at: 1, value: 0.4, hold: true }])
  })

  it('the COMPILED clip stays on the frozen value after the freeze', () => {
    const r = build([mover(), freezeAt(2)])
    const clip = deepClips(r.project).find((c) => c.partId === 'm')!
    const keys = clip.keyframes!.channels.x!.keys
    expect(keys.every((k) => k.frame <= 60)).toBe(true)
    for (const frame of [60, 90, 150, 230]) expect(sampleChannel(keys, frame)).toBeCloseTo(0.5, 6)
  })

  it('removes expressions with one warn per channel', () => {
    const idle = mover({ expressions: [{ channel: 'y', source: 'value + sin(t)*0.01' }, { channel: 'scale', source: 'value' }] })
    const r = expand([idle, freezeAt(2)])
    expect(byId(r.spec.elements, 'm').expressions).toBeUndefined()
    const warns = r.issues.filter((i) => i.code === 'freeze-expression-removed')
    expect(warns).toHaveLength(2)
    expect(warns.map((w) => w.message).join()).toMatch(/"y".*"scale"/)
  })

  it('freezes what is inside a target group too, on the group clock', () => {
    const group = { id: 'g', kind: 'group', at: 1, duration: 6, children: [square('inner', 0.2, 0.5, { at: 0.5, duration: 5, keys: [{ channel: 'x', at: 0, value: 0.2 }, { channel: 'x', at: 4, value: 0.8 }] })] }
    const g = byId(expand([group as never, freezeAt(3.5, ['g'])]).spec.elements, 'g')
    // 3.5 s on the level = 2.5 s into the group = 2.0 s into `inner`
    const x = keysOn(g.children![0]!, 'x')
    expect(x.map((k) => k.at)).toEqual([0, 2])
    expect(x[1]!.value).toBeCloseTo(0.5, 6)
  })

  it('leaves an element that has not started, or has ended, alone and says so', () => {
    const r = expand([mover({ at: 5 }), freezeAt(2)])
    expect(byId(r.spec.elements, 'm').keys).toEqual(mover({ at: 5 }).keys)
    expect(r.issues).toEqual([expect.objectContaining({ severity: 'info', code: 'freeze-target-idle' })])
  })

  it('names an unknown target and changes nothing', () => {
    const r = expand([mover(), freezeAt(2, ['m', 'nope'])])
    expect(byId(r.spec.elements, 'm').keys).toEqual(mover().keys)
    expect(r.issues).toEqual([expect.objectContaining({ severity: 'error', code: 'unknown-target', message: expect.stringContaining('nope') })])
  })
})
