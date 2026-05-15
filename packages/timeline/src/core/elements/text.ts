import type { Clip } from '../../types'
import { createClip, type CreateClipOptions } from './base'

export function createTextClip(
  options: Omit<CreateClipOptions, 'type' | 'src'>,
): Clip {
  return createClip({
    ...options,
    type: 'text',
    name: options.name ?? 'Text',
    content: options.content ?? '',
  })
}
