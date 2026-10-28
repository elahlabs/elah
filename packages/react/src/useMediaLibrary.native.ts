import { useMemo } from 'react'
import type { MediaAsset } from '@elah/core'
import { useMediaLibraryStore } from './stores'
import type { UseMediaLibraryApi } from './useMediaLibrary'

/**
 * React Native variant of `useMediaLibrary`. Metro (and any bundler that honours
 * the `.native` platform extension) picks this file instead of
 * `useMediaLibrary.ts`; browsers and Node never see it.
 *
 * Why it exists: the web hook returns `importFiles` / `importUrl` / `importBlob`
 * from `@elah/core`'s root entry. Those are DOM importers (`File`,
 * `URL.createObjectURL`, `<video>` probing), and the root entry also reaches the
 * export worker's `import.meta`, which Metro cannot parse. This variant keeps the
 * same API shape so shared code type-checks, reads the same store, and makes
 * the three importers throw a clear error. Mobile ingestion is its own seam:
 * `useImportMedia` in `@elah/react-native` (workstream RN-P8).
 */

function notOnNative(name: string): never {
  throw new Error(
    `${name} is a browser importer and is not available on React Native. ` +
      'Add media with @elah/react-native (useImportMedia, workstream RN-P8), ' +
      'or add a MediaAsset to mediaLibraryStore yourself.',
  )
}

export function useMediaLibrary(): UseMediaLibraryApi {
  const order = useMediaLibraryStore((s) => s.order)
  const assets = useMediaLibraryStore((s) => s.assets)
  const getAsset = useMediaLibraryStore((s) => s.getAsset)
  const removeAsset = useMediaLibraryStore((s) => s.removeAsset)
  const updateAsset = useMediaLibraryStore((s) => s.updateAsset)

  const ordered = useMemo(
    () => order.map((id) => assets[id]).filter(Boolean) as MediaAsset[],
    [order, assets],
  )

  return useMemo(
    () => ({
      assets: ordered,
      getAsset,
      removeAsset,
      updateAsset,
      importFiles: () => notOnNative('importFiles'),
      importUrl: () => notOnNative('importUrl'),
      importBlob: () => notOnNative('importBlob'),
    }),
    [ordered, getAsset, removeAsset, updateAsset],
  )
}

/** Alias for {@link useMediaLibrary}. */
export const useAssets = useMediaLibrary
