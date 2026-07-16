import type { Clip, Transform } from '../types'
import { createClip } from './base'

/** Inputs for createAudioClip; `src`/`assetId` bind to imported media and `volume` sets the clip's linear level. */
export interface CreateAudioClipOptions {
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

/** Typed wrapper over createClip that pins `type: 'audio'` and supplies a default name so callers can't omit them. */
export function createAudioClip(options: CreateAudioClipOptions): Clip {
  return createClip({ ...options, type: 'audio', name: options.name ?? 'Audio' })
}
