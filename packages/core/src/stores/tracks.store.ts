import { createStore } from 'zustand/vanilla'
import type { Clip, Project, Track } from '../types'

export interface TracksState {
  tracks: Track[]
  clips: Record<string, Clip[]>
  /** Output canvas dimensions; mirrored so React re-renders on aspect changes. */
  stage: { width: number; height: number }
  totalFrames: number
  canUndo: boolean
  canRedo: boolean
}

export interface TracksActions {
  /** Called by Timeline component when the engine emits 'change' */
  sync: (project: Project, meta: { canUndo: boolean; canRedo: boolean }) => void
}

/**
 * Vanilla Zustand store that mirrors engine project state for UI consumers.
 *
 * React components subscribe via `useTracksStore` from @elah/react with
 * granular selectors — only the slice they need. A trim on track 3 never
 * re-renders a component subscribed to track 7.
 *
 * @example
 * ```ts
 * const tracks = useTracksStore(s => s.tracks)          // React (@elah/react)
 * const clips  = tracksStore.getState().clips[trackId]  // imperative
 * ```
 */
export const tracksStore = createStore<TracksState & TracksActions>()((set) => ({
  tracks: [],
  clips: {},
  stage: { width: 1080, height: 1920 },
  totalFrames: 0,
  canUndo: false,
  canRedo: false,

  sync: (project, meta) => {
    let max = 0
    for (const trackClips of Object.values(project.clips)) {
      for (const c of trackClips) {
        const end = c.startFrame + c.durationFrames
        if (end > max) max = end
      }
    }

    set({
      tracks: project.tracks,
      clips: project.clips,
      stage: project.stage,
      totalFrames: max,
      canUndo: meta.canUndo,
      canRedo: meta.canRedo,
    })
  },
}))
