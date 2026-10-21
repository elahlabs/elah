import { describe, it, expect } from 'vitest'
import { parseXml } from './__tests__/xml'
import { svgToProject } from './svgToProject'
import { parsePathData } from '../pathOps'
import { resolveShapeRect } from '../../renderer/gpu/layers/shapePaint'
import type { Clip } from '../../types'

function shapesOf(clips: Record<string, Clip[]>): Clip[] {
  return Object.values(clips).flat()
}

describe('parseXml (test helper)', () => {
  it('builds a tree from a simple document', () => {
    expect(parseXml('<svg viewBox="0 0 1 1"><g id="a"><path d="M0 0"/></g></svg>')).toEqual({
      tag: 'svg',
      attrs: { viewBox: '0 0 1 1' },
      children: [
        {
          tag: 'g',
          attrs: { id: 'a' },
          children: [{ tag: 'path', attrs: { d: 'M0 0' }, children: [] }],
        },
      ],
    })
  })

  it('stores xlink:href under its local name', () => {
    const tree = parseXml('<svg viewBox="0 0 1 1"><use xlink:href="#x"/></svg>')
    expect(tree.children[0].attrs.href).toBe('#x')
  })

  it('keeps CDATA as the text of a style element', () => {
    const tree = parseXml('<svg viewBox="0 0 1 1"><style><![CDATA[.a{fill:red}]]></style></svg>')
    expect(tree.children[0].text).toBe('.a{fill:red}')
  })

  it('decodes entities', () => {
    const tree = parseXml('<svg viewBox="0 0 1 1"><g id="a &amp; b"/></svg>')
    expect(tree.children[0].attrs.id).toBe('a & b')
  })

  it('throws on a mismatched end tag', () => {
    expect(() => parseXml('<a></b>')).toThrow()
  })
})

