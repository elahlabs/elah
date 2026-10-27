import { describe, expect, it } from 'vitest'
import { buildOne, errorsOf, expandOne, hasExit, hasIdleMotion, keysOn } from './testSupport'

const TYPICAL = { component: 'quote-card', text: 'This changed everything about how we work.', sub: 'Jane Doe, CEO' }
const MINIMAL = { component: 'quote-card', text: 'Short.' } // no attribution
const MAXIMAL = {
  component: 'quote-card',
  text: 'A considerably longer quotation that should wrap across several lines of the card and really test the layout.',
  sub: 'A. Very Long Attribution Name, Chief Something Officer',
  duration: 6,
}

describe('quote-card: compiles clean', () => {
  it.each([['typical', TYPICAL], ['minimal (no attribution)', MINIMAL], ['maximal (long quote + attribution)', MAXIMAL]])('%s', (_label, c) => {
    const built = buildOne(c)
    expect(errorsOf(built.issues)).toEqual([])
  })
})

describe('quote-card: structure', () => {
  it('every part id is prefixed with the component id and ends at the component duration', () => {
    const { parts, group } = expandOne(TYPICAL)
    expect(parts.map((p) => p.id)).toEqual(['x-shadow', 'x-surface', 'x-mark', 'x-quote', 'x-rule', 'x-attribution'])
    for (const p of parts) expect(p.at + p.duration).toBeCloseTo(group.duration, 1)
  })

  it('omits the rule and attribution when there is no attribution text', () => {
    const { parts } = expandOne(MINIMAL)
    expect(parts.find((p) => p.id === 'x-rule')).toBeUndefined()
    expect(parts.find((p) => p.id === 'x-attribution')).toBeUndefined()
  })

  it('the shadow and surface rise in together, the mark and quote follow staggered, the rule draws before the attribution', () => {
    const { parts } = expandOne(TYPICAL)
    const byId = Object.fromEntries(parts.map((p) => [p.id, p]))
    expect(byId['x-shadow']!.at).toBe(0)
    expect(byId['x-surface']!.at).toBe(0)
    expect(byId['x-mark']!.at).toBeGreaterThan(0)
    expect(byId['x-quote']!.at).toBeGreaterThan(byId['x-mark']!.at)
    expect(byId['x-rule']!.at).toBeGreaterThan(byId['x-quote']!.at)
    expect(byId['x-attribution']!.at).toBeGreaterThan(byId['x-rule']!.at)
  })

  it('the shadow sits behind the surface, offset down, with a gaussianBlur effect (switches on after AV-7)', () => {
    const { parts } = expandOne(TYPICAL)
    const shadow = parts.find((p) => p.id === 'x-shadow')!
    const surface = parts.find((p) => p.id === 'x-surface')!
    expect(shadow.y!).toBeGreaterThan(surface.y!)
    expect(shadow.effects?.[0]?.kind).toBe('gaussianBlur')
    expect((shadow.layer ?? 0)).toBeLessThan(surface.layer ?? 0)
  })

  it('the quote reveals by line, not all at once', () => {
    const { parts } = expandOne(TYPICAL)
    const quote = parts.find((p) => p.id === 'x-quote')!
    expect(quote.reveal).toMatchObject({ preset: 'rise', unit: 'line' })
  })

  it('every part has idle motion and an exit', () => {
    const { parts } = expandOne(TYPICAL)
    for (const p of parts) {
      expect(hasIdleMotion(p), `${p.id} has no idle motion`).toBe(true)
      expect(hasExit(p), `${p.id} has no exit`).toBe(true)
    }
  })

  it('calm energy rises the surface in slower than bold', () => {
    const { parts: calmParts } = expandOne({ ...MINIMAL, energy: 'calm' })
    const { parts: boldParts } = expandOne({ ...MINIMAL, energy: 'bold' })
    const calmSurface = calmParts.find((p) => p.id === 'x-surface')!
    const boldSurface = boldParts.find((p) => p.id === 'x-surface')!
    const calmY = keysOn(calmSurface, 'y')
    const boldY = keysOn(boldSurface, 'y')
    const calmRamp = calmY[1]!.at - calmY[0]!.at
    const boldRamp = boldY[1]!.at - boldY[0]!.at
    expect(calmRamp).toBeGreaterThan(boldRamp)
  })

  it('colours come through ctx.color — accent resolves to the $accent token', () => {
    const { parts } = expandOne(TYPICAL)
    const rule = parts.find((p) => p.id === 'x-rule')!
    expect(rule.stroke).toBe('$accent')
  })
})
