/**
 * Carrying the media library across a page load.
 *
 * The library is module-scoped and rebuilt empty on every load, which is fine
 * for the assets themselves — a clip plays from its own `src` and never asks
 * the library for anything. What does not survive is everything the library
 * alone holds: the filmstrip decoded from the video, the waveform decoded from
 * its audio, the real duration and dimensions. So a restored composition comes
 * back with grey placeholder boxes where every clip's thumbnails were, and the
 * only way to get them back is to decode all of it again — if the source can
 * even be fetched, which for a file the user dragged in from their own device
 * it cannot.
 *
 * This module is the two halves of fixing that, and nothing else: turn the
 * library into something storable, and put a stored one back. Where it is
 * stored is deliberately not decided here — `packages/core` has no business
 * knowing about IndexedDB, tenants or projects, and the app that does owns the
 * adapter.
 *
 * The ids are kept. A restored clip's `assetId` names the asset it had when it
 * was saved, so hydrating under the same ids makes those references resolve
 * directly; `relinkProjectMedia` stays the fallback for anything that comes
 * back by `src` instead (a re-import, or a snapshot that predates the clip).
 */

import { mediaLibraryStore, type MediaLibraryState } from './store'
import { scheduleThumbnailById } from './importFiles'
import type { MediaAsset } from './types'

/**
 * One stored asset. Structurally a `MediaAsset` — named separately because it
 * crosses a storage boundary, so widening `MediaAsset` must be a deliberate
 * decision about what is worth persisting rather than an automatic one.
 *
 * `status` is not carried: a stored asset is by definition finished probing.
 */
export type MediaLibrarySnapshotEntry = Omit<MediaAsset, 'status'>

export interface HydrateMediaLibraryOptions {
  /**
   * The `src` of every media clip in the composition being restored.
   *
   * Decides the fate of entries whose source can no longer be fetched — a
   * `blob:` URL from a local file, dead the moment the session that minted it
   * ended. Such an entry is worth restoring only when a clip still points at
   * it, because then its stored filmstrip is the one thing that keeps that clip
   * from being an anonymous grey rectangle. Restoring it into the Assets panel
   * of a composition that never used it would just be litter.
   */
  referencedSrcs: ReadonlySet<string>
  /**
   * Rewrites an entry before it is considered (LM-P3): a local file whose
   * handle was re-opened this session is restored under its fresh object URL
   * instead of the dead one it was saved with. Return the entry unchanged to
   * leave it as stored. The result still goes through the same rules - never
   * overwrites, a dead `blob:` is kept only when `referencedSrcs` has it - and
   * `referencedSrcs` is matched against the REMAPPED `src`.
   */
  remap?: (entry: MediaLibrarySnapshotEntry) => MediaLibrarySnapshotEntry
}

export interface HydrateMediaLibraryResult {
  /** Ids added to the library by this call. */
  hydrated: string[]
  /**
   * Hydrated ids that came back without thumbnails and whose source can still
   * be fetched — the ones worth spending a decode on. Feed to
   * {@link refreshMissingThumbnails}.
   */
  needsThumbnail: string[]
}

/**
 * Whether a source can be fetched again in a later session.
 *
 * Deliberately duplicated from `projectDocument.isRecoverableMediaSrc` rather
 * than imported: that one is about clips and what to tell the user is missing;
 * this one is about assets and whether a decode is worth attempting. They agree
 * today and there is no reason for the asset layer to depend on the document
 * layer to say so.
 */
function isFetchableSrc(src: string): boolean {
  return src.length > 0 && !src.startsWith('blob:') && !src.startsWith('data:')
}

function hasThumbnails(entry: MediaLibrarySnapshotEntry): boolean {
  return entry.thumbnailUrl !== undefined || (entry.thumbnailStrip?.length ?? 0) > 0
}

/**
 * The library, as something storable.
 *
 * Skips assets still being probed: their duration and dimensions are fallback
 * guesses, and storing those would restore a clip at the wrong width with no
 * way to tell it was ever provisional.
 */
export function snapshotMediaLibrary(
  state: Pick<MediaLibraryState, 'assets' | 'order'>,
): MediaLibrarySnapshotEntry[] {
  const entries: MediaLibrarySnapshotEntry[] = []
  for (const id of state.order) {
    const asset = state.assets[id]
    if (!asset || asset.status === 'pending') continue
    const { status: _dropped, ...entry } = asset
    entries.push(entry)
  }
  return entries
}

/**
 * Put a stored library back, keeping ids so restored clips resolve directly.
 *
 * Never overwrites: an asset already registered under the same id or the same
 * `src` was put there by this session — a live import, or a project's own asset
 * fetch — and is by definition fresher than anything stored.
 */
export function hydrateMediaLibrary(
  entries: readonly MediaLibrarySnapshotEntry[],
  opts: HydrateMediaLibraryOptions,
): HydrateMediaLibraryResult {
  const store = mediaLibraryStore.getState()
  const existing = store.assets
  const existingSrcs = new Set(Object.values(existing).map((a) => a.src))

  const hydrated: string[] = []
  const needsThumbnail: string[] = []

  for (const stored of entries) {
    const entry = opts.remap ? opts.remap(stored) : stored
    if (existing[entry.id] !== undefined) continue
    if (existingSrcs.has(entry.src)) continue

    const fetchable = isFetchableSrc(entry.src)
    // A dead source earns its place only by being the one thing standing
    // between a restored clip and a blank rectangle.
    if (!fetchable && !opts.referencedSrcs.has(entry.src)) continue

    mediaLibraryStore.getState().addAsset({ ...entry, status: 'ready' })
    existingSrcs.add(entry.src)
    hydrated.push(entry.id)

    // Only worth asking for what can actually be decoded: a dead source would
    // fail every time, and an entry that already has its strip needs nothing.
    if (fetchable && !hasThumbnails(entry)) needsThumbnail.push(entry.id)
  }

  return { hydrated, needsThumbnail }
}

/**
 * Decode thumbnails for hydrated assets that came back without them.
 *
 * Fire-and-forget, one decode per asset, and entirely cosmetic — the
 * composition plays whether these land or not.
 *
 * @param schedule Injectable so tests never touch a video element.
 */
export function refreshMissingThumbnails(
  assetIds: readonly string[],
  schedule: (assetId: string) => void = scheduleThumbnailById,
): void {
  for (const id of assetIds) schedule(id)
}
