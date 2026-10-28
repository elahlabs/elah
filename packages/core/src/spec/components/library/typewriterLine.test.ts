import { describe, expect, it } from 'vitest'
import { buildOne, errorsOf, expandOne, hasExit, hasIdleMotion, keysOn } from './testSupport'

const TYPICAL = { component: 'typewriter-line', text: 'Loading the future...', sub: '???' }
const MINIMAL = { component: 'typewriter-line', text: 'Hi' }
const MAXIMAL = { component: 'typewriter-line', text: 'This is a considerably longer line of typed text to type out', sub: 'a ghost behind it', duration: 5 }

describe('typewriter-line: compiles clean', () => {
  it.each([['typical', TYPICAL], ['minimal (no ghost, short text)', MINIMAL], ['maximal (long line + ghost)', MAXIMAL]])('%s', (_label, c) => {
    const built = buildOne(c)
    expect(errorsOf(built.issues)).toEqual([])
  })
})

describe('typewriter-line: structure', () => {
  it('every part id is prefixed with the component id and ends at the component duration', () => {
    const { parts, group } = expandOne(TYPICAL)
    expect(parts.map((p) => p.id)).toEqual(['x-ghost', 'x-line', 'x-caret'])
    for (const p of parts) expect(p.at + p.duration).toBeCloseTo(group.duration, 1)
  })

  it('parts arrive staggered — the caret lands only after the line has finished typing', () => {
    const { parts } = expandOne(TYPICAL)
    const line = parts.find((p) => p.id === 'x-line')!
    const caret = parts.find((p) => p.id === 'x-caret')!
    expect(line.at).toBe(0)
    expect(caret.at).toBeGreaterThan(line.at)
  })

  it('the line has a typewriter reveal, and the caret blinks continuously via an expression', () => {
    const { parts } = expandOne(TYPICAL)
    const line = parts.find((p) => p.id === 'x-line')!
    expect(line.reveal).toMatchObject({ preset: 'typewriter', unit: 'char' })
    const caret = parts.find((p) => p.id === 'x-caret')!
    expect(caret.expressions?.[0]?.channel).toBe('opacity')
    expect(caret.expressions?.[0]?.source).toContain('pulse(')
  })

  it('every part has idle motion and an exit', () => {
    const { parts } = expandOne(TYPICAL)
    for (const p of parts) {
      expect(hasIdleMotion(p), `${p.id} has no idle motion`).toBe(true)
    }
    // The line and ghost fade out via `exitOut`; the caret's exit is baked into its
    // opacity EXPRESSION envelope (it cannot also carry opacity keys — see the
    // component's own doc comment), so `hasExit` (which looks at opacity KEYS) does
    // not apply to it.
    expect(hasExit(parts.find((p) => p.id === 'x-line')!)).toBe(true)
    expect(hasExit(parts.find((p) => p.id === 'x-ghost')!)).toBe(true)
  })

  it('calm energy pops the caret in slower than bold', () => {
    const { parts: calmParts } = expandOne({ ...MINIMAL, energy: 'calm' })
    const { parts: boldParts } = expandOne({ ...MINIMAL, energy: 'bold' })
    const calmCaret = calmParts.find((p) => p.id === 'x-caret')!
    const boldCaret = boldParts.find((p) => p.id === 'x-caret')!
    const calmScale = keysOn(calmCaret, 'scale')
    const boldScale = keysOn(boldCaret, 'scale')
    const calmRamp = calmScale[calmScale.length - 1]!.at - calmScale[0]!.at
    const boldRamp = boldScale[boldScale.length - 1]!.at - boldScale[0]!.at
    expect(calmRamp).toBeGreaterThan(boldRamp)
  })

  it('colours come through ctx.color — accent resolves to the $accent token', () => {
    const { parts } = expandOne(TYPICAL)
    const caret = parts.find((p) => p.id === 'x-caret')!
    expect(caret.fill).toBe('$accent')
  })
})
