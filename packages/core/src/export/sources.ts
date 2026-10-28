import type { AudioResolver } from '../media/audio/audioResolver'

/**
 * Caller-supplied source bytes for an export (LM-P1, `ExportOptions.sources`).
 *
 * A local file the editor already holds as a `File` (lazy, disk-backed) is read
 * straight from that Blob instead of being `fetch`ed back from its `blob:` URL,
 * which would materialise the whole file in memory. A src that is not in the
 * map falls through to the normal fetch.
 */

export type AssetBlobFetcher = (src: string, kind: string) => Promise<Blob>

const has = (sources: Record<string, Blob>, src: string): boolean =>
  Object.prototype.hasOwnProperty.call(sources, src)

/** `fetcher`, except that a src present in `sources` resolves to its Blob. */
export function sourceAwareFetch(
  sources: Record<string, Blob> | undefined,
  fetcher: AssetBlobFetcher,
): AssetBlobFetcher {
  if (!sources) return fetcher
  return (src, kind) => (has(sources, src) ? Promise.resolve(sources[src]) : fetcher(src, kind))
}

/** `base`, except that a src present in `sources` resolves via its Blob's bytes. */
export function sourceAwareAudioResolver(
  sources: Record<string, Blob> | undefined,
  base: AudioResolver,
): AudioResolver {
  if (!sources) return base
  return (src) => (has(sources, src) ? sources[src].arrayBuffer() : base(src))
}
