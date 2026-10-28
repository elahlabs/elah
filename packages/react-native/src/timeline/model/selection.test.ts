import { describe, expect, it } from 'vitest'
import { buildFixture } from './__fixtures__/project'
import { deleteSelectionCommand } from './selection'

describe('deleteSelectionCommand', () => {
  it('returns null for an empty selection', () => {
    const f = buildFixture()
    expect(deleteSelectionCommand(f.snapshot(), new Set())).toBeNull()
  })

  it('returns null when every selected id is unknown', () => {
    const f = buildFixture()
    expect(deleteSelectionCommand(f.snapshot(), new Set(['gone-1', 'gone-2']))).toBeNull()
  })

  it('builds one removeClips command for clips on different tracks', () => {
    const f = buildFixture()
    const command = deleteSelectionCommand(f.snapshot(), new Set([f.a.id, f.title.id]))
    expect(command).toEqual({
      type: 'removeClips',
      clips: [
        { clipId: f.a.id, trackId: f.v1.id },
        { clipId: f.title.id, trackId: f.elements.id },
      ],
    })
  })

  it('keeps the selection order', () => {
    const f = buildFixture()
    const command = deleteSelectionCommand(f.snapshot(), new Set([f.b.id, f.a.id]))
    expect(command).toEqual({
      type: 'removeClips',
      clips: [
        { clipId: f.b.id, trackId: f.v1.id },
        { clipId: f.a.id, trackId: f.v1.id },
      ],
    })
  })

  it('skips a clip on a locked lane', () => {
    const f = buildFixture()
    const base = f.snapshot()
    const snapshot = {
      ...base,
      tracks: base.tracks.map((t) => (t.id === f.v1.id ? { ...t, locked: true } : t)),
    }
    const command = deleteSelectionCommand(snapshot, new Set([f.a.id, f.title.id]))
    expect(command).toEqual({
      type: 'removeClips',
      clips: [{ clipId: f.title.id, trackId: f.elements.id }],
    })
  })

  it('returns null when every selected clip is on a locked lane', () => {
    const f = buildFixture()
    const base = f.snapshot()
    const snapshot = {
      ...base,
      tracks: base.tracks.map((t) => ({ ...t, locked: true })),
    }
    expect(deleteSelectionCommand(snapshot, new Set([f.a.id, f.b.id]))).toBeNull()
  })

  it('keeps only the valid ids when the selection mixes valid and unknown', () => {
    const f = buildFixture()
    const command = deleteSelectionCommand(f.snapshot(), new Set(['gone', f.b.id, 'also-gone']))
    expect(command).toEqual({
      type: 'removeClips',
      clips: [{ clipId: f.b.id, trackId: f.v1.id }],
    })
  })
})
