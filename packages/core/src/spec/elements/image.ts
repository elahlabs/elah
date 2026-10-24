/**
 * elements/image.ts — an `image` spec element -> a `Clip` literal (AV-1).
 *
 * `src` only — the brief supplies the URL; the model never invents one (the
 * type's own doc comment). No `assetId`: a generated document has no media
 * library entry for it yet.
 */

import type { Clip } from '../../types'
import type { SpecElement } from '../types'
import { applyEffectsAndBlend, applyMotionAndKeyframes, baseClip, buildLayout, buildTransform, type BuildContext } from './common'

const DEFAULT_IMAGE_SIZE = 400

export function buildImageClip(
  el: SpecElement,
  input: { id: string; trackId: string; startFrame: number; durationFrames: number },
  ctx: BuildContext,
  path: string,
): Clip {
  const w = el.w ?? DEFAULT_IMAGE_SIZE
  const h = el.h ?? DEFAULT_IMAGE_SIZE
  const transform = buildTransform(el, ctx, path, { w, h })

  let clip: Clip = {
    ...baseClip({ ...input, type: 'image', name: el.name ?? 'image', transform }, el, ctx, path),
    ...(el.src ? { src: el.src } : {}),
  }
  if (!el.src) {
    ctx.issues.push({ severity: 'error', path: `${path}.src`, code: 'missing-src', message: 'image element has no src' })
  }

  const layout = buildLayout(el.layout, ctx, path)
  if (layout) clip.layout = layout

  clip = applyMotionAndKeyframes(clip, el, ctx, path)
  clip = applyEffectsAndBlend(clip, el, ctx, path)
  return clip
}
