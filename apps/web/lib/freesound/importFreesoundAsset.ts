import { useMediaLibraryStore, type MediaAsset } from '@elah/editor'
import type { FreesoundSound } from './types'

function findExisting(src: string): MediaAsset | undefined {
  return Object.values(useMediaLibraryStore.getState().assets).find((a) => a.src === src)
}

/**
 * Registers a Freesound search result as a `MediaAsset` in the shared media
 * library, mirroring importPixabayAsset — Freesound already reports duration
 * and a waveform thumbnail, so we skip the probe pipeline. Synchronous so it
 * can run inside a native `dragstart` handler, which must call `setData`
 * before returning.
 */
export function importFreesoundSound(sound: FreesoundSound): MediaAsset {
  const src = sound.previews['preview-hq-mp3'] || sound.previews['preview-lq-mp3']
  const existing = findExisting(src)
  if (existing) return existing

  const asset: MediaAsset = {
    id: crypto.randomUUID(),
    kind: 'audio',
    name: sound.name?.trim() || `freesound-${sound.id}`,
    src,
    durationSec: sound.duration,
    thumbnailUrl: sound.images?.waveform_m,
    byteSize: 0,
    lastModified: Date.now(),
    addedAt: Date.now(),
  }
  useMediaLibraryStore.getState().addAsset(asset)
  return asset
}
