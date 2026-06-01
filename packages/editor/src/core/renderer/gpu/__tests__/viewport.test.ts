import { describe, expect, it } from 'vitest'
import { computeContainViewport } from '../viewport'

describe('computeContainViewport', () => {
  it('fills the whole canvas when aspects match', () => {
    // 16:9 stage in a 16:9 canvas.
    expect(computeContainViewport(1600, 900, 1280, 720)).toEqual({
      x: 0,
      y: 0,
      width: 1600,
      height: 900,
    })
  })

  it('pillarboxes a portrait stage in a landscape canvas', () => {
    // 1080×1920 (9:16) project in a 1600×900 panel → bars left/right.
    const vp = computeContainViewport(1600, 900, 1080, 1920)
    expect(vp.height).toBe(900) // height is the limiting dimension
    expect(vp.width).toBe(Math.round(900 * (1080 / 1920))) // 506
    expect(vp.y).toBe(0)
    expect(vp.x).toBe(Math.round((1600 - vp.width) / 2)) // centred
    // Inner rect is strictly narrower than the canvas → real pillarbox.
    expect(vp.width).toBeLessThan(1600)
  })

  it('letterboxes a landscape stage in a portrait canvas', () => {
    // 1920×1080 (16:9) project in a 600×900 panel → bars top/bottom.
    const vp = computeContainViewport(600, 900, 1920, 1080)
    expect(vp.width).toBe(600) // width is the limiting dimension
    expect(vp.height).toBe(Math.round(600 / (1920 / 1080))) // 338
    expect(vp.x).toBe(0)
    expect(vp.y).toBe(Math.round((900 - vp.height) / 2)) // centred
    expect(vp.height).toBeLessThan(900)
  })

  it('centres the fitted rect within the canvas', () => {
    const vp = computeContainViewport(1000, 1000, 1000, 500) // 2:1 in a square
    expect(vp.width).toBe(1000)
    expect(vp.height).toBe(500)
    expect(vp.y).toBe(250) // (1000 - 500) / 2
    expect(vp.x).toBe(0)
  })

  it('falls back to the full canvas on degenerate inputs', () => {
    expect(computeContainViewport(800, 600, 0, 0)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    })
    expect(computeContainViewport(0, 0, 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    })
  })
})
