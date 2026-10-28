import { describe, expect, it } from 'vitest'
import { buildOne, errorsOf, expandOne, hasExit, hasIdleMotion, keysOn } from './testSupport'

const TYPICAL = { component: 'kinetic-title', text: 'The future of motion design is here', emphasis: ['future', 'here'], sub: 'introducing' }
const MINIMAL = { component: 'kinetic-title', text: 'Go' }
const MAXIMAL = {
  component: 'kinetic-title',
  text: 'This is a very long kinetic headline that should wrap across several lines of the safe area',
  emphasis: ['long', 'lines'],
  sub: 'a demonstration',
}

describe('kinetic-title: compiles clean', () => {
  it.each([['typical', TYPICAL], ['minimal (one word, no kicker, no emphasis)', MINIMAL], ['maximal (wraps, two emphasis words)', MAXIMAL]])(
    '%s',
    (_label, c) => {
      const built = buildOne(c)
      expect(errorsOf(built.issues)).toEqual([])
    },
  )
})

describe('kinetic-title: structure', () => {
  it('every part id is prefixed with the component id, and ends at the component duration', () => {
    const { parts, group } = expandOne(TYPICAL)
    expect(parts.length).toBeGreaterThan(3)
    for (const p of parts) {
      expect(p.id.startsWith('x-')).toBe(true)
      expect(p.at + p.duration).toBeCloseTo(group.duration, 1)
    }
  })

  it('words arrive staggered — strictly increasing start times', () => {
    const { parts } = expandOne(TYPICAL)
    const words = parts.filter((p) => /^x-word-\d+$/.test(p.id)).sort((a, b) => Number(a.id.split('-').pop()) - Number(b.id.split('-').pop()))
    expect(words.length).toBeGreaterThan(1)
    for (let i = 1; i < words.length; i++) expect(words[i]!.at).toBeGreaterThan(words[i - 1]!.at)
  })

  it('every part has idle motion once landed, and an exit', () => {
    const { parts } = expandOne(TYPICAL)
    for (const p of parts) {
      expect(hasIdleMotion(p), `${p.id} has no idle motion`).toBe(true)
      expect(hasExit(p), `${p.id} has no exit`).toBe(true)
    }
  })

  it('an emphasis word is its own element, anchored to its line, in accent serif italic — not a span', () => {
    const { parts } = expandOne(TYPICAL)
    const emphasisWord = parts.find((p) => p.kind === 'text' && p.text === 'future')!
    expect(emphasisWord).toBeDefined()
    expect(emphasisWord.italic).toBe(true)
    expect(emphasisWord.font).toBe('$serif')
    expect(emphasisWord.color).toBe('$accent')
    expect(emphasisWord.spans).toBeUndefined()
    // Anchored to its line: same y as its neighbouring word on the same line.
    const neighbour = parts.find((p) => p.kind === 'text' && p.text === 'of')!
    expect(emphasisWord.y).toBeCloseTo(neighbour.y!, 5)
    // A hand-drawn underline exists as its own part too.
    const underline = parts.find((p) => p.id.startsWith('x-underline-'))!
    expect(underline).toBeDefined()
    expect(underline.draw).toBeDefined()
  })

  it('calm energy arrives slower than bold', () => {
    const { parts: calmParts } = expandOne({ ...MINIMAL, energy: 'calm' })
    const { parts: boldParts } = expandOne({ ...MINIMAL, energy: 'bold' })
    const calmY = keysOn(calmParts[0]!, 'y')
    const boldY = keysOn(boldParts[0]!, 'y')
    const calmRamp = calmY[calmY.length - 1]!.at - calmY[0]!.at
    const boldRamp = boldY[boldY.length - 1]!.at - boldY[0]!.at
    expect(calmRamp).toBeGreaterThan(boldRamp)
  })

  it('colours come through ctx.color — accent resolves to the $accent token', () => {
    const { parts } = expandOne(TYPICAL)
    const emphasisWord = parts.find((p) => p.text === 'future')!
    expect(emphasisWord.color).toBe('$accent')
    const underline = parts.find((p) => p.id.startsWith('x-underline-'))!
    expect(underline.stroke).toBe('$accent')
  })
})
