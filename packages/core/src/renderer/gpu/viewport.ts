/**
 * Letterbox / pillarbox geometry for the GPU renderer.
 *
 * The canvas backing store fills the host container (any aspect). The project
 * renders into an inner rectangle that preserves the project's aspect ratio
 * (`Scene.stage`), centred in the canvas. The surrounding margins are left as the
 * cleared (black) framebuffer — that is the letterbox / pillarbox.
 */

/** A pixel rectangle in framebuffer coordinates (origin bottom-left, GL convention). */
export interface ViewportRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Compute the largest rectangle of `stage` aspect that fits inside the canvas,
 * centred. Integer-rounded so `gl.viewport` gets whole pixels.
 *
 * - Canvas wider than the stage aspect → pillarbox (bars left/right).
 * - Canvas taller than the stage aspect → letterbox (bars top/bottom).
 * - Equal aspect → fills the whole canvas.
 *
 * Degenerate inputs (any dimension ≤ 0) fall back to the full canvas rect so the
 * renderer never produces a zero-area viewport.
 */
export function computeContainViewport(
  canvasWidth: number,
  canvasHeight: number,
  stageWidth: number,
  stageHeight: number,
): ViewportRect {
  if (canvasWidth <= 0 || canvasHeight <= 0 || stageWidth <= 0 || stageHeight <= 0) {
    return {
      x: 0,
      y: 0,
      width: Math.max(canvasWidth, 0),
      height: Math.max(canvasHeight, 0),
    }
  }

  const canvasAspect = canvasWidth / canvasHeight
  const stageAspect = stageWidth / stageHeight

  let width: number
  let height: number
  if (canvasAspect > stageAspect) {
    // Canvas is wider → height is the limiting dimension → pillarbox.
    height = canvasHeight
    width = height * stageAspect
  } else {
    // Canvas is taller (or equal) → width is the limiting dimension → letterbox.
    width = canvasWidth
    height = width / stageAspect
  }

  const w = Math.round(width)
  const h = Math.round(height)
  return {
    x: Math.round((canvasWidth - w) / 2),
    y: Math.round((canvasHeight - h) / 2),
    width: w,
    height: h,
  }
}
