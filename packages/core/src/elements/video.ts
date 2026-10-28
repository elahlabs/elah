import type { Clip, Transform } from '../types'
import { createClip } from './base'

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

export function createVideoClip(options: CreateVideoClipOptions): Clip {
  return createClip({ ...options, type: 'video', name: options.name ?? 'Video' })
}
