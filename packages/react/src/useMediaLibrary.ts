import { importFiles, importUrl, importBlob } from '@elah/core'
import type {
  MediaAsset,
  ImportFilesResult,
  ImportUrlOptions,
  ImportBlobOptions,
} from '@elah/core'
import { useMediaLibraryStore } from './stores'

export interface UseMediaLibraryApi {
  /** Assets in insertion order. */
  assets: MediaAsset[]
  getAsset: (id: string) => MediaAsset | undefined
  removeAsset: (id: string) => void
  updateAsset: (id: string, patch: Partial<MediaAsset>) => void
  importFiles: (files: Iterable<File>) => Promise<ImportFilesResult>
  importUrl: (url: string, opts?: ImportUrlOptions) => Promise<MediaAsset>
  importBlob: (blob: Blob, opts?: ImportBlobOptions) => Promise<MediaAsset>
}

/**
 * Public hook for reading and mutating the media library. Returns assets in
 * insertion order plus the ingestion (`importFiles`/`importUrl`/`importBlob`)
 * and mutation (`removeAsset`/`updateAsset`) surface.
 */
export function useMediaLibrary(): UseMediaLibraryApi {
  const order = useMediaLibraryStore((s) => s.order)
  const assets = useMediaLibraryStore((s) => s.assets)
  const getAsset = useMediaLibraryStore((s) => s.getAsset)
  const removeAsset = useMediaLibraryStore((s) => s.removeAsset)
  const updateAsset = useMediaLibraryStore((s) => s.updateAsset)
  return {
    assets: order.map((id) => assets[id]).filter(Boolean) as MediaAsset[],
    getAsset,
    removeAsset,
    updateAsset,
    importFiles,
    importUrl,
    importBlob,
  }
}

/** Alias for {@link useMediaLibrary}. */
export const useAssets = useMediaLibrary