describe('svgToProject — shapes and paths', () => {
  it('converts the check fixture at the default size', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 10 18 20 6"/></svg>'
    const { project, skipped, shapeCount } = svgToProject(parseXml(svg), { fps: 30, durationFrames: 90 })
    expect(shapeCount).toBe(1)
    expect(skipped).toEqual([])
    expect(project.stage).toEqual({ width: 1024, height: 1024 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapePath).toBe('M170.667 512L426.667 768L853.333 256')
    expect(clip.shapeViewBox!.x).toBeCloseTo(170.667, 3)
    expect(clip.shapeViewBox!.y).toBeCloseTo(256, 3)
    expect(clip.shapeViewBox!.width).toBeCloseTo(682.667, 3)
    expect(clip.shapeViewBox!.height).toBeCloseTo(512, 3)
    expect(clip.transform!.x).toBeCloseTo(0.5, 6)
    expect(clip.transform!.y).toBeCloseTo(0.5, 6)
    expect(clip.transform!.scale).toBeCloseTo(0.666667, 5)
    expect(clip.transform!.scaleX).toBeCloseTo(1, 6)
    expect(clip.transform!.scaleY).toBeCloseTo(0.75, 6)
    expect(clip.transform!.rotation).toBe(0)
    expect(clip.shapeStrokeWidth).toBeCloseTo(85.333, 3)
    expect(clip.shapeStrokeCap).toBe('round')
    expect(clip.shapeStrokeJoin).toBe('round')
    expect(clip.shapeStroke).toBe('#000000')
    expect(clip.shapeFill).toBe('transparent')
  })

  it('rect fill-opacity and clip opacity', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><rect width="10" height="10" fill="#0f172a" fill-opacity=".9" opacity=".5"/></svg>',
    )
    const { project } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeFill).toBe('rgba(15, 23, 42, 0.9)')
    expect(clip.opacity).toBe(0.5)
  })

  it('currentColor resolves through an ancestor color attribute', () => {
    const root = parseXml('<svg viewBox="0 0 100 100"><g color="#ff0000"><rect width="5" height="5" fill="currentColor"/></g></svg>')
    const { project } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeFill).toBe('#ff0000')
  })

  it('a non-uniform scale is reported for a stroked shape', () => {
    const root = parseXml('<svg viewBox="0 0 100 100"><g transform="scale(2 1)"><path d="M0 0H10" stroke="#000" stroke-width="3"/></g></svg>')
    const { project, skipped } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeViewBox!.height).toBeCloseTo(1, 6) // padded from 0
    expect(clip.shapeViewBox!.width).toBeCloseTo(10 * 2, 6)
    expect(skipped.find((s) => s.feature === 'non-uniform-stroke')).toEqual({ feature: 'non-uniform-stroke', count: 1 })
  })

  it('a uniform scale multiplies the stroke width', () => {
    const root = parseXml('<svg viewBox="0 0 100 100"><g transform="scale(2)"><path d="M0 0H10" stroke="#000" stroke-width="3"/></g></svg>')
    const { project, skipped } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeStrokeWidth).toBeCloseTo(6, 6)
    expect(skipped.find((s) => s.feature === 'non-uniform-stroke')).toBeUndefined()
  })

  it('dash array and offset, size 1000', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><path d="M0 0H10" stroke="#000" stroke-width="1" stroke-dasharray="4 2" stroke-dashoffset="1"/></svg>',
    )
    const { project } = svgToProject(root, { fps: 30, durationFrames: 90, size: 1000 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeStrokeDash).toEqual([40, 20])
    expect(clip.shapeStrokeDashOffset).toBe(10)
  })

  it('a dasharray with a negative entry is discarded', () => {
    const root = parseXml('<svg viewBox="0 0 100 100"><path d="M0 0H10" stroke="#000" stroke-width="1" stroke-dasharray="4,-2"/></svg>')
    const { project } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeStrokeDash).toBeUndefined()
  })

  it('stroke-dasharray: none is a solid stroke', () => {
    const root = parseXml('<svg viewBox="0 0 100 100"><path d="M0 0H10" stroke="#000" stroke-width="1" stroke-dasharray="none"/></svg>')
    const { project } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeStrokeDash).toBeUndefined()
  })

  it('display:none and visibility:hidden elements produce no clip and no skip', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><rect display="none" width="5" height="5" fill="red"/><rect visibility="hidden" width="5" height="5" fill="red"/></svg>',
    )
    const { project, skipped, shapeCount } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    expect(shapeCount).toBe(0)
    expect(shapesOf(project.clips)).toEqual([])
    expect(skipped).toEqual([])
  })

  it('display:none on a group hides its children', () => {
    const root = parseXml('<svg viewBox="0 0 100 100"><g display="none"><rect width="5" height="5" fill="red"/></g></svg>')
    const { project, shapeCount } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    expect(shapeCount).toBe(0)
    expect(shapesOf(project.clips)).toEqual([])
  })

  it('reports unsupported elements as skips', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><text/><image/><foo/><animate/></svg>',
    )
    const { skipped } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    expect(skipped).toEqual([
      { feature: 'animation', count: 1 },
      { feature: 'element:foo', count: 1 },
      { feature: 'image', count: 1 },
      { feature: 'text', count: 1 },
    ])
  })

  it('a filter is skipped but the element is still emitted', () => {
    const root = parseXml('<svg viewBox="0 0 100 100"><rect width="5" height="5" fill="red" filter="url(#f)"/></svg>')
    const { project, skipped, shapeCount } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    expect(shapeCount).toBe(1)
    expect(skipped).toEqual([{ feature: 'filter', count: 1 }])
    expect(shapesOf(project.clips)).toHaveLength(1)
  })

  it('a missing paint server falls back to the fallback colour', () => {
    const root = parseXml('<svg viewBox="0 0 100 100"><rect width="5" height="5" fill="url(#missing) red"/></svg>')
    const { project, skipped } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeFill).toBe('red')
    expect(skipped).toEqual([{ feature: 'paint-server-missing', count: 1 }])
  })

  it('a linearGradient reference with no stops resolves to a transparent solid, no Paint (PV-P6b-3)', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><defs><linearGradient id="g"/></defs><rect width="5" height="5" fill="url(#g)" stroke="black" stroke-width="1"/></svg>',
    )
    const { project, skipped } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeFill).toBe('transparent')
    expect(clip.shapeFillPaint).toBeUndefined()
    expect(skipped).toEqual([])
  })

  it('a linearGradient reference with stops becomes a shapeFillPaint (PV-P6b-3)', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="5" height="5" fill="url(#g)" stroke="black" stroke-width="1"/></svg>',
    )
    const { project, skipped } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeFillPaint?.type).toBe('linear')
    expect(skipped).toEqual([])
  })

  it('the element limit counts every drawable shape and reports the overflow', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><rect width="1" height="1" fill="red"/><rect width="1" height="1" fill="red"/><rect width="1" height="1" fill="red"/></svg>',
    )
    const { project, skipped, shapeCount } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100, maxShapes: 1 })
    expect(shapeCount).toBe(3)
    expect(shapesOf(project.clips)).toHaveLength(1)
    expect(skipped).toEqual([{ feature: 'element-limit', count: 2 }])
  })

  it('falls back to width/height when there is no viewBox', () => {
    const root = parseXml('<svg width="48" height="24"><rect width="1" height="1" fill="red"/></svg>')
    const { project, skipped } = svgToProject(root, { fps: 30, durationFrames: 90 })
    expect(project.stage).toEqual({ width: 1024, height: 512 })
    expect(skipped).toEqual([])
  })

  it('falls back to the default box when there is neither a viewBox nor width/height', () => {
    const root = parseXml('<svg><rect width="1" height="1" fill="red"/></svg>')
    const { project, skipped } = svgToProject(root, { fps: 30, durationFrames: 90 })
    expect(project.stage).toEqual({ width: 1024, height: 512 })
    expect(skipped).toEqual([{ feature: 'no-viewbox', count: 1 }])
  })

  it('tracks are created in document order, one clip each, all kind elements', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><rect width="1" height="1" fill="red"/><rect width="1" height="1" fill="green"/><rect width="1" height="1" fill="blue"/></svg>',
    )
    const { project } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    expect(project.tracks).toHaveLength(3)
    const byOrder = [...project.tracks].sort((a, b) => a.order - b.order)
    expect(byOrder.map((t) => t.order)).toEqual([0, 1, 2])
    for (const t of byOrder) {
      expect(t.kind).toBe('elements')
      expect(project.clips[t.id]).toHaveLength(1)
    }
  })

  it('throws when the root is not <svg>', () => {
    expect(() => svgToProject(parseXml('<g/>'), { fps: 30, durationFrames: 90 })).toThrow('Not an SVG document')
  })
})

