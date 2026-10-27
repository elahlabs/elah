import { describe, expect, it } from 'vitest'
import {
  cubicBezier,
  formatColor,
  sampleColorChannel,
  setChannelExpression,
  SPRING_PRESETS,
  type BaselineContext,
  type Clip,
  type Keyframe,
  type Project,
} from '@elah/core'
import {
  bezierFromHandle,
  channelLabel,
  colorStripCells,
  curvePath,
  drawerChannels,
  expressionSamples,
  frameToX,
  samplesPath,
  samplesRange,
  segmentHandles,
  snapValue,
  unionRange,
  valueRange,
  valueToY,
  xToFrame,
  yToValue,
  type CurveView,
} from './curves'

const key = (frame: number, value: number, extra: Partial<Keyframe> = {}): Keyframe => ({
  id: `k${frame}`,
  frame,
  value,
  easing: 'linear',
  ...extra,
})

const view: CurveView = { zoom: 4, scrollLeft: 40, height: 200, pad: 10, min: 0, max: 100 }

describe('curve mapping', () => {
  it('frame ↔ x round-trips and matches the timeline lanes', () => {
    expect(frameToX(10, view)).toBe(0)
    expect(xToFrame(frameToX(37, view), view)).toBeCloseTo(37)
  })

  it('value ↔ y round-trips with min at the bottom', () => {
    expect(valueToY(0, view)).toBe(190)
    expect(valueToY(100, view)).toBe(10)
    expect(yToValue(valueToY(42, view), view)).toBeCloseTo(42)
  })
})

describe('valueRange', () => {
  it('pads the key range', () => {
    const r = valueRange([key(0, 0), key(10, 100)])
    expect(r.min).toBeCloseTo(-10)
    expect(r.max).toBeCloseTo(110)
  })

  it('includes an overshoot between keys', () => {
    const r = valueRange([key(0, 0), key(30, 100, { easingBezier: [0.34, 1.56, 0.64, 1] })])
    expect(r.max).toBeGreaterThan(110)
  })

  it('gives a flat channel a window', () => {
    const r = valueRange([key(0, 1), key(10, 1)])
    expect(r.min).toBeLessThan(1)
    expect(r.max).toBeGreaterThan(1)
  })
})

describe('curvePath', () => {
  it('starts at the first key, in timeline coordinates', () => {
    const d = curvePath([key(0, 0), key(20, 100)], 10, 10, 30, view)
    expect(d.startsWith(`M${frameToX(10, view).toFixed(1)},${valueToY(0, view).toFixed(1)}`)).toBe(true)
    expect(d).toContain('L')
  })

  it('is empty with no keys or an empty span', () => {
    expect(curvePath([], 0, 0, 10, view)).toBe('')
    expect(curvePath([key(0, 0)], 0, 5, 5, view)).toBe('')
  })
})

describe('handles', () => {
  it('places handles from the bezier and inverts them', () => {
    const a = key(0, 0)
    const b = key(10, 100, { easingBezier: [0.25, 0.1, 0.25, 1] })
    const h = segmentHandles(a, b)!
    expect(h.h1).toEqual({ frame: 2.5, value: 10 })
    expect(h.h2).toEqual({ frame: 2.5, value: 100 })
    const moved = bezierFromHandle(a, b, 1, 5, 50)!
    expect(moved).toEqual([0.5, 0.5, 0.25, 1])
    // The new curve passes through the evaluator.
    expect(cubicBezier(moved, 0.5)).toBeGreaterThan(0)
  })

  it('clamps x to the segment and allows overshoot in y', () => {
    const a = key(0, 0)
    const b = key(10, 100)
    expect(bezierFromHandle(a, b, 2, 50, 150)).toEqual([0, 0, 1, 1.5])
  })

  it('has no handles on a hold or a flat segment', () => {
    expect(segmentHandles(key(0, 0, { hold: true }), key(10, 5))).toBeNull()
    expect(segmentHandles(key(0, 5), key(10, 5))).toBeNull()
    expect(bezierFromHandle(key(0, 5), key(10, 5), 1, 3, 3)).toBeNull()
  })

  it('a named easing starts from its approximation', () => {
    const h = segmentHandles(key(0, 0), key(10, 10, { easing: 'quad-out' }))!
    expect(h.h1.frame).toBeCloseTo(2.5)
  })
})

