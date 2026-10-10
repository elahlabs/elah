import { afterEach, describe, expect, it, vi } from 'vitest'
import { playbackStore, selectionStore } from '@elah/core'
import { buildFixture } from './__fixtures__/project'
import { applyEngineCommand, defaultCommandTargets, type CommandTargets } from './commands'
import { beginMove, endMove, updateMove } from './moveGesture'
import { beginTrim, endTrim, updateTrim } from './trimGesture'

/**
 * The reducers are proven against the REAL TimelineEngine here: a gesture's
 * command, applied, leaves the project exactly where the preview said it
 * would, and one undo reverts the whole gesture. This is the "parity by
 * construction" claim of the React Native binding: the same engine the web
 * timeline drives, driven by the same numbers.
 */

afterEach(() => {
  playbackStore.setState({ currentFrame: 0, zoom: 4 })
  selectionStore.getState().clearSelection()
})

describe('move through the engine', () => {
  it('commits one undoable move for a drag along the lane', () => {
    const f = buildFixture()
    const targets = defaultCommandTargets(f.engine)
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    const preview = updateMove(session, { translationX: 40 })
    const command = endMove(session, preview, f.snapshot())!

    applyEngineCommand(targets, command)
    expect(f.clip(f.a.id).startFrame).toBe(preview.startFrame)
    expect(f.clip(f.a.id).startFrame).toBe(40)

    expect(f.engine.undo()).toBe(true)
    expect(f.clip(f.a.id).startFrame).toBe(30)
    expect(f.engine.redo()).toBe(true)
    expect(f.clip(f.a.id).startFrame).toBe(40)
  })

  it('moves a clip onto another lane', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    const preview = updateMove(session, { translationX: 0, pointerY: 90 })
    applyEngineCommand(defaultCommandTargets(f.engine), endMove(session, preview, f.snapshot())!)

    expect(f.engine.findClip(f.a.id)?.trackId).toBe(f.v2.id)
    expect(f.engine.getClipsOnTrack(f.v1.id).map((c) => c.name)).toEqual(['B'])
  })

  it('lands in the gap the settle rule picked, so the engine never rejects the drop', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    const preview = updateMove(session, { translationX: 70 * 4 }) // A would overlap B
    const command = endMove(session, preview, f.snapshot())!
    expect(command.type === 'moveClip' && command.startFrame).toBe(180)

    applyEngineCommand(defaultCommandTargets(f.engine), command)
    expect(f.clip(f.a.id).startFrame).toBe(180)
    expect(f.engine.getClipsOnTrack(f.v1.id).map((c) => c.name)).toEqual(['B', 'A'])
  })

  it('is refused by the engine when the target lane is locked at commit time', () => {
    const f = buildFixture()
    const session = beginMove(f.a.id, f.snapshot(4, false))!
    const preview = updateMove(session, { translationX: 0, pointerY: 90 })
    const command = endMove(session, preview, f.snapshot())!
    // The lane locks between the snapshot and the release (another user action).
    f.engine.updateTrack(f.v2.id, { locked: true })
    applyEngineCommand(defaultCommandTargets(f.engine), command)
    expect(f.engine.findClip(f.a.id)?.trackId).toBe(f.v1.id)
  })

  it('produces the same project the DOM timeline would (same engine call, same numbers)', () => {
    const viaGesture = buildFixture()
    const session = beginMove(viaGesture.a.id, viaGesture.snapshot(4, false))!
    const preview = updateMove(session, { translationX: 35 * 4 }) // settles behind B at 60
    applyEngineCommand(
      defaultCommandTargets(viaGesture.engine),
      endMove(session, preview, viaGesture.snapshot())!,
    )

    const viaWeb = buildFixture()
    // What ClipBlock.handleBodyPointerDown's finish() calls after resolveOverlapEdgeSnap.
    viaWeb.engine.moveClip(viaWeb.a.id, viaWeb.v1.id, viaWeb.v1.id, 60)

    const shape = (clips: { name: string; startFrame: number; durationFrames: number }[]) =>
      clips.map((c) => [c.name, c.startFrame, c.durationFrames])
    expect(shape(viaGesture.engine.getClipsOnTrack(viaGesture.v1.id))).toEqual(
      shape(viaWeb.engine.getClipsOnTrack(viaWeb.v1.id)),
    )
  })
})

