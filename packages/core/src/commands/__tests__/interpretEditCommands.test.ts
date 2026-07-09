import { beforeEach, describe, expect, it } from 'vitest'
import { TimelineEngine } from '../../editor/TimelineEngine'
import { interpretEditCommands } from '../interpretEditCommands'
import type { EditCommand } from '../editCommand'

/**
 * Covers the AI-command interpreter: each command kind maps onto the engine
 * mutation funnel, the whole batch is one undo entry, and unapplicable commands
 * are reported (not thrown) without aborting siblings.
 *
 * Text clips are used throughout — they have no source-asset length cap, so
 * trim/split/cut behave predictably without wiring real media.
 */
describe('interpretEditCommands', () => {
  let engine: TimelineEngine
  let trackId: string
  let clipId: string

  beforeEach(() => {
    engine = new TimelineEngine({ fps: 30 })
    trackId = engine.addTrack('elements').id
    clipId = engine.addClip({
      trackId,
      type: 'text',
      name: 'Text 1',
      text: { content: 'Hello' },
      startFrame: 0,
      durationFrames: 120,
    }).id
  })

  it('split divides one clip into two', () => {
    const results = interpretEditCommands(engine, [
      { kind: 'split', clipId, trackId, atFrame: 60 },
    ])
    expect(results[0].ok).toBe(true)
    expect(engine.getClipsOnTrack(trackId)).toHaveLength(2)
  })

  it('rejects a split outside the clip bounds', () => {
    const results = interpretEditCommands(engine, [
      { kind: 'split', clipId, trackId, atFrame: 200 },
    ])
    expect(results[0]).toMatchObject({ ok: false, reason: 'split-outside-clip' })
    expect(engine.getClipsOnTrack(trackId)).toHaveLength(1)
  })

  it('delete removes the clip', () => {
    const results = interpretEditCommands(engine, [
      { kind: 'delete', clipId, trackId },
    ])
    expect(results[0].ok).toBe(true)
    expect(engine.findClip(clipId)).toBeNull()
  })

  it('trim shortens the clip', () => {
    interpretEditCommands(engine, [
      { kind: 'trim', clipId, trackId, startFrame: 0, durationFrames: 30 },
    ])
    expect(engine.findClip(clipId)?.clip.durationFrames).toBe(30)
  })

  it('move relocates the clip to a new start frame', () => {
    const other = engine.addTrack('elements').id
    const results = interpretEditCommands(engine, [
      { kind: 'move', clipId, fromTrackId: trackId, toTrackId: other, startFrame: 300 },
    ])
    expect(results[0].ok).toBe(true)
    const after = engine.findClip(clipId)
    expect(after?.trackId).toBe(other)
    expect(after?.clip.startFrame).toBe(300)
  })

  it('cutRange removes an interior range and leaves two clips', () => {
    // Clip spans [0,120). Remove [40,80) → keep [0,40) and [80,120).
    const results = interpretEditCommands(engine, [
      { kind: 'cutRange', clipId, trackId, fromFrame: 40, toFrame: 80 },
    ])
    expect(results[0].ok).toBe(true)
    const clips = [...engine.getClipsOnTrack(trackId)].sort((a, b) => a.startFrame - b.startFrame)
    expect(clips).toHaveLength(2)
    expect(clips[0]).toMatchObject({ startFrame: 0, durationFrames: 40 })
    expect(clips[1].startFrame).toBe(80)
    expect(clips[1].durationFrames).toBe(40)
  })

  it('cutRange from the clip start leaves a single trailing clip', () => {
    interpretEditCommands(engine, [
      { kind: 'cutRange', clipId, trackId, fromFrame: 0, toFrame: 50 },
    ])
    const clips = engine.getClipsOnTrack(trackId)
    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatchObject({ startFrame: 50, durationFrames: 70 })
  })

  it('cutRange to the clip end leaves a single leading clip', () => {
    interpretEditCommands(engine, [
      { kind: 'cutRange', clipId, trackId, fromFrame: 90, toFrame: 120 },
    ])
    const clips = engine.getClipsOnTrack(trackId)
    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatchObject({ startFrame: 0, durationFrames: 90 })
  })

  it('rejects a cutRange with from >= to', () => {
    const results = interpretEditCommands(engine, [
      { kind: 'cutRange', clipId, trackId, fromFrame: 80, toFrame: 40 },
    ])
    expect(results[0]).toMatchObject({ ok: false, reason: 'invalid-range' })
    expect(engine.getClipsOnTrack(trackId)).toHaveLength(1)
  })

  it('reports clip-not-found for an unknown clip', () => {
    const results = interpretEditCommands(engine, [
      { kind: 'delete', clipId: 'nope', trackId },
    ])
    expect(results[0]).toMatchObject({ ok: false, reason: 'clip-not-found' })
  })

  it('reports track-mismatch when the clip is on a different track', () => {
    const other = engine.addTrack('elements').id
    const results = interpretEditCommands(engine, [
      { kind: 'delete', clipId, trackId: other },
    ])
    expect(results[0]).toMatchObject({ ok: false, reason: 'track-mismatch' })
    expect(engine.findClip(clipId)?.clip).toBeDefined()
  })

  it('rejects delete on a locked track', () => {
    engine.updateTrack(trackId, { locked: true })
    const results = interpretEditCommands(engine, [
      { kind: 'delete', clipId, trackId },
    ])
    expect(results[0]).toMatchObject({ ok: false, reason: 'engine-rejected' })
    expect(engine.findClip(clipId)?.clip).toBeDefined()
  })

  it('rejects trim on a locked track instead of reporting false success', () => {
    engine.updateTrack(trackId, { locked: true })
    const results = interpretEditCommands(engine, [
      { kind: 'trim', clipId, trackId, startFrame: 0, durationFrames: 30 },
    ])
    expect(results[0]).toMatchObject({ ok: false, reason: 'engine-rejected' })
    // Clip must be untouched.
    expect(engine.findClip(clipId)?.clip.durationFrames).toBe(120)
  })

  it('collapses a multi-primitive edit into a single undo entry', () => {
    // cutRange expands to split + split + remove — three engine mutations.
    // If the batch collapsed correctly, exactly one undo reverts all three.
    const commands: EditCommand[] = [
      { kind: 'cutRange', clipId, trackId, fromFrame: 40, toFrame: 80 },
    ]
    interpretEditCommands(engine, commands)
    expect(engine.getClipsOnTrack(trackId)).toHaveLength(2)

    engine.undo()
    const clips = engine.getClipsOnTrack(trackId)
    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatchObject({ startFrame: 0, durationFrames: 120 })
  })

  it('applies siblings even when one command fails', () => {
    const results = interpretEditCommands(engine, [
      { kind: 'delete', clipId: 'ghost', trackId },
      { kind: 'trim', clipId, trackId, startFrame: 0, durationFrames: 20 },
    ])
    expect(results[0].ok).toBe(false)
    expect(results[1].ok).toBe(true)
    expect(engine.findClip(clipId)?.clip.durationFrames).toBe(20)
  })
})
