import type { Clip } from '../types'
import { createClip, type FreehandClipMetadata } from './base'

export interface CreateFreehandClipOptions {
  trackId: string
  name?: string
  startFrame: number
  durationFrames: number
  freehand?: FreehandClipMetadata
  volume?: number
  opacity?: number
}

export function createFreehandClip(options: CreateFreehandClipOptions): Clip {
  return createClip({
    ...options,
    type: 'freehand',
    name: options.name ?? 'Drawing',
  })
}
