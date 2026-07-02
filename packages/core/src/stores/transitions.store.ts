import { create } from 'zustand'
import type { Transition, Project } from '../types'

interface TransitionsState {
  transitions: Transition[]
}

interface TransitionsActions {
  sync: (project: Project) => void
}

/**
 * Mirrors project.transitions into React via the engine 'change' event.
 * Wire: EditorProvider listens to engine.on('change') and calls sync().
 *
 * Components look up transitions by trackId or clipId using selectors:
 *   const transition = useTransitionsStore(s =>
 *     s.transitions.find(t => t.fromClipId === clipId || t.toClipId === clipId)
 *   )
 */
export const useTransitionsStore = create<TransitionsState & TransitionsActions>()((set) => ({
  transitions: [],

  sync: (project) => {
    set({ transitions: project.transitions })
  },
}))
