import { describe, it, expect } from 'vitest'
import { resolveTimeline } from './resolveTimeline'
import { projectUsesLayout } from './layout'
import { REGIONS } from '../ops/types'
import type { Clip, LayoutRegion, Project, Track, Transform } from '../types'
import type { TextMeasurer } from '../renderer/gpu/layers/textMeasure'

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

/** A rect shape, one clip per its own elements track. Default transform: (0.5, 0.5), scale 0.2 — a 100x100 box centred at (500, 250). */
function shapeClip(id: string, overrides?: Partial<Clip>): Clip {
  return makeClip({
    id,
    trackId: id,
    type: 'shape',
    shapeKind: 'rect',
    transform: { x: 0.5, y: 0.5, scale: 0.2, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
    ...overrides,
  })
}

/** A legacy text clip (no `transform`, no `transformModel`). */
function textClip(id: string, overrides?: Partial<Clip>): Clip {
  return makeClip({
    id,
    trackId: id,
    type: 'text',
    content: 'HELLO',
    fontSize: 40,
    ...overrides,
  })
}

/** A project with one elements track per clip, in the given (= scene) order. */
function projectOf(clips: Clip[], overrides?: Partial<Project>): Project {
  const tracks = clips.map((c, i) => makeTrack({ id: c.trackId, order: i }))
  const byTrack: Record<string, Clip[]> = {}
  for (const c of clips) byTrack[c.trackId] = [c]
  return makeProject({ tracks, clips: byTrack, ...overrides })
}

/** The width-aware double from the ticket: 10 stage px per character. */
const MEASURE: TextMeasurer = {
  measure: (_font, text) => ({ width: text.length * 10, ascent: 0, descent: 0 }),
}

describe('types', () => {
  it('LayoutRegion is a compile-time superset of every ops Region, plus the two safe areas', () => {
    const all: LayoutRegion[] = [...REGIONS, 'safe-title', 'safe-action']
    expect(all).toHaveLength(13)
  })
})

describe('graph', () => {
  it('(1) a project without layout resolves to the identical scene, with or without a measurer', () => {
    const a = shapeClip('A')
    const p = projectOf([a])
    const withMeasure = resolveTimeline(5, p, { measure: MEASURE })
    const without = resolveTimeline(5, p)
    expect(withMeasure).toEqual(without)
    expect('layoutErrors' in without).toBe(false)
  })

  it('(2) a mutual cycle is reported for both clips and leaves them unchanged', () => {
    const a = shapeClip('A', { layout: { anchorTo: { clip: 'B', edge: 'bottom' } } })
    const b = shapeClip('B', { layout: { anchorTo: { clip: 'A', edge: 'bottom' } } })
    const p = projectOf([a, b])
    const scene = resolveTimeline(5, p)
    expect(scene.layoutErrors).toEqual([
      { clipId: 'A', reason: 'cycle' },
      { clipId: 'B', reason: 'cycle' },
    ])
    expect(scene.shapes.find((s) => s.id === 'A')!.transform).toEqual(a.transform)
    expect(scene.shapes.find((s) => s.id === 'B')!.transform).toEqual(b.transform)
  })

  it('(2b) a clip anchored to itself is its own cycle', () => {
    const a = shapeClip('A', { layout: { anchorTo: { clip: 'A', edge: 'bottom' } } })
    const scene = resolveTimeline(5, projectOf([a]))
    expect(scene.layoutErrors).toEqual([{ clipId: 'A', reason: 'cycle' }])
  })

  it('(3) a missing target is reported once and the clip is left unchanged', () => {
    const a = shapeClip('A', { layout: { anchorTo: { clip: 'nope', edge: 'bottom' } } })
    const scene = resolveTimeline(5, projectOf([a]))
    expect(scene.layoutErrors).toEqual([{ clipId: 'A', reason: 'missing-target' }])
    expect(scene.shapes[0].transform).toEqual(a.transform)
  })

  it('(4a) an active image clip with layout is unsupported', () => {
    const img = makeClip({ id: 'I', trackId: 'I', type: 'image', src: 'a.png', layout: { region: 'top-left' } })
    const track = makeTrack({ id: 'I', kind: 'video' })
    const p = makeProject({ tracks: [track], clips: { I: [img] } })
    const scene = resolveTimeline(5, p)
    expect(scene.layoutErrors).toEqual([{ clipId: 'I', reason: 'unsupported' }])
  })

  it('(4b) a legacy freehand with layout is unsupported', () => {
    const fh = makeClip({ id: 'F', trackId: 'F', type: 'freehand', pathData: 'M0 0 L10 10', layout: { region: 'center' } })
    const scene = resolveTimeline(5, projectOf([fh]))
    expect(scene.layoutErrors).toEqual([{ clipId: 'F', reason: 'unsupported' }])
  })

  it('(4c) fitTo on a non-shape is unsupported', () => {
    const x = shapeClip('X')
    const t = textClip('T', { layout: { fitTo: { clip: 'X' } } })
    const scene = resolveTimeline(5, projectOf([t, x]))
    expect(scene.layoutErrors).toEqual([{ clipId: 'T', reason: 'unsupported' }])
  })

  it('(4d) anchoring to an unframeable target is unsupported on the REFERENCING clip', () => {
    const img = makeClip({ id: 'I', trackId: 'I', type: 'image', src: 'a.png' })
    const a = shapeClip('A', { layout: { anchorTo: { clip: 'I', edge: 'bottom' } } })
    const trackI = makeTrack({ id: 'I', kind: 'video' })
    const trackA = makeTrack({ id: 'A', order: 1 })
    const p = makeProject({ tracks: [trackI, trackA], clips: { I: [img], A: [a] } })
    const scene = resolveTimeline(5, p)
    expect(scene.layoutErrors).toEqual([{ clipId: 'A', reason: 'unsupported' }])
  })
})

describe('placement maths', () => {
  /** A's own box before layout, at B's twin transform: box (450, 200, 100, 100). */
  function regionResult(region: LayoutRegion, transformOverrides?: Partial<Transform>): Transform {
    const a = shapeClip('A', {
      transform: { x: 0.5, y: 0.5, scale: 0.2, rotation: 0, anchor: { x: 0.5, y: 0.5 }, ...transformOverrides },
      layout: { region },
    })
    return resolveTimeline(5, projectOf([a])).shapes[0].transform!
  }

  it('(5) region placement', () => {
    const topLeft = regionResult('top-left')
    expect(topLeft.x).toBeCloseTo(0.1, 6)
    expect(topLeft.y).toBeCloseTo(0.15, 6)

    const bottomRight = regionResult('bottom-right')
    expect(bottomRight.x).toBeCloseTo(0.9, 6)
    expect(bottomRight.y).toBeCloseTo(0.85, 6)

    const lowerThird = regionResult('lower-third')
    expect(lowerThird.x).toBeCloseTo(0.5, 6)
    expect(lowerThird.y).toBeCloseTo(0.8, 6)

    const safeTitle = regionResult('safe-title', { x: 0.98 })
    expect(safeTitle.x).toBeCloseTo(0.9, 6)
    expect(safeTitle.y).toBeCloseTo(0.5, 6)
  })

  it('(6) pin placement', () => {
    const rightBottom = shapeClip('A', { layout: { pin: { right: 20, bottom: 10 } } })
    const t1 = resolveTimeline(5, projectOf([rightBottom])).shapes[0].transform!
    expect(t1.x).toBeCloseTo(0.93, 6)
    expect(t1.y).toBeCloseTo(0.88, 6)

    const left = shapeClip('A', { layout: { pin: { left: 0 } } })
    const t2 = resolveTimeline(5, projectOf([left])).shapes[0].transform!
    expect(t2.x).toBeCloseTo(0.05, 6)
    expect(t2.y).toBeCloseTo(0.5, 6)
  })

  /** A scale 0.1 (side 50) anchored to B (default twin: box 450, 200, 100, 100). */
  function anchorResult(anchorTo: NonNullable<Clip['layout']>['anchorTo']): Transform {
    const b = shapeClip('B')
    const a = shapeClip('A', {
      trackId: 'A',
      transform: { x: 0.5, y: 0.5, scale: 0.1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      layout: { anchorTo },
    })
    const scene = resolveTimeline(5, projectOf([a, b]))
    return scene.shapes.find((s) => s.id === 'A')!.transform!
  }

  it('(7) anchorTo placement', () => {
    const bottomStart = anchorResult({ clip: 'B', edge: 'bottom', align: 'start', gap: 10 })
    expect(bottomStart.x).toBeCloseTo(0.475, 6)
    expect(bottomStart.y).toBeCloseTo(0.67, 6)

    const right = anchorResult({ clip: 'B', edge: 'right' })
    expect(right.x).toBeCloseTo(0.575, 6)
    expect(right.y).toBeCloseTo(0.5, 6)

    const topEnd = anchorResult({ clip: 'B', edge: 'top', align: 'end', gap: 5 })
    expect(topEnd.x).toBeCloseTo(0.525, 6)
    expect(topEnd.y).toBeCloseTo(0.34, 6)

    const leftStart = anchorResult({ clip: 'B', edge: 'left', align: 'start' })
    expect(leftStart.x).toBeCloseTo(0.425, 6)
    expect(leftStart.y).toBeCloseTo(0.45, 6)
  })

  it('(8) precedence: anchorTo wins over region, and pin wins over region', () => {
    const b = shapeClip('B')
    const a = shapeClip('A', {
      trackId: 'A',
      transform: { x: 0.5, y: 0.5, scale: 0.1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      layout: { region: 'top-left', anchorTo: { clip: 'B', edge: 'bottom', align: 'start', gap: 10 } },
    })
    const scene = resolveTimeline(5, projectOf([a, b]))
    const t = scene.shapes.find((s) => s.id === 'A')!.transform!
    expect(t.x).toBeCloseTo(0.475, 6)
    expect(t.y).toBeCloseTo(0.67, 6)

    const a2 = shapeClip('A', { layout: { region: 'top-left', pin: { left: 0 } } })
    const t2 = resolveTimeline(5, projectOf([a2])).shapes[0].transform!
    expect(t2.x).toBeCloseTo(0.05, 6)
    expect(t2.y).toBeCloseTo(0.15, 6)
  })

  it('(9) a layout can chain through another laid-out clip, regardless of scene order', () => {
    const b = shapeClip('B')
    const a = shapeClip('A', {
      trackId: 'A',
      transform: { x: 0.5, y: 0.5, scale: 0.1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      layout: { anchorTo: { clip: 'B', edge: 'bottom', align: 'start', gap: 10 } },
    })
    const c = shapeClip('C', {
      trackId: 'C',
      transform: { x: 0.5, y: 0.5, scale: 0.1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      layout: { anchorTo: { clip: 'A', edge: 'bottom' } },
    })
    // C's track is listed FIRST — before A, the clip it (transitively) depends on.
    const scene = resolveTimeline(5, projectOf([c, a, b]))
    const ct = scene.shapes.find((s) => s.id === 'C')!.transform!
    expect(ct.x).toBeCloseTo(0.475, 6)
    expect(ct.y).toBeCloseTo(0.77, 6)
  })

  it('(10) fitTo grows a shape to its target text box, padded, in the target rotation', () => {
    const t = textClip('T')
    const s = shapeClip('S', {
      trackId: 'S',
      transform: { x: 0.1, y: 0.1, scale: 0.5, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      layout: { fitTo: { clip: 'T', padding: 10 } },
    })
    const scene = resolveTimeline(5, projectOf([s, t]), { measure: MEASURE })
    const st = scene.shapes.find((x) => x.id === 'S')!.transform!
    expect(st.x).toBeCloseTo(0.5, 6)
    expect(st.y).toBeCloseTo(0.5, 6)
    expect(st.scaleX).toBeCloseTo(0.28, 6)
    expect(st.scaleY).toBeCloseTo(0.272, 6)
    expect(st.rotation).toBeCloseTo(0, 6)

    const t2 = textClip('T', { transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0.3, anchor: { x: 0.5, y: 0.5 } } })
    const s2 = shapeClip('S', {
      trackId: 'S',
      transform: { x: 0.1, y: 0.1, scale: 0.5, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      layout: { fitTo: { clip: 'T', padding: 10 } },
    })
    const scene2 = resolveTimeline(5, projectOf([s2, t2]), { measure: MEASURE })
    const st2 = scene2.shapes.find((x) => x.id === 'S')!.transform!
    expect(st2.rotation).toBeCloseTo(0.3, 6)
  })

  it('(11) a text region constraint is skipped without a measurer, and applied with one', () => {
    const a = textClip('A', { layout: { region: 'top-left' } })
    const p = projectOf([a])

    const withoutMeasure = resolveTimeline(5, p)
    expect(withoutMeasure.texts[0].transform).toEqual(a.transform)
    expect('layoutErrors' in withoutMeasure).toBe(false)

    const withMeasure = resolveTimeline(5, p, { measure: MEASURE })
    expect(withMeasure.texts[0].transform!.x).toBeCloseTo(0.075, 6)
    expect(withMeasure.texts[0].transform!.y).toBeCloseTo(0.098, 6)
  })
})

describe('composition order', () => {
  it('(12) a keyed channel wins over the laid-out base on its own axis; the other axis stays laid out', () => {
    const b = shapeClip('B')
    const a = shapeClip('A', {
      trackId: 'A',
      transform: { x: 0.5, y: 0.5, scale: 0.1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      layout: { anchorTo: { clip: 'B', edge: 'bottom', align: 'start', gap: 10 } },
      keyframes: {
        channels: {
          x: { source: { kind: 'keyframes' }, keys: [{ id: 'k', frame: 0, value: 0.2, easing: 'linear' }] },
        },
      },
    })
    const scene = resolveTimeline(5, projectOf([a, b]))
    const t = scene.shapes.find((s) => s.id === 'A')!.transform!
    expect(t.x).toBeCloseTo(0.2, 6)
    expect(t.y).toBeCloseTo(0.67, 6)
  })

  it('(13) entry motion applies on top of the laid-out base, and settles once its ramp ends', () => {
    const b = shapeClip('B')
    const a = shapeClip('A', {
      trackId: 'A',
      transform: { x: 0.5, y: 0.5, scale: 0.1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      layout: { anchorTo: { clip: 'B', edge: 'bottom', align: 'start', gap: 10 } },
      shapeAnimation: { durationFrames: 10, inMotion: { offsetY: 0.1 } },
    })
    const p = projectOf([a, b])
    const at0 = resolveTimeline(0, p).shapes.find((s) => s.id === 'A')!.transform!
    const at20 = resolveTimeline(20, p).shapes.find((s) => s.id === 'A')!.transform!
    expect(at0.y).toBeCloseTo(0.77, 2)
    expect(at20.y).toBeCloseTo(0.67, 6)
  })

  it('(14) projectUsesLayout reports whether any clip carries layout', () => {
    const p1 = projectOf([shapeClip('A')])
    expect(projectUsesLayout(p1)).toBe(false)

    const b = shapeClip('B')
    const a = shapeClip('A', {
      trackId: 'A',
      transform: { x: 0.5, y: 0.5, scale: 0.1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      layout: { anchorTo: { clip: 'B', edge: 'bottom', align: 'start', gap: 10 } },
    })
    const p2 = projectOf([a, b])
    expect(projectUsesLayout(p2)).toBe(true)
  })
})
