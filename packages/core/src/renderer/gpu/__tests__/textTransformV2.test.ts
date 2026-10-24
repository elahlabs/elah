import { describe, expect, it } from 'vitest'
import { createClip } from '../../../elements/base'
import { resolveTimeline } from '../../../resolver/resolveTimeline'
import { TimelineEngine } from '../../../editor/TimelineEngine'
import { paintText, textPaintSignature } from '../layers/textPaint'
import { blockCenter } from '../layers/textLayout'
import type { ActiveTextClip } from '../../../resolver/scene'

/**
 * Text transform model v2 (PV-P2a).
 *
 * Two things are being proved here, and the second is the important one. The
 * first is that a new text clip asks for v2 and the resolver carries the
 * request. The second is that a clip which does NOT ask for it - every stored
 * document in existence - goes down exactly the path it always did, down to the
 * last decimal of the `fillText` arguments. That is what the legacy-parity
 * matrix in the second describe is for.
 */

describe('v2 model', () => {
  it('a text clip made by the factory is v2', () => {
    const clip = createClip({
      type: 'text',
      trackId: 't',
      startFrame: 0,
      durationFrames: 10,
      text: { content: 'x' },
    })
    expect(clip.transformModel).toBe('v2')
  })

  it('a shape is not, and does not gain the key at all', () => {
    const clip = createClip({
      type: 'shape',
      trackId: 't',
      startFrame: 0,
      durationFrames: 10,
      shape: { shapeKind: 'rect' },
    })
    expect('transformModel' in clip).toBe(false)
  })

  it('the resolver carries it, and a legacy clip keeps no key', () => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1000, height: 500 } })
    const track = engine.addTrack('elements')
    const clip = engine.addClip({
      type: 'text',
      text: { content: 'hello' },
      trackId: track.id,
      startFrame: 0,
      durationFrames: 10,
    })

    expect(resolveTimeline(0, engine.getProject()).texts[0]!.transformModel).toBe('v2')

    // Cleared, the clip is a legacy one again - and 'absent' must stay absent
    // rather than becoming `undefined` on the Active object, because the
    // renderer branches on the field existing.
    engine.updateClip(clip.id, track.id, { transformModel: undefined })
    expect('transformModel' in resolveTimeline(0, engine.getProject()).texts[0]!).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Layout and painting
// ---------------------------------------------------------------------------

const STAGE = { width: 1000, height: 500 }
const CONTENT = 'HELLO BIG WORLD'

/**
 * A 2D context that records every call and every property set, so "identical
 * calls with identical arguments" is a comparison of two arrays of strings
 * rather than of pixels. The painter draws the panel with moveTo/arcTo/fill, not
 * fillRect, so the shape methods are here too.
 */
function recordingContext(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = []
  const properties = [
    'font',
    'fillStyle',
    'strokeStyle',
    'lineWidth',
    'lineJoin',
    'textAlign',
    'textBaseline',
    'globalAlpha',
    'shadowColor',
    'shadowBlur',
    'shadowOffsetX',
    'shadowOffsetY',
  ]
  const target: Record<string, unknown> = {}
  for (const name of properties) {
    Object.defineProperty(target, name, {
      get: () => target[`_${name}`],
      set: (value: unknown) => {
        target[`_${name}`] = value
        log.push(`${name}=${String(value)}`)
      },
      enumerable: true,
    })
  }
  for (const name of [
    'save',
    'restore',
    'translate',
    'rotate',
    'scale',
    'beginPath',
    'moveTo',
    'arcTo',
    'closePath',
    'fill',
    'stroke',
    'fillText',
    'strokeText',
    'rect',
    'clip',
  ]) {
    target[name] = (...args: unknown[]) => {
      log.push(`${name}(${args.join(',')})`)
    }
  }
  target.measureText = (text: string) => ({ width: text.length * 10 }) as TextMetrics
  return { ctx: target as unknown as CanvasRenderingContext2D, log }
}

