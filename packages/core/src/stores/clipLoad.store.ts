import { createStore } from 'zustand/vanilla'

/**
 * What a clip's media is doing, as far as the renderer can tell.
 *
 * `'loading'` means a provider exists and has not produced a drawable frame
 * yet — the clip is on the timeline but the preview has nothing to paint for
 * it. `'error'` means the container could not be opened at all. A clip that is
 * drawing normally has no entry.
 */
export type ClipLoadState = 'loading' | 'error'

export interface ClipLoadStoreState {
  byClipId: Record<string, ClipLoadState>
}

export interface ClipLoadStoreActions {
  /** Report a clip's state, or `null` to forget it. */
  set: (clipId: string, state: ClipLoadState | null) => void
  clear: () => void
}

/**
 * Which clips the preview cannot draw yet (Ring 1, vanilla so core stays
 * React-free; the React binding binds it as `useClipLoadStore`).
 *
 * Deliberately NOT part of the project document or the tracks mirror: this is
 * renderer state, not composition state, and it must never reach undo history
 * or an autosave. The renderer writes it at clip-boundary events only —
 * acquire, first successful upload, open failure, release — so subscribers see
 * a handful of notifications per clip and nothing at all per frame.
 *
 * Every write is compared first: a repeated `'loading'` report (acquire runs on
 * every tick a clip is in the scene) returns the same state object and notifies
 * nobody.
 */
export const clipLoadStore = createStore<ClipLoadStoreState & ClipLoadStoreActions>()(
  (set) => ({
    byClipId: {},

    set: (clipId, state) =>
      set((s) => {
        const current = s.byClipId[clipId]
        if (state === null) {
          if (current === undefined) return s
          const { [clipId]: _gone, ...rest } = s.byClipId
          return { byClipId: rest }
        }
        if (current === state) return s
        return { byClipId: { ...s.byClipId, [clipId]: state } }
      }),

    clear: () => set((s) => (Object.keys(s.byClipId).length === 0 ? s : { byClipId: {} })),
  }),
)
