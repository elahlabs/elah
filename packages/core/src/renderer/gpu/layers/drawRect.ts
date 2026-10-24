/**
 * drawRect — clip→stage placement math shared by every quad-based layer
 * (video, image). Pure functions: a clip's optional `Transform` + its content
 * size in, a pixel draw rect and a clip-space matrix out.
 *
 * The single behaviour worth calling out: with NO explicit transform the clip is
 * *contained* within the stage (object-fit: contain), never stretched. An
 * explicit transform is taken as the author's intent and applied verbatim.
 */

import type { Transform } from '../../../types'
import { computeContainRect, computeCoverRect } from './objectFit'

/**
 * Pixel rect (stage space, origin top-left) plus a rotation about its centre.
 * MOT-8: `skewX`/`skewY` (radians) shear the scaled box about the same centre BEFORE the
 * rotation. They are present only when non-zero, so an unskewed rect is the object it always was.
 */
export interface DrawRect {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  skewX?: number
  skewY?: number
  /** MOT-8 phase B: tilt about x / y in radians and the eye distance in stage px; present only when the clip tilts. */
  rotateX?: number
  rotateY?: number
  perspective?: number
}

/** Eye distance (stage px) used when a tilting clip does not set one. */
export const DEFAULT_PERSPECTIVE = 1200

/** A tilt that is safe to project: angles off the edge-on singularity, a positive eye distance. */
export interface Tilt {
  /** rotateX, radians. */
  ax: number
  /** rotateY, radians. */
  ay: number
  /** Eye distance, stage px. */
  d: number
}

/** Half-width of the band around +-90 degrees that a tilt is moved out of (0.1 degree). */
const EDGE_ON_EPS = (0.1 * Math.PI) / 180

/**
 * An angle wrapped to (-180, 180] degrees. Within 0.1 degree of edge-on (+-90) it is pushed to the
 * band's edge on the side it is on, so cos() never reaches 0 (no NaN, no infinite w) while a
 * flip still passes through 90 and shows the back face beyond it.
 */
function safeTiltAngle(a: number | undefined): number {
  if (typeof a !== 'number' || !Number.isFinite(a)) return 0
  const TAU = 2 * Math.PI
  let r = a % TAU
  if (r > Math.PI) r -= TAU
  else if (r <= -Math.PI) r += TAU
  for (const e of [Math.PI / 2, -Math.PI / 2]) {
    if (Math.abs(r - e) < EDGE_ON_EPS) return r < e ? e - EDGE_ON_EPS : e + EDGE_ON_EPS
  }
  return r
}

/**
 * The tilt a (rotateX, rotateY, perspective) triple stands for, or undefined when the clip is flat
 * (both angles absent, zero, not finite, or whole turns). Every renderer reads 3D rotation through
 * this one function, so they wrap, nudge off edge-on and default the eye distance alike.
 */
export function tiltOf(rotateX?: number, rotateY?: number, perspective?: number): Tilt | undefined {
  const ax = safeTiltAngle(rotateX)
  const ay = safeTiltAngle(rotateY)
  if (ax === 0 && ay === 0) return undefined
  const d = typeof perspective === 'number' && Number.isFinite(perspective) && perspective > 1 ? perspective : DEFAULT_PERSPECTIVE
  return { ax, ay, d }
}

/** The tilt of a rect or a transform, or undefined. */
export function rectTilt(r: { rotateX?: number; rotateY?: number; perspective?: number } | undefined): Tilt | undefined {
  return r ? tiltOf(r.rotateX, r.rotateY, r.perspective) : undefined
}

/** The 3D fields to spread into a DrawRect: empty (not zeros) when the clip is flat. */
export function tiltFields(t: { rotateX?: number; rotateY?: number; perspective?: number } | undefined): { rotateX?: number; rotateY?: number; perspective?: number } {
  if (!t || !tiltOf(t.rotateX, t.rotateY, t.perspective)) return {}
  return {
    rotateX: t.rotateX ?? 0,
    rotateY: t.rotateY ?? 0,
    ...(t.perspective !== undefined ? { perspective: t.perspective } : {}),
  }
}

