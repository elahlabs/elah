/**
 * objectFit — fit a piece of content of one aspect ratio inside the project
 * stage of another, the way CSS `object-fit` does.
 *
 * This is the clip→stage counterpart of `computeContainViewport` (which fits the
 * project stage into the on-screen canvas for letterboxing). Here the OUTER box
 * is the stage and the INNER content is a clip (video frame / image), so an
 * off-aspect clip is contained *within* the project frame instead of stretched.
 *
 * Kept float (no integer rounding) and top-left origin so the result feeds
 * straight into the clip transform matrix (`buildTransformMatrixFromRect`).
 */

/** A rectangle in stage-space pixels, origin top-left. */
export interface FitRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Largest rect of the content's aspect ratio that fits inside the stage,
 * centred (CSS `object-fit: contain`).
 *
 * - Content wider than the stage aspect → letterbox (bars top/bottom).
 * - Content taller than the stage aspect → pillarbox (bars left/right).
 * - Equal aspect → fills the stage exactly.
 *
 * Degenerate inputs (any dimension ≤ 0) fall back to filling the stage, so the
 * caller never gets a zero-area rect.
 */
export function computeContainRect(
  contentWidth: number,
  contentHeight: number,
  stageWidth: number,
  stageHeight: number,
): FitRect {
  if (
    contentWidth <= 0 ||
    contentHeight <= 0 ||
    stageWidth <= 0 ||
    stageHeight <= 0
  ) {
    return { x: 0, y: 0, width: Math.max(stageWidth, 0), height: Math.max(stageHeight, 0) }
  }

  const stageAspect = stageWidth / stageHeight
  const contentAspect = contentWidth / contentHeight

  let width: number
  let height: number
  if (stageAspect > contentAspect) {
    // Stage is wider than the content → content height fills, bars left/right (pillarbox).
    height = stageHeight
    width = height * contentAspect
  } else {
    // Stage is taller (or equal) → content width fills, bars top/bottom (letterbox).
    width = stageWidth
    height = width / contentAspect
  }

  return {
    x: (stageWidth - width) / 2,
    y: (stageHeight - height) / 2,
    width,
    height,
  }
}
