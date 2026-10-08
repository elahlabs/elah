import { describe, expect, it } from 'vitest'
import { transitionGeometry } from './transitionGeometry'

/**
 * The type offered four directions and the picture moved in one: `up` and
 * `down` fell through to `right` for a slide, and a wipe ignored direction
 * altogether. These are the four, for both kinds.
 */
describe('transitionGeometry', () => {
  it('slides the outgoing picture off the edge it was told to', () => {
    expect(transitionGeometry('slide', 'left', 0.5)).toMatchObject({ x: -0.5, y: 0 })
    expect(transitionGeometry('slide', 'right', 0.5)).toMatchObject({ x: 0.5, y: 0 })
    expect(transitionGeometry('slide', 'up', 0.5)).toMatchObject({ x: 0, y: -0.5 })
    expect(transitionGeometry('slide', 'down', 0.5)).toMatchObject({ x: 0, y: 0.5 })
  })

  it('wipes the outgoing picture away from the edge it was told to', () => {
    expect(transitionGeometry('wipe', 'left', 0.25).inset).toEqual({
      bottom: 0,
      left: 0.25,
      right: 0,
      top: 0,
    })
    expect(transitionGeometry('wipe', 'up', 0.25).inset).toEqual({
      bottom: 0,
      left: 0,
      right: 0,
      top: 0.25,
    })
    expect(transitionGeometry('wipe', 'down', 0.25).inset.bottom).toBe(0.25)
    expect(transitionGeometry('wipe', 'right', 0.25).inset.right).toBe(0.25)
  })

  it('keeps the old default when a project never said which way', () => {
    expect(transitionGeometry('slide', undefined, 0.4).x).toBe(0.4)
    expect(transitionGeometry('wipe', undefined, 0.4).inset.right).toBe(0.4)
  })

  it('a slide never clips and a wipe never moves', () => {
    expect(transitionGeometry('slide', 'up', 0.7).inset).toEqual({
      bottom: 0,
      left: 0,
      right: 0,
      top: 0,
    })
    expect(transitionGeometry('wipe', 'down', 0.7)).toMatchObject({ x: 0, y: 0 })
  })

  it('leaves a fade where it is — it is composited by opacity', () => {
    expect(transitionGeometry('fade', 'left', 0.6)).toEqual({
      inset: { bottom: 0, left: 0, right: 0, top: 0 },
      x: 0,
      y: 0,
    })
  })

  it('clamps progress to the window', () => {
    expect(transitionGeometry('slide', 'left', -1).x).toBe(0)
    expect(transitionGeometry('slide', 'left', 5).x).toBe(-1)
  })
})
