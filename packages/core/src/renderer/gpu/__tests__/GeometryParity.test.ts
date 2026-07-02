/**
 * GeometryParity — Export ↔ Preview placement math parity harness (Phase 3b).
 *
 * The two renderers place clips differently at the API level:
 *
 *   GPU renderer  (Preview)  — buildDrawTransformMatrix → GL clip-space 3×3 matrix.
 *   2D canvas     (Export)   — resolveDrawRect + canvas translate/rotate/drawImage.
 *
 * Both call resolveDrawRect with the same inputs, so geometric parity is
 * guaranteed by shared code. This test suite is a *regression guard*: if either
 * renderer ever diverges from the shared helper (or if the helper changes), at
 * least one assertion here will break before pixels do.
 *
 * What IS tested here (no GPU or real video required):
 *   - resolveDrawRect produces the expected rect for all transform modes
 *   - The GPU matrix derived from that rect maps the quad centre (0.5, 0.5)
 *     to the same NDC point as the 2D canvas centre formula
 *   - Both paths apply the same rotation (radians) about the same pixel centre
 *
 * What is NOT tested (requires a real browser with WebGL2):
 *   - Actual pixel output equality (needs preserveDrawingBuffer readback)
 *   - Shader blending / opacity compositing
 *   Use a Playwright golden-frame spec for full pixel comparison.
 */

import { describe, it, expect } from 'vitest'
import { resolveDrawRect, buildTransformMatrixFromRect } from '../layers/drawRect'
import type { Transform } from '../../../types'

const STAGE_W = 1920
const STAGE_H = 1080

// ---------------------------------------------------------------------------
// Helper: apply the 3×3 column-major matrix to a 2D point (homogeneous coords).
// ---------------------------------------------------------------------------
function applyMatrix(m: Float32Array, x: number, y: number): { x: number; y: number } {
  // Column-major layout: m[col * 3 + row]
  // [m0 m3 m6]   [x]
  // [m1 m4 m7] × [y]
  // [m2 m5 m8]   [1]
  return {
    x: m[0] * x + m[3] * y + m[6],
    y: m[1] * x + m[4] * y + m[7],
  }
}

/** Convert pixel (px, py) on the stage to NDC (clip space) coordinates. */
function pixelToNdc(px: number, py: number): { x: number; y: number } {
  return {
    x: (px / STAGE_W) * 2 - 1,
    y: (py / STAGE_H) * 2 - 1,
  }
}

// ---------------------------------------------------------------------------
// Core invariant: GPU matrix centre == 2D canvas centre
// ---------------------------------------------------------------------------

/**
 * For any rect, the GPU matrix should map the UV centre (0.5, 0.5) to the
 * same NDC coordinate as the 2D canvas centre formula:
 *   NDC_x = 2 * (rect.x + rect.width/2) / stageWidth - 1
 *   NDC_y = 2 * (rect.y + rect.height/2) / stageHeight - 1
 *
 * This verifies that both paths rotate about the same stage pixel.
 */
