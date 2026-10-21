import { describe, expect, it } from 'vitest'
import { pathBounds } from '../renderer/gpu/layers/pathBounds'
import {
  FREEHAND_MAX_POINTS,
  FREEHAND_MIN_SAMPLE_PX,
  FREEHAND_PATH_PRECISION,
  freehandFromDrag,
  pointsToPathData,
  type StagePoint,
} from './freehand'

const STAGE = { width: 1000, height: 500 }

/** What the transform would look like if it were rounded like the path is. */
const round1 = (v: number) => Math.round(v * 10) / 10

describe('pointsToPathData', () => {
  it('emits a polyline with one decimal of precision', () => {
    const d = pointsToPathData([
      { x: 10, y: 20 },
      { x: 20, y: 20 },
      { x: 30, y: 20 },
    ])
    expect(d).toBe('M 10 20 L 20 20 L 30 20')
  })

  it('rounds to FREEHAND_PATH_PRECISION decimals', () => {
    expect(FREEHAND_PATH_PRECISION).toBe(1)
    expect(pointsToPathData([{ x: 10.04, y: 20.06 }, { x: 30.04, y: 20.06 }])).toBe('M 10 20.1 L 30 20.1')
  })

  it('drops a sample closer than FREEHAND_MIN_SAMPLE_PX to the last kept one', () => {
    expect(FREEHAND_MIN_SAMPLE_PX).toBe(2)
    // 1px from the last kept point, so dropped; then 2px away, which is NOT
    // "below" the threshold, so kept.
    const d = pointsToPathData([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 100, y: 0 },
    ])
    expect(d).toBe('M 0 0 L 2 0 L 100 0')
  })

  it('keeps a sample at exactly FREEHAND_MIN_SAMPLE_PX', () => {
    // The comparison is strictly below, so the threshold distance itself survives.
    expect(pointsToPathData([{ x: 0, y: 0 }, { x: FREEHAND_MIN_SAMPLE_PX, y: 0 }])).toBe(
      'M 0 0 L 2 0',
    )
  })

  it('keeps the first sample unconditionally', () => {
    expect(pointsToPathData([{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 50, y: 5 }])).toBe('M 5 5 L 50 5')
  })

  it('collapses jitter around one spot to a single sample', () => {
    // Each point is within FREEHAND_MIN_SAMPLE_PX of the last KEPT one, so a slow
    // drag that never really moves cannot accumulate a dense zigzag.
    const d = pointsToPathData([
      { x: 10, y: 10 },
      { x: 10.5, y: 10.2 },
      { x: 9.8, y: 10.4 },
      { x: 10.2, y: 9.9 },
    ])
    expect(d).toBe('')
  })

  it('truncates at FREEHAND_MAX_POINTS', () => {
    expect(FREEHAND_MAX_POINTS).toBe(2000)
    const many: StagePoint[] = Array.from({ length: FREEHAND_MAX_POINTS + 50 }, (_, i) => ({ x: i * 10, y: 0 }))
    const d = pointsToPathData(many)
    // One M plus (MAX - 1) L commands.
    expect(d.split(' ').filter(tok => tok === 'M' || tok === 'L')).toHaveLength(FREEHAND_MAX_POINTS)
  })

  it("returns '' for one point and for an empty array", () => {
    // A one-point path strokes nothing but is not an empty document field, and an
    // empty pathData is exactly what the timeline already inserts.
    expect(pointsToPathData([{ x: 10, y: 10 }])).toBe('')
    expect(pointsToPathData([])).toBe('')
  })

  it('ignores non-finite samples rather than emitting NaN into the document', () => {
    const d = pointsToPathData([
      { x: 0, y: 0 },
      { x: Number.NaN, y: 5 },
      { x: 40, y: 0 },
    ])
    expect(d).toBe('M 0 0 L 40 0')
    expect(d).not.toContain('NaN')
  })
})

