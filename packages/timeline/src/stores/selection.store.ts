import { create } from 'zustand'

interface SelectionState {
  selectedClipIds: Set<string>
  activeTrackId: string | null
}

interface SelectionActions {
  selectClip: (clipId: string) => void
  toggleClipSelection: (clipId: string) => void
  selectClips: (clipIds: string[]) => void
  clearSelection: () => void
  setActiveTrack: (trackId: string | null) => void
}

export const useSelectionStore = create<SelectionState & SelectionActions>()(
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
