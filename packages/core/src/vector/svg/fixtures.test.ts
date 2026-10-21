import { describe, it, expect } from 'vitest'
import { SVG_FIDELITY_FIXTURES } from './fixtures'
import { parseXml } from './__tests__/xml'
import { svgToProject } from './svgToProject'
import { parsePathData } from '../pathOps'
import { resolveShapeRect } from '../../renderer/gpu/layers/shapePaint'
import type { Clip, Project } from '../../types'

function shapesOf(project: Project): Clip[] {
  // Walk compounds too: a fixture's shapes may be nested one level deep.
  const out: Clip[] = []
  const walk = (p: Project): void => {
    for (const clip of Object.values(p.clips).flat()) {
      if (clip.type === 'compound' && clip.compound) walk(clip.compound.project)
      else out.push(clip)
    }
  }
  walk(project)
  return out
}

describe('SVG_FIDELITY_FIXTURES', () => {
  for (const fixture of SVG_FIDELITY_FIXTURES) {
    it(`${fixture.name}: shape count and skip list`, () => {
      const { project, skipped, shapeCount } = svgToProject(parseXml(fixture.svg), { fps: 30, durationFrames: 150 })
      expect(shapeCount).toBe(fixture.expectedShapes)
      expect(skipped).toEqual(fixture.expectedSkipped)

      for (const clip of shapesOf(project)) {
        expect(clip.type).toBe('shape')
        expect(parsePathData(clip.shapePath ?? '').length).toBeGreaterThan(0)
        const rect = resolveShapeRect(clip.transform, project.stage)
        expect(rect.x).toBeCloseTo(clip.shapeViewBox!.x, 6)
        expect(rect.y).toBeCloseTo(clip.shapeViewBox!.y, 6)
        expect(rect.width).toBeCloseTo(clip.shapeViewBox!.width, 6)
        expect(rect.height).toBeCloseTo(clip.shapeViewBox!.height, 6)
      }
    })
  }

  it('close: the first clip is a straight diagonal line', () => {
    const fixture = SVG_FIDELITY_FIXTURES.find((f) => f.name === 'close')!
    const { project } = svgToProject(parseXml(fixture.svg), { fps: 30, durationFrames: 150 })
    const [clip] = shapesOf(project)
    expect(clip.shapePath).toBe('M256 256L768 768')
  })

  it('plus-circle: the first clip is the circle path', () => {
    const fixture = SVG_FIDELITY_FIXTURES.find((f) => f.name === 'plus-circle')!
    const { project } = svgToProject(parseXml(fixture.svg), { fps: 30, durationFrames: 150 })
    const [clip] = shapesOf(project)
    expect(clip.shapePath!.startsWith('M938.667 512C')).toBe(true)
  })

  it('star: fill-rule evenodd carries through', () => {
    const fixture = SVG_FIDELITY_FIXTURES.find((f) => f.name === 'star')!
    const { project } = svgToProject(parseXml(fixture.svg), { fps: 30, durationFrames: 150 })
    const [clip] = shapesOf(project)
    expect(clip.shapeFillRule).toBe('evenodd')
  })

  it('camera: fill/stroke/path per clip', () => {
    const fixture = SVG_FIDELITY_FIXTURES.find((f) => f.name === 'camera')!
    const { project } = svgToProject(parseXml(fixture.svg), { fps: 30, durationFrames: 150 })
    const clips = shapesOf(project)
    expect(clips[0].shapeFill).toBe('#1f2937')
    expect(clips[1].shapeFill).toBe('transparent')
    expect(clips[1].shapeStroke).toBe('#f9fafb')
    expect(clips[1].shapeStrokeWidth).toBeCloseTo(64, 3)
    expect(clips[2].shapeFill).toBe('#ef4444')
    expect(clips[2].shapePath!.startsWith('M810.667 384')).toBe(true)
  })

  it('pin: the second clip (the circle inside the translated group) starts at the expected point', () => {
    const fixture = SVG_FIDELITY_FIXTURES.find((f) => f.name === 'pin')!
    const { project } = svgToProject(parseXml(fixture.svg), { fps: 30, durationFrames: 150 })
    const clips = shapesOf(project)
    expect(clips[1].shapePath!.startsWith('M618.667 448')).toBe(true)
  })
})
