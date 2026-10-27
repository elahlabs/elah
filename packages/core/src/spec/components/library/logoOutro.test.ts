import { describe, expect, it } from 'vitest'
import { buildOne, errorsOf, expandOne, hasExit, hasIdleMotion, keysOn } from './testSupport'

const TYPICAL = { component: 'logo-outro', text: 'ELAH', sub: 'make anything' }
const MINIMAL = { component: 'logo-outro', text: 'X' } // no tagline
const MAXIMAL = { component: 'logo-outro', text: 'A Considerably Longer Wordmark', sub: 'and a longer tagline underneath it too', duration: 5 }

describe('logo-outro: compiles clean', () => {
  it.each([['typical', TYPICAL], ['minimal (no tagline)', MINIMAL], ['maximal (long wordmark + tagline)', MAXIMAL]])('%s', (_label, c) => {
    const built = buildOne(c)
    expect(errorsOf(built.issues)).toEqual([])
  })
})

describe('logo-outro: structure', () => {
  it('every part id is prefixed with the component id', () => {
    const { parts } = expandOne(TYPICAL)
    expect(parts.length).toBeGreaterThan(3) // wordmark + ring + 8 burst dots + tagline
    for (const p of parts) expect(p.id.startsWith('x-')).toBe(true)
  })

  it('omits the tagline when there is no sub text', () => {
    const { parts } = expandOne(MINIMAL)
    expect(parts.find((p) => p.id === 'x-tagline')).toBeUndefined()
  })

  it('parts arrive staggered: ring after the wordmark, the burst after the ring starts, the tagline last', () => {
    const { parts } = expandOne(TYPICAL)
    const byId = Object.fromEntries(parts.map((p) => [p.id, p]))
    expect(byId['x-wordmark']!.at).toBe(0)
    expect(byId['x-ring']!.at).toBeGreaterThan(byId['x-wordmark']!.at)
    expect(byId['x-burst-0']!.at).toBeGreaterThan(byId['x-wordmark']!.at)
    expect(byId['x-tagline']!.at).toBeGreaterThan(byId['x-ring']!.at)
  })

  it('the wordmark and tagline hold with NO exit — this component ends the piece, per the craft brief', () => {
    const { parts } = expandOne(TYPICAL)
    const wordmark = parts.find((p) => p.id === 'x-wordmark')!
    const tagline = parts.find((p) => p.id === 'x-tagline')!
    expect(hasExit(wordmark)).toBe(false)
    expect(hasExit(tagline)).toBe(false)
    // But they still ARRIVE and still drift once landed — "no exit" is not "no motion".
    expect(hasIdleMotion(wordmark)).toBe(true)
    expect(hasIdleMotion(tagline)).toBe(true)
  })

  it('the ring draws on, then keeps expanding while it fades — its own kind of exit', () => {
    const { parts } = expandOne(TYPICAL)
    const ring = parts.find((p) => p.id === 'x-ring')!
    expect(ring.draw).toBeDefined()
    const scale = keysOn(ring, 'scale')
    expect(scale[scale.length - 1]!.value).toBeGreaterThan(1) // expands past 1, not shrinks
    expect(hasExit(ring)).toBe(true) // opacity ends at 0
  })

  it('the dots burst radially outward from the centre, then fade', () => {
    const { parts } = expandOne(TYPICAL)
    const dots = parts.filter((p) => p.id.startsWith('x-burst-'))
    expect(dots.length).toBe(8)
    for (const d of dots) {
      const x = keysOn(d, 'x')
      expect(x.length).toBeGreaterThanOrEqual(2)
      expect(x[x.length - 1]!.value).not.toBe(x[0]!.value) // moved outward
      expect(hasExit(d)).toBe(true)
    }
  })

  it('calm energy pops the wordmark in slower than bold', () => {
    const { parts: calmParts } = expandOne({ ...MINIMAL, energy: 'calm' })
    const { parts: boldParts } = expandOne({ ...MINIMAL, energy: 'bold' })
    const calmWordmark = calmParts.find((p) => p.id === 'x-wordmark')!
    const boldWordmark = boldParts.find((p) => p.id === 'x-wordmark')!
    const calmScale = keysOn(calmWordmark, 'scale')
    const boldScale = keysOn(boldWordmark, 'scale')
    const calmRamp = calmScale[1]!.at - calmScale[0]!.at
    const boldRamp = boldScale[1]!.at - boldScale[0]!.at
    expect(calmRamp).toBeGreaterThan(boldRamp)
  })

  it('colours come through ctx.color — accent resolves to the $accent token', () => {
    const { parts } = expandOne(TYPICAL)
    const ring = parts.find((p) => p.id === 'x-ring')!
    expect(ring.stroke).toBe('$accent')
  })
})
