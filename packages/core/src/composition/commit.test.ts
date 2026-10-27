import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import type { Clip } from '../types'
import { commitComposition, commitPropValues } from './commit'
import type { ProjectComposition } from './types'

function engine(): TimelineEngine {
  return new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
}

/** An elements track with text clip `t` (content 'Hello') and shape clip `sh` (fill '#3366ff'), on separate tracks so neither overlaps the other. */
function fixture(): { e: TimelineEngine; t: string; sh: string } {
  const e = engine()
  const trackA = e.addTrack('elements', { name: 'Text' })
  const trackB = e.addTrack('elements', { name: 'Shape' })
  const t = e.addClip({
    type: 'text',
    trackId: trackA.id,
    startFrame: 0,
    durationFrames: 60,
    text: { content: 'Hello' },
  })
  const sh = e.addClip({
    type: 'shape',
    trackId: trackB.id,
    startFrame: 0,
    durationFrames: 60,
    shape: { shapeKind: 'rect', shapeFill: '#3366ff' },
  })
  return { e, t: t.id, sh: sh.id }
}

const props = (): ProjectComposition['props'] => [
  { name: 'title', type: 'text', default: 'Hello', label: 'Title' },
  { name: 'accent', type: 'color', default: '#3366ff', label: 'Accent' },
]

function findClip(e: TimelineEngine, id: string): Clip {
  return e.findClip(id)!.clip
}

// ---------------------------------------------------------------------------
// Step 1: TimelineEngine.setComposition
// ---------------------------------------------------------------------------

describe('TimelineEngine.setComposition', () => {
  it('stores an equal but not identical object; the caller input is not frozen', () => {
    const { e } = fixture()
    const input: ProjectComposition = { props: props(), bindings: [] }
    e.setComposition(input)
    const stored = e.getProject().composition
    expect(stored).toEqual(input)
    expect(stored).not.toBe(input)
    expect(Object.isFrozen(input)).toBe(false)
  })

  it('is one undo step; undo removes the composition', () => {
    const { e } = fixture()
    e.setComposition({ props: props(), bindings: [] })
    expect(e.canUndo()).toBe(true)
    expect(e.undo()).toBe(true)
    expect(e.getProject().composition).toBeUndefined()
  })

  it('setComposition(null) on a project without one records no history', () => {
    const { e } = fixture()
    const canUndoBefore = e.canUndo()
    e.setComposition(null)
    expect(e.canUndo()).toBe(canUndoBefore)
  })

  it('an empty composition ({props: [], bindings: []}) removes an existing one', () => {
    const { e } = fixture()
    e.setComposition({ props: props(), bindings: [] })
    e.setComposition({ props: [], bindings: [] })
    expect(e.getProject().composition).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Step 2: commitComposition / commitPropValues
// ---------------------------------------------------------------------------

describe('commitComposition', () => {
  it('leaves content unchanged and stores every prop’s value; one undo step', () => {
    const { e, t } = fixture()
    const before = e.getProject()

    const r = commitComposition(e, { props: props(), bindings: [{ clipId: t, path: 'text', prop: 'title' }] })

    expect(r.ok).toBe(true)
    expect(findClip(e, t).content).toBe('Hello')
    expect(e.getProject().composition?.values).toEqual({ title: 'Hello', accent: '#3366ff' })
    // One undo step: undoing once returns to exactly the pre-commit project.
    expect(e.undo()).toBe(true)
    expect(e.getProject()).toEqual(before)
  })

  it('commitComposition(engine, null) removes the composition and leaves the clips as they are', () => {
    const { e, t } = fixture()
    commitComposition(e, { props: props(), bindings: [{ clipId: t, path: 'text', prop: 'title' }] })
    const contentBefore = findClip(e, t).content

    const r = commitComposition(e, null)

    expect(r.ok).toBe(true)
    expect(e.getProject().composition).toBeUndefined()
    expect(findClip(e, t).content).toBe(contentBefore)
  })
})

describe('commitPropValues', () => {
  it('sets content, values.title and changedClipIds; one undo restores both', () => {
    const { e, t } = fixture()
    commitComposition(e, { props: props(), bindings: [{ clipId: t, path: 'text', prop: 'title' }] })

    const r = commitPropValues(e, { title: 'World' })

    expect(r.ok).toBe(true)
    expect(findClip(e, t).content).toBe('World')
    expect(e.getProject().composition?.values?.title).toBe('World')
    expect(r.changedClipIds).toEqual([t])

    expect(e.undo()).toBe(true)
    expect(findClip(e, t).content).toBe('Hello')
    expect(e.getProject().composition?.values?.title).toBe('Hello')
  })

  it('returns ok:false with a bad-color issue for an invalid colour; history is unchanged', () => {
    const { e, t } = fixture()
    commitComposition(e, { props: props(), bindings: [{ clipId: t, path: 'text', prop: 'title' }] })
    const before = e.getProject()

    const r = commitPropValues(e, { accent: 'red' })

    expect(r.ok).toBe(false)
    expect(r.issues[0]?.code).toBe('bad-color')
    expect(e.getProject()).toBe(before)
  })

  it('rewrites a bound shape fill', () => {
    const { e, t, sh } = fixture()
    commitComposition(e, {
      props: props(),
      bindings: [
        { clipId: t, path: 'text', prop: 'title' },
        { clipId: sh, path: 'shapeFill', prop: 'accent' },
      ],
    })

    const r = commitPropValues(e, { accent: '#ff0000' })

    expect(r.ok).toBe(true)
    expect(findClip(e, sh).shapeFill).toBe('#ff0000')
  })

  it('rewrites a compound clip when a binding reaches into one of its children', () => {
    const { e } = fixture()
    const track = e.addTrack('elements', { name: 'Nested source' })
    const child = e.addClip({
      type: 'text',
      trackId: track.id,
      startFrame: 0,
      durationFrames: 60,
      text: { content: 'Inner' },
    })
    const nested = e.nestClips([child.id])
    expect(nested.ok).toBe(true)
    const compoundId = nested.ok ? nested.data : ''

    commitComposition(e, {
      props: [{ name: 'inner', type: 'text', default: 'Inner', label: 'Inner' }],
      bindings: [{ clipId: `${compoundId}/${child.id}`, path: 'text', prop: 'inner' }],
    })

    const r = commitPropValues(e, { inner: 'Changed' })

    expect(r.ok).toBe(true)
    expect(r.changedClipIds).toEqual([compoundId])
    const compound = findClip(e, compoundId)
    const innerClip = Object.values(compound.compound!.project.clips).flat().find((c) => c.id === child.id)
    expect(innerClip?.content).toBe('Changed')
  })

  it('returns ok:false with an unknown-prop issue when the project has no composition', () => {
    const { e } = fixture()
    const r = commitPropValues(e, { title: 'World' })
    expect(r.ok).toBe(false)
    expect(r.issues[0]).toMatchObject({ kind: 'prop', code: 'unknown-prop' })
    expect(r.changedClipIds).toEqual([])
  })
})
