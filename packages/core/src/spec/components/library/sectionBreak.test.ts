import { describe, expect, it } from 'vitest'
import { buildOne, errorsOf, expandOne, keysOn } from './testSupport'

const TYPICAL = { component: 'section-break', text: 'LATER' }
const MINIMAL = { component: 'section-break', text: 'A', duration: 0.5 } // shortest allowed
const MAXIMAL = { component: 'section-break', text: 'MEANWHILE', duration: 1.2 } // longest allowed

describe('section-break: compiles clean', () => {
  it.each([['typical', TYPICAL], ['minimal (shortest, 0.5s)', MINIMAL], ['maximal (longest, 1.2s)', MAXIMAL]])('%s', (_label, c) => {
    const built = buildOne(c)
    expect(errorsOf(built.issues)).toEqual([])
  })
})

describe('section-break: structure', () => {
  it('is exactly a full-frame panel and one word riding with it, both prefixed with the component id', () => {
    const { parts } = expandOne(TYPICAL)
    expect(parts.map((p) => p.id)).toEqual(['x-panel', 'x-word'])
  })

  it('sweeps from off-frame left, through centre, to off-frame right, and the word rides the identical path', () => {
    const { parts, group } = expandOne(TYPICAL)
    const panel = parts.find((p) => p.id === 'x-panel')!
    const word = parts.find((p) => p.id === 'x-word')!
    const px = keysOn(panel, 'x')
    const wx = keysOn(word, 'x')
    expect(px.length).toBe(3)
    expect(px[0]!.value).toBeLessThan(0) // starts off-frame left
    expect(px[1]!.value).toBe(0.5) // covers the centre
    expect(px[2]!.value).toBeGreaterThan(1) // ends off-frame right
    expect(wx.map((k) => k.value)).toEqual(px.map((k) => k.value)) // rides identically
    expect(panel.at + panel.duration).toBeCloseTo(group.duration, 5)
    expect(word.at + word.duration).toBeCloseTo(group.duration, 5)
  })

  it('the panel covers the whole frame width at the centre point', () => {
    const { parts } = expandOne(TYPICAL)
    const panel = parts.find((p) => p.id === 'x-panel')!
    expect(panel.w!).toBeGreaterThan(1080)
  })

  it('the word rides in background colour on the accent panel', () => {
    const { parts } = expandOne(TYPICAL)
    const panel = parts.find((p) => p.id === 'x-panel')!
    const word = parts.find((p) => p.id === 'x-word')!
    expect(panel.fill).toBe('$accent')
    // "bg" is not a token this test spec's design defines, so it falls back to the literal — still correct.
    expect(word.color).toBe('#f7f7f5')
  })

  it('is never still: this component is explicitly exempt from idle-motion expressions — it is in continuous motion for its whole (sub-1.2s) length', () => {
    const { parts } = expandOne(TYPICAL)
    for (const p of parts) {
      expect((p.expressions ?? []).length).toBe(0)
      expect(keysOn(p, 'x').length).toBe(3) // continuously animating the whole time instead
    }
  })
})