function assertCentresParity(transform: Transform | undefined, contentW: number, contentH: number) {
  const rect = resolveDrawRect(transform, STAGE_W, STAGE_H, contentW, contentH)
  const matrix = buildTransformMatrixFromRect(rect, STAGE_W, STAGE_H)

  // UV centre of the quad (the point both paths rotate around)
  const gpuCentre = applyMatrix(matrix, 0.5, 0.5)

  // 2D canvas: translate to (cx, cy), rotate, drawImage at (-w/2, -h/2, w, h)
  // → the rotation pivot is (cx, cy) in stage pixels
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const canvasCentre = pixelToNdc(cx, cy)

  expect(gpuCentre.x).toBeCloseTo(canvasCentre.x, 5)
  expect(gpuCentre.y).toBeCloseTo(canvasCentre.y, 5)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeometryParity — resolveDrawRect shared by both renderers', () => {
  it('no-transform + known content size → contain rect (letterbox)', () => {
    // 16:9 content (1280×720) in 1920×1080 stage → fills width, centred vertically.
    const rect = resolveDrawRect(undefined, STAGE_W, STAGE_H, 1280, 720)
    expect(rect.x).toBe(0)
    expect(rect.y).toBe(0)
    expect(rect.width).toBe(STAGE_W)
    expect(rect.height).toBe(STAGE_H)
    expect(rect.rotation).toBe(0)
  })

  it('no-transform + 4:3 content (1024×768) → pillarbox with letterbox', () => {
    // Content narrower than stage: should be contained inside stage
    const rect = resolveDrawRect(undefined, STAGE_W, STAGE_H, 1024, 768)
    // Aspect: 1024/768 ≈ 1.333; stage: 1920/1080 ≈ 1.777 → height-constrained
    const expectedH = STAGE_H
    const expectedW = Math.round((1024 / 768) * STAGE_H)
    const expectedX = Math.round((STAGE_W - expectedW) / 2)
    expect(rect.height).toBeCloseTo(expectedH, 0)
    expect(rect.width).toBeCloseTo(expectedW, 0)
    expect(rect.x).toBeCloseTo(expectedX, 0)
    expect(rect.y).toBe(0)
  })

  it('no-transform + unknown content size → fills stage', () => {
    const rect = resolveDrawRect(undefined, STAGE_W, STAGE_H)
    expect(rect).toEqual({ x: 0, y: 0, width: STAGE_W, height: STAGE_H, rotation: 0 })
  })

  it('explicit transform at stage centre, scale 1 → content fills stage', () => {
    const transform: Transform = {
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
    }
    const rect = resolveDrawRect(transform, STAGE_W, STAGE_H, STAGE_W, STAGE_H)
    expect(rect.x).toBeCloseTo(0, 5)
    expect(rect.y).toBeCloseTo(0, 5)
    expect(rect.width).toBeCloseTo(STAGE_W, 5)
    expect(rect.height).toBeCloseTo(STAGE_H, 5)
  })

  it('explicit transform at top-left corner → clip anchored at (0, 0)', () => {
    const transform: Transform = {
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      anchor: { x: 0, y: 0 },
    }
    const rect = resolveDrawRect(transform, STAGE_W, STAGE_H, 400, 300)
    expect(rect.x).toBe(0)
    expect(rect.y).toBe(0)
    expect(rect.width).toBe(400)
    expect(rect.height).toBe(300)
  })

  it('scale 0.5 halves content dimensions', () => {
    const transform: Transform = {
      x: 0.5,
      y: 0.5,
      scale: 0.5,
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
    }
    const rect = resolveDrawRect(transform, STAGE_W, STAGE_H, 1920, 1080)
    expect(rect.width).toBeCloseTo(960, 5)
    expect(rect.height).toBeCloseTo(540, 5)
  })
})

describe('GeometryParity — GPU matrix centre == 2D canvas centre', () => {
  it('no-transform full-fill (1920×1080 content)', () => {
    assertCentresParity(undefined, STAGE_W, STAGE_H)
  })

  it('no-transform 4:3 content (pillarboxed)', () => {
    assertCentresParity(undefined, 1024, 768)
  })

  it('explicit centre transform, scale 1', () => {
    const t: Transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }
    assertCentresParity(t, STAGE_W, STAGE_H)
  })

  it('off-centre transform (top-left quadrant)', () => {
    const t: Transform = { x: 0.25, y: 0.25, scale: 0.5, rotation: 0, anchor: { x: 0.5, y: 0.5 } }
    assertCentresParity(t, STAGE_W, STAGE_H)
  })

  it('rotated clip — centre is the rotation pivot in both paths', () => {
    const t: Transform = {
      x: 0.5,
      y: 0.5,
      scale: 0.8,
      rotation: Math.PI / 4,
      anchor: { x: 0.5, y: 0.5 },
    }
    assertCentresParity(t, 640, 360)
  })

  it('clip positioned at bottom-right corner', () => {
    const t: Transform = { x: 0.9, y: 0.9, scale: 0.3, rotation: 0, anchor: { x: 0.5, y: 0.5 } }
    assertCentresParity(t, 400, 300)
  })
})

describe('GeometryParity — rotation is identical in both paths', () => {
  it('both paths use rect.rotation (radians) about the same pixel centre', () => {
    const rotation = Math.PI / 6 // 30 degrees
    const t: Transform = {
      x: 0.5,
      y: 0.5,
      scale: 0.5,
      rotation,
      anchor: { x: 0.5, y: 0.5 },
    }
    const rect = resolveDrawRect(t, STAGE_W, STAGE_H, 800, 450)

    // Both paths rotate by rect.rotation — verify it matches the input.
    expect(rect.rotation).toBe(rotation)

    // The GPU matrix encodes rotation via cos/sin in columns 0 and 1.
    // buildTransformMatrixFromRect uses sc=cos(rotation), ss=sin(rotation).
    // Verify the matrix diagonal encodes the correct cos value.
    const matrix = buildTransformMatrixFromRect(rect, STAGE_W, STAGE_H)
    const ws = rect.width / STAGE_W
    const hs = rect.height / STAGE_H
    const sc = Math.cos(rotation)
    const ss = Math.sin(rotation)
    expect(matrix[0]).toBeCloseTo(2 * sc * ws, 7) // top-left of matrix
    expect(matrix[4]).toBeCloseTo(2 * sc * hs, 7) // centre of matrix
    expect(matrix[1]).toBeCloseTo(2 * ss * ws, 7) // rotation term
    expect(matrix[3]).toBeCloseTo(-2 * ss * hs, 7) // rotation term
  })
})
