/**
 * createPlaygroundDemuxerFactory — wires mediabunny into the playground's
 * GpuRenderer as a DemuxerFactory.
 *
 * This is the only file in the playground that statically imports mediabunny,
 * keeping the bundle impact isolated. The editor package (@elah/editor) remains
 * free of any mediabunny dependency.
 *
 * Usage:
 *   import { createPlaygroundDemuxerFactory } from './createPlaygroundDemuxerFactory'
 *   const renderer = new GpuRenderer({
 *     demuxerFactory: createPlaygroundDemuxerFactory(),
 *   })
 *
 * blobResolver strategy:
 *   Object URLs created by URL.createObjectURL(file) can be fetched via the
 *   standard fetch() API — the browser resolves them against the in-memory
 *   Blob store. This avoids maintaining a side-map of File references and works
 *   for both local imports (blob: URLs) and remote assets (http: URLs).
 *
 *   For sub-10ms first-frame latency improvements in the future, the playground
 *   could maintain a Map<objectUrl, File> and pass the File directly, skipping
 *   the fetch() round-trip. That optimisation is deferred to Phase 2.
 *
 * @see packages/editor/src/core/renderer/gpu/demuxer/createMediabunnyBackend.ts
 * @see IMPLEMENTATION_NOTES.md — why blobResolver exists
 */

import * as _mediabunny from 'mediabunny'
import { createMediabunnyBackend } from '@elah/editor'
import type { DemuxerFactory, MediabunnyModule } from '@elah/editor'

// Cast to the structural interface expected by createMediabunnyBackend.
// The editor package uses a minimal structural type (not the real mediabunny
// types) to stay free of the mediabunny package dependency.
const mediabunny = _mediabunny as unknown as MediabunnyModule

/**
 * Returns a DemuxerFactory suitable for GpuRenderer.
 *
 * Each call to the factory produces a fresh, unopened DemuxerBackend.
 * VideoLayer calls open(src) on the backend when a new src first appears
 * in the scene. The blobResolver defaults to fetch(src).blob().
 *
 * @example
 * ```ts
 * const renderer = new GpuRenderer({
 *   demuxerFactory: createPlaygroundDemuxerFactory(),
 *   maxOutstandingDecodes: 4,
 * })
 * ```
 */
export function createPlaygroundDemuxerFactory(): DemuxerFactory {
  return () =>
    createMediabunnyBackend(mediabunny, {
      blobResolver: async (src: string): Promise<Blob> => {
        const res = await fetch(src)
        if (!res.ok) {
          throw new Error(
            `createPlaygroundDemuxerFactory: failed to fetch media "${src}" ` +
            `(HTTP ${res.status} ${res.statusText}). ` +
            'The object URL may have been revoked or the file may have been removed.',
          )
        }
        return res.blob()
      },
    })
}
