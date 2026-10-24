import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { applyOps } from './apply'
import type { ApplyContext } from './apply'
import { describeProject } from './describe'
import { opDescriber } from './describeOp'
import { sanitizeOps } from './sanitize'
import type { EditorOp } from './types'

/**
 * `removeBackground` (MI-P7b): a PAID, DEFERRED op. Ref validation is enforced in
 * `sanitizeOps` (the model-facing gate) and again in `applyOps` (which skips a
 * missing or non-video clip); `applyOps` writes nothing and reports the job in
 * `backgroundRemovals` for the web layer to price, confirm and run.
 */

type Assets = NonNullable<ApplyContext['assets']>

const FPS = 30
const assets: Assets = new Map([['talk', { id: 'talk', kind: 'video', name: 'Interview', src: 'blob:talk', durationSec: 20, hasAudio: true }]])

/** A project with one trimmed video clip (source 12s..19s) and one text clip. */
function laid() {
  const engine = new TimelineEngine({ fps: FPS, initialTracks: [] })
  const placed = applyOps(engine, [{ op: 'insertSourceRange', asset: 'talk', start: 12, end: 19 }, { op: 'addText', text: 'Hello', at: 0, duration: 2 }], { assets })
  expect(placed.skipped).toEqual([])
  const clips = Object.values(engine.getProject().clips).flat()
  const video = clips.find((c) => c.type === 'video')!
  const text = clips.find((c) => c.type === 'text')!
  return { engine, video, text }
}

const snap = (engine: TimelineEngine) => JSON.stringify(engine.getProject())

/** A strict-schema style bag: every optional field present as null. */
const bag = (o: Record<string, unknown>) => ({ op: 'removeBackground', clip: null, subject: null, land: null, ...o })

describe('removeBackground: sanitizeOps', () => {
  it('rejects a missing clip, a clip made in the same plan, and a non-video clip', () => {
    const { engine, video, text } = laid()
    const r = sanitizeOps(
      [bag({ clip: 'nope' }), bag({ clip: null }), bag({ clip: text.id }), bag({ clip: video.id })],
      engine.getProject(),
      { assets },
    )
    expect(r.ops).toEqual([{ op: 'removeBackground', clip: video.id, land: 'matte' }])
    expect(r.dropped.map((d) => d.index)).toEqual([0, 1, 2])
    expect(r.dropped[0]!.reason).toMatch(/no clip "nope"/)
    expect(r.dropped[2]!.reason).toMatch(/needs a video clip/)
  })

  it('refuses a $ref to a clip the same plan creates (the paid job needs footage that already exists)', () => {
    const { engine } = laid()
    const r = sanitizeOps(
      [{ op: 'insertSourceRange', ref: 'cut', asset: 'talk', start: 1, end: 3 }, bag({ clip: '$cut' })],
      engine.getProject(),
      { assets },
    )
    expect(r.ops.map((o) => o.op)).toEqual(['insertSourceRange'])
    expect(r.dropped).toHaveLength(1)
    expect(r.dropped[0]!.reason).toMatch(/already on the timeline/)
  })

  it('drops subject from model output: the host application finds the person', () => {
    const { engine, video } = laid()
    const ops = sanitizeOps(
      [bag({ clip: video.id, subject: { box: [0.1, 0.2, 0.5, 0.6] } }), bag({ clip: video.id, subject: 'the tall man' })],
      engine.getProject(),
    ).ops
    expect(ops).toHaveLength(2)
    for (const o of ops) expect(o).not.toHaveProperty('subject')
  })

  it('defaults land to matte, maps legacy roto to matte, keeps sandwich, and falls back on garbage', () => {
    const { engine, video } = laid()
    const ops = sanitizeOps(
      [bag({ clip: video.id }), bag({ clip: video.id, land: 'roto' }), bag({ clip: video.id, land: 'sandwich' }), bag({ clip: video.id, land: 'sticker' })],
      engine.getProject(),
    ).ops as Array<Extract<EditorOp, { op: 'removeBackground' }>>
    expect(ops.map((o) => o.land)).toEqual(['matte', 'matte', 'sandwich', 'matte'])
  })

  it('strips idempotencyKey and projectId: the web layer stamps those, the model never does', () => {
    const { engine, video } = laid()
    const r = sanitizeOps([bag({ clip: video.id, idempotencyKey: 'rb-model-chose-this', projectId: 'someone-elses-project' })], engine.getProject())
    expect(r.dropped).toEqual([])
    expect(r.ops).toHaveLength(1)
    expect(r.ops[0]).not.toHaveProperty('idempotencyKey')
    expect(r.ops[0]).not.toHaveProperty('projectId')
  })
})

