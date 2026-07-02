/**
 * Shared image decode cache for ImageLayer.
 *
 * Mirrors AudioPlaybackController's `_buffers` cache: a single in-flight/decoded
 * promise per `src`, deduped across every clip and every ImageLayer instance, so
 * a clip's first paint doesn't wait on a cold network fetch + decode. Preloading
 * (via `warmImageSrc`/`preloadProjectImages`) populates this same cache ahead of
 * time — e.g. as soon as an image asset is registered or lands on the timeline —
 * so ImageLayer.acquire() just picks up the (possibly already-resolved) promise.
 */
import type { Project } from '../../../types'

/** A decoded image ready for upload, plus its intrinsic size for the contain fit. */
export interface LoadedImage {
  source: TexImageSource
  width: number
  height: number
}

/** Loads an image src into an uploadable source. Injectable so tests skip the DOM. */
export type ImageLoader = (src: string) => Promise<LoadedImage>

/** Default loader: an <img> element, mirroring probeImage/makeImageThumbnail. */
export const defaultImageLoader: ImageLoader = (src) =>
  new Promise<LoadedImage>((resolve, reject) => {
    const img = document.createElement('img')
    // Required for texImage2D to read pixels from a cross-origin source (e.g.
    // Pexels) without tainting the canvas. The <img> tags used for plain
    // display (timeline thumbnails) don't need this since they never read
    // pixel data back.
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      img.onload = null
      img.onerror = null
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      img.onload = null
      img.onerror = null
      reject(new Error(`ImageLayer: failed to load image "${src}"`))
    }
    img.src = src
  })

const _cache = new Map<string, Promise<LoadedImage>>()

/**
 * Get (or start) the decode for `src`, deduped by URL. Failures evict the
 * cache entry so a transient error can retry later; identity guard avoids
 * clobbering a newer in-flight retry.
 */
export function loadCachedImage(src: string, loader: ImageLoader = defaultImageLoader): Promise<LoadedImage> {
  const cached = _cache.get(src)
  if (cached) return cached

  const promise = loader(src)
  promise.catch((e) => {
    if (_cache.get(src) === promise) _cache.delete(src)
    console.warn(`[image] failed to load ${src}:`, e)
  })
  _cache.set(src, promise)
  return promise
}

/**
 * Warm the decode cache for a single URL — for callers that want to start
 * fetching+decoding as soon as an image asset is registered (e.g. clicked
 * into the library), rather than waiting for it to land on the timeline.
 */
export function warmImageSrc(src: string): void {
  void loadCachedImage(src)
}

/**
 * Warm the decode cache for every image clip in the project so first paint
 * doesn't wait on download + decode. The cache is intentionally never evicted
 * except on load failure.
 */
export function preloadProjectImages(project: Project): void {
  for (const clips of Object.values(project.clips)) {
    for (const clip of clips) {
      if (clip.type === 'image' && typeof clip.src === 'string') {
        warmImageSrc(clip.src)
      }
    }
  }
}

/** Test-only: reset shared cache state between isolated test suites. */
export function __clearImageCacheForTests(): void {
  _cache.clear()
}
