/**
 * Source rotation for decoded video frames.
 *
 * Phone footage (iPhone portrait .MOV) is stored as landscape coded pixels plus
 * a clockwise display rotation in the container. WebCodecs hands back the coded
 * (unrotated) pixels, so whoever draws a decoded frame must apply it. The
 * export path gets it from mediabunny's CanvasSink (defaults to the file
 * rotation); the preview path applies it in quad.vert via `uRotation`, using
 * the same mapping as `displayToSourceUv` below.
 */

export type VideoRotation = 0 | 90 | 180 | 270

export function normalizeRotation(value: unknown): VideoRotation {
  return value === 90 || value === 180 || value === 270 ? value : 0
}

/** Size of the picture as the viewer sees it (w/h swap for 90/270). */
export function displaySizeFor(
  rawWidth: number,
  rawHeight: number,
  rotation: VideoRotation,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: rawHeight, height: rawWidth }
    : { width: rawWidth, height: rawHeight }
}

/**
 * Map a normalized point in DISPLAY space (origin top-left, y down) to the
 * normalized point of the RAW (coded) frame it shows, origin top-left.
 * `rotation` is the clockwise angle the raw frame is turned by to be upright.
 * Mirrored in quad.vert (`uRotation`).
 */
export function displayToSourceUv(
  rotation: VideoRotation,
  dx: number,
  dy: number,
): { x: number; y: number } {
  switch (rotation) {
    case 90:
      return { x: dy, y: 1 - dx }
    case 180:
      return { x: 1 - dx, y: 1 - dy }
    case 270:
      return { x: 1 - dy, y: dx }
    default:
      return { x: dx, y: dy }
  }
}
