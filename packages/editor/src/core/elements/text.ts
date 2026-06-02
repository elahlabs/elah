import type { Clip } from '../types'
import { createClip, type TextClipMetadata } from './base'

export interface CreateTextClipOptions {
  trackId: string
  name?: string
  startFrame: number
  durationFrames: number
  text: TextClipMetadata
  volume?: number
  opacity?: number
}

export function createTextClip(options: CreateTextClipOptions): Clip {
  return createClip({
    ...options,
    type: 'text',
    name: options.name ?? 'Text',
  })
}
