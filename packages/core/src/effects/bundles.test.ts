import { describe, expect, it } from 'vitest'
import { EFFECT_BUNDLES, bundleEffects, findEffectBundle } from './bundles'
import { EFFECT_REGISTRY, clampEffectParams } from './registry'
import { GPU_EFFECTS } from '../renderer/gpu/effects'

describe('effect bundles', () => {
  it('only use registered kinds and in-range params', () => {
    for (const b of EFFECT_BUNDLES) {
      for (const e of b.effects) {
        expect(EFFECT_REGISTRY.has(e.kind), `${b.id}: ${e.kind}`).toBe(true)
        const clamped = clampEffectParams(e.kind, e.params)!
        for (const [k, v] of Object.entries(e.params ?? {})) expect(clamped[k], `${b.id}.${e.kind}.${k}`).toBe(v)
      }
    }
  })

  it('expand into fresh, distinct effect entries', () => {
    const a = bundleEffects('vhs-90s')
    const b = bundleEffects('vhs-90s')
    expect(a.map((e) => e.kind)).toEqual(['colorGrade', 'vhs', 'grain'])
    expect(a[0]!.id).not.toBe(b[0]!.id)
    expect(a[1]!.params.amount).toBe(0.7)
    expect(bundleEffects('nope')).toEqual([])
    expect(findEffectBundle('noir-film')?.label).toBe('Noir film')
  })
})

describe('P9 effect uniforms', () => {
  const env = { pass: 0, size: [1000, 500] as const, inner: [0.1, 0.1, 0.8, 0.8] as const, pxPerStagePx: [0.5, 0.5] as const, frame: 45, time: 1.5 }

  it('bloom and glow radii are stage px scaled to chain uv', () => {
    const u = GPU_EFFECTS.get('bloom')!.uniforms({ radius: 20 }, env)
    expect(u.uRadius).toEqual([10 / 1000, 10 / 500])
    expect(GPU_EFFECTS.get('glow')!.padding!({ radius: 30 }, { width: 1, height: 1 })).toBe(30)
  })

  it('strobe mode picks white or black', () => {
    expect(GPU_EFFECTS.get('strobe')!.uniforms({ mode: 'black' }, env).uColor).toEqual([0, 0, 0])
    expect(GPU_EFFECTS.get('strobe')!.uniforms({ mode: 'white' }, env).uColor).toEqual([1, 1, 1])
  })

  it('twirl sends radians and flips the centre to GL orientation', () => {
    const u = GPU_EFFECTS.get('twirl')!.uniforms({ angle: 90, centerX: 0.25, centerY: 0.25, radius: 0.5 }, env)
    expect(u.uAngle).toBeCloseTo(Math.PI / 2)
    expect(u.uCenter).toEqual([0.25, 0.75])
    expect(u.uAspect).toBeCloseTo((0.8 * 1000) / (0.8 * 500))
  })

  it('pixelate counts cells in stage px, independent of preview scale', () => {
    const u = GPU_EFFECTS.get('pixelate')!.uniforms({ size: 10 }, env).uCells as number[]
    // Box = 800×400 chain px at 0.5 chain px per stage px = 1600×800 stage px → 160×80 cells.
    expect(u).toEqual([160, 80])
  })

  it('glitch blocks tick with time, not every frame', () => {
    const g = GPU_EFFECTS.get('glitchBlocks')!
    expect(g.uniforms({ speed: 4 }, { ...env, time: 1.1 }).uTick).toBe(4)
    expect(g.uniforms({ speed: 4 }, { ...env, time: 1.2 }).uTick).toBe(4)
    expect(g.uniforms({ speed: 4 }, { ...env, time: 1.3 }).uTick).toBe(5)
  })
})
