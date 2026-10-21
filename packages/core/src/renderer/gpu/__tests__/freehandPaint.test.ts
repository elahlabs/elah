import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveTimeline } from '../../../resolver/resolveTimeline'
import { TimelineEngine } from '../../../editor/TimelineEngine'
import {
  freehandPaintSignature,
  freehandPlacement,
  freehandRestTransform,
  paintFreehand,
  type Freehand2DContext,
} from '../layers/freehandPaint'
import type { ActiveFreehandClip } from '../../../resolver/scene'

/**
 * The shared freehand painter (PV-P2b).
 *
 * Two things are proved. First, that a legacy clip issues EXACTLY the calls it
 * always did - the log is compared element by element, because "a legacy
 * freehand clip issues the identical 2D calls" is only meaningful if the calls
 * are actually identical, and a `save`/`restore` pair appearing for no reason is
 * invisible in a screenshot. Second, that a v2 clip's transform is the image
 * rule, with the path's own bounds as the content box.
 */

const STAGE = { width: 1000, height: 500 }
const P = 'M10 20 L110 20 L110 70 Z'

/** Node has no Path2D; the stub records the string it was handed. */
class Path2DStub {
  constructor(readonly d: string) {}
}

beforeAll(() => {
  ;(globalThis as { Path2D?: unknown }).Path2D = Path2DStub
})
afterAll(() => {
  delete (globalThis as { Path2D?: unknown }).Path2D
})

/** An argument-recording 2D context, as in PV-P2a. */
function recordingContext(): { ctx: Freehand2DContext; log: string[] } {
  const log: string[] = []
  const target: Record<string, unknown> = {}
  for (const name of ['strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha']) {
    Object.defineProperty(target, name, {
      get: () => target[`_${name}`],
      set: (value: unknown) => {
        target[`_${name}`] = value
        log.push(`${name}=${String(value)}`)
      },
      enumerable: true,
    })
  }
  for (const name of ['save', 'restore', 'transform', 'clearRect', 'setTransform']) {
    target[name] = (...args: unknown[]) => {
      log.push(`${name}(${args.join(',')})`)
    }
  }
  target.stroke = (path: unknown) => {
    log.push(`stroke(${(path as Path2DStub).d})`)
  }
  return { ctx: target as unknown as Freehand2DContext, log }
}

function item(over: Partial<ActiveFreehandClip> = {}): ActiveFreehandClip {
  return {
    id: 'f',
    trackId: 'tr',
    name: 'f',
    type: 'freehand',
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
    pathData: P,
    strokeColor: '#fff',
    strokeWidth: 4,
    ...over,
  } as ActiveFreehandClip
}

function paintLog(over: Partial<ActiveFreehandClip>): string[] {
  const { ctx, log } = recordingContext()
  paintFreehand(ctx, item(over), STAGE)
  return log
}

describe('paintFreehand — legacy parity', () => {
  it('a legacy clip with a transform still ignores it, call for call', () => {
    // The transform is deliberately extreme: an implementation that started
    // reading it for a legacy clip would produce a wildly different log.
    const log = paintLog({
      transform: { x: 0.9, y: 0.1, scale: 3, rotation: 1, anchor: { x: 0, y: 0 } },
    })
    expect(log).toEqual([
      'strokeStyle=#fff',
      'lineWidth=4',
      'lineCap=round',
      'lineJoin=round',
      `stroke(${P})`,
    ])
  })

  it('a v2 clip with no transform paints the same as a legacy one', () => {
    const legacy = paintLog({})
    const v2 = paintLog({ transformModel: 'v2' })
    expect(v2).toEqual(legacy)
  })

  it('an empty path paints nothing at all', () => {
    expect(paintLog({ pathData: '' })).toEqual([])
  })
})