describe('freehandFromDrag', () => {
  it('stores the drawing as content: bounds start at (0, 0)', () => {
    const draft = freehandFromDrag(
      [
        { x: 100, y: 200 },
        { x: 300, y: 200 },
        { x: 300, y: 400 },
      ],
      STAGE,
    )
    expect(draft).not.toBeNull()
    // The path's own box is the drawn box, moved to the origin — NOT the stage
    // coordinates it was drawn at.
    expect(pathBounds(draft!.pathData)).toEqual({ x: 0, y: 0, width: 200, height: 200 })
    expect(draft!.pathData).not.toContain('100 200')
  })

  it('places the drawn box where it was drawn, per freehandRestTransform', () => {
    const draft = freehandFromDrag(
      [
        { x: 100, y: 200 },
        { x: 300, y: 200 },
        { x: 300, y: 400 },
      ],
      STAGE,
    )!
    // Centre of the DRAWN box: (200, 300) on a 1000x500 stage.
    // NOTE: the ticket's worked example says y 0.4; the rule it quotes
    // (`freehandRestTransform`) gives 300/500 = 0.6, and 0.6 is correct — the
    // drawing's centre is 300px down a 500px stage.
    expect(draft.transform).toEqual({
      x: 0.2,
      y: 0.6,
      scale: 1,
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
    })
  })

  it('measures the box from the ROUNDED geometry, so the two stored fields agree', () => {
    // The box is measured from the same rounded geometry that is stored, so the
    // document's `pathData` and `transform` describe ONE drawing rather than
    // disagreeing by up to half a precision step.
    //
    // (The ticket's "rounds in the path and not in the transform" is ambiguous
    // between "the transform keeps float precision" — which the next test pins —
    // and "the transform is measured from unrounded stage coordinates". This
    // chooses the second question in favour of self-consistency.)
    const draft = freehandFromDrag(
      [
        { x: 100.04, y: 200.04 },
        { x: 300.04, y: 200.04 },
      ],
      STAGE,
    )!
    // Re-based and rounded, exactly as stored.
    expect(draft.pathData).toBe('M 0 0 L 200 0')
    // The ROUNDED drawn box centres at (200, 200) on a 1000x500 stage.
    expect(draft.transform.x).toBeCloseTo(0.2, 12)
    expect(draft.transform.y).toBeCloseTo(0.4, 12)
    // ...not the raw samples' box, which would centre at 200.04.
    expect(draft.transform.x).not.toBeCloseTo(0.20004, 5)
  })

  it('does not quantise the transform to the path precision', () => {
    // A 333px-wide box at the left edge centres at 166.5, i.e. 0.1665 of a
    // 1000px stage — a value that one-decimal rounding would flatten to 0.2.
    const draft = freehandFromDrag(
      [
        { x: 0, y: 0 },
        { x: 333, y: 0 },
      ],
      STAGE,
    )!
    expect(draft.transform.x).toBeCloseTo(0.1665, 6)
    expect(draft.transform.x).not.toBe(round1(draft.transform.x))
  })

  it('returns null for a zero-length drag', () => {
    expect(freehandFromDrag([], STAGE)).toBeNull()
    expect(freehandFromDrag([{ x: 10, y: 10 }], STAGE)).toBeNull()
    // Sub-threshold movement is the same case: one surviving sample.
    expect(
      freehandFromDrag(
        [
          { x: 10, y: 10 },
          { x: 10.5, y: 10.5 },
        ],
        STAGE,
      ),
    ).toBeNull()
  })

  it('places a drawing drawn in the top-left corner, not at the stage centre', () => {
    // The regression the re-basing rule exists to prevent: a transform built from
    // the RE-BASED box would report centre (0,0) and put every drawing at the
    // middle of the stage.
    const draft = freehandFromDrag(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      STAGE,
    )!
    expect(draft.transform.x).toBeCloseTo(0.05, 6)
    expect(draft.transform.y).toBeCloseTo(0.1, 6)
  })

  it('re-drawing into a box keeps the anchor and changes only the geometry', () => {
    // Under v2 the transform addresses the BOX, so replacing a path is just a
    // new box at the same anchor — no special case needed in the tool.
    const first = freehandFromDrag(
      [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
      STAGE,
    )!
    const second = freehandFromDrag(
      [
        { x: 100, y: 100 },
        { x: 400, y: 300 },
      ],
      STAGE,
    )!
    expect(second.transform.anchor).toEqual(first.transform.anchor)
    expect(pathBounds(second.pathData)).toEqual({ x: 0, y: 0, width: 300, height: 200 })
  })
})
