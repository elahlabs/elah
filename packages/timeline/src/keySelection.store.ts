import { create } from 'zustand'
import { useSelectionStore } from '@elah/react'

/**
 * Which keyframes are selected (PV-T7-3).
 *
 * A separate store from the clip selection, because "this clip is selected" and
 * "these three of its keys are selected" are different facts with different
 * lifetimes: the clip selection is set by clicking the clip, the key selection by
 * clicking a diamond, and Delete means two entirely different things depending
 * on whether the second one is empty.
 *
 * It is scoped to one clip. Selecting a key in another clip replaces the
 * selection rather than adding to it, so a drag can never try to move keys
 * belonging to two clips at once.
 */
export interface KeySelectionState {
  clipId: string | null
  frames: ReadonlySet<number>
  select: (clipId: string, frames: ReadonlyArray<number>) => void
  toggle: (clipId: string, frame: number) => void
  /** Move the selection by `delta`, for the frame a drag committed. */
  shift: (delta: number) => void
  clear: () => void
}

export const useKeySelectionStore = create<KeySelectionState>()((set, get) => ({
  clipId: null,
  frames: new Set<number>(),

  select: (clipId, frames) => set({ clipId, frames: new Set(frames) }),

  toggle: (clipId, frame) => {
    const { clipId: current, frames } = get()
    // A different clip is a different selection, never an addition.
    if (current !== clipId) {
      set({ clipId, frames: new Set([frame]) })
      return
    }
    const next = new Set(frames)
    if (next.has(frame)) next.delete(frame)
    else next.add(frame)
    set({ frames: next })
  },

  shift: (delta) => {
    const { clipId, frames } = get()
    if (!clipId || frames.size === 0) return
    set({ frames: new Set([...frames].map((f) => f + delta)) })
  },

  clear: () => set({ clipId: null, frames: new Set<number>() }),
}))

// A key selection only makes sense while its clip is still selected, so losing
// the clip drops the keys. This lives at module scope because it is a
// subscription, not a hook: a component that mounts later must not have to
// remember to make it.
useSelectionStore.subscribe((state, prev) => {
  if (state.selectedClipIds === prev.selectedClipIds) return
  const { clipId, frames, clear } = useKeySelectionStore.getState()
  if (!clipId || frames.size === 0) return
  if (!state.selectedClipIds.has(clipId)) clear()
})

/** The key selection, or an empty one for any other clip. */
export function keysOf(clipId: string): ReadonlySet<number> {
  const { clipId: current, frames } = useKeySelectionStore.getState()
  return current === clipId ? frames : new Set<number>()
}
