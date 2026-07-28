import { describe, expect, it } from 'vitest'
import {
  computeVisibleWindow,
  isClipVisible,
  QUANTUM_PX,
  SHOW_ALL_WINDOW,
  VIRTUALIZATION_BUFFER_PX,
  type VisibleWindow,
} from './visible-window'

describe('isClipVisible', () => {
  // window [1000, 2000] + buffer 200 => effective visible span (800, 2200)
  const window: VisibleWindow = { start: 1000, end: 2000 }
  const buffer = 200

  it('is false for a clip fully left of window - buffer', () => {
    expect(isClipVisible(500, 700, window, buffer)).toBe(false)
  })

  it('is false for a clip fully right of window + buffer', () => {
    expect(isClipVisible(2300, 2500, window, buffer)).toBe(false)
  })

  it('is true for a clip straddling the left edge', () => {
    expect(isClipVisible(700, 900, window, buffer)).toBe(true)
  })

  it('is true for a clip straddling the right edge', () => {
    expect(isClipVisible(2100, 2300, window, buffer)).toBe(true)
  })

  it('is true for a clip fully inside the window', () => {
    expect(isClipVisible(1200, 1400, window, buffer)).toBe(true)
  })

  it('is false when the clip ends exactly at window.start - buffer (strict >)', () => {
    expect(isClipVisible(600, 800, window, buffer)).toBe(false)
  })

  it('is false when the clip starts exactly at window.end + buffer (strict <)', () => {
    expect(isClipVisible(2200, 2400, window, buffer)).toBe(false)
  })

  it('is true just inside the left buffer edge (+1px)', () => {
    expect(isClipVisible(600, 801, window, buffer)).toBe(true)
  })

  it('is true just inside the right buffer edge (-1px)', () => {
    expect(isClipVisible(2199, 2400, window, buffer)).toBe(true)
  })

  it('handles the real VIRTUALIZATION_BUFFER_PX constant consistently', () => {
    const w: VisibleWindow = { start: 0, end: 500 }
    // Just outside the real buffer to the left.
    expect(
      isClipVisible(-VIRTUALIZATION_BUFFER_PX - 10, -VIRTUALIZATION_BUFFER_PX - 5, w, VIRTUALIZATION_BUFFER_PX),
    ).toBe(false)
    // Just inside the real buffer to the left.
    expect(
      isClipVisible(-VIRTUALIZATION_BUFFER_PX - 10, -VIRTUALIZATION_BUFFER_PX + 1, w, VIRTUALIZATION_BUFFER_PX),
    ).toBe(true)
  })
})

describe('isClipVisible with SHOW_ALL_WINDOW', () => {
  it('is true for any finite clip (±Infinity math is safe)', () => {
    expect(isClipVisible(0, 100, SHOW_ALL_WINDOW, VIRTUALIZATION_BUFFER_PX)).toBe(true)
    expect(isClipVisible(-1_000_000, -999_900, SHOW_ALL_WINDOW, VIRTUALIZATION_BUFFER_PX)).toBe(true)
    expect(isClipVisible(1_000_000, 2_000_000, SHOW_ALL_WINDOW, VIRTUALIZATION_BUFFER_PX)).toBe(true)
    // Even a zero-duration clip is visible: strict inequalities against ±Infinity
    // are always true for any finite value.
    expect(isClipVisible(0, 0, SHOW_ALL_WINDOW, VIRTUALIZATION_BUFFER_PX)).toBe(true)
  })
})

describe('computeVisibleWindow', () => {
  const sidebarWidth = 184

  it('always returns a quantized superset of the true window', () => {
    const cases: Array<[scrollLeft: number, containerWidth: number]> = [
      [0, 1000],
      [50, 1000],
      [250, 1200],
      [999, 500],
      [1, 201],
      [12345, 4321],
    ]

    for (const [scrollLeft, containerWidth] of cases) {
      const trueStart = scrollLeft
      const trueEnd = scrollLeft + Math.max(0, containerWidth - sidebarWidth)
      const result = computeVisibleWindow(scrollLeft, containerWidth, sidebarWidth, QUANTUM_PX)

      expect(result.start).toBeLessThanOrEqual(trueStart)
      expect(result.end).toBeGreaterThanOrEqual(trueEnd)
      expect(result.start % QUANTUM_PX).toBe(0)
      expect(result.end % QUANTUM_PX).toBe(0)
    }
  })

  it('subtracts the sidebar width from the container width for the true span', () => {
    // quantum = 1 disables quantization rounding so the raw subtraction is visible.
    const result = computeVisibleWindow(0, 1000, 184, 1)
    expect(result).toEqual({ start: 0, end: 816 })
  })

  it('clamps the span to 0 when containerWidth < sidebarWidth', () => {
    // quantum = 1 avoids masking a negative pre-quantize span.
    const result = computeVisibleWindow(50, 100, 184, 1)
    expect(result.start).toBe(50)
    expect(result.end).toBe(50)
    expect(result.end - result.start).toBe(0)
  })

  it('returns start 0 for scrollLeft 0', () => {
    const result = computeVisibleWindow(0, 1000, 184, QUANTUM_PX)
    expect(result.start).toBe(0)
  })

  it('gives identical windows for two scrollLefts within the same quantum step', () => {
    const a = computeVisibleWindow(100, 1000, 184, QUANTUM_PX)
    const b = computeVisibleWindow(150, 1000, 184, QUANTUM_PX)
    expect(a).toEqual(b)
    expect(a).toEqual({ start: 0, end: 1000 })
  })

  it('gives a different window once scrollLeft crosses into the next quantum step', () => {
    const withinStep = computeVisibleWindow(100, 1000, 184, QUANTUM_PX)
    const nextStep = computeVisibleWindow(200, 1000, 184, QUANTUM_PX)
    expect(nextStep.start).not.toBe(withinStep.start)
  })
})
