import type { Clip } from '../../types'
import { createClip, type CreateClipOptions } from './base'

export function createImageClip(
  options: Omit<CreateClipOptions, 'type'>,
): Clip {
  return createClip({ ...options, type: 'image', name: options.name ?? 'Image' })
}
