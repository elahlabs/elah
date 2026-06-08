import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toFrame } from '../utils/frames'

interface PlaybackState {
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

interface PlaybackActions {
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

export const usePlaybackStore = create<PlaybackState & PlaybackActions>()(
  persist(
    (set) => ({
      currentFrame: 0,
      currentFrameEpoch: 0,
      isPlaying: false,
      playbackRate: 1,
      loop: false,
      volume: 1,
      muted: false,
      zoom: 4,
      snapEnabled: true,

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
      setZoom: (zoom) => set({ zoom: Math.max(0.02, Math.min(50, zoom)) }),
      toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
    }),
    {
      name: 'myeditor-playback',
      partialize: (s) => ({
        zoom: s.zoom,
        volume: s.volume,
        muted: s.muted,
        playbackRate: s.playbackRate,
        loop: s.loop,
        snapEnabled: s.snapEnabled,
      }),
    },
  ),
)
