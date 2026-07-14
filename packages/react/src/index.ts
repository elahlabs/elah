/**
 * @elah/react
 *
 * React bindings for the Elah video engine. Everything here is a thin hook
 * layer over @elah/core, which stays framework-agnostic (zero React imports).
 */

// --- Editor context (EditorProvider wiring lives in @elah/editor) ---
export { EditorContext, useEditor, useTimelineEngine, usePlaybackEngine } from './editor-context'
export type { EditorContextValue } from './editor-context'

// --- Store hooks (Ring 1: React views over core's vanilla Zustand mirrors) ---
export {
  useTracksStore,
  usePlaybackStore,
  useSelectionStore,
  useTransitionsStore,
  useMediaLibraryStore,
} from './stores'
export type { BoundStoreHook } from './stores'

// --- Media library ---
export { useMediaLibrary, useAssets } from './useMediaLibrary'
export type { UseMediaLibraryApi } from './useMediaLibrary'

// --- Audio mixer hooks ---
export { useAudioMixer } from './audio/useAudioMixer'
export type { AudioMixerApi } from './audio/useAudioMixer'
export { useMasterVolume } from './audio/useMasterVolume'
export type { MasterVolumeApi } from './audio/useMasterVolume'
export { useTrackLevels } from './audio/useTrackLevels'
export type { TrackLevel } from './audio/useTrackLevels'
