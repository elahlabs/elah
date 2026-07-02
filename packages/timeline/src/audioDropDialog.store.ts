import { create } from 'zustand'

/** What to place when a video with audio is dropped onto the timeline. */
export type AudioDropChoice = 'both' | 'video-only' | 'audio-only'

interface AudioDropDialogState {
  open: boolean
  /** Asset name shown in the dialog body. */
  assetName: string
  /** Resolver for the in-flight `request()` promise; null when closed. */
  resolve: ((choice: AudioDropChoice | null) => void) | null
}

interface AudioDropDialogActions {
  /**
   * Open the dialog and await the user's choice. Resolves to the chosen
   * placement, or `null` if a new request supersedes this one before it closes.
   */
  request: (assetName: string) => Promise<AudioDropChoice | null>
  /** Resolve the in-flight request with a choice and close the dialog. */
  respond: (choice: AudioDropChoice) => void
}

/**
 * Bridges the imperative drop handler (`useTimelineDrop`) and the declarative
 * modal (`AudioDropDialog`). The handler awaits `request()`; the modal calls
 * `respond()` on a button click.
 */
export const useAudioDropDialogStore = create<AudioDropDialogState & AudioDropDialogActions>(
  (set, get) => ({
    open: false,
    assetName: '',
    resolve: null,

    request: (assetName) => {
      // A pending request is abandoned (resolved null) if a new drop arrives.
      get().resolve?.(null)
      return new Promise<AudioDropChoice | null>((resolve) => {
        set({ open: true, assetName, resolve })
      })
    },

    respond: (choice) => {
      get().resolve?.(choice)
      set({ open: false, assetName: '', resolve: null })
    },
  }),
)
