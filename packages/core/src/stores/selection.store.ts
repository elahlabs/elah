import { createStore } from 'zustand/vanilla'

/** UI-only selection (Ring 2); holds no engine truth, so ids here may name clips that have since been removed. */
export interface SelectionState {
  selectedClipIds: Set<string>
  activeTrackId: string | null
}

/** Selection mutators; selectClip replaces the set, toggleClipSelection adds/removes within it for multi-select. */
export interface SelectionActions {
  selectClip: (clipId: string) => void
  toggleClipSelection: (clipId: string) => void
  selectClips: (clipIds: string[]) => void
  clearSelection: () => void
  setActiveTrack: (trackId: string | null) => void
}

/** Vanilla store so core stays React-free; @elah/react wraps it as the `useSelectionStore` hook. */
export const selectionStore = createStore<SelectionState & SelectionActions>()(
  (set) => ({
    selectedClipIds: new Set(),
    activeTrackId: null,

    selectClip: (clipId) =>
      set({ selectedClipIds: new Set([clipId]) }),

    toggleClipSelection: (clipId) =>
      set((s) => {
        const next = new Set(s.selectedClipIds)
        if (next.has(clipId)) {
          next.delete(clipId)
        } else {
          next.add(clipId)
        }
        return { selectedClipIds: next }
      }),

    selectClips: (clipIds) =>
      set({ selectedClipIds: new Set(clipIds) }),

    clearSelection: () =>
      set({ selectedClipIds: new Set() }),

    setActiveTrack: (trackId) =>
      set({ activeTrackId: trackId }),
  }),
)
