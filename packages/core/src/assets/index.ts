export type { MediaAsset, MediaAssetAnalysis, MediaAssetTopObject, MediaAssetVector, MediaKind, DragMediaPayload } from './types'
export { VECTOR_INLINE_MAX_CHARS, isVectorAsset, vectorOriginLine } from './vector'
export { MEDIA_DRAG_MIME, mediaDragKindMime } from './types'
export { mediaLibraryStore } from './store'
export type { MediaLibraryState, MediaLibraryActions } from './store'
export {
  importFiles,
  importUrl,
  importBlob,
  beginImportUrl,
  scheduleThumbnailById,
  LARGE_LOCAL_SOURCE_BYTES,
  shouldDecodeWaveform,
  shouldStreamAudio,
  computeStreamedWaveform,
} from './importFiles'
export { fingerprintBlob, FINGERPRINT_CHUNK_BYTES } from './fingerprint'
export type { FingerprintOptions } from './fingerprint'
export {
  snapshotMediaLibrary,
  hydrateMediaLibrary,
  refreshMissingThumbnails,
} from './librarySnapshot'
export type {
  MediaLibrarySnapshotEntry,
  HydrateMediaLibraryOptions,
  HydrateMediaLibraryResult,
} from './librarySnapshot'
export { determineAssetHasAudio, hasAudioDetermined, probeHasAudio } from './hasAudio'
export type {
  ImportFilesOptions,
  ImportFilesResult,
  ImportUrlOptions,
  ImportBlobOptions,
  SkippedImport,
} from './importFiles'

// The React surface over this store — `useMediaLibrary()` / `useAssets()` —
// lives in the React binding. Core stays framework-agnostic (ARCHITECTURE P1),
// which is enforced by src/no-react-imports.test.ts.
