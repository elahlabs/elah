import { createStore } from 'zustand/vanilla'
import type { MediaAsset } from './types'

export interface MediaLibraryState {
  assets: Record<string, MediaAsset>
  order: string[]
}

export interface MediaLibraryActions {
  addAsset: (asset: MediaAsset) => void
  removeAsset: (id: string) => void
  updateAsset: (id: string, patch: Partial<MediaAsset>) => void
  getAsset: (id: string) => MediaAsset | undefined
}

/**
 * Vanilla store. React consumers should prefer `useMediaLibrary()` from
 * @elah/react; imperative access via `mediaLibraryStore.getState()` is for
 * non-React code paths (workers, actions).
 */
export const mediaLibraryStore = createStore<MediaLibraryState & MediaLibraryActions>(
  (set, get) => ({
    assets: {},
    order: [],
    addAsset: (asset) =>
      set((s) => ({
        assets: { ...s.assets, [asset.id]: asset },
        order: s.order.includes(asset.id) ? s.order : [...s.order, asset.id],
      })),
    removeAsset: (id) =>
      set((s) => {
        const { [id]: _removed, ...rest } = s.assets
        return { assets: rest, order: s.order.filter((x) => x !== id) }
      }),
    updateAsset: (id, patch) =>
      set((s) => {
        const existing = s.assets[id]
        if (!existing) return s
        return { assets: { ...s.assets, [id]: { ...existing, ...patch } } }
      }),
    getAsset: (id) => get().assets[id],
  }),
)
