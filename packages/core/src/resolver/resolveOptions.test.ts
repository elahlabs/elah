import { describe, it, expect, vi } from 'vitest'
import { layoutResolveOptions } from './resolveOptions'
import type { Clip, Project, Track } from '../types'

const STAGE = { width: 1000, height: 500 }

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: 'p1',
    fps: 30,
    stage: STAGE,
    tracks: [],
    clips: {},
    transitions: [],
    version: 1,
    ...overrides,
  }
}

function makeTrack(overrides?: Partial<Track>): Track {
  return {
    id: overrides?.id ?? 't1',
    name: overrides?.id ?? 't1',
    kind: 'elements',
    order: 0,
    height: 54,
    locked: false,
    disabled: false,
    muted: false,
    solo: false,
    ...overrides,
  }
}

function makeClip(overrides: Partial<Clip> & { id: string; trackId: string; type: Clip['type'] }): Clip {
  return {
    name: overrides.id,
    startFrame: 0,
    durationFrames: 60,
    sourceStartFrame: 0,
    sourceDurationFrames: 60,
    ...overrides,
  }
}

/** A project with no clip carrying `layout`. */
function projectWithoutLayout(): Project {
  const clip = makeClip({ id: 'a', trackId: 't1', type: 'shape', shapeKind: 'rect' })
  return makeProject({ tracks: [makeTrack({ id: 't1' })], clips: { t1: [clip] } })
}

/** A project whose one shape carries `layout: { region: 'top' }`. */
function projectWithLayout(): Project {
  const clip = makeClip({ id: 'a', trackId: 't1', type: 'shape', shapeKind: 'rect', layout: { region: 'top' } })
  return makeProject({ tracks: [makeTrack({ id: 't1' })], clips: { t1: [clip] } })
}

describe('layoutResolveOptions', () => {
  it('returns {} without calling makeContext when the project uses no layout', () => {
    const makeContext = vi.fn(() => ({ font: '', measureText: () => ({ width: 0 }) }) as any)
    const opts = layoutResolveOptions(projectWithoutLayout(), makeContext)
    expect(opts).toEqual({})
    expect(makeContext).not.toHaveBeenCalled()
  })

  it('builds a measurer over the context makeContext returns when the project uses layout', () => {
    const ctx = { font: '', measureText: (t: string) => ({ width: t.length * 7 }) } as any
    const opts = layoutResolveOptions(projectWithLayout(), () => ctx)
    expect(opts.measure).toBeDefined()
    expect(opts.measure!.measure('10px x', 'abc').width).toBe(21)
  })

  it('returns {} when makeContext returns null', () => {
    const opts = layoutResolveOptions(projectWithLayout(), () => null)
    expect(opts).toEqual({})
  })
})
