import { createStore } from 'zustand/vanilla'
import { toFrame } from '../utils/frames'
import { clampZoom } from '../utils/timelineMath'

export interface PlaybackState {
  /** Current playhead position in frames */
  currentFrame: number
  /**
   * Monotonically increasing counter incremented on every frame update.
   * Lets subscribers detect scrub events even when currentFrame didn't change
   * (e.g. scrubbing to the same frame during playback).
   * Pattern borrowed from Freecut's playback store (MIT).
   */
  currentFrameEpoch: number
  isPlaying: boolean
  playbackRate: number
  loop: boolean
  volume: number
  muted: boolean
  /** Pixels per frame — controls timeline zoom level */
  zoom: number
  /** Snap-to-grid enabled */
  snapEnabled: boolean
}

export interface PlaybackActions {
  setCurrentFrame: (frame: number) => void
  play: () => void
  pause: () => void
  togglePlayPause: () => void
  setPlaybackRate: (rate: number) => void
  toggleLoop: () => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  setZoom: (zoom: number) => void
  toggleSnap: () => void
}

const STORAGE_KEY = 'myeditor-playback'

/**
 * The fields worth remembering between sessions: the user's transport
 * preferences. `currentFrame` and `isPlaying` are deliberately absent — where
 * the playhead was is a property of the composition being open, not of the
 * person.
 */
const PERSISTED_KEYS = [
  'zoom',
  'volume',
  'muted',
  'playbackRate',
  'loop',
  'snapEnabled',
] as const satisfies readonly (keyof PlaybackState)[]

type PersistedPrefs = Pick<PlaybackState, (typeof PERSISTED_KEYS)[number]>

function pickPrefs(state: PlaybackState): PersistedPrefs {
  return {
    zoom: state.zoom,
    volume: state.volume,
    muted: state.muted,
    playbackRate: state.playbackRate,
    loop: state.loop,
    snapEnabled: state.snapEnabled,
  }
}

/**
 * Read the preferences zustand's `persist` middleware used to write.
 *
 * Same key, same `{ state, version }` envelope, so replacing the middleware
 * costs nobody their zoom level or their mute.
 */
function readPersistedPrefs(): Partial<PersistedPrefs> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { state?: Partial<PersistedPrefs> }
    const stored = parsed?.state
    if (!stored || typeof stored !== 'object') return {}
    const prefs: Partial<PersistedPrefs> = {}
    for (const key of PERSISTED_KEYS) {
      const value = stored[key]
      if (typeof value === (key === 'muted' || key === 'loop' || key === 'snapEnabled' ? 'boolean' : 'number')) {
        // Narrowed by the runtime check above; the union makes TS unable to see it.
        ;(prefs as Record<string, unknown>)[key] = value
      }
    }
    return prefs
  } catch {
    // Private mode, blocked storage, or a document written by a future build.
    return {}
  }
}

/**
 * Transport mirror (Ring 1). Vanilla so core stays React-free;
 * the React binding binds it into the `usePlaybackStore` hook.
 *
 * Persistence is hand-rolled rather than zustand's `persist` middleware, and
 * that is a performance fix, not a style preference. The middleware wraps
 * `setState` so that *every* mutation serialises the partialized state and
 * writes it to `localStorage` — there is no check for whether a persisted field
 * actually changed. `setCurrentFrame` runs on every integer frame of playback
 * (~30/second) and on every pointermove of a scrub, so the editor was doing a
 * synchronous JSON stringify and a cross-process storage write dozens of times
 * a second to re-save six values that had not moved. Subscribing and comparing
 * instead means the write happens when a preference changes, and never during
 * playback.
 */
export const playbackStore = createStore<PlaybackState & PlaybackActions>()((set) => ({
  currentFrame: 0,
  currentFrameEpoch: 0,
  isPlaying: false,
  playbackRate: 1,
  loop: false,
  volume: 1,
  muted: false,
  zoom: 4,
  snapEnabled: true,
  ...readPersistedPrefs(),

  setCurrentFrame: (frame) =>
    set((s) => {
      const next = toFrame(frame)
      // Always bump the epoch — that's the point of the field: subscribers
      // need to detect repeat seeks to the same frame (e.g. scrub).
      return s.currentFrame === next
        ? { currentFrameEpoch: s.currentFrameEpoch + 1 }
        : {
            currentFrame: next,
            currentFrameEpoch: s.currentFrameEpoch + 1,
          }
    }),

  play: () => set((s) => (s.isPlaying ? s : { isPlaying: true })),
  pause: () => set((s) => (s.isPlaying ? { isPlaying: false } : s)),
  togglePlayPause: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setPlaybackRate: (rate) => set({ playbackRate: rate }),
  toggleLoop: () => set((s) => ({ loop: !s.loop })),
  setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  // Lower bound is deliberately tiny so long timelines (10+ min) can be
  // zoomed out far enough to fit on screen (e.g. 30min@30fps ≈ 54k frames).
  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
}))

// The write half. Compares the six persisted fields and does nothing for the
// frame/epoch churn that dominates this store's traffic.
playbackStore.subscribe((state, prev) => {
  if (typeof localStorage === 'undefined') return
  if (PERSISTED_KEYS.every((key) => state[key] === prev[key])) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: pickPrefs(state), version: 0 }))
  } catch {
    // Quota or private mode. Losing a remembered zoom level is not worth
    // failing a transport action over.
  }
})
