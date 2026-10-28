/**
 * Container alpha probe (PV-P8d): whether a video source's primary video
 * track may carry transparent samples, read from the container only —
 * mediabunny's `canBeTransparent()` — the same lazy-import/dispose shape
 * `assets/hasAudio.ts`'s `probeHasAudio` uses so a bundle that never touches
 * the media library doesn't pull the demuxer in.
 */

import { sourceBlobCache } from './demuxer/sourceBlobCache'

/** mediabunny's lazy module, injectable for tests. */
export type LoadMediabunny = () => Promise<typeof import('mediabunny')>

/**
 * Whether the source's primary video track may carry alpha (container read
 * only, like `probeHasAudio`). False when there is no video track.
 */
export async function probeHasAlpha(
  src: string,
  resolveBlob: (src: string) => Promise<Blob> = sourceBlobCache.resolve,
  loadMediabunny: LoadMediabunny = () => import('mediabunny'),
): Promise<boolean> {
  const mb = await loadMediabunny()
  const source = /^https?:/i.test(src)
    ? new mb.UrlSource(src)
    : new mb.BlobSource(await resolveBlob(src))

  const input = new mb.Input({ formats: mb.ALL_FORMATS, source })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return false
    return (await track.canBeTransparent()) ?? false
  } finally {
    input.dispose()
  }
}
