import { describe, expect, it } from 'vitest'
import type { ActiveFreehandClip, ActiveShapeClip, ActiveTextClip } from '../../../resolver/scene'
import { elementFrameFor, freehandFrame, shapeMaskFrame, textMaskFrame } from '../layers/elementFrame'
import { resolveShapeRect } from '../layers/shapePaint'
import { measureContextFor, type TextMeasurer } from '../layers/textMeasure'

const stage = { width: 1000, height: 500 }
// Fixed-width glyphs: every character is 10 px wide.
const measure = { font: '', measureText: (t: string) => ({ width: t.length * 10 }) as TextMetrics }

describe('element mask frames', () => {
  it('a shape frame is exactly the painter rect', () => {
    const item = { transform: { x: 0.3, y: 0.4, scale: 0.2, rotation: 0.5, anchor: { x: 0.5, y: 0.5 } } } as ActiveShapeClip
    expect(shapeMaskFrame(item, stage)).toEqual(resolveShapeRect(item.transform, stage))
  })

  it('a text frame is the glyph box, centred on the text and carrying its rotation', () => {
    const base = { content: 'HELLO', fontSize: 40, transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } } }
    const flat = textMaskFrame(measure, base as unknown as ActiveTextClip, stage)
    expect(flat.x + flat.width / 2).toBeCloseTo(500)
    expect(flat.y + flat.height / 2).toBeCloseTo(250)
    expect(flat.rotation).toBe(0)
    const turned = textMaskFrame(measure, { ...base, transform: { ...base.transform, rotation: 0.4 } } as unknown as ActiveTextClip, stage)
    expect(turned.rotation).toBe(0.4)
    expect(turned.width).toBeCloseTo(flat.width)
    // Rotating about its own centre keeps the centre put.
    expect(turned.x + turned.width / 2).toBeCloseTo(500)
  })
})

// PV-P2a: `elementFrameFor` is the one entry point the overlay, the mask frame
// and the harness all read, so a stretched or anchored clip is measured the same
// way everywhere instead of three times.
describe('elementFrameFor (PV-P2)', () => {
  const measurer: TextMeasurer = {
    measure: (_font, text) => ({ width: text.length * 10, ascent: 0, descent: 0 }),
  }
  const text = (over: Partial<ActiveTextClip>): ActiveTextClip =>
    ({
      id: 't',
      trackId: 'tr',
      name: 't',
      type: 'text',
      content: 'HELLO',
      fontSize: 40,
      sourceFrame: 0,
      opacity: 1,
      zIndex: 0,
      ...over,
    }) as ActiveTextClip

  it('a legacy text frame is exactly what textMaskFrame gives', () => {
    const item = text({ transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } } })
    expect(elementFrameFor(item, stage, measurer)).toEqual(
      textMaskFrame(measureContextFor(measurer), item, stage),
    )
  })

  it('a v2 frame starts at the anchor point', () => {
    // 'HELLO' at 40 px is 50 wide and one 48 px line high; anchored top-left at
    // (0.1, 0.2) = (100, 100) the box starts exactly there.
    const frame = elementFrameFor(
      text({
        transformModel: 'v2',
        transform: { x: 0.1, y: 0.2, scale: 1, rotation: 0, anchor: { x: 0, y: 0 } },
      }),
      stage,
      measurer,
    )!
    expect(frame.x).toBeCloseTo(100, 6)
    expect(frame.y).toBeCloseTo(100, 6)
    expect(frame.width).toBeCloseTo(50, 6)
    expect(frame.height).toBeCloseTo(48, 6)
    expect(frame.rotation).toBe(0)
  })

  it('a stretched v2 frame is the stretched box, still centred where it was', () => {
    const frame = elementFrameFor(
      text({
        transformModel: 'v2',
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 }, scaleX: 2 },
      }),
      stage,
      measurer,
    )!
    expect(frame.width).toBeCloseTo(100, 6)
    expect(frame.height).toBeCloseTo(48, 6)
    // Twice as wide about the same centre.
    expect(frame.x + frame.width / 2).toBeCloseTo(500, 6)
    expect(frame.y + frame.height / 2).toBeCloseTo(250, 6)
  })

  it('text without a measurer has no frame rather than an estimated one', () => {
    expect(elementFrameFor(text({}), stage)).toBeUndefined()
  })

  it('a shape needs no measurer and is the painter rect', () => {
    const item = { transform: { x: 0.3, y: 0.4, scale: 0.2, rotation: 0.5, anchor: { x: 0.5, y: 0.5 } } } as ActiveShapeClip
    expect(elementFrameFor(item, stage)).toEqual(shapeMaskFrame(item, stage))
  })
})

// PV-P2b: a drawing's box IS its path, so a legacy clip's frame is the geometry
// bounds - where it is actually drawn - and a v2 clip's is the placed rect.
describe('elementFrameFor — freehand (PV-P2b)', () => {
  const P = 'M10 20 L110 20 L110 70 Z'
  const freehand = (over: Partial<ActiveFreehandClip> = {}): ActiveFreehandClip =>
    ({
      id: 'f',
      trackId: 'tr',
      name: 'f',
      type: 'freehand',
      pathData: P,
      strokeColor: '#fff',
      strokeWidth: 4,
      sourceFrame: 0,
      opacity: 1,
      zIndex: 0,
      ...over,
    }) as ActiveFreehandClip

  it('a legacy drawing is framed where it is drawn, whatever its transform says', () => {
    const item = freehand({ transform: { x: 0.9, y: 0.1, scale: 3, rotation: 1, anchor: { x: 0, y: 0 } } })
    expect(freehandFrame(item, stage)).toEqual({ x: 10, y: 20, width: 100, height: 50, rotation: 0 })
    expect(elementFrameFor(item, stage)).toEqual(freehandFrame(item, stage))
  })

  it('a v2 drawing is framed by the transform, and needs no measurer', () => {
    const item = freehand({
      transformModel: 'v2',
      transform: { x: 0.06, y: 0.09, scale: 2, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
    })
    expect(freehandFrame(item, stage)).toEqual({ x: -40, y: -5, width: 200, height: 100, rotation: 0 })
    expect(elementFrameFor(item, stage)).toEqual(freehandFrame(item, stage))
  })

  it('a drawing with no path has no frame', () => {
    expect(freehandFrame(freehand({ pathData: '' }), stage)).toBeUndefined()
    expect(elementFrameFor(freehand({ pathData: '' }), stage)).toBeUndefined()
  })
})
