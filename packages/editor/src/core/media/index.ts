import { useMediaLibraryStore } from './store'
import type { MediaAsset } from './types'

export type { MediaAsset, MediaKind, DragMediaPayload } from './types'
export { MEDIA_DRAG_MIME } from './types'
export { useMediaLibraryStore } from './store'
export { importFiles } from './importFiles'
export type { ImportFilesOptions } from './importFiles'

/**
 * Public hook for reading the media library.
 * Returns assets in insertion order.
 */
export function useMediaLibrary(): {
  assets: MediaAsset[]
  getAsset: (id: string) => MediaAsset | undefined
} {
  const order = useMediaLibraryStore((s) => s.order)
  const assets = useMediaLibraryStore((s) => s.assets)
  const getAsset = useMediaLibraryStore((s) => s.getAsset)
  return {
    assets: order.map((id) => assets[id]).filter(Boolean) as MediaAsset[],
    getAsset,
  }
}
