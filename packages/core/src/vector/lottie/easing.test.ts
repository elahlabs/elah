import { describe, expect, it } from 'vitest'
import { easingFields, segmentEasing } from './easing'

describe('segmentEasing', () => {
  it('a bezier handle pair becomes one bezier', () => {
    expect(segmentEasing({ t: 0, s: [0], o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } })).toEqual({
      hold: false,
      ease: { kind: 'bezier', bezier: [0.33, 0, 0.67, 1] },
    })
  })

  it('(0,0)/(1,1) handles are linear and missing handles are linear', () => {
    expect(segmentEasing({ t: 0, s: [0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } })).toEqual({ hold: false, ease: { kind: 'linear' } })
    expect(segmentEasing({ t: 0, s: [0] })).toEqual({ hold: false, ease: { kind: 'linear' } })
  })

  it('h:1 is a hold', () => {
    expect(segmentEasing({ t: 0, s: [0], h: 1 })).toEqual({ hold: true })
  })

  it('equal per-dimension handles collapse; different ones are not 1:1', () => {
    expect(segmentEasing({ t: 0, s: [0, 0], o: { x: [0.4, 0.4], y: [0, 0] }, i: { x: [0.6, 0.6], y: [1, 1] } })).toEqual({
      hold: false,
      ease: { kind: 'bezier', bezier: [0.4, 0, 0.6, 1] },
    })
    expect(segmentEasing({ t: 0, s: [0, 0], o: { x: [0.4, 0.2], y: [0, 0] }, i: { x: [0.6, 0.6], y: [1, 1] } })).toBeNull()
  })

  it('an x handle outside 0..1 and a lone handle are not 1:1', () => {
    expect(segmentEasing({ t: 0, s: [0], o: { x: [1.4], y: [0] }, i: { x: [0.6], y: [1] } })).toBeNull()
    expect(segmentEasing({ t: 0, s: [0], o: { x: [0.4], y: [0] } })).toBeNull()
  })

  it('easingFields leaves linear without a bezier', () => {
    expect(easingFields({ kind: 'linear' })).toEqual({ easing: 'linear' })
    expect(easingFields({ kind: 'bezier', bezier: [0.1, 0.2, 0.3, 0.4] })).toEqual({ easing: 'linear', easingBezier: [0.1, 0.2, 0.3, 0.4] })
  })
})
