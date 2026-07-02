import { useMediaLibraryStore, type MediaAsset } from '@elah/editor'
import type { PixabayPhoto, PixabayVideo, PixabayVideoFile } from './types'

/**
 * Target resolution standard for imported media: the "long edge" (max of
 * width/height, since sources can be landscape or portrait) we prefer to
 * meet. Keeps video/image quality consistent across random topics without
 * pulling unnecessarily large sources that are slow to probe and overkill
 * for the timeline.
 */
const TARGET_LONG_EDGE = 1080

function longEdge(width: number | null | undefined, height: number | null | undefined): number {
  return Math.max(width ?? 0, height ?? 0)
}

/**
 * Picks the best downloadable file for a Pixabay video against
 * `TARGET_LONG_EDGE`: the smallest of the four fixed quality tiers
 * (large/medium/small/tiny) whose long edge meets or exceeds the target,
 * falling back to `large` if none clears it.
 */
function pickVideoFile(video: PixabayVideo): PixabayVideoFile {
  const tiers = [video.videos.tiny, video.videos.small, video.videos.medium, video.videos.large].filter(
    (f) => f && f.url,
  )
  const sorted = [...tiers].sort((a, b) => longEdge(a.width, a.height) - longEdge(b.width, b.height))
  return sorted.find((f) => longEdge(f.width, f.height) >= TARGET_LONG_EDGE) ?? video.videos.large
}

function findExisting(src: string): MediaAsset | undefined {
  return Object.values(useMediaLibraryStore.getState().assets).find((a) => a.src === src)
}

/**
 * Picks the best src variant for a Pixabay photo against `TARGET_LONG_EDGE`:
 * `largeImageURL` (Pixabay's largest download available on the free API tier)
 * unless the source itself is smaller than the target, in which case
 * `largeImageURL` would just be an upscale of `webformatURL` — use
 * `webformatURL` instead so we never serve an artificially inflated image.
 */
function pickPhotoSrc(photo: PixabayPhoto): string {
  if (longEdge(photo.imageWidth, photo.imageHeight) < TARGET_LONG_EDGE) return photo.webformatURL
  return photo.largeImageURL || photo.webformatURL
}

/**
 * Registers a Pixabay search result as a `MediaAsset` in the shared media
 * library, reusing its own store instead of `importUrl()`'s probe pipeline —
 * Pixabay already reports dimensions/duration/thumbnail, so probing again
 * would just be a redundant network round-trip. Synchronous so it can run
 * inside a native `dragstart` handler, which must call `setData` before
 * returning.
 */
export function importPixabayPhoto(photo: PixabayPhoto): MediaAsset {
  const src = pickPhotoSrc(photo)
  const existing = findExisting(src)
  if (existing) return existing

  const asset: MediaAsset = {
    id: crypto.randomUUID(),
    kind: 'image',
    name: photo.tags?.trim() || `pixabay-photo-${photo.id}`,
    src,
    durationSec: 0,
    width: photo.imageWidth,
    height: photo.imageHeight,
    thumbnailUrl: photo.webformatURL,
    byteSize: 0,
    lastModified: Date.now(),
    addedAt: Date.now(),
  }
  useMediaLibraryStore.getState().addAsset(asset)
  return asset
}

export function importPixabayVideo(video: PixabayVideo): MediaAsset {
  const file = pickVideoFile(video)
  const src = file.url
  const existing = findExisting(src)
  if (existing) return existing

  const asset: MediaAsset = {
    id: crypto.randomUUID(),
    kind: 'video',
    name: video.tags?.trim() || `pixabay-video-${video.id}`,
    src,
    durationSec: video.duration,
    width: file.width,
    height: file.height,
    thumbnailUrl: file.thumbnail,
    byteSize: 0,
    lastModified: Date.now(),
    addedAt: Date.now(),
  }
  useMediaLibraryStore.getState().addAsset(asset)
  return asset
}
