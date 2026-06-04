import { create } from 'zustand'
import type { Clip, Project, Track } from '../types'

interface TracksState {
  tracks: Track[]
  clips: Record<string, Clip[]>
  /** Output canvas dimensions; mirrored so React re-renders on aspect changes. */
  stage: { width: number; height: number }
  totalFrames: number
  canUndo: boolean
  canRedo: boolean
}

interface TracksActions {
  /** Called by Timeline component when the engine emits 'change' */
  sync: (project: Project, meta: { canUndo: boolean; canRedo: boolean }) => void
}

/**
 * Zustand store that mirrors engine project state into React.
 *
 * Components subscribe with granular selectors — only the slice they need.
 * A trim on track 3 never re-renders a component subscribed to track 7.
 *
 * @example
 * ```ts
 * const tracks = useTracksStore(s => s.tracks)
 * const clips  = useTracksStore(s => s.clips[trackId] ?? [])
 * ```
 */
export const useTracksStore = create<TracksState & TracksActions>()((set) => ({
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
