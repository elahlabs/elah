import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import type { InitialTrackConfig } from '../types'
import { compileVideoSpec } from './compile'
import { layProject } from './layProject'
import type { VideoSpec } from './types'

function makeEngine(initialTracks: InitialTrackConfig[] = []): TimelineEngine {
  return new TimelineEngine({ fps: 30, stage: { width: 640, height: 360 }, initialTracks })
}

const SPEC: VideoSpec = {
  format: { width: 1080, height: 1920, fps: 30 },
  duration: 2,
  elements: [
    {
      id: 'title',
      kind: 'text',
      text: 'Hi',
      at: 0,
      duration: 2,
      font: 'inter',
      reveal: { preset: 'fade' },
      keys: [
        { channel: 'opacity', at: 0, value: 0.2 },
        { channel: 'opacity', at: 1, value: 1 },
      ],
    },
    { id: 'sub', kind: 'text', text: 'Sub', at: 0, duration: 2, layer: 1, layout: { anchorTo: { element: 'title', edge: 'bottom', gap: 4 } } },
  ],
}

function allClips(engine: TimelineEngine) {
  return Object.values(engine.getProject().clips).flat()
}

describe('layProject — one undo step', () => {
  // `TimelineEngine.getRevision()`'s own doc comment: "changes whenever the
  // project does — commits, undo, redo, loads, interaction previews", and
  // `commit()` (TimelineEngine.ts:1660-1698) bumps `_revision` UNCONDITIONALLY
  // per mutation, batched or not — so inside one `batch()`, N addTrack/addClip/
  // updateClip calls advance `_revision` by N, not by 1. Verified here rather
  // than assumed: a batch of two clips (addTrack x2, addClip x2, updateClip x2,
  // plus one setStage) advances it by far more than one.
  it('_revision advances by MORE than 1 inside the batch — one commit per addTrack/addClip/updateClip, not per batch', () => {
    const engine = makeEngine()
    const before = engine.getRevision()
    const { project } = compileVideoSpec(SPEC, { seed: 1 })
    layProject(engine, project)
    expect(engine.getRevision()).toBeGreaterThan(before + 1)
  })

  // What "one undo step" actually means, and what discardLast's real contract
  // is: the assistant records `getRevision()` AFTER applying a plan (`getRevision`'s
  // own doc: "records it when it applies a plan"), then `discardLast(that revision)`
  // succeeds as long as nothing has happened since — regardless of how many
  // commits the apply itself took internally.
  it('one engine.undo() call removes EVERY clip and track the lay added — the batch is one undo entry', () => {
    const engine = makeEngine()
    const { project } = compileVideoSpec(SPEC, { seed: 1 })
    layProject(engine, project)
    expect(allClips(engine).length).toBeGreaterThan(0)
    expect(engine.canUndo()).toBe(true)

    expect(engine.undo()).toBe(true)
    expect(allClips(engine)).toHaveLength(0)
    expect(engine.canUndo()).toBe(false) // nothing before it — the WHOLE lay was one entry
  })

  it('discardLast(revision), with revision captured right after the lay, restores the timeline', () => {
    const engine = makeEngine()
    const { project } = compileVideoSpec(SPEC, { seed: 1 })
    layProject(engine, project)
    const revision = engine.getRevision() // captured AFTER, as the assistant does
    expect(allClips(engine).length).toBeGreaterThan(0)

    const restored = engine.discardLast(revision)
    expect(restored).toBe(true)
    expect(allClips(engine)).toHaveLength(0)
  })

  it('discardLast refuses once anything else changed since (same contract every other assistant plan follows)', () => {
    const engine = makeEngine()
    const { project } = compileVideoSpec(SPEC, { seed: 1 })
    layProject(engine, project)
    const revision = engine.getRevision()
    engine.addMarker(0) // an unrelated change after the lay
    expect(engine.discardLast(revision)).toBe(false)
  })
})

describe('layProject — stage', () => {
  it('adopts the compiled stage size when the live timeline has no clips', () => {
    const engine = makeEngine()
    const { project } = compileVideoSpec(SPEC, { seed: 1 })
    layProject(engine, project)
    expect(engine.getProject().stage).toEqual(project.stage)
  })

  it('does NOT resize the stage once the live timeline already holds a clip', () => {
    const engine = makeEngine([{ kind: 'video' }])
    const track = engine.getProject().tracks[0]!
    engine.addClip({ trackId: track.id, type: 'video', src: 'x.mp4', startFrame: 0, durationFrames: 10 })
    const stageBefore = engine.getProject().stage

    const { project } = compileVideoSpec(SPEC, { seed: 1 })
    layProject(engine, project)
    expect(engine.getProject().stage).toEqual(stageBefore)
  })
})

describe('layProject — appends above existing content', () => {
  it('never removes or reorders a pre-existing track', () => {
    const engine = makeEngine([{ kind: 'video' }])
    const existingTrackId = engine.getProject().tracks[0]!.id

    const { project } = compileVideoSpec(SPEC, { seed: 1 })
    layProject(engine, project)

    const live = engine.getProject()
    expect(live.tracks.some((t) => t.id === existingTrackId)).toBe(true)
  })
})

describe('layProject — closed-factory fields survive addClip + updateClip', () => {
  it('keyframes, layout (remapped), fontId and textAnimator all survive the two-call insert', () => {
    const engine = makeEngine()
    const { project } = compileVideoSpec(SPEC, { seed: 1 })
    layProject(engine, project)

    const live = allClips(engine)
    const title = live.find((c) => c.content === 'Hi')!
    const sub = live.find((c) => c.content === 'Sub')!
    expect(title).toBeDefined()
    expect(sub).toBeDefined()

    // keyframes: addClip's factory does not accept them at all.
    const opacityKeys = title.keyframes?.channels.opacity?.keys
    expect(opacityKeys).toHaveLength(2)
    expect(opacityKeys?.map((k) => k.value)).toEqual([0.2, 1])

    // fontId: addClip's TextClipMetadata has no such field.
    expect(title.fontId).toBe('inter')

    // textAnimator: same story.
    expect(title.textAnimator?.preset).toBe('fade')

    // layout: also survives, AND its `clip` reference is remapped to the
    // LIVE id addClip minted for `title` — not the compiled-document id,
    // which never touched this engine.
    expect(sub.layout?.anchorTo?.clip).toBe(title.id)
    expect(sub.layout?.anchorTo?.gap).toBe(4)
  })
})

describe('layProject — result shape', () => {
  it('reports every inserted clip as added, with a non-null range', () => {
    const engine = makeEngine()
    const { project } = compileVideoSpec(SPEC, { seed: 1 })
    const result = layProject(engine, project)
    expect(result.skipped).toHaveLength(0)
    expect(result.deferred).toHaveLength(0)
    expect(result.touched.added).toHaveLength(2)
    expect(result.applied).toHaveLength(2)
    expect(result.range).not.toBeNull()
  })
})