describe('freehandPlacement', () => {
  it('is undefined for anything that has no placement to make', () => {
    expect(freehandPlacement(item({}), STAGE)).toBeUndefined()
    expect(freehandPlacement(item({ transformModel: 'v2' }), STAGE)).toBeUndefined()
    expect(
      freehandPlacement(item({ transformModel: 'v2', pathData: '', transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } } }), STAGE),
    ).toBeUndefined()
  })

  it('the rest transform is the path box centre, and it reproduces the drawing', () => {
    const rest = freehandRestTransform({ x: 10, y: 20, width: 100, height: 50 }, STAGE)
    expect(rest.x).toBeCloseTo(0.06, 9)
    expect(rest.y).toBeCloseTo(0.09, 9)
    expect(rest.scale).toBe(1)
    expect(rest.rotation).toBe(0)

    const placed = freehandPlacement(item({ transformModel: 'v2', transform: rest }), STAGE)!
    expect(placed.bounds).toEqual({ x: 10, y: 20, width: 100, height: 50 })
    expect(placed.rect.x).toBeCloseTo(10, 9)
    expect(placed.rect.y).toBeCloseTo(20, 9)
    expect(placed.rect.width).toBeCloseTo(100, 9)
    expect(placed.rect.height).toBeCloseTo(50, 9)
    // Identity: the drawing stays exactly where it was drawn.
    placed.matrix.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 1, 0, 0][i]!, 9))
  })

  it('anchors the box at the anchor point', () => {
    const placed = freehandPlacement(
      item({
        transformModel: 'v2',
        transform: { x: 0, y: 0, scale: 1, rotation: 0, anchor: { x: 0, y: 0 } },
      }),
      STAGE,
    )!
    expect(placed.rect.x).toBeCloseTo(0, 9)
    expect(placed.rect.y).toBeCloseTo(0, 9)
    // The path's own (10,20) has to move to the anchor, hence the offset.
    placed.matrix.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 1, -10, -20][i]!, 9))
  })

  it('rotates about the placed box centre', () => {
    const rest = freehandRestTransform({ x: 10, y: 20, width: 100, height: 50 }, STAGE)
    const placed = freehandPlacement(
      item({ transformModel: 'v2', transform: { ...rest, rotation: Math.PI / 2 } }),
      STAGE,
    )!
    placed.matrix.forEach((v, i) => expect(v).toBeCloseTo([0, 1, -1, 0, 105, -15][i]!, 6))
  })

  it('scales about the placed box centre', () => {
    const rest = freehandRestTransform({ x: 10, y: 20, width: 100, height: 50 }, STAGE)
    const placed = freehandPlacement(item({ transformModel: 'v2', transform: { ...rest, scale: 2 } }), STAGE)!
    placed.matrix.forEach((v, i) => expect(v).toBeCloseTo([2, 0, 0, 2, -60, -45][i]!, 9))
    expect(placed.rect.x).toBeCloseTo(-40, 9)
    expect(placed.rect.y).toBeCloseTo(-5, 9)
    expect(placed.rect.width).toBeCloseTo(200, 9)
    expect(placed.rect.height).toBeCloseTo(100, 9)
  })

  it('stretches with scaleX/scaleY, multiplying the scale', () => {
    const rest = freehandRestTransform({ x: 10, y: 20, width: 100, height: 50 }, STAGE)
    const placed = freehandPlacement(
      item({ transformModel: 'v2', transform: { ...rest, scale: 2, scaleX: 3, scaleY: 0.5 } }),
      STAGE,
    )!
    expect(placed.rect.width).toBeCloseTo(100 * 2 * 3, 9)
    expect(placed.rect.height).toBeCloseTo(50 * 2 * 0.5, 9)
  })
})

describe('paintFreehand — v2', () => {
  it('wraps the stroke in the placement matrix', () => {
    const rest = freehandRestTransform({ x: 10, y: 20, width: 100, height: 50 }, STAGE)
    const { ctx, log } = recordingContext()
    paintFreehand(ctx, item({ transformModel: 'v2', transform: rest }), STAGE)
    expect(log[0]).toBe('strokeStyle=#fff')
    expect(log[4]).toBe('save()')
    expect(log[5]).toMatch(/^transform\(1,0,0,1,[01](?:\.\d+)?,-?[01]/)
    expect(log[6]).toBe(`stroke(${P})`)
    expect(log[7]).toBe('restore()')
  })
})

describe('freehandPaintSignature', () => {
  const t = { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }

  it('separates a v2 clip from a legacy one', () => {
    const legacy = freehandPaintSignature(item({ transform: t }), STAGE)
    const v2 = freehandPaintSignature(item({ transform: t, transformModel: 'v2' }), STAGE)
    expect(v2).not.toBe(legacy)
  })

  it('changes when a v2 clip moves, and not when a legacy one does', () => {
    const v2a = freehandPaintSignature(item({ transform: t, transformModel: 'v2' }), STAGE)
    const v2b = freehandPaintSignature(item({ transform: { ...t, x: 0.6 }, transformModel: 'v2' }), STAGE)
    expect(v2b).not.toBe(v2a)
    // Two legacy clips differing only in a transform nothing reads are equal.
    expect(freehandPaintSignature(item({ transform: { ...t, x: 0.6 } }), STAGE)).toBe(
      freehandPaintSignature(item({ transform: t }), STAGE),
    )
  })
})

describe('the factory and the resolver (PV-P2b wiring)', () => {
  it('a new freehand clip is v2, and clearing it is a legacy clip again', () => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1000, height: 500 } })
    const track = engine.addTrack('elements')
    const clip = engine.addClip({
      type: 'freehand',
      freehand: { pathData: P },
      trackId: track.id,
      startFrame: 0,
      durationFrames: 10,
    })
    expect(resolveTimeline(0, engine.getProject()).freehand[0]!.transformModel).toBe('v2')

    engine.updateClip(clip.id, track.id, { transformModel: undefined })
    expect('transformModel' in resolveTimeline(0, engine.getProject()).freehand[0]!).toBe(false)
  })
})