// --- Spring segments (PV-P5a) ------------------------------------------------

describe('spring segments draw with no bezier handles', () => {
  const bouncy = SPRING_PRESETS[2].spring // "Bouncy"

  it('has no handles to drag', () => {
    expect(segmentHandles(key(0, 0), key(30, 1, { spring: bouncy }))).toBeNull()
  })

  it('refuses to write a bezier from a handle move', () => {
    // A drag here would otherwise store an easingBezier the sampler ignores,
    // so the spring would look deleted while still playing.
    expect(bezierFromHandle(key(0, 0), key(30, 1, { spring: bouncy }), 1, 5, 0.5)).toBeNull()
  })

  it('still has handles when the spring is invalid', () => {
    // An unreadable spring falls back to the key's curve, which IS drawable.
    const bad = { spring: { stiffness: 'x' } as never, easing: 'quad-out' as const }
    expect(segmentHandles(key(0, 0), key(10, 10, bad))).not.toBeNull()
  })

  it('keeps the overshoot in view', () => {
    // The curve rises above the destination key; if valueRange only considered
    // the key values, the drawer's top would clip the interesting part.
    const r = valueRange([key(0, 0), key(30, 1, { spring: bouncy })])
    expect(r.max).toBeGreaterThan(1.2)
  })

  it('draws a path that rises above the target value', () => {
    const keys = [key(0, 0), key(30, 1, { spring: bouncy })]
    const d = curvePath(keys, 0, 0, 30, view)
    expect(d).not.toBe('')
    // A smaller y means a higher value; the overshoot must be above value 1.
    const ys = [...d.matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map((m) => Number(m[2]))
    expect(Math.min(...ys)).toBeLessThan(valueToY(1, view))
  })
})

describe('labels and snapping', () => {
  const clip = {
    id: 'c',
    trackId: 't',
    type: 'video',
    name: 'v',
    startFrame: 0,
    durationFrames: 10,
    sourceStartFrame: 0,
    sourceDurationFrames: 10,
    effects: [{ id: 'e1', kind: 'gaussianBlur', params: {} }],
  } as unknown as Clip

  it('labels every channel family', () => {
    expect(channelLabel(clip, 'opacity')).toBe('Opacity')
    expect(channelLabel(clip, 'time')).toBe('Time remap')
    expect(channelLabel(clip, 'fx.e1.radius')).toBe('Gaussian blur · Radius')
    expect(channelLabel(clip, 'mask.feather')).toBe('Mask feather')
  })

  it('snaps to a step that fits the range', () => {
    expect(snapValue(0.12345, { min: 0, max: 1 })).toBeCloseTo(0.123)
    expect(snapValue(123.456, { min: 0, max: 1000 })).toBe(123)
  })
})
// --- Expression curves (PV-P5b-3) ------------------------------------------

const CTX: BaselineContext = { stage: { width: 1920, height: 1080 } }

/** A clip starting at frame 100 with `x` keyed 0 -> 1 over 10 frames. */
function exprClip(source?: string, channel: 'x' | 'y' = 'x'): Clip {
  const base = {
    id: 'c1', trackId: 't1', type: 'text', name: 'T', content: 'x',
    startFrame: 100, durationFrames: 20, sourceStartFrame: 0, sourceDurationFrames: 20,
    keyframes: {
      channels: {
        x: { source: { kind: 'keyframes' as const }, keys: [key(0, 0), key(10, 1)] },
      },
    },
  } as unknown as Clip
  if (!source) return base
  return { ...base, ...setChannelExpression(base, channel, source, CTX) }
}

const exprProject = (clip: Clip): Project =>
  ({
    id: 'p', version: 1, fps: 30, stage: { width: 1920, height: 1080 },
    tracks: [{ id: 't1', name: 'T', kind: 'elements', order: 0, height: 54, locked: false, disabled: false, muted: false, solo: false }],
    clips: { t1: [clip] },
    transitions: [],
  }) as unknown as Project

describe('drawerChannels', () => {
  it('lists keyed channels, then expression-only ones', () => {
    // `x` has keys, `y` has only an expression. The drawer must show both: an
    // expression channel with no keys is invisible to allKeyedChannels.
    const c = exprClip('value + 1', 'y')
    expect(drawerChannels(c)).toEqual(['x', 'y'])
  })

  it('does not duplicate a channel that has both keys and an expression', () => {
    const c = exprClip('value + 1', 'x')
    expect(drawerChannels(c)).toEqual(['x'])
  })
})

describe('expressionSamples', () => {
  it('samples every frame of the requested span', () => {
    const c = exprClip('value + 1')
    const s = expressionSamples(exprProject(c), c, 'x', 100, 110)
    expect(s).toHaveLength(11)
    // Halfway along keys 0 -> 1 is 0.5, and the expression adds 1.
    const mid = s.find((p) => p.frame === 105)!
    expect(mid.value).toBeCloseTo(1.5, 10)
  })

  it('honours maxSamples by stepping', () => {
    const c = exprClip('value + 1')
    const s = expressionSamples(exprProject(c), c, 'x', 100, 110, 5)
    expect(s.map((p) => p.frame)).toEqual([100, 102, 104, 106, 108, 110])
  })

  it('is empty for a channel with no expression', () => {
    const c = exprClip()
    expect(expressionSamples(exprProject(c), c, 'x', 100, 110)).toEqual([])
  })

  it('is empty when every frame fails to evaluate', () => {
    const c = exprClip('clip("nobody").x')
    expect(expressionSamples(exprProject(c), c, 'x', 100, 110)).toEqual([])
  })

  it('skips only the frames that fail', () => {
    // `sqrt` of a negative is non-finite, so the middle of the span drops out
    // while the ends survive — a hole in the data, not in the curve.
    const c = exprClip('sqrt(value - 0.5)')
    const s = expressionSamples(exprProject(c), c, 'x', 100, 110)
    expect(s.length).toBeGreaterThan(0)
    expect(s.length).toBeLessThan(11)
  })
})

describe('samplesRange', () => {
  it('is null for no samples', () => {
    expect(samplesRange([])).toBeNull()
  })

  it('gives a flat channel a unit-ish window, like valueRange', () => {
    expect(samplesRange([{ frame: 0, value: 2 }, { frame: 1, value: 2 }])).toEqual({ min: 1.5, max: 2.5 })
  })

  it('pads a varying channel by 10%', () => {
    expect(samplesRange([{ frame: 0, value: 0 }, { frame: 1, value: 10 }])).toEqual({ min: -1, max: 11 })
  })

  it('agrees with valueRange for the same numbers', () => {
    const keys = [key(0, 0), key(10, 1)]
    const samples = [
      { frame: 0, value: 0 },
      { frame: 10, value: 1 },
    ]
    expect(samplesRange(samples)!.min).toBeCloseTo(valueRange(keys).min, 10)
    expect(samplesRange(samples)!.max).toBeCloseTo(valueRange(keys).max, 10)
  })
})

describe('unionRange', () => {
  it('is a unit window when neither range exists', () => {
    expect(unionRange(null, null)).toEqual({ min: 0, max: 1 })
  })

  it('takes the one that exists', () => {
    expect(unionRange({ min: 2, max: 3 }, null)).toEqual({ min: 2, max: 3 })
    expect(unionRange(null, { min: 2, max: 3 })).toEqual({ min: 2, max: 3 })
  })

  it('spans both', () => {
    expect(unionRange({ min: 0, max: 1 }, { min: -1, max: 0.5 })).toEqual({ min: -1, max: 1 })
  })
})

describe('samplesPath', () => {
  it('maps each sample through the same transform and number format', () => {
    // NOT the same string as curvePath: that one samples the curve densely
    // between keys, this one has one point per evaluation. What has to match is
    // the MAPPING and the FORMAT, or the dashed curve will not sit on top of
    // the key curve.
    const samples = [
      { frame: 0, value: 0 },
      { frame: 10, value: 100 },
    ]
    const d = samplesPath(samples, view)
    expect(d).toBe(
      `M${frameToX(0, view).toFixed(1)},${valueToY(0, view).toFixed(1)}` +
        `L${frameToX(10, view).toFixed(1)},${valueToY(100, view).toFixed(1)}`,
    )
    // Same "M x,y L x,y" shape curvePath emits: no space after the comma.
    expect(d).toMatch(/^M-?\d+\.\d,-?\d+\.\dL-?\d+\.\d,-?\d+\.\d$/)
    // And the first point really is the first sample's pixel position.
    expect(d.startsWith(`M${frameToX(0, view).toFixed(1)},`)).toBe(true)
  })

  it('is empty for no samples', () => {
    expect(samplesPath([], view)).toBe('')
  })

  it('emits one point per sample, not a resampled curve', () => {
    const s = [0, 1, 2, 3].map((i) => ({ frame: i, value: i }))
    expect(samplesPath(s, view).split('L')).toHaveLength(4)
  })
})

// PV-P5c-2: the drawer's colour strip — discrete sampled cells, not a curve.
describe('colorStripCells', () => {
  const flatView: Pick<CurveView, 'zoom' | 'scrollLeft'> = { zoom: 1, scrollLeft: 0 }
  const vecKey = (frame: number, vec: number[]): Keyframe => ({ id: `v${frame}`, frame, value: 0, vec, easing: 'linear' })

  it('is empty with no keys, an empty window, or a non-positive cell size', () => {
    expect(colorStripCells([], 0, 0, 100, flatView)).toEqual([])
    const keys = [vecKey(0, [1, 0, 0, 1])]
    expect(colorStripCells(keys, 0, 50, 50, flatView)).toEqual([])
    expect(colorStripCells(keys, 0, 0, 100, flatView, 0)).toEqual([])
  })

  it('tiles the window in cellPx-wide cells, each sampled at its centre', () => {
    const keys = [vecKey(0, [1, 0, 0, 1]), vecKey(100, [0, 0, 1, 1])]
    const cells = colorStripCells(keys, 0, 0, 20, flatView, 10)
    expect(cells).toHaveLength(2)
    expect(cells[0]).toEqual({ x: 0, width: 10, color: formatColor(sampleColorChannel(keys, 5)!) })
    expect(cells[1]).toEqual({ x: 10, width: 10, color: formatColor(sampleColorChannel(keys, 15)!) })
  })

  it('the last cell is clipped to the window instead of overshooting it', () => {
    const keys = [vecKey(0, [1, 0, 0, 1]), vecKey(100, [0, 0, 1, 1])]
    const cells = colorStripCells(keys, 0, 0, 15, flatView, 10)
    expect(cells).toHaveLength(2)
    expect(cells[1]!.width).toBe(5)
  })

  it('clip-relative keys are read through clipStart, matching sampleColorChannel directly', () => {
    const keys = [vecKey(0, [1, 0, 0, 1]), vecKey(20, [0, 1, 0, 1])]
    // The clip starts at absolute frame 100, so absolute frame 110 is local frame 10.
    const cells = colorStripCells(keys, 100, 100, 120, flatView, 20)
    expect(cells).toHaveLength(1)
    expect(cells[0]!.color).toBe(formatColor(sampleColorChannel(keys, 10)!))
  })

  it('honours zoom and scrollLeft the same way frameToX does', () => {
    const keys = [vecKey(0, [1, 0, 0, 1]), vecKey(10, [0, 0, 1, 1])]
    const zoomedView: Pick<CurveView, 'zoom' | 'scrollLeft'> = { zoom: 2, scrollLeft: 5 }
    const cells = colorStripCells(keys, 0, 0, 10, zoomedView, 10)
    // Window [0,10] at zoom 2 is 20px wide starting at x = -5 (frameToX(0) - scrollLeft).
    expect(cells[0]!.x).toBe(frameToX(0, zoomedView))
    expect(cells).toHaveLength(2)
  })
})