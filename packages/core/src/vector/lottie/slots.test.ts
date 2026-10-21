import { describe, expect, it } from 'vitest'
import { createSlotRegistry, normalizeHex, slotNameOf } from './slots'

describe('slots', () => {
  it('reads $name', () => {
    expect(slotNameOf('$accent')).toBe('accent')
    expect(slotNameOf(' $Brand_2 ')).toBe('Brand_2')
    expect(slotNameOf('accent')).toBeUndefined()
    expect(slotNameOf('$')).toBeUndefined()
    expect(slotNameOf(undefined)).toBeUndefined()
  })

  it('normalises hex', () => {
    expect(normalizeHex('#F0A')).toBe('#ff00aa')
    expect(normalizeHex('#FF3D7F')).toBe('#ff3d7f')
    expect(normalizeHex('rgba(1, 2, 3, 0.5)')).toBeUndefined()
  })

  it('matches by name, then by an option colour, case-insensitively', () => {
    const reg = createSlotRegistry({ accent: '#FF3D7F' })
    expect(reg.match('$brand', '#112233')).toEqual({ name: 'brand' })
    expect(reg.match('Fill 1', '#ff3d7f')).toEqual({ name: 'accent' })
    expect(reg.match('Fill 1', '#000000')).toBeUndefined()
    expect(reg.match('$brand', 'rgba(1, 2, 3, 0.5)')?.reason).toMatch(/translucent/)
  })

  it('counts uses and keeps the first colour as the default', () => {
    const reg = createSlotRegistry(undefined)
    reg.use('accent', '#ff3d7f')
    reg.use('accent', '#000000')
    expect(reg.uses()).toEqual([{ name: 'accent', value: '#ff3d7f', count: 2 }])
    expect(reg.props()).toMatchObject([{ name: 'accent', type: 'color', default: '#ff3d7f' }])
  })
})
