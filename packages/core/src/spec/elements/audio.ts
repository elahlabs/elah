/**
 * elements/audio.ts — an `audio` spec element -> a `Clip` literal (AV-1).
 *
 * No transform (audio has no picture); `volume` plus `fadeIn`/`fadeOut` ramps
 * on the `volume` channel, written the same way `applyDrawOn` writes the
 * `draw` channel: `setKeyframe` twice per ramp, baseline included for free.
 */

import type { Clip } from '../../types'
import { setKeyframe, type BaselineContext } from '../../elements/keyframes'
import { clampIssue, toFrames, OPACITY_RANGE } from '../units'
import type { SpecElement } from '../types'
import { applyMotionAndKeyframes, baseClip, type BuildContext } from './common'

function baselineCtx(ctx: BuildContext): BaselineContext {
  return { stage: ctx.stage }
}

export function buildAudioClip(
  el: SpecElement,
  input: { id: string; trackId: string; startFrame: number; durationFrames: number },
  ctx: BuildContext,
  path: string,
): Clip {
  const volume = el.volume === undefined ? 1 : clampIssue(el.volume, OPACITY_RANGE[0], OPACITY_RANGE[1], `${path}.volume`, ctx.issues)

  let clip: Clip = {
    ...baseClip({ ...input, type: 'audio', name: el.name ?? 'audio' }, el, ctx, path),
    volume,
    ...(el.src ? { src: el.src } : {}),
  }
  if (!el.src) {
    ctx.issues.push({ severity: 'error', path: `${path}.src`, code: 'missing-src', message: 'audio element has no src' })
  }

  const last = Math.max(0, clip.durationFrames - 1)
  const bCtx = baselineCtx(ctx)
  if (el.fadeIn) {
    const end = Math.min(last, Math.max(0, toFrames(el.fadeIn, ctx.fps)))
    clip = { ...clip, ...setKeyframe(clip, 'volume', 0, bCtx, 0, { easing: 'linear' }) }
    clip = { ...clip, ...setKeyframe(clip, 'volume', end, bCtx, volume, { easing: 'linear' }) }
  }
  if (el.fadeOut) {
    const start = Math.max(0, last - Math.max(0, toFrames(el.fadeOut, ctx.fps)))
    clip = { ...clip, ...setKeyframe(clip, 'volume', start, bCtx, volume, { easing: 'linear' }) }
    clip = { ...clip, ...setKeyframe(clip, 'volume', last, bCtx, 0, { easing: 'linear' }) }
  }

  clip = applyMotionAndKeyframes(clip, el, ctx, path)
  return clip
}
