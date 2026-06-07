import type { Clip, Transform } from '../types'
import { createClip } from './base'

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

export function createImageClip(options: CreateImageClipOptions): Clip {
  return createClip({ ...options, type: 'image', name: options.name ?? 'Image' })
}
