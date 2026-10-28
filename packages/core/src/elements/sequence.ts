import type { Clip, ClipSequence, Transform } from '../types'
import { createClip } from './base'

export interface CreateSequenceClipOptions {
  trackId: string
  name?: string
  startFrame: number
  durationFrames: number
  src?: string
  assetId?: string
  sequence: ClipSequence
  opacity?: number
  transform?: Transform
}

export function createSequenceClip(options: CreateSequenceClipOptions): Clip {
  return createClip({ ...options, type: 'sequence', name: options.name ?? 'Sequence' })
}

/**
 * Timeline frames one cycle of `seq` lasts at the project's `projectFps`, at
 * least 1 (a zero-length cycle would give a clip no length to place).
 */
export function sequenceCycleFrames(seq: Pick<ClipSequence, 'frameCount' | 'fps'>, projectFps: number): number {
  return Math.max(1, Math.round((seq.frameCount / seq.fps) * projectFps))
}