/** A row-major 3x3 matrix. */
export type Mat3 = [[number, number, number], [number, number, number], [number, number, number]]

function mul3(a: Mat3, b: Mat3): Mat3 {
  const o: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r][c] = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]
  return o
}

/**
 * The homography taking quad coordinates (u, v, 1) (unit square, origin top-left) to homogeneous
 * clip space (x, y, w) with Y still TOP-DOWN (the vertex shader negates it), for a tilted rect.
 *
 * Order is CSS "perspective(d) rotateX() rotateY() rotate() skew()" about the box centre, in pixel
 * space: scale the unit quad to the box, shear, rotate in the plane, tilt (Rx * Ry, CSS order),
 * divide by w = 1 - z / d, then move the centre to the rect's stage position. Float64 throughout;
 * buildTransformMatrixFromRect narrows it for the GPU. The plane is z = 0 before the tilt, so the
 * whole thing is one 3x3. No backface culling: past 90 degrees the back face shows, mirrored.
 */
export function tiltHomography(rect: DrawRect, tilt: Tilt, stageWidth: number, stageHeight: number): Mat3 {
  const sc = Math.cos(rect.rotation)
  const ss = Math.sin(rect.rotation)
  const shear = rectShear(rect)
  const kx = shear?.kx ?? 0
  const ky = shear?.ky ?? 0
  // Plane part, column-wise: where the u and v edges go (same terms as buildTransformMatrixFromRect).
  const a = rect.width * (sc - ky * ss)
  const b = rect.width * (ss + ky * sc)
  const c = rect.height * (kx * sc - ss)
  const e = rect.height * (kx * ss + sc)
  const A: Mat3 = [
    [a, c, -(a + c) / 2],
    [b, e, -(b + e) / 2],
    [0, 0, 1],
  ]
  const ca = Math.cos(tilt.ax)
  const sa = Math.sin(tilt.ax)
  const cb = Math.cos(tilt.ay)
  const sb = Math.sin(tilt.ay)
  const T: Mat3 = [
    [cb, 0, 0],
    [sb * sa, ca, 0],
    [(sb * ca) / tilt.d, -sa / tilt.d, 1],
  ]
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const N: Mat3 = [
    [2 / stageWidth, 0, (2 * cx - stageWidth) / stageWidth],
    [0, 2 / stageHeight, (2 * cy - stageHeight) / stageHeight],
    [0, 0, 1],
  ]
  return mul3(N, mul3(T, A))
}

/** Project quad point (u, v) of a tilted rect: stage-pixel x / y and the clip-space w (w <= 0: behind the eye). */
export function projectTiltedPoint(rect: DrawRect, stageWidth: number, stageHeight: number, u: number, v: number): { x: number; y: number; w: number } | undefined {
  const tilt = rectTilt(rect)
  if (!tilt) return undefined
  const H = tiltHomography(rect, tilt, stageWidth, stageHeight)
  const X = H[0][0] * u + H[0][1] * v + H[0][2]
  const Y = H[1][0] * u + H[1][1] * v + H[1][2]
  const W = H[2][0] * u + H[2][1] * v + H[2][2]
  return { x: ((X / W + 1) / 2) * stageWidth, y: ((Y / W + 1) / 2) * stageHeight, w: W }
}

/** Largest skew angle the maths accepts (89 degrees): tan() is unbounded at 90. */
export const MAX_SKEW_RAD = (89 * Math.PI) / 180

/** The tangents of a skew: x' = x + kx * y, y' = ky * x + y (CSS skew(ax, ay)). */
export interface Shear {
  kx: number
  ky: number
}

/**
 * The shear a skew pair stands for, or undefined when there is none (both absent, zero, or not
 * finite). Every renderer reads skew through this one function, so they clamp and tan alike.
 */
