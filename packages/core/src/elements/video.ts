import type { Clip, Transform } from '../types'
import { createClip } from './base'

/** Inputs for createVideoClip; `src`/`assetId` bind to imported media, the rest are optional visual/audio overrides. */
export interface CreateVideoClipOptions {
  trackId: string
  name?: string
  startFrame: number
  durationFrames: number
  src: string
  assetId?: string
  volume?: number
  opacity?: number
  transform?: Transform
}

/** Typed wrapper over createClip that pins `type: 'video'` and supplies a default name so callers can't omit them. */
export function createVideoClip(options: CreateVideoClipOptions): Clip {
  return createClip({ ...options, type: 'video', name: options.name ?? 'Video' })
}
