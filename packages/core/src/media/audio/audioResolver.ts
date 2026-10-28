/**
 * AudioResolver — injectable URL-to-bytes seam for audio decode.
 *
 * Mirrors the video pipeline's `blobResolver` (see
 * media/video/demuxer/createMediabunnyBackend.ts). All three audio fetch
 * sites (playback decode cache, export mix, waveform generation) accept an
 * optional `audioResolver` so a single override — e.g. return a retained
 * File's bytes, or route through a same-origin proxy for a CDN that lacks
 * permissive CORS — covers every consumer.
 *
 * Defaults to fetch(src).arrayBuffer() — works for blob:, http(s):, data:.
 */
import { sourceBlobCache } from '../video/demuxer/sourceBlobCache'

export type AudioResolver = (src: string) => Promise<ArrayBuffer>

export const defaultAudioResolver: AudioResolver = async (src) => {
  const res = await fetch(src)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching audio ${src}`)
  return res.arrayBuffer()
}

/**
 * Audio bytes through the shared `sourceBlobCache`, for the editor's preview.
 *
 * A video's own audio is the same file the demuxer and the has-audio probe
 * read, so this is one download instead of another full one; the cache's
 * stall timeout applies; and bytes primed from a local upload
 * (`sourceBlobCache.prime`) answer audio as well as video, so a clip repointed
 * to its hosted URL keeps playing without re-fetching. `Blob.arrayBuffer()`
 * returns a fresh copy each call, so `decodeAudioData` detaching it never
 * touches the cached bytes.
 */
export const cachedAudioResolver: AudioResolver = async (src) => {
  const blob = await sourceBlobCache.resolve(src)
  return blob.arrayBuffer()
}
