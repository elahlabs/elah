import { useEffect, useMemo, type ReactNode } from 'react'
import type { InitialTrackConfig, ProjectLoadedEvent } from '@elah/core'
import {
  TimelineEngine,
  PlaybackEngine,
  installTraceGlobal,
  trace,
} from '@elah/core/engine'
import { useTracksStore, usePlaybackStore, useTransitionsStore } from './stores'
import { EditorContext } from './editor-context'

/**
 * Builds the engine pair and wires it to the read-only stores: engine changes
 * -> tracksStore / transitionsStore, PlaybackEngine <-> playbackStore (with the
 * echo-seek guard), and the project:loaded rewind. DOM-free, so the web editor
 * and @elah/react-native share it. Moved here from @elah/editor (RN-T2);
 * @elah/editor still re-exports it.
 */
export interface EditorProviderProps {
  fps: number
  stage?: { width: number; height: number }
  defaultTrackHeight?: number
  maxHistorySize?: number
  /**
   * Tracks created in the empty project before any user edits. Omit for the
   * default lanes; pass a fixed list (e.g. video / audio / text)
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
  // Both engines are built together, and the restore→transport wire is attached
  // here rather than in an effect below. That is not tidiness — it is the only
  // place it works.
  //
  // The component that restores a stored document is a *descendant* of this
  // provider (it needs the engine from this context), and React runs passive
  // effects child-before-parent. An `engine.on('project:loaded', …)` in an
  // effect here would therefore subscribe *after* the open's `loadProject` had
  // already fired — so the one load the rewind was written for is the one it
  // would miss, leaving the new project sharing the last one's playhead and, if
  // that one was playing, starting itself.
  const { engine, playback } = useMemo(
    () => {
      const engine = new TimelineEngine({
        fps,
        stage,
        defaultTrackHeight,
        maxHistorySize,
        initialTracks,
      })

      const playback = new PlaybackEngine({
        fps,
        getTotalFrames: () => useTracksStore.getState().totalFrames,
      })

      // Restore → transport.
      //
      // `engine.loadProject()` replaces the whole composition, which leaves the
      // playhead pointing into a timeline that no longer exists — mid-play, over
      // a different project. `TimelineEngine` has no reference to
      // `PlaybackEngine` on purpose (it is Node-safe and RAF-free), so the two
      // are joined here, where every other engine↔playback wire already lives.
      //
      // Both objects are moved, not just the engine: the store is the
      // transport's source of truth for the rest of the app, is module-scoped
      // (so it still holds the *previous* project's frame after a client-side
      // navigation), and `PlaybackEngine.notify()` only pushes `currentFrame`
      // into it when the value actually changed.
      engine.on('project:loaded', ({ transport }: ProjectLoadedEvent) => {
        if (transport !== 'rewind') return
        playback.pause()
        playback.seek(0)
        const pb = usePlaybackStore.getState()
        if (pb.isPlaying) pb.pause()
        if (pb.currentFrame !== 0) pb.setCurrentFrame(0)
      })

      return { engine, playback }
    },
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


