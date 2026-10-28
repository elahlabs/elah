import { describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'
import { readProjectDocument } from './projectDocument'

/** Track groups (PV-T1): collapsible rows in the timeline; compositing is untouched. */

function setup() {
  const engine = new TimelineEngine({
    fps: 30,
    initialTracks: [
      { kind: 'video', name: 'V1' },
      { kind: 'video', name: 'V2' },
      { kind: 'audio', name: 'A1' },
      { kind: 'audio', name: 'A2' },
    ],
  })
  const [v1, v2, a1, a2] = engine.getProject().tracks.map((t) => t.id) as [string, string, string, string]
  return { engine, v1, v2, a1, a2 }
}

describe('groupTracks', () => {
  it('creates a group in track order, expanded, as one undo step', () => {
    const { engine, v1, a1 } = setup()
    const id = engine.groupTracks([a1, v1], 'Interview')!

    expect(engine.getProject().trackGroups).toEqual([{ id, name: 'Interview', trackIds: [v1, a1], collapsed: false }])
    expect(engine.lastHistoryDescription()).toBe('Group tracks')
    engine.undo()
    expect('trackGroups' in engine.getProject()).toBe(false)
  })

  it('moves a track out of its old group and drops a group left empty', () => {
    const { engine, v1, v2, a1 } = setup()
    const first = engine.groupTracks([v1, a1])!
    engine.groupTracks([v2])
    const second = engine.groupTracks([v1, a1, v2])!

    const groups = engine.getProject().trackGroups!
    expect(groups.map((g) => g.id)).toEqual([second])
    expect(groups.some((g) => g.id === first)).toBe(false)
  })

  it('ignores unknown ids and refuses when none is known', () => {
    const { engine, v1 } = setup()
    expect(engine.groupTracks(['nope'])).toBeNull()
    const id = engine.groupTracks([v1, 'nope'])!
    expect(engine.getProject().trackGroups![0]!.trackIds).toEqual([v1])
    expect(id).toBeTruthy()
  })
})

describe('collapse, ungroup and track removal', () => {
  it('collapses and expands a group', () => {
    const { engine, v1, a1 } = setup()
    const id = engine.groupTracks([v1, a1])!
    engine.setTrackGroupCollapsed(id, true)
    expect(engine.getProject().trackGroups![0]!.collapsed).toBe(true)
    engine.setTrackGroupCollapsed(id, false)
    expect(engine.getProject().trackGroups![0]!.collapsed).toBe(false)
  })

  it('ungrouping removes the group and leaves the tracks', () => {
    const { engine, v1, a1 } = setup()
    const id = engine.groupTracks([v1, a1])!
    engine.ungroupTracks(id)
    expect('trackGroups' in engine.getProject()).toBe(false)
    expect(engine.getProject().tracks).toHaveLength(4)
  })

  it('removing a track takes it out of its group, and an empty group goes with it', () => {
    const { engine, v1, v2, a1 } = setup()
    engine.groupTracks([v1, a1])
    engine.groupTracks([v2])

    engine.removeTrack(a1)
    expect(engine.getProject().trackGroups!.map((g) => g.trackIds)).toEqual([[v1], [v2]])

    engine.removeTrack(v2)
    expect(engine.getProject().trackGroups!.map((g) => g.trackIds)).toEqual([[v1]])
  })

  it('survives a save and reload', () => {
    const { engine, v1, a1 } = setup()
    const id = engine.groupTracks([v1, a1], 'Pair')!
    engine.setTrackGroupCollapsed(id, true)
    const restored = readProjectDocument(JSON.parse(JSON.stringify(engine.getProject())))
    expect(restored.trackGroups).toEqual([{ id, name: 'Pair', trackIds: [v1, a1], collapsed: true }])
  })
})
