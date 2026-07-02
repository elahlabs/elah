import type { Track, TrackKind } from '../types'
import { generateId } from '../utils/id'

export interface CreateTrackOptions {
  kind: TrackKind
  name?: string
  order?: number
  height?: number
}

/** Factory function for creating a new Track with safe defaults */
export function createTrack(options: CreateTrackOptions): Track {
  return {
    id: generateId(),
    name:
      options.name ??
      (options.kind === 'video' ? 'Video' : options.kind === 'audio' ? 'Audio' : 'Text'),
    kind: options.kind,
    order: options.order ?? 0,
    height: options.height ?? 64,
    locked: false,
    disabled: false,
    muted: false,
    solo: false,
    volume: 1,
  }
}