describe('trim through the engine', () => {
  it('commits exactly what the preview showed, including the source window shift', () => {
    const f = buildFixture()
    const session = beginTrim(f.a.id, 'left', f.snapshot(4))!
    const preview = updateTrim(session, -40)
    applyEngineCommand(defaultCommandTargets(f.engine), endTrim(session, preview)!)

    const live = f.clip(f.a.id)
    expect(live.startFrame).toBe(preview.startFrame)
    expect(live.durationFrames).toBe(preview.durationFrames)
    expect(live.sourceStartFrame).toBe(10) // 20 - 10 frames extended to the left

    f.engine.undo()
    expect(f.clip(f.a.id)).toMatchObject({ startFrame: 30, durationFrames: 60, sourceStartFrame: 20 })
  })

  it('previews the source left bound honestly: the commit does not move the end', () => {
    const f = buildFixture()
    const session = beginTrim(f.a.id, 'left', f.snapshot(4))!
    const preview = updateTrim(session, -400) // asks for far more than the source has
    expect(preview).toEqual({ startFrame: 10, durationFrames: 80 })
    applyEngineCommand(defaultCommandTargets(f.engine), endTrim(session, preview)!)

    const live = f.clip(f.a.id)
    expect(live.startFrame + live.durationFrames).toBe(90) // end anchored
    expect(live).toMatchObject({ startFrame: 10, durationFrames: 80, sourceStartFrame: 0 })
  })

  it('right-trims up to the next clip, and the engine accepts exactly that', () => {
    const f = buildFixture()
    const session = beginTrim(f.a.id, 'right', f.snapshot(4))!
    const preview = updateTrim(session, 10000)
    expect(preview.durationFrames).toBe(90) // not 120: B starts at 120
    applyEngineCommand(defaultCommandTargets(f.engine), endTrim(session, preview)!)
    expect(f.clip(f.a.id)).toMatchObject({ startFrame: 30, durationFrames: 90 })
  })

  it('would be rejected by the engine without the neighbour bound (the web snap-back case)', () => {
    const f = buildFixture()
    // Bypass the reducer and ask for what the source allows but the lane does not.
    f.engine.trimClip(f.a.id, f.v1.id, 30, 120)
    expect(f.clip(f.a.id).durationFrames).toBe(60) // untouched: silent rejection
  })
})

describe('transport, selection and zoom commands', () => {
  it('seeks through the playback store', () => {
    const f = buildFixture()
    applyEngineCommand(defaultCommandTargets(f.engine), { type: 'seek', frame: 42 })
    expect(playbackStore.getState().currentFrame).toBe(42)
  })

  it('selects and clears through the selection store', () => {
    const f = buildFixture()
    const targets = defaultCommandTargets(f.engine)
    applyEngineCommand(targets, { type: 'selectClip', clipId: f.a.id })
    expect([...selectionStore.getState().selectedClipIds]).toEqual([f.a.id])
    applyEngineCommand(targets, { type: 'clearSelection' })
    expect(selectionStore.getState().selectedClipIds.size).toBe(0)
  })

  it('sets zoom through the store, which clamps it', () => {
    const f = buildFixture()
    applyEngineCommand(defaultCommandTargets(f.engine), { type: 'setZoom', zoom: 1e9 })
    expect(playbackStore.getState().zoom).toBe(50)
  })

  it('plays and pauses through the playback store', () => {
    const f = buildFixture()
    const targets = defaultCommandTargets(f.engine)
    applyEngineCommand(targets, { type: 'play' })
    expect(playbackStore.getState().isPlaying).toBe(true)
    applyEngineCommand(targets, { type: 'pause' })
    expect(playbackStore.getState().isPlaying).toBe(false)
  })

  it('removes a clip, and undo / redo go through the engine', () => {
    const f = buildFixture()
    const targets = defaultCommandTargets(f.engine)
    applyEngineCommand(targets, { type: 'removeClip', clipId: f.b.id, trackId: f.v1.id })
    expect(f.engine.findClip(f.b.id)).toBeNull()
    applyEngineCommand(targets, { type: 'undo' })
    expect(f.engine.findClip(f.b.id)).not.toBeNull()
    applyEngineCommand(targets, { type: 'redo' })
    expect(f.engine.findClip(f.b.id)).toBeNull()
  })

  it('touches nothing but the named target for each command', () => {
    const engine = {
      moveClip: vi.fn(),
      trimClip: vi.fn(),
      removeClip: vi.fn(),
      undo: vi.fn(() => true),
      redo: vi.fn(() => true),
    }
    const playback = { setCurrentFrame: vi.fn(), setZoom: vi.fn(), play: vi.fn(), pause: vi.fn() }
    const selection = { selectClip: vi.fn(), clearSelection: vi.fn() }
    const targets: CommandTargets = {
      engine,
      playback: { getState: () => playback },
      selection: { getState: () => selection },
    }

    applyEngineCommand(targets, { type: 'moveClip', clipId: 'c', fromTrackId: 't1', toTrackId: 't2', startFrame: 7 })
    expect(engine.moveClip).toHaveBeenCalledWith('c', 't1', 't2', 7)
    applyEngineCommand(targets, { type: 'trimClip', clipId: 'c', trackId: 't1', startFrame: 3, durationFrames: 9 })
    expect(engine.trimClip).toHaveBeenCalledWith('c', 't1', 3, 9)
    applyEngineCommand(targets, { type: 'seek', frame: 5 })
    expect(playback.setCurrentFrame).toHaveBeenCalledWith(5)
    applyEngineCommand(targets, { type: 'play' })
    expect(playback.play).toHaveBeenCalledOnce()
    expect(playback.pause).not.toHaveBeenCalled()
    applyEngineCommand(targets, { type: 'pause' })
    expect(playback.pause).toHaveBeenCalledOnce()
    expect(selection.selectClip).not.toHaveBeenCalled()
    expect(engine.removeClip).not.toHaveBeenCalled()
  })
})