describe('svgToProject — groups and use', () => {
  it('a group with two children and opacity < 1 becomes one compound clip', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><g opacity=".5"><rect width="5" height="5" fill="red"/><rect width="5" height="5" fill="blue"/></g></svg>',
    )
    const { project } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.type).toBe('compound')
    expect(clip.opacity).toBe(0.5)
    expect(clip.transform).toEqual({ x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } })
    const childClips = shapesOf(clip.compound!.project.clips)
    expect(childClips).toHaveLength(2)
    expect(clip.compound!.project.stage).toEqual(project.stage)
  })

  it('a group with one child folds the opacity into it, no compound', () => {
    const root = parseXml('<svg viewBox="0 0 100 100"><g opacity=".5"><rect width="5" height="5" fill="red"/></g></svg>')
    const { project } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.type).toBe('shape')
    expect(clip.opacity).toBe(0.5)
  })

  it('three nested opacity groups compound at depths 2 and 3, the innermost folds', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100">' +
        '<g opacity=".5">' +
        '<rect width="5" height="5" fill="red"/>' +
        '<g opacity=".5">' +
        '<rect width="5" height="5" fill="green"/>' +
        '<g opacity=".5">' +
        '<rect width="5" height="5" fill="blue"/>' +
        '<rect width="5" height="5" fill="yellow"/>' +
        '</g>' +
        '</g>' +
        '</g>' +
        '</svg>',
    )
    const { project, skipped } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    expect(skipped).toEqual([{ feature: 'group-opacity-depth', count: 1 }])
    const [outer] = shapesOf(project.clips)
    expect(outer.type).toBe('compound')
    const outerChildren = shapesOf(outer.compound!.project.clips)
    expect(outerChildren).toHaveLength(2) // rect + middle compound
    const middle = outerChildren.find((c) => c.type === 'compound')!
    expect(middle).toBeDefined()
    // The innermost group could not wrap (its own depth + 1 > 3), so it folds
    // and hands its two rects up flattened instead of as a nested compound:
    // the middle compound ends up with 3 children, not 2.
    const middleChildren = shapesOf(middle.compound!.project.clips)
    expect(middleChildren).toHaveLength(3)
    expect(middleChildren.every((c) => c.type === 'shape')).toBe(true)
  })

  it("the camera fixture's use inherits fill from the use element", () => {
    const root = parseXml(
      '<svg viewBox="0 0 24 24"><defs><circle id="dot" r="1"/></defs><use href="#dot" x="18" y="9" fill="#ef4444"/></svg>',
    )
    const { project } = svgToProject(root, { fps: 30, durationFrames: 150 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeFill).toBe('#ef4444')
  })

  it('a self-referencing use is a cycle, not a hang', () => {
    const root = parseXml('<svg viewBox="0 0 100 100"><g id="a"><use href="#a"/></g></svg>')
    const { skipped, shapeCount } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    expect(shapeCount).toBe(0)
    expect(skipped).toEqual([{ feature: 'use-cycle', count: 1 }])
  })

  it('a use with a missing target is reported', () => {
    const root = parseXml('<svg viewBox="0 0 100 100"><use href="#nope"/></svg>')
    const { skipped, shapeCount } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    expect(shapeCount).toBe(0)
    expect(skipped).toEqual([{ feature: 'use-missing', count: 1 }])
  })

  it('a symbol renders through use and reports symbol-viewbox', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><symbol id="s" viewBox="0 0 1 1"><rect width="5" height="5" fill="red"/></symbol><use href="#s"/></svg>',
    )
    const { project, skipped, shapeCount } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    expect(shapeCount).toBe(1)
    expect(shapesOf(project.clips)).toHaveLength(1)
    expect(skipped).toEqual([{ feature: 'symbol-viewbox', count: 1 }])
  })
})
