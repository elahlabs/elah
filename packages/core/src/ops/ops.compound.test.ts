import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { applyOps } from './apply'
import { sanitizeOps } from './sanitize'
import { describeProject } from './describe'
import { opDescriber } from './describeOp'
import type { EditorOp } from './types'

/**
 * Compound ops (PV-P1c-1 step 2).
 *
 * The point of routing nest/unnest through ops rather than inventing a private
 * path is that an assistant plan and a user gesture then go through the SAME pure
 * P1a-3 functions, so they cannot disagree about what a legal nest is. These
 * tests therefore assert the hand-off, not the nesting itself: that a plan can
 * build a compound and address it by `$ref`, that a refusal is a *skip* that
 * leaves the rest of the plan running, and that a refusal writes nothing.
 */

function engine(): TimelineEngine {
  return new TimelineEngine({ fps: 30, stage: { width: 1280, height: 720 } })
}

/** Two video clips on one track, plus a text clip on the elements track. */
function twoClips(e: TimelineEngine): { a: string; b: string; c: string; v: string } {
  const v = e.addTrack('video')
  const a = e.addClip({ type: 'video', src: 'a.mp4', trackId: v.id, startFrame: 0, durationFrames: 20 })
  const b = e.addClip({ type: 'video', src: 'b.mp4', trackId: v.id, startFrame: 20, durationFrames: 20 })
  const c = e.addClip({
    type: 'text',
    text: { content: 'note' },
    trackId: e.addTrack('elements').id,
    startFrame: 0,
    durationFrames: 20,
  })
  return { a: a.id, b: b.id, c: c.id, v: v.id }
}

const ids = (e: TimelineEngine) => Object.values(e.getProject().clips).flat().map((c) => c.id)

describe('sanitize — nest and unnest', () => {
  it('keeps a well-formed nest and unnest', () => {
    const e = engine()
    const { a, b, c } = twoClips(e)
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'nest', clips: [a, b], ref: 'grp', name: 'Pair' },
        { op: 'unnest', clip: '$grp' },
      ],
      e.getProject(),
    )
    expect(dropped).toEqual([])
    expect(ops.map((o) => o.op)).toEqual(['nest', 'unnest'])
  })

  it('drops a nest of fewer than two clips, with a readable reason', () => {
    const e = engine()
    const { a } = twoClips(e)
    const { ops, dropped } = sanitizeOps([{ op: 'nest', clips: [a] }], e.getProject())
    expect(ops).toEqual([])
    expect(dropped[0]?.reason).toMatch(/at least two clips/)
  })

  it('drops a nest naming the same clip twice', () => {
    const e = engine()
    const { a } = twoClips(e)
    const { ops, dropped } = sanitizeOps([{ op: 'nest', clips: [a, a] }], e.getProject())
    expect(ops).toEqual([])
    expect(dropped[0]?.reason).toMatch(/same clip twice/)
  })

  it('drops a nest whose clips array is missing', () => {
    const e = engine()
    const { ops, dropped } = sanitizeOps([{ op: 'nest' }], e.getProject())
    expect(ops).toEqual([])
    expect(dropped[0]?.reason).toMatch(/clips array/)
  })

  it('drops an unnest naming a clip that does not exist', () => {
    const e = engine()
    const { ops, dropped } = sanitizeOps([{ op: 'unnest', clip: 'nope' }], e.getProject())
    expect(ops).toEqual([])
    expect(dropped[0]?.reason).toMatch(/no clip/)
  })

  it('drops a nest referring to a $ref nothing created', () => {
    const e = engine()
    const { a } = twoClips(e)
    const { ops, dropped } = sanitizeOps([{ op: 'nest', clips: [a, '$ghost'] }], e.getProject())
    expect(ops).toEqual([])
    expect(dropped[0]?.reason).toMatch(/refers to nothing created/)
  })
})

describe('apply — nest with a ref, then unnest by that ref, in one batch', () => {
  it('runs both in a single undo step', () => {
    const e = engine()
    const { a, b } = twoClips(e)
    const before = e.getProject()

    const result = applyOps(e, [
      { op: 'nest', clips: [a, b], ref: 'grp' } as EditorOp,
      { op: 'unnest', clip: '$grp' } as EditorOp,
    ])
    expect(result.skipped).toEqual([])
    expect(result.applied).toEqual([0, 1])
    // One undo takes back the WHOLE plan, so the document is exactly as it was.
    expect(e.undo()).toBe(true)
    expect(e.getProject()).toEqual(before)
  })

  it('records the compound under its $ref and reports the parts as removed', () => {
    const e = engine()
    const { a, b } = twoClips(e)
    const result = applyOps(e, [{ op: 'nest', clips: [a, b], ref: 'grp' } as EditorOp])
    const compoundId = result.refs.grp
    expect(compoundId).toBeTruthy()
    expect(ids(e)).toContain(compoundId)
    // The two children are gone, and the diff styling is told so.
    expect(ids(e)).not.toContain(a)
    expect(result.touched.removed.map((r) => r.id).sort()).toEqual([a, b].sort())
    expect(result.touched.added).toContain(compoundId)
  })

  it('names the compound', () => {
    const e = engine()
    const { a, b } = twoClips(e)
    applyOps(e, [{ op: 'nest', clips: [a, b], name: 'My Pair' } as EditorOp])
    expect(Object.values(e.getProject().clips).flat().some((c) => c.name === 'My Pair')).toBe(true)
  })
})

