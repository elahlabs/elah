import { describe, expect, it } from 'vitest'
import { buildOne, errorsOf, expandOne, hasExit, hasIdleMotion, keysOn } from './testSupport'

const TYPICAL = { component: 'clock-sweep', text: 'Time is running out' }
const MINIMAL = { component: 'clock-sweep' } // no caption
const MAXIMAL = { component: 'clock-sweep', text: 'A rather long caption describing the deadline in detail', duration: 6 }

describe('clock-sweep: compiles clean', () => {
  it.each([['typical', TYPICAL], ['minimal (no caption)', MINIMAL], ['maximal (long caption)', MAXIMAL]])('%s', (_label, c) => {
    const built = buildOne(c)
    expect(errorsOf(built.issues)).toEqual([])
  })
})

describe('clock-sweep: structure', () => {
  it('every part id is prefixed with the component id and ends at the component duration', () => {
    const { parts, group } = expandOne(TYPICAL)
    // face + 12 ticks + arc + hand + 2 orbit dots + caption = 18
    expect(parts.length).toBe(18)
    for (const p of parts) {
      expect(p.id.startsWith('x-')).toBe(true)
      expect(p.at + p.duration).toBeCloseTo(group.duration, 1)
    }
  })

  it('omits the caption when there is no text', () => {
    const { parts } = expandOne(MINIMAL)
    expect(parts.find((p) => p.id === 'x-caption')).toBeUndefined()
  })

  it('ticks pop in staggered around the face', () => {
    const { parts } = expandOne(TYPICAL)
    const ticks = parts.filter((p) => p.id.startsWith('x-tick-')).sort((a, b) => Number(a.id.split('-').pop()) - Number(b.id.split('-').pop()))
    expect(ticks.length).toBe(12)
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.at).toBeGreaterThan(ticks[i - 1]!.at)
  })

  it('the hand sweeps CONTINUOUSLY via a rotation expression, not a one-shot key', () => {
    const { parts } = expandOne(TYPICAL)
    const hand = parts.find((p) => p.id === 'x-hand')!
    expect((hand.keys ?? []).some((k) => k.channel === 'rotation')).toBe(false)
    const rotationExpr = hand.expressions?.find((e) => e.channel === 'rotation')
    expect(rotationExpr).toBeDefined()
    expect(rotationExpr!.source).toContain('t *')
  })

  it('orbit dots drift on x/y expressions around their own static centre, not keys', () => {
    const { parts } = expandOne(TYPICAL)
    const dots = parts.filter((p) => p.id.startsWith('x-orbit-'))
    expect(dots.length).toBe(2)
    for (const d of dots) {
      expect((d.keys ?? []).some((k) => k.channel === 'x' || k.channel === 'y')).toBe(false)
      expect(d.expressions?.some((e) => e.channel === 'x')).toBe(true)
      expect(d.expressions?.some((e) => e.channel === 'y')).toBe(true)
    }
  })

  it('the face is a partial stroke (an arc), and the accent arc draws along the rim after it', () => {
    const { parts } = expandOne(TYPICAL)
    const face = parts.find((p) => p.id === 'x-face')!
    const arc = parts.find((p) => p.id === 'x-arc')!
    expect(face.shape).toBe('arc')
    expect(face.draw).toBeDefined()
    expect(arc.shape).toBe('arc')
    expect(arc.draw).toBeDefined()
    expect(arc.at).toBeGreaterThan(face.at)
  })

  it('every part has idle motion and an exit', () => {
    const { parts } = expandOne(TYPICAL)
    for (const p of parts) {
      expect(hasIdleMotion(p), `${p.id} has no idle motion`).toBe(true)
      expect(hasExit(p), `${p.id} has no exit`).toBe(true)
    }
  })

  it('calm energy pops the hand in slower than bold', () => {
    const { parts: calmParts } = expandOne({ ...MINIMAL, energy: 'calm' })
    const { parts: boldParts } = expandOne({ ...MINIMAL, energy: 'bold' })
    const calmHand = calmParts.find((p) => p.id === 'x-hand')!
    const boldHand = boldParts.find((p) => p.id === 'x-hand')!
    const calmScale = keysOn(calmHand, 'scale')
    const boldScale = keysOn(boldHand, 'scale')
    const calmRamp = calmScale[1]!.at - calmScale[0]!.at
    const boldRamp = boldScale[1]!.at - boldScale[0]!.at
    expect(calmRamp).toBeGreaterThan(boldRamp)
  })

  it('colours come through ctx.color — accent resolves to the $accent token', () => {
    const { parts } = expandOne(TYPICAL)
    const arc = parts.find((p) => p.id === 'x-arc')!
    expect(arc.stroke).toBe('$accent')
  })
})
