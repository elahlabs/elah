/**
 * elements/icon.ts — an `icon` spec element -> a `Clip` literal (AV-1).
 *
 * Vendored glyphs (`../../icons`) are stroke art: a `path` shape, transparent
 * fill, round cap/join, and a stroke width scaled from the 24-unit viewBox
 * Lucide draws at into the icon's own stage-px box. An unknown name is an
 * error issue and the element still becomes something — a plain circle badge
 * — so a generated layout with one bad icon name still reads.
 */

import type { Clip } from '../../types'
import { iconPath, ICON_STROKE_UNITS } from '../../icons'
import type { SpecElement } from '../types'
import { applyEffectsAndBlend, applyMotionAndKeyframes, baseClip, buildLayout, buildTransform, resolveColor, type BuildContext } from './common'

const DEFAULT_ICON_SIZE = 64
/** Ink: legible on the default light background. */
const DEFAULT_ICON_COLOR = '#111111'

export function buildIconClip(
  el: SpecElement,
  input: { id: string; trackId: string; startFrame: number; durationFrames: number },
  ctx: BuildContext,
  path: string,
): Clip {
  const w = el.w ?? DEFAULT_ICON_SIZE
  const h = el.h ?? DEFAULT_ICON_SIZE
  const transform = buildTransform(el, ctx, path, { w, h })
  const name = el.icon ?? ''
  const icon = iconPath(name)
  // `color` first: it is the field an author reaches for on an icon. The
  // fallback is ink, never white — a white stroke vanishes on the default light
  // background, which is how every model-coloured icon once rendered invisible.
  const [colorSpec, colorPath] =
    typeof el.color === 'string'
      ? [el.color, `${path}.color`]
      : typeof el.stroke === 'string'
        ? [el.stroke, `${path}.stroke`]
        : typeof el.fill === 'string'
          ? [el.fill, `${path}.fill`]
          : [undefined, `${path}.color`]
  const strokeColor = resolveColor(colorSpec, ctx, colorPath)
  const badgeColor = strokeColor ?? DEFAULT_ICON_COLOR

  let clip: Clip = {
    ...baseClip({ ...input, type: 'shape', name: el.name ?? (name || 'icon'), transform }, el, ctx, path),
    shapeKind: 'path',
    shapeFill: 'transparent',
    shapeStroke: badgeColor,
    shapeStrokeCap: 'round',
    shapeStrokeJoin: 'round',
  }

  if (icon) {
    clip.shapePath = icon.d
    clip.shapeViewBox = icon.viewBox
    const scale = Math.min(w / icon.viewBox.width, h / icon.viewBox.height)
    clip.shapeStrokeWidth = el.strokeWidth ?? ICON_STROKE_UNITS * scale
  } else {
    ctx.issues.push({ severity: 'error', path: `${path}.icon`, code: 'unknown-icon', message: `unknown icon "${name}"` })
    // A plain badge so the composition still reads with one bad name in it.
    clip.shapeKind = 'circle'
    clip.shapeFill = badgeColor
    clip.shapeStroke = undefined
    clip.shapeStrokeWidth = 0
  }

  const layout = buildLayout(el.layout, ctx, path)
  if (layout) clip.layout = layout

  clip = applyMotionAndKeyframes(clip, el, ctx, path)
  clip = applyEffectsAndBlend(clip, el, ctx, path)
  return clip
}
