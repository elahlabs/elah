import { describe, expect, it } from 'vitest'
import {
  EFFECT_REGISTRY,
  applyEffectPreset,
  clampEffectParams,
  createEffect,
  defaultEffectParams,
  effectsFor,
  getEffectDefinition,
  keyframeableColorParams,
  keyframeableParams,
} from './registry'

const FIRST_KINDS = [
  'colorGrade',
  'gaussianBlur',
  'vignette',
  'grain',
  'rgbSplit',
  'letterbox',
  'chromaticAberration',
  'scanlines',
]

/** EDX-P9: light, distortion, glitch v2. */
const P9_KINDS = [
  'bloom',
  'glow',
  'flash',
  'strobe',
  'lightRays',
  'wave',
  'twirl',
  'bulge',
  'fisheye',
  'displace',
  'vhs',
  'crt',
  'pixelate',
  'glitchBlocks',
]
/** MI-P8: motion blur along the clip's own velocity. */
const MI_KINDS = ['motionBlur']
const ALL_KINDS = [...FIRST_KINDS, ...P9_KINDS, ...MI_KINDS]

describe('effect registry', () => {
  it('registers the first-phase kinds, then the EDX-P9 kinds', () => {
    expect([...EFFECT_REGISTRY.keys()]).toEqual(ALL_KINDS)
  })

  it('every param default sits inside its own range and type', () => {
    for (const def of EFFECT_REGISTRY.values()) {
      for (const [name, pd] of Object.entries(def.params)) {
        const where = `${def.kind}.${name}`
        if (pd.type === 'number') {
          expect(typeof pd.default, where).toBe('number')
          if (pd.min !== undefined) expect(pd.default as number, where).toBeGreaterThanOrEqual(pd.min)
          if (pd.max !== undefined) expect(pd.default as number, where).toBeLessThanOrEqual(pd.max)
        } else if (pd.type === 'color') {
          expect(pd.default, where).toMatch(/^#[0-9a-f]{6}$/)
          // PV-P5c: colour params are keyframeable now (a `vec`-keyed channel).
          expect(pd.keyframeable, where).toBe(true)
        } else if (pd.type === 'boolean') {
          expect(typeof pd.default, where).toBe('boolean')
          expect(pd.keyframeable, where).toBe(false)
        }
      }
    }
  })

  it('every preset names only real params, and applying it keeps them in range', () => {
    for (const def of EFFECT_REGISTRY.values()) {
      for (const preset of def.presets ?? []) {
        for (const name of Object.keys(preset.params)) {
          expect(def.params[name], `${def.kind}/${preset.id}.${name}`).toBeDefined()
        }
        const applied = applyEffectPreset(createEffect(def.kind), preset.id)
        expect(applied.params).toEqual(clampEffectParams(def.kind, applied.params))
      }
    }
  })

  it('every kind renders on the GPU and applies to no audio clip', () => {
    for (const def of EFFECT_REGISTRY.values()) {
      expect(def.render.gpu).toBe(true)
      expect(def.render.passes).toBeGreaterThanOrEqual(1)
      expect(def.appliesTo).not.toContain('audio')
    }
    expect(effectsFor('audio')).toEqual([])
    expect(effectsFor('video').map((d) => d.kind)).toEqual(ALL_KINDS)
  })
})

describe('motionBlur (MI-P8)', () => {
  const def = EFFECT_REGISTRY.get('motionBlur')!

  it('is a one-pass blur-category effect that bleeds 200 px and has no Canvas2D twin', () => {
    expect(def.category).toBe('blur')
    expect(def.render).toEqual({ gpu: true, canvas2d: false, passes: 1, padding: 200 })
  })

  it('shutter is keyframeable; samples is an integer and is not', () => {
    expect(keyframeableParams('motionBlur')).toContain('shutter')
    expect(keyframeableParams('motionBlur')).not.toContain('samples')
    expect(clampEffectParams('motionBlur', { samples: 11.6 })?.samples).toBe(12)
    expect(clampEffectParams('motionBlur', { samples: 2 })?.samples).toBe(4)
    expect(clampEffectParams('motionBlur', { samples: 99 })?.samples).toBe(32)
  })

  it('clamps every range and defaults to following the clip', () => {
    expect(defaultEffectParams('motionBlur')).toEqual({
      shutter: 0.5,
      samples: 12,
      minPx: 1.5,
      auto: true,
      angle: 0,
      length: 40,
    })
    expect(clampEffectParams('motionBlur', { shutter: 4, minPx: 99, angle: 400, length: 900, auto: 'no' })).toMatchObject({
      shutter: 1,
      minPx: 20,
      angle: 180,
      length: 200,
      auto: true,
    })
  })

  it('drops the resolver-supplied velocity inputs: they are not params', () => {
    const out = clampEffectParams('motionBlur', { velX: 40, velY: 3, velSpin: 1, velZoom: 1 })!
    expect(Object.keys(out).sort()).toEqual(['angle', 'auto', 'length', 'minPx', 'samples', 'shutter'])
  })
})

describe('clampEffectParams', () => {
  it('fills defaults, clamps numbers, rounds integers and drops unknown names', () => {
    const out = clampEffectParams('grain', { amount: 5, size: -1, seed: 12.7, bogus: 1 })
    expect(out).toEqual({ amount: 1, size: 0.5, seed: 13, animated: true })
  })

  it('replaces non-finite numbers, bad colours and wrong types with defaults', () => {
    expect(clampEffectParams('vignette', { amount: Number.NaN, color: 'red' })).toEqual(
      defaultEffectParams('vignette'),
    )
    expect(clampEffectParams('grain', { animated: 'yes' })?.animated).toBe(true)
    expect(clampEffectParams('vignette', { color: '#AABBCC' })?.color).toBe('#aabbcc')
  })

  it('returns null for an unknown kind and tolerates junk input', () => {
    expect(clampEffectParams('nope', {})).toBeNull()
    expect(clampEffectParams('letterbox', null)).toEqual(defaultEffectParams('letterbox'))
    expect(clampEffectParams('letterbox', 'x')).toEqual(defaultEffectParams('letterbox'))
  })
})

describe('createEffect / applyEffectPreset', () => {
  it('creates an effect with a fresh id and defaults', () => {
    const a = createEffect('vignette')
    const b = createEffect('vignette')
    expect(a.id).not.toBe(b.id)
    expect(a).toMatchObject({ kind: 'vignette', params: defaultEffectParams('vignette') })
    expect(a.preset).toBeUndefined()
  })

  it('lays a preset over the current params and records it', () => {
    const e = createEffect('colorGrade', 'noir')
    expect(e.preset).toBe('noir')
    expect(e.params.saturation).toBe(0)
    expect(e.params.exposure).toBe(0) // not in the preset → default kept
  })

  it('keeps params the preset does not mention', () => {
    const custom = { ...createEffect('colorGrade'), params: { ...defaultEffectParams('colorGrade'), exposure: 0.5 } }
    expect(applyEffectPreset(custom, 'teal-orange').params.exposure).toBe(0.5)
  })

  it('throws on an unknown kind or preset — call-site errors, not data errors', () => {
    expect(() => createEffect('nope')).toThrow()
    expect(() => createEffect('vignette', 'nope')).toThrow()
  })
})

describe('keyframeableParams', () => {
  it('lists numeric keyframeable params only', () => {
    expect(keyframeableParams('grain')).toEqual(['amount', 'size'])
    expect(keyframeableParams('vignette')).toEqual(['amount', 'radius', 'softness'])
    expect(keyframeableParams('nope')).toEqual([])
    expect(getEffectDefinition('nope')).toBeUndefined()
  })
})

describe('keyframeableColorParams', () => {
  it('lists colour keyframeable params only (PV-P5c)', () => {
    expect(keyframeableColorParams('vignette')).toEqual(['color'])
    expect(keyframeableColorParams('bloom')).toEqual(['tint'])
    expect(keyframeableColorParams('grain')).toEqual([])
    expect(keyframeableColorParams('nope')).toEqual([])
  })
})
