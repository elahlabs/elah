/** Kind of media this asset represents. */
export type MediaKind = 'video' | 'audio' | 'image'

/**
 * A single piece of source media registered in the editor's MediaLibrary.
 * Clips reference assets by `id`; the asset owns the metadata (duration,
 * dimensions, source fps, thumbnail) so multiple clips can share a source
 * without duplicating it.
 */
export interface MediaAsset {
  id: string
  kind: MediaKind
  name: string
  /** Object URL, blob URL, or persisted asset URL. */
  src: string
  /** Source duration in seconds. */
  durationSec: number
  width?: number
  height?: number
  /** Intrinsic frame rate of the source. Undefined for audio / image. */
  sourceFps?: number
  /** Whether a video source carries an audio track. Set during import (best-effort
   * sync probe, refined by async audio decode). Undefined for audio / image. */
  hasAudio?: boolean
  /** Single representative thumbnail (mid-frame for video). Used by the AssetPanel. */
  thumbnailUrl?: string
  /** A few evenly-spaced frames decoded once per video asset, tiled across the
   * timeline clip to fake a filmstrip. Undefined for audio. */
  thumbnailStrip?: string[]
  /** Normalized (0..1) waveform peaks for audio/video sources with audio. */
  waveform?: Float32Array
  byteSize: number
  /** File last-modified timestamp from the source `File`. Used for dedupe. */
  lastModified: number
  /** Epoch ms. Used for display order and tie-breaking. */
  addedAt: number
}

/** MIME type used on `dataTransfer` for drags originating from the AssetPanel. */
export const MEDIA_DRAG_MIME = 'application/x-elah-media'

/** Payload encoded into `dataTransfer.getData(MEDIA_DRAG_MIME)`. */
export interface DragMediaPayload {
  kind: 'media-asset'
  assetId: string
}

/**
 * Extra `dataTransfer` type set alongside {@link MEDIA_DRAG_MIME} that encodes
 * the asset's `MediaKind`. `dataTransfer.getData` is only readable on `drop`
 * in most browsers, but `dataTransfer.types` is readable throughout the drag —
 * so this lets drop targets show a compatible/incompatible highlight on
 * dragenter/dragover, before the actual payload can be read.
 */
export function mediaDragKindMime(kind: MediaKind): string {
  return `application/x-elah-media-kind-${kind}`
}
