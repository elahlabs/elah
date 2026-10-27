import { beforeEach, describe, expect, it } from 'vitest'
import { timelineUiStore } from './timelineUi.store'
import { selectionStore } from './selection.store'

/** Timeline preferences and the selection anchor (PV-T1). */

describe('timelineUiStore', () => {
  beforeEach(() => {
    timelineUiStore.setState({ tool: 'select', linkedSelection: true, followPlayhead: true, trackHeight: 54, headerWidth: 184 })
  })

  it('defaults to the select tool, linked selection on and following the playhead', () => {
    const s = timelineUiStore.getState()
    expect([s.tool, s.linkedSelection, s.followPlayhead]).toEqual(['select', true, true])
  })

  it('switches tool and toggles its preferences', () => {
    const s = timelineUiStore.getState()
    s.setTool('trim')
    s.toggleLinkedSelection()
    s.setFollowPlayhead(false)
    const after = timelineUiStore.getState()
    expect([after.tool, after.linkedSelection, after.followPlayhead]).toEqual(['trim', false, false])
    after.setLinkedSelection(true)
    expect(timelineUiStore.getState().linkedSelection).toBe(true)
  })
})

describe('timeline track height (PV-T4)', () => {
  it('is one height for every track, 54 px by default, clamped to 24–200', () => {
    timelineUiStore.setState({ trackHeight: 54 })
    expect(timelineUiStore.getState().trackHeight).toBe(54)
    timelineUiStore.getState().setTrackHeight(96)
    expect(timelineUiStore.getState().trackHeight).toBe(96)
    timelineUiStore.getState().setTrackHeight(5)
    expect(timelineUiStore.getState().trackHeight).toBe(24)
    timelineUiStore.getState().setTrackHeight(999)
    expect(timelineUiStore.getState().trackHeight).toBe(200)
    timelineUiStore.getState().setTrackHeight(Number.NaN)
    expect(timelineUiStore.getState().trackHeight).toBe(54)
  })
})

describe('timeline header width (PV-T4)', () => {
  it('defaults to 184 px and is clamped to 140–360', () => {
    expect(timelineUiStore.getState().headerWidth).toBe(184)
    timelineUiStore.getState().setHeaderWidth(250.4)
    expect(timelineUiStore.getState().headerWidth).toBe(250)
    timelineUiStore.getState().setHeaderWidth(10)
    expect(timelineUiStore.getState().headerWidth).toBe(140)
    timelineUiStore.getState().setHeaderWidth(9999)
    expect(timelineUiStore.getState().headerWidth).toBe(360)
    timelineUiStore.getState().setHeaderWidth(Number.NaN)
    expect(timelineUiStore.getState().headerWidth).toBe(184)
  })
})

describe('selectionStore anchor', () => {
  beforeEach(() => selectionStore.getState().clearSelection())

  it('follows the last clip clicked or added', () => {
    const s = selectionStore.getState()
    s.selectClip('a')
    expect(selectionStore.getState().anchorClipId).toBe('a')
    s.addClips(['b', 'c'])
    expect([...selectionStore.getState().selectedClipIds]).toEqual(['a', 'b', 'c'])
    expect(selectionStore.getState().anchorClipId).toBe('c')
    s.toggleClipSelection('d')
    expect(selectionStore.getState().anchorClipId).toBe('d')
  })

  it('clears when its clip leaves the selection', () => {
    const s = selectionStore.getState()
    s.selectClips(['a', 'b'])
    expect(selectionStore.getState().anchorClipId).toBe('b')
    s.removeClips(['b'])
    expect([...selectionStore.getState().selectedClipIds]).toEqual(['a'])
    expect(selectionStore.getState().anchorClipId).toBeNull()
    s.toggleClipSelection('a')
    expect(selectionStore.getState().selectedClipIds.size).toBe(0)
    s.selectClip('x')
    s.clearSelection()
    expect(selectionStore.getState().anchorClipId).toBeNull()
  })

  it('removing clips that are not selected changes nothing', () => {
    const s = selectionStore.getState()
    s.selectClip('a')
    const before = selectionStore.getState()
    s.removeClips(['zzz'])
    expect(selectionStore.getState()).toBe(before)
  })
})
