/**
 * Roto review masks for one frame (`Clip.roto` → `Scene.rotoMasks`).
 *
 * Runs after the video pass so every mask copies the RESOLVED video: the same
 * source frame (speed, trim and transition seeks included), transform, crop and
 * opacity. Deriving it any other way would let the mask drift off its video.
 */

import type { ClipRoto, Project } from '../types'
import type { ActiveRotoMask, ActiveVideoClip } from './scene'

/** Half a track step: above its own video, below the next track up (steps are integers). */
const ROTO_Z_OFFSET = 0.5

const DEFAULT_COLOR: [number, number, number] = [0.545, 0.361, 0.965] // #8b5cf6

/** '#rrggbb' → linear 0..1 RGB. Anything unparseable falls back to the default violet. */
export function parseHexColor(hex: string | undefined): [number, number, number] {
  if (typeof hex !== 'string') return DEFAULT_COLOR
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return DEFAULT_COLOR
  const n = parseInt(m[1]!, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
}

/** True when a document value is a drawable roto run. Tolerates hand-written or stale docs. */
export function isDrawableRoto(roto: ClipRoto | undefined): roto is ClipRoto {
  return (
    !!roto &&
    roto.kind === 'sequence' &&
    typeof roto.frameUrlTemplate === 'string' &&
    roto.frameUrlTemplate.length > 0 &&
    Number.isInteger(roto.frameCount) &&
    roto.frameCount > 0 &&
    roto.width > 0 &&
    roto.height > 0 &&
    !!roto.view &&
    (roto.view.mode === 'overlay' || roto.view.mode === 'matte')
  )
}

/** Masks for the videos already resolved at this frame, in the videos' order. */
export function resolveRotoMasks(
  videos: ReadonlyArray<ActiveVideoClip>,
  project: Project,
): ActiveRotoMask[] {
  if (videos.length === 0) return []

  const byId = new Map<string, ClipRoto>()
  for (const clips of Object.values(project.clips)) {
    for (const clip of clips) {
      if (clip.type === 'video' && isDrawableRoto(clip.roto)) byId.set(clip.id, clip.roto)
    }
  }
  if (byId.size === 0) return []

  const out: ActiveRotoMask[] = []
  for (const video of videos) {
    const roto = byId.get(video.id)
    if (!roto) continue
    const mode = roto.view.mode as 'overlay' | 'matte'
    const frame = Math.min(roto.frameCount - 1, Math.max(0, Math.round(video.sourceFrame)))
    out.push({
      id: `${video.id}:roto`,
      clipId: video.id,
      trackId: video.trackId,
      sourceFrame: frame,
      frameUrlTemplate: roto.frameUrlTemplate,
      frameCount: roto.frameCount,
      width: roto.width,
      height: roto.height,
      mode,
      color: parseHexColor(roto.view.color),
      opacity: (mode === 'matte' ? 1 : clamp01(roto.view.opacity)) * clamp01(video.opacity),
      zIndex: video.zIndex + ROTO_Z_OFFSET,
      ...(video.transform ? { transform: video.transform } : {}),
      ...(video.crop ? { crop: video.crop } : {}),
    })
  }
  return out
}

/** Replace `{frame}` in a template with the frame index. */
export function rotoFrameUrl(template: string, frame: number): string {
  return template.split('{frame}').join(String(frame))
}
