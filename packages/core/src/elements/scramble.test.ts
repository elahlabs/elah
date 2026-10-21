import { describe, expect, it } from 'vitest'
import { resolveScrambleCharset, scrambleText, SCRAMBLE_PRESETS } from './scramble'

const TEXT = 'Hello brave world'

describe('scrambleText', () => {
  it('progress 0 draws every glyph from the charset and keeps the shape', () => {
    const pool = new Set(Array.from(SCRAMBLE_PRESETS.upper))
    const out = scrambleText(TEXT, 0, 0, { charset: 'upper', seed: 3 })
    expect(Array.from(out)).toHaveLength(Array.from(TEXT).length)
    for (const [k, g] of Array.from(out).entries()) {
      if (TEXT[k] === ' ') expect(g).toBe(' ')
      else expect(pool.has(g)).toBe(true)
    }
    expect(out).not.toMatch(/[a-z]/)
  })

  it('progress 1 shows the text', () => {
    expect(scrambleText(TEXT, 1, 7, { charset: 'upper' })).toBe(TEXT)
  })

  it('resolves left to right and never reverts', () => {
    const n = TEXT.replace(/ /g, '').length
    let prev = -1
    for (let s = 0; s <= 100; s++) {
      const out = scrambleText(TEXT, s / 100, 4, { charset: 'symbols', seed: 9 })
      let run = 0
      let idx = 0
      for (let k = 0; k < out.length; k++) {
        if (TEXT[k] === ' ') continue
        idx++
        if (out[k] === TEXT[k] && run === idx - 1) run = idx
      }
      expect(run).toBeGreaterThanOrEqual(prev)
      prev = run
      expect(run).toBe(Math.floor((s / 100) * n + 1e-9))
    }
    expect(prev).toBe(n)
  })

  it('preserves spaces and newlines, and optionally scrambles spaces', () => {
    const t = 'ab cd\nef'
    const out = scrambleText(t, 0, 0, { charset: 'upper' })
    expect(out[2]).toBe(' ')
    expect(out[5]).toBe('\n')
    const none = scrambleText(t, 0, 0, { charset: 'upper', preserve: 'none' })
    expect(none[2]).not.toBe(' ')
    expect(none[5]).toBe('\n')
  })

  it('is deterministic and random access: frame N does not depend on earlier frames', () => {
    const opts = { charset: 'alnum', seed: 42, changeEvery: 2 }
    const run = () => [0, 5, 10].map((f) => scrambleText(TEXT, 0.3, f, opts))
    const first = run()
    expect(run()).toEqual(first)
    expect(scrambleText(TEXT, 0.3, 10, opts)).toBe(first[2])
    const reversed = [10, 5, 0].map((f) => scrambleText(TEXT, 0.3, f, opts))
    expect(reversed).toEqual([first[2], first[1], first[0]])
    console.log('scramble frames 0/5/10:', JSON.stringify(first))
  })

  it('holds a noise glyph for changeEvery frames then changes; seeds differ', () => {
    const o = { charset: 'upper', seed: 1, changeEvery: 4 }
    expect(scrambleText(TEXT, 0, 0, o)).toBe(scrambleText(TEXT, 0, 3, o))
    expect(scrambleText(TEXT, 0, 0, o)).not.toBe(scrambleText(TEXT, 0, 4, o))
    expect(scrambleText(TEXT, 0, 0, { ...o, seed: 2 })).not.toBe(scrambleText(TEXT, 0, 0, o))
  })

  it('resolves presets and literals; an oversized or empty literal falls back', () => {
    expect(resolveScrambleCharset('lower')).toBe(SCRAMBLE_PRESETS.lower)
    expect(resolveScrambleCharset('ABC123')).toBe('ABC123')
    expect(resolveScrambleCharset('x'.repeat(65))).toBe(SCRAMBLE_PRESETS.upper)
    expect(resolveScrambleCharset('')).toBe(SCRAMBLE_PRESETS.upper)
  })
})
