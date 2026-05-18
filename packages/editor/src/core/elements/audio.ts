import type { Clip } from '../types'
import { createClip, type CreateClipOptions } from './base'

export function createAudioClip(
  options: Omit<CreateClipOptions, 'type'>,
): Clip {
  return createClip({ ...options, type: 'audio', name: options.name ?? 'Audio' })
}
