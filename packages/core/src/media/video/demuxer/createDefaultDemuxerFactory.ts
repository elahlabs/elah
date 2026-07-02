/**
 * createDefaultDemuxerFactory — zero-config demuxer wiring.
 *
 * `createMediabunnyBackend` keeps the editor decoder-agnostic by taking the
 * mediabunny module as an argument, which means consumers normally have to both
 * install mediabunny *and* import it themselves. mediabunny is now a direct
 * dependency of `@elah/core`, so this helper does that wiring for you:
 *
 * ```ts
 * import { Preview, createDefaultDemuxerFactory } from '@elah/editor'
 *
 * <Preview demuxerFactory={createDefaultDemuxerFactory()} />
 * ```
 *
 * Pass a `blobResolver` if your sources aren't plain `fetch`-able URLs (e.g. to
 * hand back a retained `File` and skip the fetch round-trip):
 *
 * ```ts
 * createDefaultDemuxerFactory({ blobResolver: (src) => fileCache.get(src) })
 * ```
 *
 * Advanced consumers who want to supply their own mediabunny build (or a
 * different decoder entirely) can keep using {@link createMediabunnyBackend}
 * directly — this module is the only place in the package that statically
 * imports `mediabunny`, so with tree-shaking it adds nothing to bundles that
 * don't reference it.
 */

import * as mediabunny from 'mediabunny'
import {
  createMediabunnyBackend,
  type MediabunnyModule,
  type CreateMediabunnyBackendOpts,
} from './createMediabunnyBackend'
import type { DemuxerFactory } from './MediabunnyDemuxer'

const mb = mediabunny as unknown as MediabunnyModule

/**
 * Build a {@link DemuxerFactory} backed by the bundled mediabunny package.
 *
 * @param opts Optional backend configuration (e.g. a custom `blobResolver`).
 */
export function createDefaultDemuxerFactory(
  opts: CreateMediabunnyBackendOpts = {},
): DemuxerFactory {
  return () => createMediabunnyBackend(mb, opts)
}
