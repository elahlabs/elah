import { describe, expect, it } from 'vitest'
import { validateScene } from '@elah/core/html'
import { STARTERS } from './starters'

describe('motion playground starters', () => {
  it('has the three starter scenes from the brief', () => {
    expect(STARTERS.map((s) => s.id)).toEqual(['title-card', 'lower-third', 'stat-counter'])
  })

  for (const s of STARTERS) {
    it(`${s.id} passes validateScene with no violations`, () => {
      const verdict = validateScene({ html: s.html, css: s.css })
      expect(verdict.violations.map((v) => `${v.element}: ${v.message}`)).toEqual([])
      expect(verdict.ok).toBe(true)
    })
  }
})
