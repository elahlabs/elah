/**
 * Authoritative "does this video carry an audio track?" determination.
 *
 * Why this exists — the two signals that came before it are both unreliable:
 *
 *  1. `probeVideo()` reads `HTMLVideoElement.audioTracks` / `mozHasAudio` /
 *     `webkitAudioDecodedByteCount`. Chromium exposes none of them usefully at
 *     `loadedmetadata` (`audioTracks` is behind a flag, and
 *     `webkitAudioDecodedByteCount` is still 0 because nothing has decoded
 *     yet), so it answers `false` for every video — including ones that
 *     obviously have sound.
 *  2. The waveform decode (`scheduleAudioAnalysis`) is authoritative when it
 *     succeeds, but it downloads and decodes the entire file, and it fails for
 *     reasons that have nothing to do with audio (CORS, unsupported codec).
 *
 * Reading the container instead is both correct and cheap: mediabunny fetches
 * only the header/index via range requests, never the media payload.
 *
 * The determination is memoised per asset and started at import time so that
 * callers which import and insert in the same click — the gallery's "add to
 * editor", which registers a placeholder asset via `beginImportUrl` and inserts
 * it immediately — get a real answer rather than the placeholder seed value.
 */

import { mediaLibraryStore } from './store'
import { sourceBlobCache } from '../media/video/demuxer/sourceBlobCache'

/** In-flight/settled determinations, keyed by asset id. */
const determinations = new Map<string, Promise<boolean>>()
/** Assets whose container probe answered — these outrank every other signal. */
const determined = new Set<string>()

/**
 * Read the source's container and report whether it carries an audio track.
 *
 * mediabunny is imported dynamically so that bundles which never touch the
 * media library don't pull the demuxer in.
 */
export async function probeHasAudio(
  src: string,
  resolveBlob: (src: string) => Promise<Blob> = sourceBlobCache.resolve,
): Promise<boolean> {
  const mb = await import('mediabunny')
  // http(s) sources stream through range requests, so only the header/index is
  // fetched. Everything else — blob:, data:, and the same-origin proxy path the
  // gallery uses, which answers `Accept-Ranges: none` — has to be materialised
  // as a Blob. That download goes through the shared cache, so the demuxer that
  // opens this same source after the user drops it on the timeline reuses these
  // bytes instead of fetching the file a second time.
  const source = /^https?:/i.test(src)
    ? new mb.UrlSource(src)
    : new mb.BlobSource(await resolveBlob(src))

  const input = new mb.Input({ formats: mb.ALL_FORMATS, source })
  try {
    return (await input.getPrimaryAudioTrack()) !== null
  } finally {
    input.dispose()
  }
}

/**
 * Determine (once per asset) whether a video asset has an audio track, writing
 * the result back to the media library.
 *
 * Non-video assets and unknown ids resolve `false`. If the container can't be
 * read, the asset's current `hasAudio` is kept rather than being overwritten
 * with a guess.
 *
 * @param probe Injectable probe — a test seam, not part of the public contract.
 */
export function determineAssetHasAudio(
  assetId: string,
  probe: (src: string) => Promise<boolean> = probeHasAudio,
): Promise<boolean> {
  const cached = determinations.get(assetId)
  if (cached) return cached

  const asset = mediaLibraryStore.getState().getAsset(assetId)
  if (!asset || asset.kind !== 'video') return Promise.resolve(false)

  const determination = probe(asset.src)
    .then((hasAudio) => {
      determined.add(assetId)
      mediaLibraryStore.getState().updateAsset(assetId, { hasAudio })
      return hasAudio
    })
    .catch((err) => {
      console.warn(`[hasAudio] Container probe failed for "${asset.name}":`, err)
      return mediaLibraryStore.getState().getAsset(assetId)?.hasAudio ?? false
    })

  determinations.set(assetId, determination)
  return determination
}

/**
 * Whether the container probe has already answered for this asset. Weaker
 * signals check this before writing `hasAudio` so they can't overrule it.
 */
export function hasAudioDetermined(assetId: string): boolean {
  return determined.has(assetId)
}

/** Test seam — forgets every memoised determination. */
export function __resetHasAudioDeterminations(): void {
  determinations.clear()
  determined.clear()
}
