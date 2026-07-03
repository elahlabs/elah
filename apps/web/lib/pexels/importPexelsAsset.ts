import { useMediaLibraryStore, type MediaAsset } from '@elah/editor'
import { proxyPexelsImage } from './proxyImage'
import type { PexelsPhoto } from './types'

/**
 * Target resolution standard for imported media — mirrors Pixabay's
 * TARGET_LONG_EDGE so photos from either provider land on the timeline at a
 * consistent quality (see importPixabayAsset.ts for the full rationale).
 */
const TARGET_LONG_EDGE = 1080

function longEdge(width: number | null | undefined, height: number | null | undefined): number {
  return Math.max(width ?? 0, height ?? 0)
}

function findExisting(src: string): MediaAsset | undefined {
  return Object.values(useMediaLibraryStore.getState().assets).find((a) => a.src === src)
}

/**
 * Picks the best src variant for a Pexels photo against `TARGET_LONG_EDGE`:
 * `large2x` (Pexels' ~1880px-long-edge download) unless the original photo is
 * smaller than the target, in which case `large2x` would just upscale — use
 * `large` (~940px) instead so we never serve an artificially inflated image.
 *
 * Pexels' `src.*` variants are all downscaled from the same original and
 * preserve its aspect ratio, so width/height are derived from the original
 * `photo.width`/`photo.height` scaled to whichever variant's long edge cap —
 * matching pickPhotoSrc in importPixabayAsset.ts, which keeps the cover-fit
 * transform in sync with the image the renderer actually loads.
 */
const LARGE2X_LONG_EDGE = 1880
const LARGE_LONG_EDGE = 940

function pickPhotoSrc(photo: PexelsPhoto): { src: string; width: number; height: number } {
  const original = longEdge(photo.width, photo.height)
  if (original < TARGET_LONG_EDGE) {
    return { src: photo.src.large, width: photo.width, height: photo.height }
  }
  const scale = Math.min(1, LARGE2X_LONG_EDGE / original)
  const width = Math.round(photo.width * scale)
  const height = Math.round(photo.height * scale)
  if (width && height) return { src: photo.src.large2x, width, height }
  const fallbackScale = Math.min(1, LARGE_LONG_EDGE / original)
  return { src: photo.src.large, width: Math.round(photo.width * fallbackScale), height: Math.round(photo.height * fallbackScale) }
}

/**
 * Registers a Pexels search result as a `MediaAsset` in the shared media
 * library, mirroring importPixabayPhoto — Pexels already reports
 * dimensions, so no probing round-trip is needed. Synchronous so it can run
 * inside a native `dragstart` handler.
 */
export function importPexelsPhoto(photo: PexelsPhoto): MediaAsset {
  const picked = pickPhotoSrc(photo)
  const { width, height } = picked
  const src = proxyPexelsImage(picked.src)
  const existing = findExisting(src)
  if (existing) {
    console.log('[pexels] photo reused from library', { id: photo.id, src, width: existing.width, height: existing.height })
    return existing
  }

  const asset: MediaAsset = {
    id: crypto.randomUUID(),
    kind: 'image',
    name: photo.alt?.trim() || `pexels-photo-${photo.id}`,
    src,
    durationSec: 0,
    width,
    height,
    thumbnailUrl: proxyPexelsImage(photo.src.medium),
    byteSize: 0,
    lastModified: Date.now(),
    addedAt: Date.now(),
  }
  console.log('[pexels] photo imported', { id: photo.id, src, width, height })
  useMediaLibraryStore.getState().addAsset(asset)
  return asset
}
