import type { Clip, Transform } from '../types'
import { createClip } from './base'

/** Inputs for createImageClip; `src`/`assetId` bind to imported media, `durationFrames` sets how long the still holds. */
export interface CreateImageClipOptions {
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

/** Typed wrapper over createClip that pins `type: 'image'` and supplies a default name so callers can't omit them. */
export function createImageClip(options: CreateImageClipOptions): Clip {
  return createClip({ ...options, type: 'image', name: options.name ?? 'Image' })
}
