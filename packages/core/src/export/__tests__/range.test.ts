import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../../editor/TimelineEngine'
import type { Project } from '../../types'
import { resolveExportRange } from '../range'

/** A project whose timeline runs to exactly `totalFrames`, optionally with `inOut` set. */
function buildProject(totalFrames: number, inOut?: { in: number; out: number }): Project {
  const engine = new TimelineEngine({ fps: 30 })
  const track = engine.addTrack('elements')
  engine.addClip({
    type: 'shape',
    trackId: track.id,
    startFrame: 0,
    durationFrames: totalFrames,
    shape: { shapeKind: 'rect' },
  } as never)
  const project = engine.getProject()
  return inOut ? { ...project, inOut } : project
}

describe('resolveExportRange (PV-P9a-1)', () => {
  it('total 100, inOut 20..50 → 30 frames starting at 20', () => {
    const project = buildProject(100, { in: 20, out: 50 })
    expect(resolveExportRange(project, 'inOut')).toEqual({ startFrame: 20, endFrame: 50, totalFrames: 30 })
  })

  it('missing inOut uses the full range even when range is "inOut"', () => {
    const project = buildProject(100)
    expect(resolveExportRange(project, 'inOut')).toEqual({ startFrame: 0, endFrame: 100, totalFrames: 100 })
  })

  it('range "all" ignores a present inOut', () => {
    const project = buildProject(100, { in: 20, out: 50 })
    expect(resolveExportRange(project, 'all')).toEqual({ startFrame: 0, endFrame: 100, totalFrames: 100 })
  })

  it('defaults to "all" when no mode is given', () => {
    const project = buildProject(100, { in: 20, out: 50 })
    expect(resolveExportRange(project)).toEqual({ startFrame: 0, endFrame: 100, totalFrames: 100 })
  })

  it('clamps an out-of-range inOut to the timeline bounds', () => {
    const project = buildProject(100, { in: 90, out: 150 })
    expect(resolveExportRange(project, 'inOut')).toEqual({ startFrame: 90, endFrame: 100, totalFrames: 10 })
  })

  it('clamps a negative in to 0', () => {
    const project = buildProject(100, { in: -10, out: 40 })
    expect(resolveExportRange(project, 'inOut')).toEqual({ startFrame: 0, endFrame: 40, totalFrames: 40 })
  })

  it('rejects an empty range (in === out)', () => {
    const project = buildProject(100, { in: 30, out: 30 })
    expect(() => resolveExportRange(project, 'inOut')).toThrow(/empty or invalid/)
  })

  it('rejects an inverted range (out < in)', () => {
    const project = buildProject(100, { in: 50, out: 20 })
    expect(() => resolveExportRange(project, 'inOut')).toThrow(/empty or invalid/)
  })

  it('rejects a range that clamps to empty (both past the end)', () => {
    const project = buildProject(100, { in: 120, out: 150 })
    expect(() => resolveExportRange(project, 'inOut')).toThrow(/empty or invalid/)
  })

  it('the first exported frame (i=0) resolves the scene at the range start', () => {
    // frame 20 in an absolute walk == i=0 of a range starting at 20 (documents
    // the contract ExportWorker.ts relies on: absolute frame = start + i).
    const range = resolveExportRange(buildProject(100, { in: 20, out: 50 }), 'inOut')
    const absoluteFrameForOutputIndexZero = range.startFrame + 0
    expect(absoluteFrameForOutputIndexZero).toBe(20)
  })
})
