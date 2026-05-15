import type { Clip } from '../../types'
import { createClip, type CreateClipOptions } from './base'

export function createVideoClip(
  options: Omit<CreateClipOptions, 'type'>,
): Clip {
  return createClip({ ...options, type: 'video', name: options.name ?? 'Video' })
}