function paintLog(item: Partial<ActiveTextClip>): string[] {
  const { ctx, log } = recordingContext()
  paintText(ctx, base(item), STAGE)
  return log
}

function base(over: Partial<ActiveTextClip> = {}): ActiveTextClip {
  return {
    id: 't',
    trackId: 'tr',
    name: 't',
    type: 'text',
    content: CONTENT,
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
    ...over,
  } as ActiveTextClip
}

/** The factory's v2 clip, as a transform for tests that author one directly. */
const V2_AT = (x: number, y: number, over: Record<string, number> = {}) => ({
  x,
  y,
  scale: 1,
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  ...over,
})

describe('legacy parity', () => {
  // Ten ways a text clip can be authored, none of them opting into v2. Each must
  // paint exactly what it painted before this ticket - the same calls, the same
  // arguments, in the same order - whether or not it is handed to the v2 branch.
  const FIXTURES: Array<[string, Partial<ActiveTextClip>]> = [
    ['bare', {}],
    ['left aligned', { textAlign: 'left' }],
    ['right aligned', { textAlign: 'right' }],
    ['wrapping', { content: Array(40).fill('word').join(' ') }],
    [
      'rotated',
      { transform: { x: 0.3, y: 0.7, scale: 1, rotation: 0.4, anchor: { x: 0.5, y: 0.5 } } },
    ],
    [
      'scaled and rotated',
      { transform: { x: 0.3, y: 0.7, scale: 1.5, rotation: 0.4, anchor: { x: 0.5, y: 0.5 } } },
    ],
    [
      'panel',
      {
        backgroundColor: '#000',
        backgroundOpacity: 0.5,
        padding: 12,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: '#fff',
      },
    ],
    [
      'outline and shadow',
      {
        textOutline: { color: '#000', width: 3 },
        textShadow: { color: '#000', blur: 4, offsetX: 1, offsetY: 2 },
      },
    ],
    [
      'animated',
      {
        textAnimator: { unit: 'word', preset: 'pop', staggerFrames: 3, durationFrames: 6 },
        localFrame: 4,
      },
    ],
    [
      'explicit identity transform',
      {
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 }, scaleX: 1, scaleY: 1 },
      },
    ],
  ]

  for (const [name, fixture] of FIXTURES) {
    it(`a ${name} clip paints identically under v2 at the default anchor`, () => {
      const legacy = paintLog(fixture)
      const asV2 = paintLog({
        ...fixture,
        transformModel: 'v2',
        transform: fixture.transform ?? { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      })
      expect(asV2).toEqual(legacy)
    })
  }

  it('a legacy clip ignores scaleX and scaleY, and anchor', () => {
    // The field the legacy model never read. Painting it must change nothing -
    // which is also why `ctx.scale` may never be called for such a clip.
    const plain = paintLog({ transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0, y: 0 } } })
    const stretched = paintLog({
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0, y: 0 }, scaleX: 2 },
    })
    expect(stretched).toEqual(plain)
    expect(stretched.some((line) => line.startsWith('scale('))).toBe(false)
  })
})

