/**
 * fitCrop — PQ-1a. Pure "fit this footage to the stage" planning for the `setFit` op and the Properties panel.
 *
 * `contain` is the renderer's default (no crop, no transform). `cover` fills the stage by writing a crop WINDOW of the
 * stage's own aspect (centred on a focus point, clamped to the frame) plus the transform that fits that window to the
 * stage: crop shrinks the content size the transform is measured from, so the aspects must match for the fit to be
 * exact. `blur-fill` keeps the picture contained; its backdrop (a separate clip) uses the cover result.
 */

import type { Transform } from '../../../types'
import type { CropRect } from './drawRect'
import { transformFromContainRect } from './drawRect'

export type FitMode = 'contain' | 'cover' | 'blur-fill'

export interface FitPlan {
  /** Undefined = clear the clip's crop. */
  crop?: CropRect
  /** Undefined = clear the clip's transform. */
  transform?: Transform
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))
const valid = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/** The crop window and fitting transform that make `content` fill `stage`, centred as near `focus` as the frame allows. */
export function coverPlan(
  content: { width: number; height: number },
  stage: { width: number; height: number },
  focus: { x: number; y: number } = { x: 0.5, y: 0.5 },
): FitPlan {
  if (!valid(content.width) || !valid(content.height) || !valid(stage.width) || !valid(stage.height)) return {}
  const fx = Number.isFinite(focus.x) ? clamp01(focus.x) : 0.5
  const fy = Number.isFinite(focus.y) ? clamp01(focus.y) : 0.5
  const stageAspect = stage.width / stage.height
  const contentAspect = content.width / content.height
  // Same aspect (to sub-pixel tolerance): the picture already fills the stage.
  if (Math.abs(stageAspect - contentAspect) < 1e-4) return {}
  let w = 1
  let h = 1
  if (contentAspect > stageAspect) w = stageAspect / contentAspect
  else h = contentAspect / stageAspect
  const x = Math.min(1 - w, Math.max(0, fx - w / 2))
  const y = Math.min(1 - h, Math.max(0, fy - h / 2))
  const crop: CropRect = { x, y, width: w, height: h }
  const transform = transformFromContainRect(content.width * w, content.height * h, stage.width, stage.height)
  return { crop, transform }
}

/**
 * `fitPlan(content, stage, fit, focus)`: what to write on the clip. `contain` and `blur-fill` (the foreground) return
 * `{}`: crop and transform both cleared. `cover` returns the window and transform, or `{}` when the aspects already match.
 */
export function fitPlan(
  content: { width: number; height: number },
  stage: { width: number; height: number },
  fit: FitMode,
  focus: { x: number; y: number } = { x: 0.5, y: 0.5 },
): FitPlan {
  if (fit !== 'cover') return {}
  return coverPlan(content, stage, focus)
}

/** What the clip looks like to the Fit row: crop present = fill, a linked backdrop = blur-fill, else contain. */
export function fitModeOf(clip: { crop?: unknown }, hasBackdrop: boolean): FitMode {
  if (hasBackdrop) return 'blur-fill'
  return clip.crop ? 'cover' : 'contain'
}

/** True when `candidate` is the muted, blurred copy that `blur-fill` lays behind `clip`. */
export function isFitBackdrop(
  candidate: { id: string; linkId?: string; assetId?: string; src?: string; volume?: number; effects?: ReadonlyArray<{ kind: string }> },
  clip: { id: string; linkId?: string; assetId?: string; src?: string },
): boolean {
  if (candidate.id === clip.id) return false
  if (!clip.linkId || candidate.linkId !== clip.linkId) return false
  const sameMedia = clip.assetId ? candidate.assetId === clip.assetId : !!clip.src && candidate.src === clip.src
  if (!sameMedia) return false
  if (candidate.volume !== 0) return false
  return !!candidate.effects?.some((e) => e.kind === 'gaussianBlur')
}
