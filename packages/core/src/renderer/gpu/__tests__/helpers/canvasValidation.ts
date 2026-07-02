/**
 * Canvas validation helpers for GPU renderer regression testing.
 */

import { expect } from 'vitest'

export type Rgba = [number, number, number, number]

/** Read pixel data from a canvas element. */
export function captureFrame(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('canvasValidation: 2D context unavailable')
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/** Sample a single pixel from ImageData. */
export function samplePixel(data: ImageData, x: number, y: number): Rgba {
  const idx = (y * data.width + x) * 4
  return [
    data.data[idx] ?? 0,
    data.data[idx + 1] ?? 0,
    data.data[idx + 2] ?? 0,
    data.data[idx + 3] ?? 0,
  ]
}

/** Stable djb2 hash of raw pixel bytes for regression comparison. */
export function hashFrame(data: ImageData): string {
  let hash = 5381
  for (let i = 0; i < data.data.length; i++) {
    hash = (hash * 33) ^ data.data[i]!
  }
  return (hash >>> 0).toString(16)
}

/** Returns true when every pixel is near transparent black. */
export function isBlankFrame(data: ImageData, tolerance = 4): boolean {
  for (let i = 0; i < data.data.length; i += 4) {
    const r = data.data[i] ?? 0
    const g = data.data[i + 1] ?? 0
    const b = data.data[i + 2] ?? 0
    const a = data.data[i + 3] ?? 0
    if (r > tolerance || g > tolerance || b > tolerance || a > tolerance) {
      return false
    }
  }
  return true
}

/** Vitest helper: assert pixel colour within tolerance. */
export function expectPixelApprox(
  data: ImageData,
  x: number,
  y: number,
  expected: Rgba,
  tolerance = 8,
): void {
  const actual = samplePixel(data, x, y)
  for (let i = 0; i < 4; i++) {
    expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(tolerance)
  }
}
