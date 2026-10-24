/**
 * EDX-P2: every registry kind has exactly one GPU implementation, and the
 * pure param → uniform maths behaves.
 */

import { describe, expect, it } from 'vitest'
import { EFFECT_REGISTRY, defaultEffectParams } from '../../../effects/registry'
import { GPU_EFFECTS } from '../effects'
import { letterboxBar } from '../effects/letterbox'
import type { EffectEnv } from '../effects/types'

const ENV: EffectEnv = {
  pass: 0,
  size: [1000, 600],
  inner: [0.1, 0.1, 0.8, 0.8],
  pxPerStagePx: [0.5, 0.5],
  frame: 30,
  time: 1,
}

describe('GPU effect registry parity', () => {
  it('lists exactly the kinds the registry lists', () => {
    expect([...GPU_EFFECTS.keys()].sort()).toEqual([...EFFECT_REGISTRY.keys()].sort())
  })

  for (const [kind, gpu] of GPU_EFFECTS) {
    describe(kind, () => {
      const params = defaultEffectParams(kind)

      it('is a complete GLSL ES 3.00 fragment shader', () => {
        expect(gpu.frag.startsWith('#version 300 es')).toBe(true)
        expect(gpu.frag).toContain('void main()')
        expect(gpu.frag).toContain('fragColor')
      })

      it('declares every uniform it sets, with finite values on default params', () => {
        const passes = gpu.passes(params)
        expect(passes).toBeGreaterThanOrEqual(1)
        for (let pass = 0; pass < passes; pass++) {
          const uniforms = gpu.uniforms(params, { ...ENV, pass })
          for (const [name, value] of Object.entries(uniforms)) {
            expect(gpu.frag, `${kind} sets ${name}`).toMatch(new RegExp(`uniform \\w+ ${name};`))
            const values = typeof value === 'number' ? [value] : [...value]
            expect([1, 2, 3, 4]).toContain(values.length)
            for (const v of values) expect(Number.isFinite(v), `${kind}.${name}`).toBe(true)
          }
        }
      })

      it('has a non-negative padding', () => {
        expect(gpu.padding?.(params, { width: 1920, height: 1080 }) ?? 0).toBeGreaterThanOrEqual(0)
      })
    })
  }
})

describe('uniform maths', () => {
  it('gaussianBlur runs horizontal then vertical with σ = radius × scale / 2', () => {
    const blur = GPU_EFFECTS.get('gaussianBlur')!
    const params = { radius: 20 }
    expect(blur.passes(params)).toBe(2)
    const env: EffectEnv = { ...ENV, pxPerStagePx: [0.5, 0.25] }
    expect(blur.uniforms(params, { ...env, pass: 0 })).toEqual({ uDir: [1, 0], uSigma: 5 })
    expect(blur.uniforms(params, { ...env, pass: 1 })).toEqual({ uDir: [0, 1], uSigma: 2.5 })
    expect(blur.padding!(params, { width: 100, height: 100 })).toBe(30)
  })

  it('colorGrade sends hue in radians and never a zero gamma', () => {
    const grade = GPU_EFFECTS.get('colorGrade')!
    const u = grade.uniforms({ ...defaultEffectParams('colorGrade'), hue: 90, gamma: 0 }, ENV)
    expect(u.uHue).toBeCloseTo(Math.PI / 2)
    expect((u.uLiftGammaGain as number[])[1]).toBeGreaterThan(0)
  })

  it('rgbSplit offsets along the angle, as a fraction of the box width', () => {
    const split = GPU_EFFECTS.get('rgbSplit')!
    // amount 0.01 of an 800 px box = 8 px.
    const flat = split.uniforms({ amount: 0.01, angle: 0 }, ENV).uOffset as number[]
    expect(flat[0]).toBeCloseTo(8 / 1000)
    expect(flat[1]).toBeCloseTo(0)
    const down = split.uniforms({ amount: 0.01, angle: 90 }, ENV).uOffset as number[]
    expect(down[0]).toBeCloseTo(0)
    expect(down[1]).toBeCloseTo(8 / 600)
  })

  it('grain moves with the frame only when animated', () => {
    const g = GPU_EFFECTS.get('grain')!
    const still = { amount: 0.3, size: 2, seed: 5, animated: false }
    expect(g.uniforms(still, ENV).uSeed).toBe(5)
    expect(g.uniforms({ ...still, animated: true }, ENV).uSeed).toBe(35)
    expect(g.uniforms(still, ENV).uCell).toBe(1)
  })

  it('letterbox bars appear only when the target is wider than the box', () => {
    expect(letterboxBar(2.39, 16 / 9)).toBeCloseTo((1 - 16 / 9 / 2.39) / 2)
    expect(letterboxBar(1.5, 16 / 9)).toBe(0)
    expect(letterboxBar(2.39, 0)).toBe(0)
  })
})
