import type { Clip } from '../types'
import { createClip, type TextClipMetadata } from './base'

/** Inputs for createTextClip; `text` carries the styled content, and text clips have no source media so they trim freely. */
export interface CreateTextClipOptions {
  trackId: string
  name?: string
  startFrame: number
  durationFrames: number
  text: TextClipMetadata
  volume?: number
  opacity?: number
}

/** Typed wrapper over createClip that pins `type: 'text'` and supplies a default name so callers can't omit them. */
export function createTextClip(options: CreateTextClipOptions): Clip {
  return createClip({
    ...options,
    type: 'text',
    name: options.name ?? 'Text',
  })
}
