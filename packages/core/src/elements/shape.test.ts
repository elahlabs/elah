/**
 * The shape clip factory carries the v2 geometry.
 *
 * `createClip` spreads each optional field conditionally, so the risk is not a
 * wrong value but a DROPPED one: a polygon whose side count never reached the
 * clip renders as the painter's default and the user sees a pentagon they did
 * not ask for. These assertions are about presence and absence.
 */

import { describe, it, expect } from 'vitest'
import { createShapeClip } from './shape'

describe('createShapeClip', () => {
  const base = { trackId: 't1', startFrame: 0, durationFrames: 30 }

  it('carries the legacy style fields', () => {
    const clip = createShapeClip({
      ...base,
      shape: { shapeKind: 'rect', shapeFill: '#fff', shapeStroke: '#000', shapeStrokeWidth: 3 },
    })
    expect(clip).toMatchObject({
      type: 'shape',
      shapeKind: 'rect',
      shapeFill: '#fff',
      shapeStroke: '#000',
      shapeStrokeWidth: 3,
    })
  })

  it('carries polygon geometry', () => {
    const clip = createShapeClip({
      ...base,
      shape: { shapeKind: 'polygon', shapeSides: 7, shapeInnerRatio: 0.4 },
    })
    expect(clip).toMatchObject({ shapeKind: 'polygon', shapeSides: 7, shapeInnerRatio: 0.4 })
  })

  it('carries a line arrowhead and a rect corner radius', () => {
    expect(createShapeClip({ ...base, shape: { shapeKind: 'line', shapeArrowHead: 'both' } }))
      .toMatchObject({ shapeArrowHead: 'both' })
    expect(createShapeClip({ ...base, shape: { shapeKind: 'rect', cornerRadius: 0.25 } }))
      .toMatchObject({ cornerRadius: 0.25 })
  })

  it('carries path data, its viewBox and its fill rule', () => {
    const clip = createShapeClip({
      ...base,
      shape: {
        shapeKind: 'path',
        shapePath: 'M0 0 L10 10',
        shapeViewBox: { x: 0, y: 0, width: 10, height: 10 },
        shapeFillRule: 'evenodd',
      },
    })
    expect(clip).toMatchObject({
      shapePath: 'M0 0 L10 10',
      shapeViewBox: { x: 0, y: 0, width: 10, height: 10 },
      shapeFillRule: 'evenodd',
    })
  })

  it('omits every field the caller did not set, so the painter applies its own defaults', () => {
    const clip = createShapeClip({ ...base, shape: { shapeKind: 'circle' } })
    for (const key of [
      'shapeSides',
      'shapeInnerRatio',
      'shapeArrowHead',
      'shapePath',
      'shapeViewBox',
      'shapeFillRule',
      'cornerRadius',
    ] as const) {
      expect(clip[key]).toBeUndefined()
    }
  })

  /** PV-P6a: paint fills/strokes, dash, cap, join and stroke alignment. */
  it('carries the PV-P6a paint, dash, cap, join and align fields', () => {
    const clip = createShapeClip({
      ...base,
      shape: {
        shapeKind: 'rect',
        shapeStrokeDash: [4, 2],
        shapeStrokeCap: 'round',
        shapeStrokeAlign: 'inside',
        shapeFillPaint: { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] },
      },
    })
    expect(clip).toMatchObject({
      shapeStrokeDash: [4, 2],
      shapeStrokeCap: 'round',
      shapeStrokeAlign: 'inside',
      shapeFillPaint: { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] },
    })
  })

  it('a plain rect has none of the PV-P6a keys', () => {
    const clip = createShapeClip({ ...base, shape: { shapeKind: 'rect' } })
    for (const key of [
      'shapeFillPaint',
      'shapeStrokePaint',
      'shapeStrokeDash',
      'shapeStrokeDashOffset',
      'shapeStrokeCap',
      'shapeStrokeJoin',
      'shapeStrokeAlign',
    ] as const) {
      expect(key in clip).toBe(false)
    }
  })

  it('names the clip after its kind when no name is given', () => {
    expect(createShapeClip({ ...base, shape: { shapeKind: 'triangle' } }).name).toBe('triangle')
  })
})
