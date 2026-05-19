import type { Clip, ClipType, Transform } from '../types'
import { generateId } from '../utils/id'
import { toFrame } from '../utils/frames'

export interface CreateClipOptions {
  trackId: string
  type: ClipType
  name?: string
  startFrame: number
  durationFrames: number
  /** Source URL (video / audio / image) */
  src?: string
  /** Reference to a MediaAsset in the MediaLibrary */
  assetId?: string
  /** Text content (text clips) */
  content?: string
  volume?: number
  opacity?: number
  /** Optional spatial transform; omit to leave undefined (renderer decides the default) */
  transform?: Transform
}

/**
 * Factory function for creating a new Clip.
 * All values are normalized: frames are rounded to integers,
 * and defaults are applied for optional fields.
 */
export function createClip(options: CreateClipOptions): Clip {
  const durationFrames = Math.max(1, toFrame(options.durationFrames))

  return {
    id: generateId(),
    trackId: options.trackId,
    type: options.type,
    name: options.name ?? options.type,
    startFrame: toFrame(options.startFrame),
    durationFrames,
    sourceStartFrame: 0,
    sourceDurationFrames: durationFrames,
    src: options.src,
    assetId: options.assetId,
    content: options.content,
    volume: options.volume ?? 1,
    opacity: options.opacity ?? 1,
    locked: false,
    disabled: false,
    ...(options.transform ? { transform: options.transform } : {}),
  }
}
