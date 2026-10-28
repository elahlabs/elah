import { createStore } from 'zustand/vanilla'

export interface SelectionState {
  selectedClipIds: Set<string>
  activeTrackId: string | null
  /**
   * The clip a Shift+click range extends from (PV-T1): the last clip clicked
   * or added. Null when nothing is selected.
   */
  anchorClipId: string | null
}

export interface SelectionActions {
  selectClip: (clipId: string) => void
  toggleClipSelection: (clipId: string) => void
  selectClips: (clipIds: string[]) => void
  /** Add clips to the selection; the last one becomes the anchor (PV-T1). */
  addClips: (clipIds: string[]) => void
  /** Take clips out of the selection; the anchor clears if it was one of them (PV-T1). */
  removeClips: (clipIds: string[]) => void
  clearSelection: () => void
  setActiveTrack: (trackId: string | null) => void
}

/**
 * Selection / active-track state (Ring 2 — UI-only, never in project history).
 * Vanilla; the React binding binds it into the `useSelectionStore` hook.
 */
export const selectionStore = createStore<SelectionState & SelectionActions>()(
  (set) => ({
    selectedClipIds: new Set(),
    activeTrackId: null,
    anchorClipId: null,

    selectClip: (clipId) =>
      set({ selectedClipIds: new Set([clipId]), anchorClipId: clipId }),

    toggleClipSelection: (clipId) =>
      set((s) => {
        const next = new Set(s.selectedClipIds)
        if (next.has(clipId)) {
          next.delete(clipId)
          return { selectedClipIds: next, anchorClipId: s.anchorClipId === clipId ? null : s.anchorClipId }
        }
        next.add(clipId)
        return { selectedClipIds: next, anchorClipId: clipId }
      }),

    selectClips: (clipIds) =>
      set({ selectedClipIds: new Set(clipIds), anchorClipId: clipIds[clipIds.length - 1] ?? null }),

    addClips: (clipIds) =>
      set((s) => {
        if (clipIds.length === 0) return s
        const next = new Set(s.selectedClipIds)
        for (const id of clipIds) next.add(id)
        return { selectedClipIds: next, anchorClipId: clipIds[clipIds.length - 1]! }
      }),

    removeClips: (clipIds) =>
      set((s) => {
        const drop = new Set(clipIds)
        const next = new Set([...s.selectedClipIds].filter((id) => !drop.has(id)))
        if (next.size === s.selectedClipIds.size) return s
        return {
          selectedClipIds: next,
          anchorClipId: s.anchorClipId !== null && drop.has(s.anchorClipId) ? null : s.anchorClipId,
        }
      }),

    clearSelection: () =>
      set({ selectedClipIds: new Set(), anchorClipId: null }),

    setActiveTrack: (trackId) =>
      set({ activeTrackId: trackId }),
  }),
)
