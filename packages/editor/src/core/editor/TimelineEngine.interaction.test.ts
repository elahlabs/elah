import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TimelineEngine } from './TimelineEngine'

/**
 * Covers previewClip() / commitInteraction() — the live-gesture path used by the
 * preview text overlay for drag/resize/inline-edit. The contract: intermediate
 * frames apply + emit 'change' but record NO history; commitInteraction folds the
 * whole gesture into exactly one undo entry.
 */
describe('TimelineEngine — interactive gestures', () => {
  let engine: TimelineEngine
  let trackId: string
  let clipId: string

  beforeEach(() => {
    engine = new TimelineEngine({ fps: 30 })
    const track = engine.addTrack('text')
    trackId = track.id
    clipId = engine.addClip({
      trackId,
      type: 'text',
      name: 'Text 1',
      text: { content: 'Hello' },
      startFrame: 0,
      durationFrames: 60,
    }).id
  })

  it('previewClip applies live but records no history entry', () => {
    const before = engine.canUndo()
    const change = vi.fn()
    engine.on('change', change)

    engine.previewClip(clipId, trackId, { fontSize: 80 })

    expect(engine.findClip(clipId)?.clip.fontSize).toBe(80)
    expect(change).toHaveBeenCalledTimes(1)
    // No new undo entry yet — the gesture is still open.
    expect(engine.canUndo()).toBe(before)
  })

  it('commitInteraction folds many previews into one undo entry', () => {
    const undoDepthBefore = countUndo(engine)

    engine.previewClip(clipId, trackId, { fontSize: 60 })
    engine.previewClip(clipId, trackId, { fontSize: 70 })
    engine.previewClip(clipId, trackId, { fontSize: 90 })
    engine.commitInteraction('Resize text')

    expect(countUndo(engine)).toBe(undoDepthBefore + 1)

    // One undo reverts the entire gesture back to the pre-gesture value.
    engine.undo()
    expect(engine.findClip(clipId)?.clip.fontSize).toBeUndefined()
  })

  it('commitInteraction is a no-op when nothing was previewed', () => {
    const undoDepthBefore = countUndo(engine)
    engine.commitInteraction()
    expect(countUndo(engine)).toBe(undoDepthBefore)
  })

  it('cancelInteraction restores the pre-gesture snapshot with no history (cancel path)', () => {
    const undoDepthBefore = countUndo(engine)

    engine.previewClip(clipId, trackId, { content: 'World' })
    engine.previewClip(clipId, trackId, { content: 'Worldd' })
    expect(engine.findClip(clipId)?.clip.content).toBe('Worldd')

    engine.cancelInteraction()

    expect(countUndo(engine)).toBe(undoDepthBefore)
    expect(engine.findClip(clipId)?.clip.content).toBe('Hello')
  })

  it('redo re-applies a committed gesture', () => {
    engine.previewClip(clipId, trackId, { fontSize: 120 })
    engine.commitInteraction('Resize text')

    engine.undo()
    expect(engine.findClip(clipId)?.clip.fontSize).toBeUndefined()

    engine.redo()
    expect(engine.findClip(clipId)?.clip.fontSize).toBe(120)
  })
})

/** Count undo steps by draining then can't-introspect — use canUndo + a probe. */
function countUndo(engine: TimelineEngine): number {
  // The engine exposes only canUndo(); reconstruct depth by undoing to the floor
  // then redoing back, counting steps. Safe because tests own the engine.
  let depth = 0
  while (engine.undo()) depth++
  for (let i = 0; i < depth; i++) engine.redo()
  return depth
}
