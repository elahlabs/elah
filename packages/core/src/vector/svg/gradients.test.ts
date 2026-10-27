import { describe, it, expect } from 'vitest'
import { parseXml } from './__tests__/xml'
import { svgToProject } from './svgToProject'
import { SVG_FIDELITY_FIXTURES } from './fixtures'
import { paintColorAt } from '../__tests__/paintSample'
import { colorAt } from '../gradient'
import type { Clip } from '../../types'

function shapesOf(clips: Record<string, Clip[]>): Clip[] {
  return Object.values(clips).flat()
}

function fixtureSvg(name: string): string {
  const f = SVG_FIDELITY_FIXTURES.find((x) => x.name === name)
  if (!f) throw new Error(`no fixture named ${name}`)
  return f.svg
}

describe('sunrise fixture gradients', () => {
  const root = parseXml(fixtureSvg('sunrise'))
  const { project } = svgToProject(root, { fps: 30, durationFrames: 150 })
  const [rect, circle, path] = shapesOf(project.clips)

  it('the sky rect gets a linear Paint spanning the stage, top to bottom', () => {
    expect(rect.shapeFillPaint?.type).toBe('linear')
    expect(rect.shapeFill).toBe('#1e3a8a')
    const box = rect.shapeViewBox!
    expect(paintColorAt(rect.shapeFillPaint!, box, 512, 0).r).toBeCloseTo(0x1e, 0)
    const top = paintColorAt(rect.shapeFillPaint!, box, 512, 0)
    expect([top.r, top.g, top.b]).toEqual([0x1e, 0x3a, 0x8a])
    const bottom = paintColorAt(rect.shapeFillPaint!, box, 512, 512)
    expect([bottom.r, bottom.g, bottom.b]).toEqual([0xf9, 0x73, 0x16])
  })

  it('the sun circle resolves stops through the href chain and gradientTransform', () => {
    expect(circle.shapeFillPaint?.type).toBe('linear')
    const box = circle.shapeViewBox!
    const topCentre = paintColorAt(circle.shapeFillPaint!, box, box.x + box.width / 2, box.y)
    expect([topCentre.r, topCentre.g, topCentre.b]).toEqual([0xfd, 0xe0, 0x47])
    const bottomCentre = paintColorAt(circle.shapeFillPaint!, box, box.x + box.width / 2, box.y + box.height)
    expect(bottomCentre.r).toBeCloseTo(245, 0)
    expect(bottomCentre.g).toBeCloseTo(158, 0)
    expect(bottomCentre.b).toBeCloseTo(11, 0)
    expect(bottomCentre.a).toBeCloseTo(0.6, 2)
    const stops = circle.shapeFillPaint!.type !== 'solid' ? circle.shapeFillPaint!.stops : []
    const midT = colorAt(stops, 0.5)
    const midSample = paintColorAt(circle.shapeFillPaint!, box, box.x + box.width / 2, box.y + box.height / 2)
    const midExpected = paintColorAt({ type: 'solid', color: midT.color }, box, 0, 0)
    expect([midSample.r, midSample.g, midSample.b]).toEqual([midExpected.r, midExpected.g, midExpected.b])
  })

  it('the path is a plain solid fill, no Paint', () => {
    expect(path.shapeFill).toBe('rgba(15, 23, 42, 0.9)')
    expect(path.shapeFillPaint).toBeUndefined()
  })
})

describe('orb fixture gradients', () => {
  const root = parseXml(fixtureSvg('orb'))
  const { project, skipped } = svgToProject(root, { fps: 30, durationFrames: 150 })
  const [glow] = shapesOf(project.clips)

  it('the glow circle gets a radial Paint with the three stops', () => {
    expect(glow.shapeFillPaint?.type).toBe('radial')
    if (glow.shapeFillPaint?.type !== 'radial') return
    expect(glow.shapeFillPaint.cx).toBeCloseTo(0.5, 4)
    expect(glow.shapeFillPaint.cy).toBeCloseTo(0.5, 4)
    expect(glow.shapeFillPaint.r).toBeCloseTo(0.7071, 4)
    expect(glow.shapeFillPaint.stops).toHaveLength(3)
  })

  it('reports the focal approximation once', () => {
    expect(skipped).toContainEqual({ feature: 'radial-gradient-focal', count: 1 })
  })
})

describe('gradients: fill-opacity, stroke, spread, degenerate bbox, href cycles', () => {
  it('fill-opacity folds into every stop', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)" fill-opacity=".5"/></svg>',
    )
    const { project } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeFillPaint?.type).toBe('linear')
    if (clip.shapeFillPaint?.type !== 'linear') return
    for (const stop of clip.shapeFillPaint.stops) {
      expect(stop.color.startsWith('rgba(')).toBe(true)
      const alpha = Number(stop.color.slice(0, -1).split(',').pop())
      expect(alpha).toBeCloseTo(0.5, 2)
    }
  })

  it('a stroke gradient sets shapeStrokePaint, not shapeFillPaint', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="100" height="100" fill="none" stroke="url(#g)" stroke-width="2"/></svg>',
    )
    const { project } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeStrokePaint?.type).toBe('linear')
    expect(clip.shapeFillPaint).toBeUndefined()
  })

  it('spreadMethod reflect is reported and converted as pad', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><defs><linearGradient id="g" spreadMethod="reflect"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/></svg>',
    )
    const { skipped } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    expect(skipped).toContainEqual({ feature: 'gradient-spread', count: 1 })
  })

  it('a zero-length gradient line collapses to a solid last-stop colour, no Paint', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="0"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/></svg>',
    )
    const { project } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeFillPaint).toBeUndefined()
    expect(clip.shapeFill).toBe('#fff')
  })

  it('an objectBoundingBox gradient on a zero-height bbox reports gradient-degenerate-bbox', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><line x1="0" y1="10" x2="50" y2="10" stroke="url(#g)" stroke-width="2"/></svg>',
    )
    const { skipped } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    expect(skipped).toContainEqual({ feature: 'gradient-degenerate-bbox', count: 1 })
  })

  it('an href cycle terminates instead of hanging', () => {
    const root = parseXml(
      '<svg viewBox="0 0 100 100"><defs><linearGradient id="a" xlink:href="#b"/><linearGradient id="b" xlink:href="#a"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="100" height="100" fill="url(#a)"/></svg>',
    )
    const { project } = svgToProject(root, { fps: 30, durationFrames: 90, size: 100 })
    const [clip] = shapesOf(project.clips)
    expect(clip.shapeFillPaint?.type).toBe('linear')
  })
})
