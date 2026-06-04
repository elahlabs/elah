import type { Clip, ClipType, Transform } from '../types'
import { generateId } from '../utils/id'
import { toFrame } from '../utils/frames'

// ---------------------------------------------------------------------------
// Per-type option shapes (discriminated union)
// ---------------------------------------------------------------------------

interface BaseCreateOptions {
  trackId: string
  name?: string
  startFrame: number
  durationFrames: number
  volume?: number
  opacity?: number
  transform?: Transform
}

interface CreateVideoOptions extends BaseCreateOptions {
  type: 'video'
  src: string
  assetId?: string
}

interface CreateAudioOptions extends BaseCreateOptions {
  type: 'audio'
  src: string
  assetId?: string
}

interface CreateImageOptions extends BaseCreateOptions {
  type: 'image'
  src: string
  assetId?: string
}

/** Style + content for a text clip. Required when type === 'text'. */
export interface TextClipMetadata {
  content: string
  fontSize?: number
  color?: string
  fontFamily?: string
  fontWeight?: 'normal' | 'bold'
  textAlign?: 'left' | 'center' | 'right'
}

interface CreateTextOptions extends BaseCreateOptions {
  type: 'text'
  /** Required for text clips — carries content + style. */
  text: TextClipMetadata
}

/**
 * Discriminated union of clip creation options.
 * TypeScript narrows the correct shape based on `type`, so callers get
 * errors when they pass video-only fields to a text clip and vice versa.
 */
export type CreateClipOptions =
  | CreateVideoOptions
  | CreateAudioOptions
  | CreateImageOptions
  | CreateTextOptions

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory function for creating a new Clip from typed creation options.
 * All values are normalized: frames are rounded to integers, and defaults
 * are applied for optional fields.
 */
export function createClip(options: CreateClipOptions): Clip {
  const durationFrames = Math.max(1, toFrame(options.durationFrames))

  const base = {
    id: generateId(),
    trackId: options.trackId,
    type: options.type as ClipType,
    name: options.name ?? options.type,
    startFrame: toFrame(options.startFrame),
    durationFrames,
    sourceStartFrame: 0,
    sourceDurationFrames: durationFrames,
    volume: options.volume ?? 1,
    opacity: options.opacity ?? 1,
    locked: false,
    disabled: false,
    ...(options.transform ? { transform: options.transform } : {}),
  }

  if (options.type === 'text') {
    const { text } = options
    return {
      ...base,
      type: 'text',
      content: text.content,
      ...(text.fontSize !== undefined ? { fontSize: text.fontSize } : {}),
      ...(text.color !== undefined ? { color: text.color } : {}),
      ...(text.fontFamily !== undefined ? { fontFamily: text.fontFamily } : {}),
      ...(text.fontWeight !== undefined ? { fontWeight: text.fontWeight } : {}),
      ...(text.textAlign !== undefined ? { textAlign: text.textAlign } : {}),
    }
  }

  return {
    ...base,
    type: options.type,
    src: options.src,
    assetId: options.assetId,
  }
}
