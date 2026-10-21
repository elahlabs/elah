import { describe, it, expect } from 'vitest'
import { projectFromClips, compoundClipFor, importedVectorClip, maxShapesForStage, COMPOUND_TRACK_KIND } from './importClip'
import { createClip } from '../elements/base'
import { PROJECT_VERSION } from '../editor/projectDocument'
import type { Clip, Project } from '../types'

function shapeClip(overrides: { transform?: Clip['transform']; shapeStrokeWidth?: number } = {}): Clip {
  return createClip({
    type: 'shape',
    trackId: '',
    name: 'shape',
    startFrame: 0,
    durationFrames: 30,
    ...(overrides.transform ? { transform: overrides.transform } : {}),
    shape: {
      shapeKind: 'rect',
      ...(overrides.shapeStrokeWidth !== undefined ? { shapeStrokeWidth: overrides.shapeStrokeWidth } : {}),
    },
  })
}

function compoundClip(project: Project): Clip {
  return createClip({
    type: 'compound',
    trackId: '',
    name: 'nested',
    startFrame: 0,
    durationFrames: 30,
    compound: { project },
  })
}

describe('projectFromClips', () => {
  it('one track per item, in order, kinds by clip type, transitions empty, version stamped', () => {
    const a = shapeClip()
    const inner: Project = projectFromClips([shapeClip()], { fps: 30, stage: { width: 10, height: 10 } })
    const b = compoundClip(inner)
    const project = projectFromClips([a, b], { fps: 30, stage: { width: 100, height: 50 } })

    expect(project.tracks).toHaveLength(2)
    const byOrder = [...project.tracks].sort((x, y) => x.order - y.order)
    expect(byOrder.map((t) => t.order)).toEqual([0, 1])
    expect(byOrder.map((t) => t.kind)).toEqual(['elements', COMPOUND_TRACK_KIND])
    expect(project.transitions).toEqual([])
    expect(project.version).toBe(PROJECT_VERSION)
    for (const track of byOrder) {
      const clips = project.clips[track.id]
      expect(clips).toHaveLength(1)
      expect(clips[0].trackId).toBe(track.id)
    }
  })
})

describe('maxShapesForStage', () => {
  it.each([
    [{ width: 1024, height: 1024 }, 32],
    [{ width: 512, height: 512 }, 128],
    [{ width: 1920, height: 1080 }, 16],
    [{ width: 10, height: 10 }, 128],
  ])('%o -> %i', (stage, expected) => {
    expect(maxShapesForStage(stage)).toBe(expected)
  })
})

describe('compoundClipFor', () => {
  it('builds a compound clip with the given opacity and no transform key when none is given', () => {
    const child = projectFromClips([shapeClip()], { fps: 30, stage: { width: 10, height: 10 } })
    const clip = compoundClipFor(child, { name: 'n', startFrame: 0, durationFrames: 30, opacity: 0.5 })
    expect(clip.type).toBe('compound')
    expect(clip.opacity).toBe(0.5)
    expect('transform' in clip).toBe(false)
    expect(clip.compound?.project).toBe(child)
  })
})

describe('importedVectorClip', () => {
  const checkStage = { width: 1024, height: 1024 }

  function checkResult(): Project {
    const clip = shapeClip({
      transform: { x: 0.5, y: 0.5, scale: 0.666667, scaleX: 1, scaleY: 0.75, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      shapeStrokeWidth: 85.333,
    })
    return projectFromClips([clip], { fps: 30, stage: checkStage })
  }

  function closeResult(): Project {
    const a = shapeClip()
    const b = shapeClip()
    return projectFromClips([a, b], { fps: 30, stage: checkStage })
  }

  it('a single-shape project is re-placed as a shape clip, fit into the parent', () => {
    const child = checkResult()
    const parentStage = { width: 1080, height: 1920 }
    const clip = importedVectorClip(child, { name: 'Check', startFrame: 12, parentStage })

    expect(clip.type).toBe('shape')
    expect(clip.trackId).toBe('')
    expect(clip.startFrame).toBe(12)
    expect(clip.name).toBe('Check')
    expect(clip.sourceStartFrame).toBe(0)
    expect(clip.sourceDurationFrames).toBe(30)
    expect(clip.transform!.scale).toBeCloseTo(0.5, 6)
    expect(clip.transform!.scaleX).toBeCloseTo(1, 6)
    expect(clip.transform!.scaleY).toBeCloseTo(0.75, 6)

    const f = (0.5 * 1080) / 682.667
    expect(clip.shapeStrokeWidth).toBeCloseTo(85.333 * f, 2)

    const originalIds = Object.values(child.clips).flat().map((c) => c.id)
    expect(originalIds).not.toContain(clip.id)
  })

  it('a multi-shape project is wrapped as a compound, fit into the parent', () => {
    const child = closeResult()
    const parentStage = { width: 1080, height: 1920 }
    const clip = importedVectorClip(child, { name: 'Close', startFrame: 0, parentStage })

    expect(clip.type).toBe('compound')
    expect(clip.transform!.scale).toBeCloseTo((0.5 * 1080) / 1024, 6)
    expect(clip.compound?.project).toBe(child)
  })
})
