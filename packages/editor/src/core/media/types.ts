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
  /** Generated thumbnail. Set asynchronously by PR-07. */
  thumbnailUrl?: string
  /** Pre-decoded waveform peaks for audio. Placeholder until PR-07+. */
  waveform?: Float32Array
  byteSize: number
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
