import { useMediaLibraryStore, type MediaAsset } from '@elah/editor'
import type { PexelsPhoto, PexelsVideo } from './types'

/**
 * Picks the best downloadable file for a Pexels video: largest mp4 at or
 * below HD, since 4K sources are overkill for the timeline and slow to probe.
 */
function pickVideoFile(video: PexelsVideo) {
  const mp4Files = video.video_files.filter((f) => f.file_type === 'video/mp4')
  const candidates = mp4Files.length > 0 ? mp4Files : video.video_files
  const hd = candidates.find((f) => f.quality === 'hd')
  if (hd) return hd
  return [...candidates].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0] ?? candidates[0]
}

function findExisting(src: string): MediaAsset | undefined {
  return Object.values(useMediaLibraryStore.getState().assets).find((a) => a.src === src)
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
  const src = photo.src.large2x || photo.src.original
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
