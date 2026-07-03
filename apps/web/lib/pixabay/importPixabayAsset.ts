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

/**
 * Pixabay caps `largeImageURL` at this long edge (docs: "Large image, max
 * 1280px"). `imageWidth`/`imageHeight` describe the *original upload*, which
 * is frequently bigger — so for any photo above this cap the actual
 * downloaded file is 1280px on its long edge, and its short edge is the
 * original scaled to match. `fullHDURL` (1920px) needs full API access and
 * is not in the search response we consume.
 */
const PIXABAY_LARGE_LONG_EDGE = 1280

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
 *
 * Returns the width/height matching whichever URL was picked. For
 * `largeImageURL` that means scaling `imageWidth`/`imageHeight` (the original
 * upload's dimensions) down to `PIXABAY_LARGE_LONG_EDGE`, since the file
 * itself is capped there — using the original's dimensions unconditionally
 * desyncs the cover-fit transform (baked against the wrong size) from the
 * image the renderer actually loads, shrinking it to a fraction of the frame.
 */
function pickPhotoSrc(photo: PixabayPhoto): { src: string; width: number; height: number } {
  const webformat = { src: photo.webformatURL, width: photo.webformatWidth, height: photo.webformatHeight }
  // Guaranteed non-zero on every Pixabay photo hit — last-resort fallback so a
  // clip never ends up with a falsy width/height and silently loses its cover
  // transform (see loadRandomPixabay, which relies on this being always valid).
  const preview = { src: photo.webformatURL, width: photo.previewWidth, height: photo.previewHeight }

  if (longEdge(photo.imageWidth, photo.imageHeight) < TARGET_LONG_EDGE) {
    return webformat.width && webformat.height ? webformat : preview
  }
  if (photo.largeImageURL) {
    const scale = Math.min(1, PIXABAY_LARGE_LONG_EDGE / longEdge(photo.imageWidth, photo.imageHeight))
    const width = Math.round(photo.imageWidth * scale)
    const height = Math.round(photo.imageHeight * scale)
    if (width && height) return { src: photo.largeImageURL, width, height }
  }
  return webformat.width && webformat.height ? webformat : preview
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
  const { src, width, height } = pickPhotoSrc(photo)
  const existing = findExisting(src)
  if (existing) {
    console.log('[pixabay] photo reused from library', { id: photo.id, src, width: existing.width, height: existing.height })
    return existing
  }

  const asset: MediaAsset = {
    id: crypto.randomUUID(),
    kind: 'image',
    name: photo.tags?.trim() || `pixabay-photo-${photo.id}`,
    src,
    durationSec: 0,
    width,
    height,
    thumbnailUrl: photo.webformatURL,
    byteSize: 0,
    lastModified: Date.now(),
    addedAt: Date.now(),
  }
  console.log('[pixabay] photo imported', {
    id: photo.id,
    src,
    width,
    height,
    imageWidth: photo.imageWidth,
    imageHeight: photo.imageHeight,
    webformatWidth: photo.webformatWidth,
    webformatHeight: photo.webformatHeight,
  })
  useMediaLibraryStore.getState().addAsset(asset)
  return asset
}

export function importPixabayVideo(video: PixabayVideo): MediaAsset {
  const file = pickVideoFile(video)
  const src = file.url
  const existing = findExisting(src)
  if (existing) {
    console.log('[pixabay] video reused from library', { id: video.id, src, width: existing.width, height: existing.height })
    return existing
  }

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
  console.log('[pixabay] video imported', { id: video.id, src, width: file.width, height: file.height, durationSec: video.duration })
  useMediaLibraryStore.getState().addAsset(asset)
  return asset
}
