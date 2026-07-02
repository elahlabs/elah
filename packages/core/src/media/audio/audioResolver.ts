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
export type AudioResolver = (src: string) => Promise<ArrayBuffer>

export const defaultAudioResolver: AudioResolver = async (src) => {
  const res = await fetch(src)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching audio ${src}`)
  return res.arrayBuffer()
}