export function skewShear(skewX?: number, skewY?: number): Shear | undefined {
  const ax = typeof skewX === 'number' && Number.isFinite(skewX) ? Math.max(-MAX_SKEW_RAD, Math.min(MAX_SKEW_RAD, skewX)) : 0
  const ay = typeof skewY === 'number' && Number.isFinite(skewY) ? Math.max(-MAX_SKEW_RAD, Math.min(MAX_SKEW_RAD, skewY)) : 0
  if (ax === 0 && ay === 0) return undefined
  return { kx: Math.tan(ax), ky: Math.tan(ay) }
}

/** The shear of a rect or a transform, or undefined. */
export function rectShear(r: { skewX?: number; skewY?: number } | undefined): Shear | undefined {
  return r ? skewShear(r.skewX, r.skewY) : undefined
}

/** The skew fields to spread into a DrawRect: empty (not zeros) when there is no skew. */
export function skewFields(t: { skewX?: number; skewY?: number } | undefined): { skewX?: number; skewY?: number } {
  if (!t || !skewShear(t.skewX, t.skewY)) return {}
  return { skewX: t.skewX ?? 0, skewY: t.skewY ?? 0 }
}

/**
 * Apply a shear to a 2D context, about the origin the caller has already translated to the
 * pivot. Call it AFTER `ctx.rotate` and before the scale/draw, which is the CSS order
 * "rotate() skew()". A no-op when there is no shear, so unskewed painters issue the same calls.
 */
export function applyShear(ctx: { transform(a: number, b: number, c: number, d: number, e: number, f: number): void }, shear: Shear | undefined): void {
  if (shear) ctx.transform(1, shear.ky, shear.kx, 1, 0, 0)
}

/** Source-space crop window, normalized 0..1 of the media's natural size, origin top-left. */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** The no-op crop — the full source frame. */
export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 }

/** Smallest allowed crop extent on either axis, as a fraction of the full source. */
const MIN_CROP_FRACTION = 0.05

/**
 * Clamp a crop window into the unit square with a non-degenerate size.
 * `undefined` (no crop authored yet) resolves to the full frame.
 */
export function normalizeCrop(crop?: CropRect): CropRect {
  if (!crop) return FULL_CROP
  const width = Math.min(1, Math.max(MIN_CROP_FRACTION, crop.width))
  const height = Math.min(1, Math.max(MIN_CROP_FRACTION, crop.height))
  const x = Math.min(1 - width, Math.max(0, crop.x))
  const y = Math.min(1 - height, Math.max(0, crop.y))
  return { x, y, width, height }
}

/** The effective (visible) content size after cropping — what the draw rect is sized from. */
export function croppedContentSize(
  contentWidth: number,
  contentHeight: number,
  crop?: CropRect,
): { width: number; height: number } {
  if (!crop) return { width: contentWidth, height: contentHeight }
  const c = normalizeCrop(crop)
  return { width: contentWidth * c.width, height: contentHeight * c.height }
}

/**
 * Build a column-major 3×3 transform matrix mapping the unit quad (0..1,
 * origin top-left) to clip space for a rect at pixel (x,y,w,h) on a stage
 * of size (sw, sh), with optional rotation about the rect centre.
 *
 * The rotation happens in PIXEL space and is normalized afterwards — the two
 * are separate steps, and the stage's own aspect ratio must not leak into the
 * rotation itself. Each basis vector is therefore divided by the axis it lands
 * ON, which is why there are four ratios here and not two: the rect's width
 * edge contributes `cos` to X (÷ stageWidth) and `sin` to Y (÷ stageHeight).
 *
 * Normalizing first and rotating afterwards (one `w/stageWidth` reused for both
 * of the width edge's components) rotates inside a squashed space, and scales
 * the result by the stage aspect: a 90° turn on a 9:16 stage came out 1.78×
 * tall and 0.56× wide. That disagreed with BOTH of the other two paths that
 * place the same rect — `ExportWorker`'s `ctx.rotate` and the preview overlay's
 * CSS `rotate()`, which are true pixel-space rotations — so a rotated clip
 * rendered as a stretched smear inside a correctly-rotated selection box.
 * Unrotated clips are unaffected: at rotation 0 the cross terms vanish and this
 * reduces to exactly the previous matrix.
 *
 * Y stays top-down here; `quad.vert` negates it on the way to GL's Y-up NDC. So
 * a positive rotation is clockwise on screen, matching `Transform.rotation`.
 */
