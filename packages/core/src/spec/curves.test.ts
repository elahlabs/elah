import { describe, expect, it } from 'vitest'
import { resolveCurve } from './curves'
import type { SpecIssue } from './types'

describe('resolveCurve', () => {
  it('undefined -> plain linear, no issue', () => {
    const issues: SpecIssue[] = []
    expect(resolveCurve(undefined, 'x', issues)).toEqual({ easing: 'linear' })
    expect(issues).toHaveLength(0)
  })

  it('a named easing -> { easing }', () => {
    const issues: SpecIssue[] = []
    expect(resolveCurve('cubic-out', 'x', issues)).toEqual({ easing: 'cubic-out' })
    expect(issues).toHaveLength(0)
  })

  it('a BEZIER_PRESETS id -> { easingBezier }, easing stays linear', () => {
    const issues: SpecIssue[] = []
    const result = resolveCurve('overshoot', 'x', issues)
    expect(result.easing).toBe('linear')
    expect(result.easingBezier).toEqual([0.34, 1.56, 0.64, 1])
    expect(issues).toHaveLength(0)
  })

  it('spring:<id> -> { spring } from SPRING_PRESETS, easing stays linear', () => {
    const issues: SpecIssue[] = []
    const result = resolveCurve('spring:bouncy', 'x', issues)
    expect(result.easing).toBe('linear')
    expect(result.spring).toEqual({ stiffness: 180, damping: 12, mass: 1 })
    expect(issues).toHaveLength(0)
  })

  it('unknown spring preset -> error issue, key keeps linear easing', () => {
    const issues: SpecIssue[] = []
    const result = resolveCurve('spring:nope', 'elements[0].keys[0].curve', issues)
    expect(result).toEqual({ easing: 'linear' })
    expect(issues).toEqual([{ severity: 'error', path: 'elements[0].keys[0].curve', code: 'unknown-curve', message: expect.any(String) }])
  })

  it('a wholly unknown curve name -> error issue, key keeps linear easing (never dropped)', () => {
    const issues: SpecIssue[] = []
    const result = resolveCurve('super-bouncy-deluxe', 'p', issues)
    expect(result).toEqual({ easing: 'linear' })
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.code).toBe('unknown-curve')
  })
})
