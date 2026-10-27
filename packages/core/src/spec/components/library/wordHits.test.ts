import { describe, expect, it } from 'vitest'
import { buildOne, errorsOf, expandOne, hasExit, hasIdleMotion, keysOn } from './testSupport'

const TYPICAL = { component: 'word-hits', items: [{ text: 'FAST' }, { text: 'BOLD', style: 'serif' }, { text: 'NOW', style: 'accent' }] }
const MINIMAL = { component: 'word-hits', items: [{ text: 'ONE' }] }
const MAXIMAL = { component: 'word-hits', items: Array.from({ length: 8 }, (_, i) => ({ text: `W${i}` })), duration: 8 }

describe('word-hits: compiles clean', () => {
  it.each([['typical', TYPICAL], ['minimal (1 item)', MINIMAL], ['maximal (8 items)', MAXIMAL]])('%s', (_label, c) => {
    const built = buildOne(c)
    expect(errorsOf(built.issues)).toEqual([])
  })
})

describe('word-hits: structure', () => {
  it('every part id is prefixed with the component id', () => {
    const { parts } = expandOne(TYPICAL)
    expect(parts.length).toBe(6) // 3 items * (ring + word)
    for (const p of parts) expect(p.id.startsWith('x-')).toBe(true)
  })

  it('the LAST hit reaches the component duration; earlier hits hand off before it', () => {
    const { parts, group } = expandOne(TYPICAL)
    const words = parts.filter((p) => p.id.startsWith('x-word-')).sort((a, b) => a.at - b.at)
    const last = words[words.length - 1]!
    expect(last.at + last.duration).toBeCloseTo(group.duration, 1)
    expect(words[0]!.at + words[0]!.duration).toBeLessThan(group.duration)
  })

  it('hits punch in staggered — strictly increasing starts, each overlapping the previous one\'s exit', () => {
    const { parts } = expandOne(TYPICAL)
    const words = parts.filter((p) => p.id.startsWith('x-word-')).sort((a, b) => a.at - b.at)
    for (let i = 1; i < words.length; i++) {
      expect(words[i]!.at).toBeGreaterThan(words[i - 1]!.at)
      // Overlap: the next word starts before the previous one has fully exited.
      expect(words[i]!.at).toBeLessThan(words[i - 1]!.at + words[i - 1]!.duration)
    }
  })

  it('every part has idle motion and an exit', () => {
    const { parts } = expandOne(TYPICAL)
    for (const p of parts) {
      expect(hasIdleMotion(p), `${p.id} has no idle motion`).toBe(true)
      expect(hasExit(p), `${p.id} has no exit`).toBe(true)
    }
  })

  it('exits up-and-out: the word\'s y key moves upward on the way out', () => {
    const { parts } = expandOne(TYPICAL)
    const word = parts.find((p) => p.id === 'x-word-0')!
    const y = keysOn(word, 'y')
    expect(y.length).toBe(2)
    expect(y[1]!.value).toBeLessThan(y[0]!.value)
  })

  it('style alternates automatically, and an explicit style wins', () => {
    const { parts } = expandOne(TYPICAL)
    const fast = parts.find((p) => p.text === 'FAST')! // index 0, no explicit style -> auto "ink"
    const bold = parts.find((p) => p.text === 'BOLD')! // explicit "serif"
    const now = parts.find((p) => p.text === 'NOW')! // explicit "accent"
    expect(fast.color).not.toBe('$accent')
    expect(bold.italic).toBe(true)
    expect(bold.font).toBe('$serif')
    expect(now.color).toBe('$accent')
  })

  it('calm energy pops in slower than bold', () => {
    const { parts: calmParts } = expandOne({ ...MINIMAL, energy: 'calm' })
    const { parts: boldParts } = expandOne({ ...MINIMAL, energy: 'bold' })
    const calmWord = calmParts.find((p) => p.id === 'x-word-0')!
    const boldWord = boldParts.find((p) => p.id === 'x-word-0')!
    const calmScale = keysOn(calmWord, 'scale')
    const boldScale = keysOn(boldWord, 'scale')
    const calmRamp = calmScale[1]!.at - calmScale[0]!.at
    const boldRamp = boldScale[1]!.at - boldScale[0]!.at
    expect(calmRamp).toBeGreaterThan(boldRamp)
  })

  it('colours come through ctx.color — accent resolves to the $accent token', () => {
    const { parts } = expandOne(TYPICAL)
    const now = parts.find((p) => p.text === 'NOW')!
    expect(now.color).toBe('$accent')
  })
})
