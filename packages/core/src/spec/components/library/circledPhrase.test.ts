import { describe, expect, it } from 'vitest'
import { buildOne, errorsOf, expandOne, hasExit, hasIdleMotion, keysOn } from './testSupport'

const CIRCLE = { component: 'circled-phrase', text: 'game changer', sub: 'they call it a', variant: 'circle' }
const UNDERLINE = { component: 'circled-phrase', text: 'underline me', variant: 'underline' }
const MARKER = { component: 'circled-phrase', text: 'marker me', variant: 'marker' }
const MINIMAL = { component: 'circled-phrase', text: 'hi' } // default variant, no lead-in

describe('circled-phrase: compiles clean', () => {
  it.each([['circle + lead-in (typical)', CIRCLE], ['underline', UNDERLINE], ['marker', MARKER], ['minimal (no lead-in, default variant)', MINIMAL]])(
    '%s',
    (_label, c) => {
      const built = buildOne(c)
      expect(errorsOf(built.issues)).toEqual([])
    },
  )
})

describe('circled-phrase: structure', () => {
  it('every part id is prefixed with the component id and ends at the component duration', () => {
    const { parts, group } = expandOne(CIRCLE)
    expect(parts.length).toBeGreaterThan(3) // lead, phrase, loop, >=1 burst dot
    for (const p of parts) {
      expect(p.id.startsWith('x-')).toBe(true)
      expect(p.at + p.duration).toBeCloseTo(group.duration, 1)
    }
  })

  it('the phrase arrives after the lead-in, staggered', () => {
    const { parts } = expandOne(CIRCLE)
    const lead = parts.find((p) => p.id === 'x-lead')!
    const phrase = parts.find((p) => p.id === 'x-phrase')!
    expect(lead.at).toBe(0)
    expect(phrase.at).toBeGreaterThan(lead.at)
  })

  it('every part has idle motion and an exit', () => {
    for (const variant of [CIRCLE, UNDERLINE, MARKER]) {
      const { parts } = expandOne(variant)
      for (const p of parts) {
        expect(hasIdleMotion(p), `${variant.variant}: ${p.id} has no idle motion`).toBe(true)
        expect(hasExit(p), `${variant.variant}: ${p.id} has no exit`).toBe(true)
      }
    }
  })

  it('the circle variant draws a hand-drawn loop and bursts dots after it closes', () => {
    const { parts } = expandOne(CIRCLE)
    const loop = parts.find((p) => p.id === 'x-loop')!
    expect(loop.shape).toBe('path')
    expect(loop.draw).toBeDefined()
    const bursts = parts.filter((p) => p.id.startsWith('x-burst-'))
    expect(bursts.length).toBeGreaterThanOrEqual(3)
  })

  it('the underline variant draws a scribble under the phrase, not a loop', () => {
    const { parts } = expandOne(UNDERLINE)
    expect(parts.find((p) => p.id === 'x-underline')).toBeDefined()
    expect(parts.find((p) => p.id === 'x-loop')).toBeUndefined()
  })

  it('the marker variant sweeps an accentSoft rect from the left via scaleX', () => {
    const { parts } = expandOne(MARKER)
    const marker = parts.find((p) => p.id === 'x-marker')!
    // accentSoft is not a token the test spec's design defines, so ctx.color falls back to its literal — still a valid colour.
    expect(marker.fill).toBe('#bbf7d0')
    expect(marker.anchor).toEqual({ x: 0, y: 0.5 })
    const scaleX = keysOn(marker, 'scaleX')
    expect(scaleX[0]!.value).toBe(0)
    expect(scaleX[scaleX.length - 1]!.value).toBe(1)
  })

  it('calm energy pops the phrase in slower than bold', () => {
    const { parts: calmParts } = expandOne({ ...MINIMAL, energy: 'calm' })
    const { parts: boldParts } = expandOne({ ...MINIMAL, energy: 'bold' })
    const calmPhrase = calmParts.find((p) => p.id === 'x-phrase')!
    const boldPhrase = boldParts.find((p) => p.id === 'x-phrase')!
    const calmScale = keysOn(calmPhrase, 'scale')
    const boldScale = keysOn(boldPhrase, 'scale')
    const calmRamp = calmScale[1]!.at - calmScale[0]!.at
    const boldRamp = boldScale[1]!.at - boldScale[0]!.at
    expect(calmRamp).toBeGreaterThan(boldRamp)
  })

  it('colours come through ctx.color — accent resolves to the $accent token', () => {
    const { parts } = expandOne(CIRCLE)
    const loop = parts.find((p) => p.id === 'x-loop')!
    expect(loop.stroke).toBe('$accent')
  })
})