describe('v2 placement', () => {
  it('x/y names the anchor point of the padded box', () => {
    // Anchored top-left at the stage centre: the 150 x 57.6 block hangs down and
    // right from it, so the line is drawn to the lower-right of the centre.
    // Legacy would draw it at (500, 250).
    const log = paintLog({ transformModel: 'v2', transform: { ...V2_AT(0.5, 0.5), anchor: { x: 0, y: 0 } } })
    const call = log.find((line) => line.startsWith('fillText('))
    expect(call).toBeDefined()
    // The content itself contains spaces, so the coordinates are read off the
    // end rather than by splitting the whole line.
    const [, x, y] = call!.match(/,(-?[\d.]+),(-?[\d.]+)\)$/)!
    expect(Number(x)).toBeCloseTo(575, 6)
    expect(Number(y)).toBeCloseTo(278.8, 6)
  })

  it('stretches about the centre, after any rotation', () => {
    const log = paintLog({ transformModel: 'v2', transform: V2_AT(0.5, 0.5, { scaleX: 2 }) })
    const order = log.filter((line) => /^(translate|rotate|scale)\(/.test(line))
    expect(order.slice(0, 3)).toEqual(['translate(500,250)', 'scale(2,1)', 'translate(-500,-250)'])
    expect(log).toContain(`fillText(${CONTENT},500,250)`)
  })

  it('rotates before it stretches, both about the block centre', () => {
    const log = paintLog({ transformModel: 'v2', transform: V2_AT(0.5, 0.5, { scaleX: 2, rotation: 0.3 }) })
    const order = log.filter((line) => /^(translate|rotate|scale)\(/.test(line))
    expect(order.slice(0, 4)).toEqual([
      'translate(500,250)',
      'rotate(0.3)',
      'scale(2,1)',
      'translate(-500,-250)',
    ])
  })

  it('writes the model and its anchor into the paint signature', () => {
    const legacy = textPaintSignature(base({ transform: V2_AT(0.5, 0.5) }), STAGE)
    const v2 = textPaintSignature(base({ transformModel: 'v2', transform: V2_AT(0.5, 0.5) }), STAGE)
    expect(v2).not.toBe(legacy)
    // Two anchors on the same v2 clip paint differently, so they must not share
    // a signature.
    const corner = textPaintSignature(
      base({ transformModel: 'v2', transform: { ...V2_AT(0.5, 0.5), anchor: { x: 0, y: 0 } } }),
      STAGE,
    )
    const far = textPaintSignature(
      base({ transformModel: 'v2', transform: { ...V2_AT(0.5, 0.5), anchor: { x: 1, y: 1 } } }),
      STAGE,
    )
    expect(corner).not.toBe(far)
    // Legacy clips differ only in an anchor they never read, so they are equal.
    const legacyCorner = textPaintSignature(
      base({ transform: { ...V2_AT(0.5, 0.5), anchor: { x: 0, y: 0 } } }),
      STAGE,
    )
    const legacyFar = textPaintSignature(
      base({ transform: { ...V2_AT(0.5, 0.5), anchor: { x: 1, y: 1 } } }),
      STAGE,
    )
    expect(legacyCorner).toBe(legacyFar)
  })
})

describe('blockCenter', () => {
  it('is the legacy value exactly when the anchor is centred', () => {
    // `toBe`, not `toBeCloseTo`: the default-anchor case has to be the same
    // double, or a v2 title drawn on an existing project moves in the last
    // decimal and the golden hashes drift.
    const result = blockCenter(
      { transform: { ...V2_AT(0.3, 0.7), anchor: { x: 0.5, y: 0.5 } }, transformModel: 'v2' },
      STAGE,
      123.4,
      56.7,
    )
    expect(result.center.x).toBe(0.3)
    expect(result.center.y).toBe(0.7)
    expect(result.stretch).toBeUndefined()
  })

  it('offsets the centre for any other anchor, and reports the stretch', () => {
    const result = blockCenter(
      { transform: { ...V2_AT(0.5, 0.5), anchor: { x: 0, y: 0 }, scaleX: 2, scaleY: 0.5 }, transformModel: 'v2' },
      STAGE,
      200,
      100,
    )
    // A 200 x 100 box anchored top-left, stretched to 400 x 50: its half-extent
    // is 200 x 25 px, which is 0.2 and 0.05 of the stage, so the centre sits
    // that far below and right of the anchor point.
    expect(result.center.x).toBeCloseTo(0.7, 9)
    expect(result.center.y).toBeCloseTo(0.55, 9)
    expect(result.stretch).toEqual({ x: 2, y: 0.5 })
  })

  it('ignores the model for a legacy clip', () => {
    const result = blockCenter({ transform: { ...V2_AT(0.2, 0.4), anchor: { x: 0, y: 0 }, scaleX: 3 } }, STAGE, 200, 100)
    expect(result.center).toEqual({ x: 0.2, y: 0.4 })
    expect(result.stretch).toBeUndefined()
  })
})
