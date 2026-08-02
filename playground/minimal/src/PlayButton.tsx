import { usePlaybackStore, useTracksStore, framesToTimecode } from '@elah/editor'

/**
 * A custom control. This ~20-line component is the pattern every piece of
 * bespoke UI you build on Elah follows:
 *
 *   1. READ state with a NARROW selector — `s => s.isPlaying`, never `s => s`.
 *      A selector returning the whole store re-renders on every frame during
 *      playback (30-60x/sec). This is the #1 performance mistake.
 *
 *   2. WRITE through an action. Playback transport lives on the playback store
 *      (`togglePlayPause`, `setCurrentFrame`, `setZoom`, …). Anything that
 *      changes the *project* — clips, tracks, transforms — goes through the
 *      engine instead: `const engine = useTimelineEngine()`, then
 *      `engine.addClip(...)`, `engine.updateClip(...)`, `engine.undo()`.
 *
 * Never mutate store state directly. The stores are read-only mirrors of engine
 * state; writing to them desyncs the UI from the project and breaks undo.
 */
export default function PlayButton() {
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const totalFrames = useTracksStore((s) => s.totalFrames)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px' }}>
      <button type="button" onClick={togglePlayPause}>
        {isPlaying ? 'Pause' : 'Play'}
      </button>

      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
        {framesToTimecode(currentFrame, 30)} / {framesToTimecode(Math.max(totalFrames, 1), 30)}
      </span>
    </div>
  )
}