describe('apply — refusals are skips, and write nothing', () => {
  it('skips an unnest of a clip that is not a compound, and leaves the project alone', () => {
    const e = engine()
    const { c } = twoClips(e)
    const before = e.getProject()
    const result = applyOps(e, [{ op: 'unnest', clip: c } as EditorOp])
    expect(result.applied).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.reason).toMatch(/not a compound/)
    expect(e.getProject()).toEqual(before)
    // A refusal must not look like a partial edit.
    expect(result.touched.removed).toEqual([])
    expect(result.touched.added).toEqual([])
  })

  it('skips an unnest the pure function refuses, preserving the project', () => {
    const e = engine()
    const { a, b } = twoClips(e)
    const nested = applyOps(e, [{ op: 'nest', clips: [a, b], ref: 'grp' } as EditorOp])
    const compoundId = nested.refs.grp!
    // Un-nest is lossless or it refuses (P1a-3). Nudging the compound on the
    // preview canvas is the ordinary way a user makes it non-lossless.
    const trackId = e.findClip(compoundId)!.trackId
    e.updateClip(compoundId, trackId, {
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
    })
    const before = e.getProject()

    const result = applyOps(e, [{ op: 'unnest', clip: compoundId } as EditorOp])
    expect(result.applied).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.reason).toMatch(/moved or scaled/)
    expect(e.getProject()).toEqual(before)
  })

  it('keeps running the plan after a refused op', () => {
    const e = engine()
    const { a, b, c } = twoClips(e)
    const result = applyOps(e, [
      { op: 'unnest', clip: c } as EditorOp, // not a compound — refused
      { op: 'nest', clips: [a, b], ref: 'grp' } as EditorOp, // still runs
    ])
    expect(result.skipped).toHaveLength(1)
    expect(result.applied).toEqual([1])
    expect(result.refs.grp).toBeTruthy()
  })
})

describe('describeProject — compounds are summarised, not dumped', () => {
  /** Clips live under their track, so a flat look needs one hop. */
  const allClips = (project: Parameters<typeof describeProject>[0]) =>
    describeProject(project).tracks.flatMap((t) => t.clips)

  it('reports child count and depth for a compound, and nothing for a flat clip', () => {
    const e = engine()
    const { a, b } = twoClips(e)
    const nested = applyOps(e, [{ op: 'nest', clips: [a, b], ref: 'grp' } as EditorOp])
    const described = allClips(e.getProject())

    const compound = described.find((c) => c.id === nested.refs.grp)
    expect(compound?.compound).toEqual({ clips: 2, depth: 0 })
    // A plain clip says nothing about compounds at all.
    const other = described.find((c) => c.id !== compound?.id)
    expect(other?.compound).toBeUndefined()
  })

  it('counts depth for a compound nested inside a compound', () => {
    const e = engine()
    const { v, a, b } = twoClips(e)
    const inner = applyOps(e, [{ op: 'nest', clips: [a, b], ref: 'inner' } as EditorOp])
    // Nest the compound itself together with a third clip on the same track.
    const third = e.addClip({ type: 'video', src: 'c.mp4', trackId: v, startFrame: 40, durationFrames: 20 })
    const both = applyOps(e, [{ op: 'nest', clips: [inner.refs.inner!, third.id], ref: 'outer' } as EditorOp])

    const described = allClips(e.getProject())
    const top = described.find((c) => c.id === both.refs.outer)
    // The subtree holds four clips — the inner compound counts as one, plus the
    // two inside it and the third sibling — and the inner compound is one level
    // down, so the depth is 1.
    expect(top?.compound).toEqual({ clips: 4, depth: 1 })
  })
})

describe('opDescriber — nest and unnest read as sentences', () => {
  it('describes both ops without falling through', () => {
    const e = engine()
    const { a, b } = twoClips(e)
    const describe = opDescriber(e.getProject())
    expect(describe({ op: 'nest', clips: [a, b] } as EditorOp)).toMatch(/Group .* into one compound/)
    expect(describe({ op: 'unnest', clip: a } as EditorOp)).toMatch(/back on the timeline/)
  })
})
