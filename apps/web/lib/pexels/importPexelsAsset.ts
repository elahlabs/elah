import { useMediaLibraryStore, type MediaAsset } from '@elah/editor'
import type { PexelsPhoto, PexelsVideo, PexelsVideoFile } from './types'

/**
 * Target resolution standard for imported media: the "long edge" (max of
 * width/height, since sources can be landscape or portrait) we prefer to
 * meet. Keeps video/image quality consistent across random topics without
 * pulling unnecessarily large (4K/"uhd") sources that are slow to probe and
 * overkill for the timeline.
 */
const TARGET_LONG_EDGE = 1080

function longEdge(width: number | null | undefined, height: number | null | undefined): number {
  return Math.max(width ?? 0, height ?? 0)
}

/**
 * Picks the best downloadable file for a Pexels video against
 * `TARGET_LONG_EDGE`: the smallest mp4 whose long edge meets or exceeds the
 * target (avoids paying for 4K when HD clears the bar), falling back to the
 * largest available file if nothing meets it.
 */
function pickVideoFile(video: PexelsVideo): PexelsVideoFile {
  const mp4Files = video.video_files.filter((f) => f.file_type === 'video/mp4')
  const candidates = mp4Files.length > 0 ? mp4Files : video.video_files
  const sorted = [...candidates].sort((a, b) => longEdge(a.width, a.height) - longEdge(b.width, b.height))
  return sorted.find((f) => longEdge(f.width, f.height) >= TARGET_LONG_EDGE) ?? sorted[sorted.length - 1] ?? candidates[0]
}

function findExisting(src: string): MediaAsset | undefined {
  return Object.values(useMediaLibraryStore.getState().assets).find((a) => a.src === src)
}

/**
 * Picks the best src variant for a Pexels photo against `TARGET_LONG_EDGE`:
 * `large2x` (Pexels' largest fixed-size crop, long edge well above the
 * target for typical stock photos) unless the source itself is smaller than
 * the target, in which case `large2x` would just be an upscale — use
 * `original` instead so we never serve an artificially inflated image.
 */
function pickPhotoSrc(photo: PexelsPhoto): string {
  if (longEdge(photo.width, photo.height) < TARGET_LONG_EDGE) return photo.src.original
  return photo.src.large2x || photo.src.original
}

/**
 * Registers a Pexels search result as a `MediaAsset` in the shared media
 * library, reusing its own store instead of `importUrl()`'s probe pipeline —
 * Pexels already reports dimensions/duration/thumbnail, so probing again
 * would just be a redundant network round-trip. Synchronous so it can run
 * inside a native `dragstart` handler, which must call `setData` before
 * returning.
 */
export function importPexelsPhoto(photo: PexelsPhoto): MediaAsset {
  const src = pickPhotoSrc(photo)
  const existing = findExisting(src)
  if (existing) return existing

  const asset: MediaAsset = {
    id: crypto.randomUUID(),
    kind: 'image',
    name: photo.alt?.trim() || `pexels-photo-${photo.id}`,
    src,
    durationSec: 0,
    width: photo.width,
    height: photo.height,
    thumbnailUrl: photo.src.medium,
    byteSize: 0,
    lastModified: Date.now(),
    addedAt: Date.now(),
  }
  useMediaLibraryStore.getState().addAsset(asset)
  return asset
}

export function importPexelsVideo(video: PexelsVideo): MediaAsset {
  const file = pickVideoFile(video)
  const src = file.link
  const existing = findExisting(src)
  if (existing) return existing

  const asset: MediaAsset = {
    id: crypto.randomUUID(),
    kind: 'video',
    name: `pexels-video-${video.id}`,
    src,
    durationSec: video.duration,
    width: file.width ?? video.width,
    height: file.height ?? video.height,
    thumbnailUrl: video.image,
    byteSize: 0,
    lastModified: Date.now(),
    addedAt: Date.now(),
  }
  useMediaLibraryStore.getState().addAsset(asset)
  return asset
}
