import type { Clip, Transform } from '../types'
import { createClip } from './base'

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

export function createAudioClip(options: CreateAudioClipOptions): Clip {
  return createClip({ ...options, type: 'audio', name: options.name ?? 'Audio' })
}
