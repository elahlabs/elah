import { createStore } from 'zustand/vanilla'
import type { Transition, Project } from '../types'

export interface TransitionsState {
  transitions: Transition[]
}

export interface TransitionsActions {
  sync: (project: Project) => void
}

/**
 * Mirrors project.transitions for UI consumers via the engine 'change' event.
 * Wire: EditorProvider listens to engine.on('change') and calls sync().
 *
 * React components look up transitions by trackId or clipId using selectors
 * (via `useTransitionsStore` from @elah/react):
 *   const transition = useTransitionsStore(s =>
 *     s.transitions.find(t => t.fromClipId === clipId || t.toClipId === clipId)
 *   )
 */
export const transitionsStore = createStore<TransitionsState & TransitionsActions>()(
  (set) => ({
    transitions: [],

    sync: (project) => {
      set({ transitions: project.transitions })
    },
  }),
)