export function buildTransformMatrixFromRect(
  rect: DrawRect,
  stageWidth: number,
  stageHeight: number,
): Float32Array {
  const tilt = rectTilt(rect)
  if (tilt) {
    // MOT-8 phase B: a tilting rect is projective; the matrix's bottom row is no longer (0, 0, 1)
    // and quad.vert uses it as w. With no tilt the branch below is exactly what it always was.
    const H = tiltHomography(rect, tilt, stageWidth, stageHeight)
    return new Float32Array([H[0][0], H[1][0], H[2][0], H[0][1], H[1][1], H[2][1], H[0][2], H[1][2], H[2][2]])
  }
  const sc = Math.cos(rect.rotation)
  const ss = Math.sin(rect.rotation)
  const shear = rectShear(rect)

  // Column 0: where the quad's u axis (the rect's width edge) lands.
  let m00 = (2 * rect.width * sc) / stageWidth
  let m01 = (2 * rect.width * ss) / stageHeight
  // Column 1: where the quad's v axis (the rect's height edge) lands.
  let m10 = (-2 * rect.height * ss) / stageWidth
  let m11 = (2 * rect.height * sc) / stageHeight
  if (shear) {
    // MOT-8: the box is sheared first (u -> (w, ky*w), v -> (kx*h, h)), then rotated, in PIXEL
    // space like the rotation, so the stage aspect still never leaks into the shear.
    const { kx, ky } = shear
    m00 = (2 * rect.width * (sc - ky * ss)) / stageWidth
    m01 = (2 * rect.width * (ss + ky * sc)) / stageHeight
    m10 = (2 * rect.height * (kx * sc - ss)) / stageWidth
    m11 = (2 * rect.height * (kx * ss + sc)) / stageHeight
  }

  // Column 2: put the quad's centre (0.5, 0.5) on the rect's pixel centre —
  // which is also the pivot, so this is what makes the rotation centred.
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const tx = (2 * cx) / stageWidth - 1 - (m00 + m10) / 2
  const ty = (2 * cy) / stageHeight - 1 - (m01 + m11) / 2

  return new Float32Array([
    m00, m01, 0,
    m10, m11, 0,
    tx, ty, 1,
  ])
}

/**
 * Convert a normalized Transform + content size into a pixel draw rect.
 *
 * `scale` is the uniform factor; `scaleX`/`scaleY` are optional per-axis
 * multipliers layered on top of it, which is what lets a clip be stretched
 * freely in one direction. Omitting them means 1, so a transform authored
 * before free resize existed resolves exactly as it always did.
 */
export function resolveTransformRect(
  transform: Transform,
  stageWidth: number,
  stageHeight: number,
  contentWidth: number,
  contentHeight: number,
  crop?: CropRect,
): DrawRect {
  const content = croppedContentSize(contentWidth, contentHeight, crop)
  const width = content.width * transform.scale * (transform.scaleX ?? 1)
  const height = content.height * transform.scale * (transform.scaleY ?? 1)

  const anchorPxX = transform.anchor.x * width
  const anchorPxY = transform.anchor.y * height

  const x = transform.x * stageWidth - anchorPxX
  const y = transform.y * stageHeight - anchorPxY

  return {
    x,
    y,
    width,
    height,
    rotation: transform.rotation,
    ...skewFields(transform),
    ...tiltFields(transform),
  }
}

