import { useStore } from 'zustand'
import type { StoreApi } from 'zustand'
import {
  tracksStore,
  playbackStore,
  selectionStore,
  transitionsStore,
  mediaLibraryStore,
} from '@elah/core'
import type {
  TracksState,
  TracksActions,
  PlaybackState,
  PlaybackActions,
  SelectionState,
  SelectionActions,
  TransitionsState,
  TransitionsActions,
  MediaLibraryState,
  MediaLibraryActions,
} from '@elah/core'

/**
 * A React hook bound to a vanilla store that also carries the store's
 * imperative API, so both call styles keep working under one name:
 * `useTracksStore(s => s.tracks)` in components and
 * `useTracksStore.getState()` in event handlers.
 */
export type BoundStoreHook<S> = {
  (): S
  <T>(selector: (state: S) => T): T
} & StoreApi<S>

function bindHook<S>(store: StoreApi<S>): BoundStoreHook<S> {
  const hook = <T,>(selector?: (state: S) => T) =>
    useStore(store, selector as (state: S) => T)
  return Object.assign(hook as BoundStoreHook<S>, store)
}

export const useTracksStore = bindHook<TracksState & TracksActions>(tracksStore)
export const usePlaybackStore = bindHook<PlaybackState & PlaybackActions>(playbackStore)
export const useSelectionStore = bindHook<SelectionState & SelectionActions>(selectionStore)
export const useTransitionsStore = bindHook<TransitionsState & TransitionsActions>(transitionsStore)
export const useMediaLibraryStore = bindHook<MediaLibraryState & MediaLibraryActions>(mediaLibraryStore)
