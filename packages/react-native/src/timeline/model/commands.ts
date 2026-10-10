import type { PlaybackActions, SelectionActions, TimelineEngine } from '@elah/core'
import { playbackStore, selectionStore } from '@elah/core/engine'

/**
 * What a finished gesture asks the editor to do. Reducers return these; they
 * never call the engine themselves. `applyEngineCommand` is the ONLY place in
 * this package that mutates the engine or a store, which is how the
 * "one mutation funnel" invariant is kept auditable: grep for `engine.` and
 * you find one file.
 *
 * Project edits (`moveClip`, `trimClip`, `removeClip`) go through the engine's
 * validated, undoable methods, exactly as the DOM timeline's gestures do. They
 * deliberately do NOT use `engine.previewClip`: a live preview that overlaps a
 * neighbour throws inside the engine's `updateClip` visitor, whereas
 * `moveClip` / `trimClip` reject the overlap silently after
 * `resolveOverlapEdgeSnap` has already settled the clip into a gap. Visual
 * feedback during the gesture is the component's job (a transform on the
 * block), not the project's.
 */
export type EngineCommand =
  | { type: 'moveClip'; clipId: string; fromTrackId: string; toTrackId: string; startFrame: number }
  | { type: 'trimClip'; clipId: string; trackId: string; startFrame: number; durationFrames: number }
  | { type: 'removeClip'; clipId: string; trackId: string }
  | { type: 'seek'; frame: number }
  | { type: 'selectClip'; clipId: string }
  | { type: 'clearSelection' }
  | { type: 'setZoom'; zoom: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'play' }
  | { type: 'pause' }

/**
 * The narrow surface a command may touch. Structural so tests can pass fakes
 * and so the package does not import zustand's types for a `getState`.
 */
export interface CommandTargets {
  engine: Pick<TimelineEngine, 'moveClip' | 'trimClip' | 'removeClip' | 'undo' | 'redo'>
  playback: { getState(): Pick<PlaybackActions, 'setCurrentFrame' | 'setZoom' | 'play' | 'pause'> }
  selection: { getState(): Pick<SelectionActions, 'selectClip' | 'clearSelection'> }
}

/** The real targets: the engine from context plus core's singleton stores. */
export function defaultCommandTargets(engine: TimelineEngine): CommandTargets {
  return { engine, playback: playbackStore, selection: selectionStore }
}

export function applyEngineCommand(targets: CommandTargets, command: EngineCommand): void {
  switch (command.type) {
    case 'moveClip':
      targets.engine.moveClip(
        command.clipId,
        command.fromTrackId,
        command.toTrackId,
        command.startFrame,
      )
      return
    case 'trimClip':
      targets.engine.trimClip(
        command.clipId,
        command.trackId,
        command.startFrame,
        command.durationFrames,
      )
      return
    case 'removeClip':
      targets.engine.removeClip(command.clipId, command.trackId)
      return
    case 'seek':
      targets.playback.getState().setCurrentFrame(command.frame)
      return
    case 'selectClip':
      targets.selection.getState().selectClip(command.clipId)
      return
    case 'clearSelection':
      targets.selection.getState().clearSelection()
      return
    case 'setZoom':
      targets.playback.getState().setZoom(command.zoom)
      return
    case 'undo':
      targets.engine.undo()
      return
    case 'redo':
      targets.engine.redo()
      return
    case 'play':
      targets.playback.getState().play()
      return
    case 'pause':
      targets.playback.getState().pause()
      return
    default: {
      // Exhaustiveness: a new command variant fails to compile here until it is handled.
      const never: never = command
      throw new Error(`Unknown engine command: ${JSON.stringify(never)}`)
    }
  }
}