describe('removeBackground: applyOps defers', () => {
  it('writes nothing, makes no undo entry, and reports the job with its source range', () => {
    const { engine, video } = laid()
    const before = snap(engine)
    const rev = engine.getRevision()
    const op: EditorOp = { op: 'removeBackground', clip: video.id, land: 'matte' }
    const r = applyOps(engine, [op])
    expect(r.applied).toEqual([0])
    expect(r.skipped).toEqual([])
    expect(r.backgroundRemovals).toEqual([
      {
        index: 0,
        op,
        clipId: video.id,
        trackId: video.trackId,
        startFrame: video.startFrame,
        durationFrames: 210,
        sourceStartFrame: 360,
        sourceDurationFrames: 210,
      },
    ])
    expect(r.touched).toEqual({ added: [], changed: [], removed: [] })
    expect(r.deferred).toEqual([])
    expect(r.regenerations).toBeUndefined()
    expect(snap(engine)).toBe(before)
    expect(engine.getRevision()).toBe(rev)
  })

  it('patches the right plan index when it is not the first op, and each removal keeps its own', () => {
    const { engine, video, text } = laid()
    const op: EditorOp = { op: 'removeBackground', clip: video.id }
    const r = applyOps(engine, [{ op: 'setClipProps', clip: text.id, opacity: 0.5 }, op, { op: 'removeBackground', clip: video.id, land: 'sandwich' }])
    expect(r.applied).toEqual([0, 1, 2])
    expect(r.backgroundRemovals!.map((b) => b.index)).toEqual([1, 2])
    expect(r.backgroundRemovals![1]!.op).toMatchObject({ land: 'sandwich' })
    // Both modes carry the same source window.
    const { op: _a, index: _i, ...w0 } = r.backgroundRemovals![0]!
    const { op: _b, index: _j, ...w1 } = r.backgroundRemovals![1]!
    expect(w1).toEqual(w0)
    // The other op in the batch still took effect.
    expect(engine.findClip(text.id)!.clip.opacity).toBe(0.5)
  })

  it('reads the source range in source frames, not timeline frames, for a sped-up clip', () => {
    const { engine } = laid()
    const sped = applyOps(engine, [{ op: 'insertSourceRange', asset: 'talk', start: 2, end: 6, speed: 2, at: 20 }], { assets })
    expect(sped.skipped).toEqual([])
    const clip = engine.findClip(sped.touched.added[0]!)!.clip
    const r = applyOps(engine, [{ op: 'removeBackground', clip: clip.id }])
    expect(r.backgroundRemovals![0]).toMatchObject({ durationFrames: 60, sourceStartFrame: 60, sourceDurationFrames: 120 })
  })

  it('falls back to the timeline length times speed when the clip carries no source window', () => {
    const { engine, video } = laid()
    engine.updateClip(video.id, video.trackId, { sourceStartFrame: 0, sourceDurationFrames: 0 })
    const r = applyOps(engine, [{ op: 'removeBackground', clip: video.id }])
    expect(r.backgroundRemovals![0]).toMatchObject({ sourceStartFrame: 0, sourceDurationFrames: 210 })
  })

  it('skips a missing clip and a non-video clip with a clear reason, and defers nothing', () => {
    const { engine, text } = laid()
    const before = snap(engine)
    const r = applyOps(engine, [
      { op: 'removeBackground', clip: 'nope' },
      { op: 'removeBackground', clip: text.id },
    ])
    expect(r.applied).toEqual([])
    expect(r.skipped).toHaveLength(2)
    expect(r.skipped[0]!.reason).toMatch(/no clip "nope"/)
    expect(r.skipped[1]).toEqual({ index: 1, reason: 'removeBackground needs a video clip' })
    expect(r.backgroundRemovals).toBeUndefined()
    expect(snap(engine)).toBe(before)
  })

  it('allows a clip that already has a matte (a re-run)', () => {
    const { engine, video, text } = laid()
    engine.updateClip(video.id, video.trackId, { matte: { sourceClipId: text.id, kind: 'alpha' } })
    const r = applyOps(engine, [{ op: 'removeBackground', clip: video.id }])
    expect(r.backgroundRemovals).toHaveLength(1)
  })
})

describe('removeBackground: describing', () => {
  it('describeOp names the clip and how the cut lands, and states no price', () => {
    const { engine, video } = laid()
    const line = opDescriber(engine.getProject())({ op: 'removeBackground', clip: video.id })
    expect(line).toContain('Remove the background from “Interview”')
    expect(line).not.toContain('credits')
    expect(line).not.toContain('sandwich')
    const sandwich = opDescriber(engine.getProject())({ op: 'removeBackground', clip: video.id, land: 'sandwich' })
    expect(sandwich).toContain('sandwich: cut copy above the original')
    expect(sandwich).not.toContain('credits')
  })

  it('describeProject shows a clip that already has a matte, and only that clip', () => {
    const { engine, video, text } = laid()
    engine.updateClip(video.id, video.trackId, { matte: { sourceClipId: text.id, kind: 'alpha' } })
    const clips = describeProject(engine.getProject()).tracks.flatMap((t) => t.clips)
    const described = clips.find((c) => c.id === video.id)!
    expect(described).toMatchObject({ matteOf: text.id, matteKind: 'alpha' })
    const plain = clips.find((c) => c.id === text.id)!
    expect(plain).not.toHaveProperty('matteOf')
    expect(plain).not.toHaveProperty('matteKind')
  })
})