/**
 * Resolve the pixel draw rect for any clip with an optional transform.
 *
 * - No transform + known content size → contain the content within the stage
 *   (letterbox/pillarbox inside the project frame; never stretched).
 * - No transform + unknown content size (first frame not yet uploaded) → fill
 *   the stage for that one tick.
 * - Explicit transform → applied verbatim relative to the content size.
 */
export function resolveDrawRect(
  transform: Transform | undefined,
  stageWidth: number,
  stageHeight: number,
  contentWidth?: number,
  contentHeight?: number,
  crop?: CropRect,
): DrawRect {
  if (!transform) {
    if (contentWidth && contentHeight) {
      const content = croppedContentSize(contentWidth, contentHeight, crop)
      const fit = computeContainRect(content.width, content.height, stageWidth, stageHeight)
      return { x: fit.x, y: fit.y, width: fit.width, height: fit.height, rotation: 0 }
    }
    return { x: 0, y: 0, width: stageWidth, height: stageHeight, rotation: 0 }
  }

  return resolveTransformRect(
    transform,
    stageWidth,
    stageHeight,
    contentWidth ?? stageWidth,
    contentHeight ?? stageHeight,
    crop,
  )
}

/**
 * Synthesize the explicit Transform that reproduces the default "contain"
 * placement of a clip with no transform of its own.
 *
 * The renderer draws a transform-less clip *contained* within the stage (see
 * `resolveDrawRect`). When the user first grabs such a clip in the interactive
 * overlay, we need a concrete `Transform` to apply the drag/resize delta to —
 * but writing one must not move the clip. This returns exactly the transform
 * whose draw rect equals the contain rect, so baking it in is visually a no-op:
 * feeding the result back through `resolveTransformRect` yields the same rect as
 * `computeContainRect`.
 *
 * Uses `anchor {0.5,0.5}` so `x`/`y` are the clip centre (matching the text
 * model), and a uniform `scale` of contain-width ÷ content-width.
 */
export function transformFromContainRect(
  contentWidth: number,
  contentHeight: number,
  stageWidth: number,
  stageHeight: number,
): Transform {
  const fit = computeContainRect(contentWidth, contentHeight, stageWidth, stageHeight)
  return {
    x: stageWidth > 0 ? (fit.x + fit.width / 2) / stageWidth : 0.5,
    y: stageHeight > 0 ? (fit.y + fit.height / 2) / stageHeight : 0.5,
    scale: contentWidth > 0 ? fit.width / contentWidth : 1,
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
  }
}

/**
 * Synthesize the explicit Transform that fits a clip's content to *cover* the
 * stage (CSS `object-fit: cover`), cropping whichever axis overflows instead
 * of letterboxing. Useful for callers that place clips programmatically (e.g.
 * random project generation) and want off-aspect media to fill the frame
 * rather than default to the renderer's contain behaviour.
 *
 * Same shape as `transformFromContainRect`: anchor `{0.5,0.5}`, uniform scale.
 */
export function transformFromCoverRect(
  contentWidth: number,
  contentHeight: number,
  stageWidth: number,
  stageHeight: number,
): Transform {
  const fit = computeCoverRect(contentWidth, contentHeight, stageWidth, stageHeight)
  return {
    x: stageWidth > 0 ? (fit.x + fit.width / 2) / stageWidth : 0.5,
    y: stageHeight > 0 ? (fit.y + fit.height / 2) / stageHeight : 0.5,
    scale: contentWidth > 0 ? fit.width / contentWidth : 1,
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
  }
}

/** Build the clip-space transform matrix for a clip with an optional transform. */
export function buildDrawTransformMatrix(
  transform: Transform | undefined,
  stageWidth: number,
  stageHeight: number,
  contentWidth?: number,
  contentHeight?: number,
  crop?: CropRect,
): Float32Array {
  return buildTransformMatrixFromRect(
    resolveDrawRect(transform, stageWidth, stageHeight, contentWidth, contentHeight, crop),
    stageWidth,
    stageHeight,
  )
}
