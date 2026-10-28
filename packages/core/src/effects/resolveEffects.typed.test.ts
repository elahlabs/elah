import { describe, expect, it } from 'vitest'
import type { Effect } from '../types'
import { resolveEffects } from './resolveEffects'

function vignette(color = '#000000'): Effect {
  return { id: 'v1', kind: 'vignette', params: { amount: 0.4, radius: 0.75, softness: 0.45, color } }
}

describe('resolveEffects colour channels (PV-P5c)', () => {
  it('a keyed colour replaces the stored one', () => {
    const [r] = resolveEffects([vignette('#000000')], {}, { 'fx.v1.color': '#ff0000' })
    expect(r!.params.color).toBe('#ff0000')
  })

  it('with no colours argument, the stored colour is used', () => {
    const [r] = resolveEffects([vignette('#000000')])
    expect(r!.params.color).toBe('#000000')
  })

  it('a bad colour string in `colors` falls back through clampParam to the registry default', () => {
    const [r] = resolveEffects([vignette('#112233')], {}, { 'fx.v1.color': 'not-a-colour' })
    expect(r!.params.color).toBe('#000000')
  })
})
