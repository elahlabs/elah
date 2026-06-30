import type { Clip } from '../types'
import { createClip, type ShapeClipMetadata } from './base'

export interface CreateShapeClipOptions {
  trackId: string
  name?: string
  startFrame: number
  durationFrames: number
  shape: ShapeClipMetadata
  volume?: number
  opacity?: number
}

export function createShapeClip(options: CreateShapeClipOptions): Clip {
  return createClip({
    ...options,
    type: 'shape',
    name: options.name ?? options.shape.shapeKind,
  })
}
