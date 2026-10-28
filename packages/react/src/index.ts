/**
 * @elah/react
 *
 * React bindings for the Elah video engine. Everything here is a thin hook
 * layer over @elah/core, which stays framework-agnostic (zero React imports).
 */

// --- Editor context + the provider that wires engines to stores ---
export { EditorContext, useEditor, useTimelineEngine, usePlaybackEngine } from './editor-context'
export type { EditorContextValue } from './editor-context'
export { EditorProvider } from './EditorProvider'
export type { EditorProviderProps } from './EditorProvider'

// --- Store hooks (React views over core's vanilla Zustand stores) ---
export {
  useTracksStore,
  usePlaybackStore,
  useSelectionStore,
  useTransitionsStore,
  useTextStylePresetsStore,
  useMediaLibraryStore,
  useClipLoadStore,
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
