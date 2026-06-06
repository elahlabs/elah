import { useEffect, useMemo, type ReactNode } from 'react'
import type { InitialTrackConfig } from '../core/types'
import { TimelineEngine } from '../core/editor/TimelineEngine'
import { PlaybackEngine } from '../core/playback/PlaybackEngine'
import { useTracksStore } from '../core/stores/tracks.store'
import { useTransitionsStore } from '../core/stores/transitions.store'
import { usePlaybackStore } from '../core/stores/playback.store'
import { EditorContext } from '../core/editor-context'
import { installTraceGlobal, trace } from '../core/debug/trace'

export interface EditorProviderProps {
  fps: number
  stage?: { width: number; height: number }
  defaultTrackHeight?: number
  maxHistorySize?: number
  /**
   * Tracks created in the empty project before any user edits. Omit for the
   * default single video track; pass a fixed list (e.g. video / audio / text)
   * for a fixed-lane editor.
   */
  initialTracks?: InitialTrackConfig[]
  children: ReactNode
}

export function EditorProvider({
  fps,
  stage,
  defaultTrackHeight,
  maxHistorySize,
  initialTracks,
  children,
}: EditorProviderProps) {
  const engine = useMemo(
    () =>
      new TimelineEngine({
        fps,
        stage,
        defaultTrackHeight,
        maxHistorySize,
        initialTracks,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const playback = useMemo(
    () =>
      new PlaybackEngine({
        fps,
        getTotalFrames: () => useTracksStore.getState().totalFrames,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Wire engine events → Zustand stores
  useEffect(() => {
    const syncAll = () => {
      const project = engine.getProject()
      useTracksStore.getState().sync(project, {
        canUndo: engine.canUndo(),
        canRedo: engine.canRedo(),
      })
      useTransitionsStore.getState().sync(project)
    }

    engine.on('change', syncAll)
    engine.on('history:change', syncAll)

    // Sync initial state
    syncAll()

    return () => {
      engine.off('change', syncAll)
      engine.off('history:change', syncAll)
    }
  }, [engine])

  // PlaybackEngine → Zustand store.
  // Guard: only call setCurrentFrame when the value actually changed so we don't
  // fire a Zustand epoch bump (and re-notify every subscriber) on every RAF tick.
  useEffect(() => {
    return playback.subscribe((snapshot) => {
      const pb = usePlaybackStore.getState()
      if (snapshot.currentFrame !== pb.currentFrame) {
        pb.setCurrentFrame(snapshot.currentFrame)
      }
      if (snapshot.isPlaying && !pb.isPlaying) pb.play()
      else if (!snapshot.isPlaying && pb.isPlaying) pb.pause()
    })
  }, [playback])

  // Zustand store → PlaybackEngine.
  // Propagates external play/pause/seek/rate changes back into the engine without
  // creating a feedback loop.
  //
  // Persisted-state init: push localStorage-restored values into the engine
  // before subscribing. Without this, a persisted loop=true or playbackRate=2
  // would be invisible to the engine until the user changed them again.
  useEffect(() => {
    installTraceGlobal()
    const s0 = usePlaybackStore.getState()
    playback.setPlaybackRate(s0.playbackRate)
    playback.setLoop(s0.loop)
    if (s0.isPlaying) playback.play()

    return usePlaybackStore.subscribe((state, prev) => {
      if (state.isPlaying !== prev.isPlaying) {
        if (state.isPlaying) playback.play()
        else playback.pause()
      }
      if (state.currentFrameEpoch !== prev.currentFrameEpoch) {
        const willSeek = state.currentFrame !== playback.currentFrame
        trace('SEEK_GATE', {
          storeFrame: state.currentFrame,
          engineFrame: playback.currentFrame,
          willSeek,
        })
        if (willSeek) playback.seek(state.currentFrame)
      }
      if (state.playbackRate !== prev.playbackRate) {
        playback.setPlaybackRate(state.playbackRate)
      }
      if (state.loop !== prev.loop) {
        playback.setLoop(state.loop)
      }
    })
  }, [playback])

  // Destroy PlaybackEngine on unmount
  useEffect(() => () => playback.destroy(), [playback])

  const value = useMemo(() => ({ engine, playback }), [engine, playback])

  return (
    <EditorContext.Provider value={value}>
      {children}
    </EditorContext.Provider>
  )
}
