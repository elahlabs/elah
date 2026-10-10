/**
 * @elah/react-native
 *
 * React Native binding for the Elah video engine. Same `Project` document,
 * same `TimelineEngine`, same `@elah/react` provider and hooks as the web; the
 * rendering, decode, audio and export seams are native and arrive workstream
 * by workstream (docs/react-native/04-workstreams.md).
 *
 * Everything here reaches `@elah/core` through `@elah/core/engine`, the
 * browser-free entry Metro and Hermes can bundle. Importing the root
 * `@elah/core` by value is a test failure in this package
 * (src/dependencyRules.test.ts).
 */

// --- React layer, shared with the web ---
export {
  EditorProvider,
  EditorContext,
  useEditor,
  useTimelineEngine,
  usePlaybackEngine,
  useTracksStore,
  usePlaybackStore,
  useSelectionStore,
  useTransitionsStore,
  useTextStylePresetsStore,
  useMediaLibraryStore,
  useClipLoadStore,
} from '@elah/react'
export type { EditorProviderProps, EditorContextValue, BoundStoreHook } from '@elah/react'
// Deliberately NOT re-exported: useMediaLibrary / useAssets. On React Native
// @elah/react resolves them to a variant whose browser importers throw; mobile
// import is its own seam (useImportMedia, RN-P8).

// --- Engine (browser-free entry) ---
export {
  TimelineEngine,
  PlaybackEngine,
  resolveTimeline,
  serializeProject,
  deserializeProject,
  readProjectDocument,
  relinkProjectMedia,
  PROJECT_VERSION,
  createVideoClip,
  createAudioClip,
  createTextClip,
  createImageClip,
  createShapeClip,
  createFreehandClip,
  BUILT_IN_TEXT_TEMPLATES,
  applyTextTemplate,
  secondsToFrames,
  framesToSeconds,
  framesToTimecode,
  splitClipAtPlayhead,
  timelineContentWidth,
  tracksStore,
  playbackStore,
  selectionStore,
} from '@elah/core/engine'
export type {
  Project,
  Track,
  Clip,
  ClipType,
  TrackKind,
  Scene,
  Transform,
  Transition,
  MediaAsset,
  MediaKind,
  InitialTrackConfig,
  PlaybackState,
  PlaybackActions,
  SelectionState,
  SelectionActions,
  TracksState,
} from '@elah/core'

// --- Timeline ---
export * from './timeline'
