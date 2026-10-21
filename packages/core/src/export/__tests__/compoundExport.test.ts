/**
 * PV-P1b-1 step 2 — the flat-paint gate.
 *
 * Step 3 of this ticket turns `renderFrame`'s inline body into a recursive
 * `paintScene(scene, env, target, depth, path)`. Before that happens, this file
 * pins what the CURRENT flat body paints, so the extraction can be proved to
 * have changed nothing for a project with no compound clips.
 *
 * The gate is an ordered call list, not pixels. `renderFrame` receives its
 * context and its scene as parameters, so the whole paint path is reachable
 * in-process: a Proxy context records every 2D call the painters make, and
 * each clip is given distinctive geometry so the log identifies which clip
 * painted where. With `gpu: null` and no transitions the flat path allocates
 * no OffscreenCanvas at all, so no canvas, WebCodecs or network stub is needed.
 *
 * What this deliberately does NOT cover: mattes, transitions, adjustment
 * clips, blend modes and the GPU effect path all need real OffscreenCanvas /
 * WorkerEffectRenderer doubles and are asserted in step 3 alongside the
 * nesting work. It covers the plain ordered walk, which is the thing the
 * extraction is most likely to break.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { MAX_COMPOUND_DEPTH } from '../../types'
import { resolveDrawRect } from '../../renderer/gpu/layers/drawRect'
import type {
  Scene,
  ActiveShapeClip,
  ActiveFreehandClip,
  ActiveCompoundClip,
  ActiveVideoClip,
} from '../../resolver/scene'

// mediabunny is only used by runExport (muxing) and as a type namespace here.
// The tests never mux, and the real module reaches for WebCodecs on import.
vi.mock('mediabunny', () => ({}))

// ---------------------------------------------------------------------------
// Loading the worker module
//
// `ExportWorker.ts` installs its `onmessage` entry point only when it is really
// inside a WorkerGlobalScope, so importing it here — or from a page — is inert.
// That guard is asserted by the ABSENCE of any `self` stub in this file: if the
// module still needed one, the import would throw.
//
// `Path2D` matters just as much: `paintFreehand` calls
// `ctx.stroke(new Path2D(pathData))` inside a `try {} catch {}` documented as
// "invalid pathData — render nothing". With no `Path2D` global the
// ReferenceError lands in that catch and every freehand clip paints NOTHING,
// silently. Without this stub the baseline below would enshrine "freehand
// draws nothing" and would still pass if the extraction broke freehand
// painting outright — a gate that asserts the opposite of what it claims.
// ---------------------------------------------------------------------------

/** The only thing a painter does with a Path2D is hand it to ctx.stroke(). */
class Path2DStub {
  constructor(readonly d: string) {}
}
;(globalThis as { Path2D?: unknown }).Path2D = Path2DStub

/**
 * An `OffscreenCanvas` double, one recorded log per allocated buffer.
 *
 * A compound's children are painted into a scratch buffer rather than the
 * frame, so the scratch is not a detail of the test env — it IS the thing under
 * test. Each buffer gets its own call log and a `__tag`, so a test can assert
 * *which depth's* buffer was painted into and which one got composited where.
 *
 * The buffers are cached in the worker's module-level `scratchStack` and so
 * SURVIVE between tests exactly as they survive between frames. That is the
 * production behaviour, so the tests do not fight it: `beforeEach` clears each
 * buffer's log in place and keeps the same objects. Counting allocations would
 * therefore measure the test order, not the code — so the compound tests follow
 * the chain of `drawImage(canvasN, …)` references instead, which is both
 * order-independent and a more direct statement of the invariant.
 */
const canvasLogs = new Map<string, string[]>()
const allCanvasStubs: OffscreenCanvasStub[] = []
let canvasSeq = 0

class OffscreenCanvasStub {
  readonly __tag: string
  readonly log: string[] = []
  private ctx: OffscreenCanvasRenderingContext2D | null = null
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.__tag = `canvas${canvasSeq++}`
    canvasLogs.set(this.__tag, this.log)
    allCanvasStubs.push(this)
  }
  clearLog(): void {
    this.log.length = 0
  }
  getContext(kind: string): OffscreenCanvasRenderingContext2D | null {
    if (kind !== '2d') return null
    if (!this.ctx) this.ctx = recordingCtx(this.width, this.height, { all: true, into: this.log }).ctx
    return this.ctx
  }
}
;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = OffscreenCanvasStub

type WorkerModule = typeof import('../ExportWorker')
let renderFrame: WorkerModule['renderFrame']
let releaseOwnedBitmaps: WorkerModule['releaseOwnedBitmaps']

beforeAll(async () => {
  const mod = await import('../ExportWorker')
  renderFrame = mod.renderFrame
  releaseOwnedBitmaps = mod.releaseOwnedBitmaps
})

afterAll(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// A recording 2D context
// ---------------------------------------------------------------------------

/** Stable, short number formatting so the log survives float noise. */
function n(v: unknown): string {
  if (typeof v === 'number') return String(Math.round(v * 1e4) / 1e4)
  if (v === undefined) return ''
  // A scratch canvas is logged by its tag, so `drawImage(canvas0,…)` says which
  // depth's buffer was composited where.
  if (v && typeof v === 'object' && '__tag' in v) return String((v as { __tag: string }).__tag)
  if (v && typeof v === 'object') return 'obj'
  return String(v)
}

/**
 * A Proxy that stands in for `OffscreenCanvasRenderingContext2D`. Method calls
 * are split in two: the frame's setup calls (`setTransform`, `clearRect`,
 * `fillRect`) go to `setup`, and everything a clip's painter does goes to
 * `calls`, so the clip log is exactly the ordered paint list and nothing else.
 *
 * State writes that change ordering (opacity, composite op) are recorded
 * inline. Returns plausible values for the few methods a painter reads.
 */
function recordingCtx(
  width: number,
  height: number,
  opts: { all?: boolean; into?: string[] } = {},
): { ctx: OffscreenCanvasRenderingContext2D; calls: string[]; setup: string[] } {
  const calls = opts.into ?? []
  const setup: string[] = []
  // The last setTransform, for painters that read the current matrix (EXP-2).
  let matrix = [1, 0, 0, 1, 0, 0]
  const target = {} as Record<string, unknown>
  const SETUP = new Set(['setTransform', 'clearRect', 'fillRect'])
  // A scratch canvas logs everything into one array, because "was this buffer
  // cleared before it was painted into?" is exactly what the compound tests ask.
  const split = !opts.all
  const ctx = new Proxy(target, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined
      // Methods whose return value a painter actually uses.
      if (prop === 'measureText') {
        return (text: string) => {
          calls.push(`measureText(${JSON.stringify(text)})`)
          return { width: text.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }
        }
      }
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
        return () => ({ addColorStop() {} })
      }
      if (prop === 'canvas') return { width, height }
      if (prop === 'getTransform') return () => ({ a: matrix[0], b: matrix[1], c: matrix[2], d: matrix[3], e: matrix[4], f: matrix[5] })
      return (...args: unknown[]) => {
        // A stroked Path2D is the freehand's whole identity, the way a rect()
        // is a shape's. Log the path data so freehand clips are legible.
        const shown =
          prop === 'stroke' && args[0] instanceof Path2DStub
            ? [args[0].d, ...args.slice(1)]
            : args
        if (prop === 'setTransform') matrix = args as number[]
        const log = `${prop}(${shown.map(n).join(',')})`
        if (split && SETUP.has(prop)) setup.push(log)
        else calls.push(log)
        return undefined
      }
    },
    set(_t, prop, value) {
      if (prop === 'globalAlpha') calls.push(`alpha=${n(value)}`)
      else if (prop === 'globalCompositeOperation') calls.push(`op=${n(value)}`)
      return true
    },
  })
  return { ctx: ctx as unknown as OffscreenCanvasRenderingContext2D, calls, setup }
}

// ---------------------------------------------------------------------------
// A flat scene: three rects and one freehand stroke, deliberately inserted out
// of z order so the log proves paint order rather than insertion order.
// ---------------------------------------------------------------------------

function shape(id: string, zIndex: number, x: number, fill: string): ActiveShapeClip {
  return {
    type: 'shape',
    id,
    trackId: `tr-${id}`,
    name: id,
    sourceFrame: 0,
    opacity: 1,
    zIndex,
    shapeKind: 'rect',
    shapeFill: fill,
    shapeStroke: 'none',
    shapeStrokeWidth: 0,
    transform: { x, y: 0.5, scale: 0.2, rotation: 0, anchor: { x: 0, y: 0 } },
  }
}

function freehand(id: string, zIndex: number, x: number): ActiveFreehandClip {
  return {
    type: 'freehand',
    id,
    trackId: `tr-${id}`,
    name: id,
    sourceFrame: 0,
    opacity: 1,
    zIndex,
    pathData: 'M 0 0 L 40 0 L 40 40 Z',
    strokeColor: '#00ff00',
    strokeWidth: 4,
    transformModel: 'v2',
    transform: { x, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0, y: 0 } },
  }
}

function flatScene(): Scene {
  return {
    frame: 0,
    fps: 30,
    stage: { width: 1920, height: 1080 },
    videos: [],
    audios: [],
    texts: [],
    images: [],
    // Insertion order is front, back, mid, stroke — nothing like z order.
    shapes: [shape('s-front', 30, 0.75, '#0000ff'), shape('s-back', 10, 0.1, '#ff0000'), shape('s-mid', 20, 0.4, '#00ff00')],
    freehand: [freehand('s-stroke', 15, 0.55)],
    transitions: [],
  }
}

const STAGE_W = 1920
const STAGE_H = 1080

type PaintLog = { calls: string[]; setup: string[] }

/** A stand-in for a mediabunny WrappedCanvas, identifiable in the log by tag. */
function decoded(tag: string): { canvas: { width: number; height: number; __tag: string } } {
  return { canvas: { width: 640, height: 360, __tag: tag } }
}

async function paintFlat(
  scene: Scene,
  occurrenceCanvases: Map<string, unknown> = new Map(),
): Promise<PaintLog> {
  const { ctx, calls, setup } = recordingCtx(STAGE_W, STAGE_H)
  await renderFrame(
    ctx,
    scene,
    new Map(),
    new Map(),
    new Map(),
    STAGE_W,
    STAGE_H,
    0,
    null,
    occurrenceCanvases as never,
  )
  return { calls, setup }
}

// ---------------------------------------------------------------------------
// The gate
//
// The `calls` list below was read off the CURRENT flat body, not written by
// hand and hoped for. Each entry is one clip's painter calls: shapes appear as
// their rect, the freehand as its translated path data. Scene order is
// z 30, 10, 20, 15; the log is 10, 15, 20, 30.
// ---------------------------------------------------------------------------

const FLAT_PAINT_ORDER = [
  'save()',
  'alpha=1',
  'beginPath()',
  'rect(192,540,216,216)',
  'fill()',
  'restore()',
  'save()',
  'alpha=1',
  'save()',
  'transform(1,0,0,1,1056,540)',
  'stroke(M 0 0 L 40 0 L 40 40 Z)',
  'restore()',
  'restore()',
  'save()',
  'alpha=1',
  'beginPath()',
  'rect(768,540,216,216)',
  'fill()',
  'restore()',
  'save()',
  'alpha=1',
  'beginPath()',
  'rect(1440,540,216,216)',
  'fill()',
  'restore()',
]

describe('PV-P1b-1 — flat paint order (pre-extraction baseline)', () => {
  it('paints every clip exactly once, in z order, whatever order the scene lists them', async () => {
    const { calls } = await paintFlat(flatScene())
    expect(calls).toEqual(FLAT_PAINT_ORDER)
  })

  it('balances every save with a restore, so one clip cannot leak ctx state into the next', async () => {
    // The single most likely casualty of turning this body into a recursive
    // paintScene is an unbalanced save/restore at one depth: every later clip
    // then inherits the wrong transform and alpha.
    const { calls } = await paintFlat(flatScene())
    const depth = calls.reduce((d, c) => d + (c === 'save()' ? 1 : c === 'restore()' ? -1 : 0), 0)
    expect(depth).toBe(0)
  })

  it('sets the stage transform once as frame setup, not as clip work', async () => {
    // The export draws in logical stage units under one scale transform; if the
    // extraction moved or repeated this, every geometry assertion above shifts.
    const { calls, setup } = await paintFlat(flatScene())
    expect(setup).toEqual([
      'setTransform(1,0,0,1,0,0)',
      'clearRect(0,0,1920,1080)',
      'fillRect(0,0,1920,1080)',
      'setTransform(1,0,0,1,0,0)',
      'setTransform(1,0,0,1,0,0)',
    ])
    expect(calls).not.toContain('setTransform(1,0,0,1,0,0)')
  })

  it('applies a clip opacity as one alpha inside its own save/restore bracket', async () => {
    const scene = flatScene()
    scene.shapes[0] = { ...scene.shapes[0], opacity: 0.5 } // s-front, z 30
    const { calls } = await paintFlat(scene)
    // Bracketed by its own save, and applied once — a nested painter must not
    // re-apply a parent's opacity, which is the compound bug step 3 can cause.
    const alphaAt = calls.indexOf('alpha=0.5')
    expect(alphaAt).toBeGreaterThan(-1)
    expect(calls.slice(alphaAt - 1, alphaAt + 3)).toEqual(['save()', 'alpha=0.5', 'beginPath()', 'rect(1440,540,216,216)'])
    expect(calls.filter(c => c === 'alpha=0.5')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Compounds
//
// A compound is placed like an image: its children are painted into this depth's
// picture buffer and that flattened picture goes through the same `drawMedia`
// path a video or image takes. The resolver has already resolved the child scene
// at the compound's own source frame, so the worker only paints.
// ---------------------------------------------------------------------------

function compound(
  id: string,
  zIndex: number,
  x: number,
  opacity: number,
  scene: Scene,
): ActiveCompoundClip {
  return {
    type: 'compound',
    id,
    trackId: `tr-${id}`,
    name: id,
    sourceFrame: 0,
    opacity,
    zIndex,
    scene,
    contentSize: { width: STAGE_W, height: STAGE_H },
    transform: { x, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0, y: 0 } },
  }
}

/** A scene holding one compound and nothing else at the top level. */
function onlyCompound(c: ActiveCompoundClip): Scene {
  const scene = flatScene()
  scene.shapes = []
  scene.freehand = []
  scene.compounds = [c]
  return scene
}

/** The scratch buffers composited by `log`, in order, as canvas tags. */
function compositesIn(log: readonly string[]): string[] {
  return log.flatMap(c => {
    const m = /^drawImage\((canvas\d+),/.exec(c)
    return m ? [m[1]] : []
  })
}

/** The single buffer this log composited, failing loudly if it composited 0 or 2. */
function onlyCompositeIn(log: readonly string[]): string {
  const tags = compositesIn(log)
  if (tags.length !== 1) throw new Error(`expected exactly one composited buffer, got ${tags.length}: ${tags.join(',')}`)
  return tags[0]
}

function logOf(tag: string): string[] {
  const log = canvasLogs.get(tag)
  if (!log) throw new Error(`unknown buffer ${tag}`)
  return log
}

beforeEach(() => {
  // The scratch buffers persist between frames, and so between tests. Clear the
  // logs in place rather than dropping the map, so a reused buffer keeps its
  // identity and a test can still follow references through it.
  for (const s of allCanvasStubs) s.clearLog()
})

describe('PV-P1b-1 — compound painting', () => {
  it('paints the children into a picture buffer instead of straight onto the frame', async () => {
    const { calls } = await paintFlat(onlyCompound(compound('c1', 10, 0.5, 1, flatScene())))

    // The frame itself drew no child geometry...
    expect(calls.filter(c => c.startsWith('rect('))).toHaveLength(0)
    // ...it composited the flattened picture, and that picture holds the children
    // in z order (10, 15, 20, 30) even though the scene listed them 30/10/20/15.
    const picture = logOf(onlyCompositeIn(calls))
    expect(picture.filter(c => c.startsWith('rect('))).toEqual([
      'rect(192,540,216,216)',
      'rect(768,540,216,216)',
      'rect(1440,540,216,216)',
    ])
    expect(picture.some(c => c.startsWith('stroke(M 0 0'))).toBe(true)
  })

  it('clears the picture buffer before painting into it', async () => {
    const { calls } = await paintFlat(onlyCompound(compound('c1', 10, 0.5, 1, flatScene())))
    const log = logOf(onlyCompositeIn(calls))
    const cleared = log.indexOf('clearRect(0,0,1920,1080)')
    const firstPaint = log.findIndex(c => c.startsWith('rect('))
    expect(cleared).toBeGreaterThan(-1)
    expect(cleared).toBeLessThan(firstPaint)
  })

  it('applies a nested opacity once at each level, never twice for one clip', async () => {
    // The ticket's assertion: a child at .5 inside a compound at .5 must write
    // exactly one alpha on the picture and exactly one on the frame — not two
    // on either. Two would be the compound multiplying its own opacity in.
    const child = flatScene()
    child.shapes[1] = { ...child.shapes[1], opacity: 0.5 } // s-mid, z 20
    child.freehand = []
    const { calls } = await paintFlat(onlyCompound(compound('c1', 10, 0.5, 0.5, child)))

    expect(calls.filter(c => c === 'alpha=0.5')).toHaveLength(1)
    expect(logOf(onlyCompositeIn(calls)).filter(c => c === 'alpha=0.5')).toHaveLength(1)
  })

  it('gives a nested compound a different picture buffer than its parent', async () => {
    // The depth stack, asserted end to end: the innermost children land in one
    // buffer, their parent composites THAT buffer into its own, and the frame
    // composites the parent's. If the buffers were shared, the parent and the
    // child would resolve to the same tag and the inner paint would overwrite
    // the outer one.
    const inner = flatScene()
    inner.shapes = [shape('deep', 10, 0.1, '#ff0000')]
    inner.freehand = []
    const outer = flatScene()
    outer.shapes = []
    outer.freehand = []
    outer.compounds = [compound('inner', 10, 0.3, 1, inner)]

    const { calls } = await paintFlat(onlyCompound(compound('outer', 10, 0.5, 1, outer)))

    const frameTag = onlyCompositeIn(calls)
    const innerTag = onlyCompositeIn(logOf(frameTag))
    expect(innerTag).not.toBe(frameTag)

    // innermost painted its shape into its own buffer…
    expect(logOf(innerTag)).toContain('rect(192,540,216,216)')
    // …its parent composited that buffer and nothing else…
    expect(compositesIn(logOf(frameTag))).toEqual([innerTag])
    // …and the frame composited the parent, never the grandchild directly.
    expect(compositesIn(calls)).toEqual([frameTag])
  })

  it('stops recursing at MAX_COMPOUND_DEPTH', async () => {
    // Six compounds deep in a chain of documents, each holding the next. The
    // resolver stops at MAX_COMPOUND_DEPTH and the export guards the same way,
    // so a hand-built deeper scene must not walk forever. Measured as the
    // length of the composite chain, not as an allocation count.
    const build = (levels: number): Scene => {
      let scene = flatScene()
      scene.shapes = []
      scene.freehand = []
      for (let i = 0; i < levels; i++) scene = onlyCompound(compound(`c${i}`, 10, 0.5, 1, scene))
      return scene
    }
    const { calls } = await paintFlat(build(MAX_COMPOUND_DEPTH + 2))

    let depth = 1
    let log = logOf(onlyCompositeIn(calls))
    while (compositesIn(log).length > 0) {
      depth++
      expect(depth).toBeLessThanOrEqual(MAX_COMPOUND_DEPTH)
      log = logOf(onlyCompositeIn(log))
    }
    expect(depth).toBe(MAX_COMPOUND_DEPTH)
  })

  it('leaves a flat scene with no compounds byte-identical to the baseline', async () => {
    // The compound branch must not perturb the existing walk.
    const { calls } = await paintFlat(flatScene())
    expect(calls).toEqual(FLAT_PAINT_ORDER)
    expect(compositesIn(calls)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Decoded video inside compounds
//
// A nested video is looked up by its WHOLE occurrence path, not by clip id. That
// is the whole point: one child clip id can be live inside two compounds on the
// same output frame, and the two occurrences hold different decoded pictures.
// Keying by clip id would show one compound the other's frame.
// ---------------------------------------------------------------------------

function video(id: string, zIndex: number, src = 'v.mp4'): ActiveVideoClip {
  return {
    type: 'video',
    id,
    trackId: `tr-${id}`,
    name: id,
    sourceFrame: 0,
    opacity: 1,
    zIndex,
    src,
    volume: 1,
  }
}

/** A scene whose only clip is a video. */
function onlyVideo(id: string, src?: string): Scene {
  const scene = flatScene()
  scene.shapes = []
  scene.freehand = []
  scene.videos = [video(id, 10, src)]
  return scene
}

const key = (...path: string[]) => JSON.stringify(path)

describe('PV-P1b-1 — video inside a compound', () => {
  it('finds the decoded frame by occurrence path, not by clip id', async () => {
    // The hole this closes: a nested video used to be looked up as
    // `clipCanvases.get(clipId)`, a root-level map, so it never resolved and the
    // export had a hole where the video was.
    const { calls } = await paintFlat(onlyCompound(compound('c1', 10, 0.5, 1, onlyVideo('v1'))), new Map([[key('c1', 'v1'), decoded('nestedA')]]))

    const picture = logOf(onlyCompositeIn(calls))
    expect(picture.some(c => c.startsWith('drawImage(nestedA,'))).toBe(true)
  })

  it('gives two compounds holding the same child id their own picture', async () => {
    // Both compounds contain a clip whose id is 'v1'. If the lookup were by bare
    // clip id, neither would resolve at all; if one occurrence's key were reused
    // for both, the same picture would be composited twice.
    //
    // Note the two compounds are SIBLINGS, so both at depth 0, and they share
    // the depth-0 picture buffer — cleared, painted and composited in turn. Only
    // NESTING needs separate buffers, which is the test above. So the evidence
    // here is the ordered sequence of composites in that one shared buffer.
    const scene = onlyCompound(compound('c1', 10, 0.3, 1, onlyVideo('v1')))
    scene.compounds!.push(compound('c2', 20, 0.6, 1, onlyVideo('v1')))
    const canvases = new Map([
      [key('c1', 'v1'), decoded('fromC1')],
      [key('c2', 'v1'), decoded('fromC2')],
    ])

    const { calls } = await paintFlat(scene, canvases)

    // Both composites name the same buffer — the siblings share depth 0's.
    const tags = [...new Set(compositesIn(calls))]
    expect(tags).toHaveLength(1)
    const shared = logOf(tags[0])
    // Assert WHICH picture, in which order — not the placement numbers, which are
    // drawMedia's business and would make this test fail for the wrong reason.
    expect(shared.filter(c => c.startsWith('drawImage(')).map(c => /^drawImage\(([^,]+),/.exec(c)![1])).toEqual([
      'fromC1',
      'fromC2',
    ])
  })

  it('draws nothing for a nested video with no decoded frame', async () => {
    // The frame loop only fills occurrences `compoundSourceFrames` reports, so an
    // inactive or undecodable one must be absent — and must not fall back to some
    // other occurrence's picture.
    const { calls } = await paintFlat(onlyCompound(compound('c1', 10, 0.5, 1, onlyVideo('v1'))), new Map())
    const picture = logOf(onlyCompositeIn(calls))
    expect(picture.filter(c => c.startsWith('drawImage('))).toHaveLength(0)
  })

  it('still reads a top-level video from the root map, by bare clip id', async () => {
    // The root path is deliberately unchanged: `clipCanvases` stays keyed by clip
    // id so the flat walk and the transition snapshots keep working.
    const scene = flatScene()
    scene.shapes = []
    scene.freehand = []
    scene.videos = [video('root-v', 10)]
    const { ctx, calls } = recordingCtx(STAGE_W, STAGE_H)
    const rootCanvases = new Map([['root-v', decoded('rootFrame')]])
    await renderFrame(ctx, scene, rootCanvases as never, new Map(), new Map(), STAGE_W, STAGE_H, 0, null, new Map())
    expect(calls.some(c => c.startsWith('drawImage(rootFrame,'))).toBe(true)
  })

  it('does not let a nested occurrence satisfy a top-level video of the same id', async () => {
    // The mirror of the previous test: the two maps must not leak into each other.
    const scene = flatScene()
    scene.shapes = []
    scene.freehand = []
    scene.videos = [video('shared', 10)]
    const { ctx, calls } = recordingCtx(STAGE_W, STAGE_H)
    await renderFrame(ctx, scene, new Map(), new Map(), new Map(), STAGE_W, STAGE_H, 0, null, new Map([[key('c1', 'shared'), decoded('nested')]]) as never)
    expect(calls.filter(c => c.startsWith('drawImage('))).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Mattes across depths
//
// `gpu.setMatte` hands the renderer a REFERENCE to a buffer, not a copy. If the
// matte buffers were shared across depths, a compound's child matte would
// overwrite the parent's buffer and the parent would composite the child's
// content — a plausible wrong frame with nothing thrown.
// ---------------------------------------------------------------------------

type MatteCall = { clipId: string; tag: string }

/** A duck-typed renderer: the class has private fields, so this is cast. */
function gpuDouble(): { gpu: unknown; mattes: MatteCall[] } {
  const mattes: MatteCall[] = []
  const gpu = {
    setMatte(clipId: string, source: unknown) {
      mattes.push({ clipId, tag: (source as { __tag?: string }).__tag ?? 'untagged' })
      return true
    },
    // Echo the source back so the effect path completes and composites.
    draw(item: { source: unknown }) {
      return item.source
    },
    endFrame() {},
    releaseKeys() {},
    drawTransition() {
      return null
    },
  }
  return { gpu, mattes }
}

function matted(id: string, zIndex: number, sourceClipId: string, x: number): ActiveShapeClip {
  return { ...shape(id, zIndex, x, '#ff0000'), matte: { sourceClipId, kind: 'alpha', invert: false } }
}

describe('PV-P1b-1 — a child matte cannot capture a sibling buffer', () => {
  it('gives a matte inside a compound a different buffer from the matte beside it', async () => {
    // Depth 0: B is the matte source for A. Inside compound C (depth 1): E is the
    // matte source for D. Same clip ids could repeat across compounds, so the
    // isolation that matters is by DEPTH.
    const inner = flatScene()
    inner.shapes = [shape('E', 10, 0.2, '#00ff00'), matted('D', 20, 'E', 0.4)]
    inner.freehand = []
    inner.compounds = []

    const scene = onlyCompound(compound('C', 30, 0.5, 1, inner))
    scene.shapes = [shape('B', 10, 0.1, '#0000ff'), matted('A', 20, 'B', 0.3)]

    const { gpu, mattes } = gpuDouble()
    const { ctx } = recordingCtx(STAGE_W, STAGE_H)
    await renderFrame(ctx, scene, new Map(), new Map(), new Map(), STAGE_W, STAGE_H, 0, gpu as never)

    // Both mattes were painted and handed to the renderer…
    expect(mattes.map(m => m.clipId).sort()).toEqual(['B', 'E'])
    // …and they are DIFFERENT buffers. Sharing one would mean the parent's matte
    // silently became the child's content.
    expect(mattes).toHaveLength(2)
    expect(mattes[0].tag).not.toBe(mattes[1].tag)
  })

  it('paints each matte source ALONE into its own buffer, and hides it from the picture', async () => {    const scene = onlyCompound(compound('C', 10, 0.5, 1, flatScene()))
    scene.shapes = [shape('B', 10, 0.1, '#0000ff'), matted('A', 20, 'B', 0.3)]
    const { gpu, mattes } = gpuDouble()
    const { ctx, calls } = recordingCtx(STAGE_W, STAGE_H)
    await renderFrame(ctx, scene, new Map(), new Map(), new Map(), STAGE_W, STAGE_H, 0, gpu as never)

    expect(mattes.map(m => m.clipId)).toEqual(['B'])
    // B's geometry is in B's matte buffer…
    expect(logOf(mattes[0].tag)).toContain('rect(192,540,216,216)')
    // …and NOT on the frame: a matte source exists only as a matte, so the main
    // walk skips it. A is flattened to a scratch and composited, so the frame
    // carries a drawImage rather than raw geometry.
    expect(calls.filter(c => c.startsWith('rect('))).toHaveLength(0)
    expect(calls.some(c => c.startsWith('drawImage('))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Cleanup (3e)
//
// The export worker owns two kinds of ImageBitmap: the ones loaded for image
// clips, and the snapshots the 2D transition fallback creates. "Exactly once" is
// the whole requirement — a double close() throws on a real ImageBitmap, and a
// missed one leaks GPU memory on a long export.
// ---------------------------------------------------------------------------

/** An ImageBitmap double that counts close() calls. */
function fakeBitmap() {
  return {
    width: 8,
    height: 8,
    closes: 0,
    close() {
      this.closes++
    },
  }
}

type ReleaseFn = typeof import('../ExportWorker')['releaseOwnedBitmaps']
/** The real parameter types, so the doubles cannot drift from the signature. */
type BitmapMap = Parameters<ReleaseFn>[0]
type SnapMap = Parameters<ReleaseFn>[1]

function ownedSnap(bmp: unknown): SnapMap extends Map<string, infer V> ? V : never {
  return { source: bmp, owned: true } as SnapMap extends Map<string, infer V> ? V : never
}

function bitmapMap(entries: [string, unknown][]): BitmapMap {
  return new Map(entries) as BitmapMap
}

function snapMap(entries: [string, unknown][]): SnapMap {
  return new Map(entries) as SnapMap
}

describe('releaseOwnedBitmaps', () => {
  it('closes every owned bitmap exactly once', () => {
    const a = fakeBitmap()
    const b = fakeBitmap()
    const bitmaps = bitmapMap([['a', a], ['b', b]])
    const snaps = snapMap([['t1', ownedSnap(b)]])

    expect(releaseOwnedBitmaps(bitmaps, snaps)).toBe(2)
    expect(a.closes).toBe(1)
    // Reachable from both maps, and still closed once.
    expect(b.closes).toBe(1)
  })

  it('is a no-op on a second call, so a finally can run it unconditionally', () => {
    const a = fakeBitmap()
    const bitmaps = bitmapMap([['a', a]])
    const snaps = snapMap([])

    expect(releaseOwnedBitmaps(bitmaps, snaps)).toBe(1)
    expect(releaseOwnedBitmaps(bitmaps, snaps)).toBe(0)
    expect(a.closes).toBe(1)
  })

  it('does not close a snapshot that only aliases a loaded bitmap', () => {
    // The 2D fallback takes image-transition snapshots straight from the loaded
    // bitmap with owned:false. Closing those would pull the bitmap out from under
    // the picture still using it.
    const a = fakeBitmap()
    const bitmaps = bitmapMap([['a', a]])
    const snaps = snapMap([['t1', { source: a, owned: false }]])

    expect(releaseOwnedBitmaps(bitmaps, snaps)).toBe(1)
    expect(a.closes).toBe(1)
  })

  it('leaves nothing behind in either map', () => {
    const bitmaps = bitmapMap([['a', fakeBitmap()]])
    const snaps = snapMap([['t1', ownedSnap(fakeBitmap())]])

    releaseOwnedBitmaps(bitmaps, snaps)
    expect(bitmaps.size).toBe(0)
    expect(snaps.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// EXP-1 — a compound is composited the way the preview composites it
//
// Preview renders a nested scene at `contentSize` (the child project's stage)
// and places it with `resolveDrawRect(transform, stage, content…)`. Export used
// to size the picture and the nested paint against the ROOT stage, so any
// compound whose child stage differs from the root exported its children at
// the wrong position and size. Fixtures here always give the child its own
// stage; the earlier compound tests (child stage == root stage) cannot see it.
// ---------------------------------------------------------------------------

/** Tags are allocation-order noise (the scratch buffers persist across tests). */
const untag = (log: readonly string[]): string[] => log.map(c => c.replace(/canvas\d+/g, 'CANVAS'))

type GpuDrawCall = {
  item: Record<string, unknown>
  frame: number
  view?: { stage?: { width: number; height: number }; fps?: number; keyPrefix?: string; output?: { width: number; height: number } }
}

/**
 * A renderer double that records what the worker asks of it, in order. `sink`
 * lets a test interleave the GPU calls with a 2D context's own call log.
 */
function gpuRecorder(sink?: string[]) {
  const events: string[] = []
  const draws: GpuDrawCall[] = []
  const mattes: { clipId: string; tag: string; prefix: string }[] = []
  const log = (e: string) => {
    events.push(e)
    sink?.push(`GPU:${e}`)
  }
  const gpu = {
    setMatte(clipId: string, source: unknown, keyPrefix?: string) {
      mattes.push({ clipId, tag: (source as { __tag?: string }).__tag ?? 'untagged', prefix: keyPrefix ?? '' })
      log('setMatte')
      return true
    },
    draw(item: Record<string, unknown>, frame: number, view?: GpuDrawCall['view']) {
      draws.push({ item, frame, ...(view ? { view } : {}) })
      log('draw')
      // Echo the source back so the effect path completes and composites it.
      return item.source
    },
    releaseKeys() {
      log('releaseKeys')
    },
    endFrame() {
      log('endFrame')
    },
    drawTransition(_a: unknown, _b: unknown, _spec: unknown, _frame: number) {
      log('transition')
      return { width: 1, height: 1, __tag: 'trOut' }
    },
  }
  return { gpu: gpu as never, events, draws, mattes }
}

/** A child project with its own stage, one shape at its centre. */
function childScene(stage: { width: number; height: number }, frame = 0, fps = 30): Scene {
  const scene = flatScene()
  scene.stage = stage
  scene.frame = frame
  scene.fps = fps
  scene.shapes = [shape('kid', 10, 0.5, '#00ff00')]
  scene.freehand = []
  return scene
}

/** A compound whose content size is `scene.stage`, as the resolver builds it. */
function sizedCompound(id: string, zIndex: number, scene: Scene, over: Partial<ActiveCompoundClip> = {}): ActiveCompoundClip {
  return {
    ...compound(id, zIndex, 0.25, 1, scene),
    contentSize: { ...scene.stage },
    transform: { x: 0.25, y: 0.75, scale: 1, rotation: 0, anchor: { x: 0, y: 0 } },
    ...over,
  }
}

const ROOT_W = 1080
const ROOT_H = 1920

/** A portrait root scene holding only `clips` as compounds. */
function portraitRoot(...clips: ActiveCompoundClip[]): Scene {
  const scene = flatScene()
  scene.stage = { width: ROOT_W, height: ROOT_H }
  scene.shapes = []
  scene.freehand = []
  scene.compounds = clips
  return scene
}

async function paintPortrait(scene: Scene, gpu: unknown = null, frameIndex = 0): Promise<string[]> {
  const { ctx, calls } = recordingCtx(ROOT_W, ROOT_H)
  await renderFrame(ctx, scene, new Map(), new Map(), new Map(), ROOT_W, ROOT_H, frameIndex, gpu as never, new Map())
  return calls
}

/** What the child paints when it IS the stage: the oracle for "in its own space". */
async function paintAsOwnStage(scene: Scene): Promise<string[]> {
  const { ctx, calls } = recordingCtx(scene.stage.width, scene.stage.height)
  await renderFrame(ctx, scene, new Map(), new Map(), new Map(), scene.stage.width, scene.stage.height, 0, null, new Map())
  return calls
}

describe('EXP-1 — a nested scene lives in its own stage', () => {
  const CHILD_STAGE = { width: 400, height: 200 }

  it('paints the children against the content size and places the picture with it', async () => {
    const child = childScene(CHILD_STAGE)
    const c = sizedCompound('c1', 10, child)
    const calls = await paintPortrait(portraitRoot(c))

    // The picture is the child's own size, not the root stage.
    const tag = onlyCompositeIn(calls)
    const buffer = allCanvasStubs.find(s => s.__tag === tag)!
    expect([buffer.width, buffer.height]).toEqual([400, 200])

    // The kid is painted exactly where it paints when the child is its own stage.
    const own = (await paintAsOwnStage(child)).filter(l => l.startsWith('rect('))
    expect(own).toHaveLength(1)
    expect(logOf(tag).filter(l => l.startsWith('rect('))).toEqual(own)

    // And the picture lands where the preview's resolveDrawRect puts it.
    const r = resolveDrawRect(c.transform, ROOT_W, ROOT_H, 400, 200)
    expect(calls).toContain(`translate(${n(r.x + r.width / 2)},${n(r.y + r.height / 2)})`)
    expect(calls).toContain(`drawImage(${tag},${n(-r.width / 2)},${n(-r.height / 2)},${n(r.width)},${n(r.height)})`)
  })

  it('places a masked compound with its own rect, crop and corner radius, not full-stage', async () => {
    const child = childScene(CHILD_STAGE)
    const c = sizedCompound('c1', 10, child, {
      mask: { kind: 'rect', x: 0.1, y: 0.1, width: 0.5, height: 0.5 } as never,
      cornerRadius: 0.2,
      crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
    })
    const { gpu, draws } = gpuRecorder()
    const calls = await paintPortrait(portraitRoot(c), gpu)

    expect(draws).toHaveLength(1)
    const { item } = draws[0]
    // The preview's chain gets the compound's draw rect; here the renderer is
    // handed the picture, the transform and the content size to derive it from.
    expect(item.fullStage).toBeFalsy()
    expect(item.transform).toEqual(c.transform)
    expect(item.contentSize).toEqual({ width: 400, height: 200 })
    expect(item.crop).toEqual(c.crop)
    expect(item.cornerRadius).toBe(0.2)
    expect(item.mask).toEqual(c.mask)
    const picture = allCanvasStubs.find(s => s === item.source)!
    expect([picture.width, picture.height]).toEqual([400, 200])
    // The chain's output is composited over the frame as a whole.
    expect(calls).toContain(`drawImage(${picture.__tag},0,0,${ROOT_W},${ROOT_H})`)
  })

  it('places a blended compound with its transform, not at 0,0,stage', async () => {
    const child = childScene(CHILD_STAGE)
    const c = sizedCompound('c1', 10, child, { blend: 'multiply' })
    const calls = await paintPortrait(portraitRoot(c))
    const tag = onlyCompositeIn(calls)
    const r = resolveDrawRect(c.transform, ROOT_W, ROOT_H, 400, 200)
    expect(calls).toContain('op=multiply')
    expect(calls).toContain(`drawImage(${tag},${n(-r.width / 2)},${n(-r.height / 2)},${n(r.width)},${n(r.height)})`)
    expect(calls.filter(l => l === `drawImage(${tag},0,0,${ROOT_W},${ROOT_H})`)).toHaveLength(0)
  })

  it('caps a huge content size without losing the aspect, and paints into the capped buffer', async () => {
    const child = childScene({ width: 8000, height: 4000 })
    const c = sizedCompound('c1', 10, child)
    const calls = await paintPortrait(portraitRoot(c))
    const tag = onlyCompositeIn(calls)
    const buffer = allCanvasStubs.find(s => s.__tag === tag)!
    // Long edge capped at max(MAX_COMPOUND_SIDE, root stage long edge) = 2048.
    expect([buffer.width, buffer.height]).toEqual([2048, 1024])
    // Painted under the cap's scale, so content units still land where they should…
    expect(logOf(tag)).toContain('setTransform(0.256,0,0,0.256,0,0)')
    // …and the picture is placed by the CONTENT size, not by the capped buffer.
    const r = resolveDrawRect(c.transform, ROOT_W, ROOT_H, 8000, 4000)
    expect(calls).toContain(`drawImage(${tag},${n(-r.width / 2)},${n(-r.height / 2)},${n(r.width)},${n(r.height)})`)
  })
})

describe('EXP-1 — nested effects see the nested frame, fps and stage', () => {
  it('hands a nested grain the nested scene frame, fps, stage and key prefix', async () => {
    const child = childScene({ width: 400, height: 200 }, 7, 24)
    child.shapes = [{ ...child.shapes[0], effects: [{ id: 'g', kind: 'grain', params: {} }] as never }]
    const { gpu, draws } = gpuRecorder()
    // The root frame is 3; the nested scene was resolved at its own frame 7.
    await paintPortrait(portraitRoot(sizedCompound('c1', 10, child)), gpu, 3)

    expect(draws).toHaveLength(1)
    expect(draws[0].frame).toBe(7)
    expect(draws[0].view?.fps).toBe(24)
    expect(draws[0].view?.stage).toEqual({ width: 400, height: 200 })
    expect(draws[0].view?.keyPrefix).toBe('c1/')
    // The nested draw targets the picture, not the root output.
    expect(draws[0].view?.output).toEqual({ width: 400, height: 200 })
  })

  it('keeps the root frame for root clips', async () => {
    const scene = portraitRoot()
    scene.shapes = [{ ...shape('s', 10, 0.1, '#ff0000'), effects: [{ id: 'g', kind: 'grain', params: {} }] as never }]
    const { gpu, draws } = gpuRecorder()
    await paintPortrait(scene, gpu, 3)
    expect(draws[0].frame).toBe(3)
    expect(draws[0].view).toBeUndefined()
  })

  it('keys a nested matte under the compound path, so it cannot meet a parent matte of the same id', async () => {
    const child = childScene({ width: 400, height: 200 })
    child.shapes = [shape('E', 10, 0.2, '#00ff00'), matted('D', 20, 'E', 0.4)]
    const scene = portraitRoot(sizedCompound('C', 30, child))
    scene.shapes = [shape('E', 10, 0.1, '#0000ff'), matted('A', 20, 'E', 0.3)]
    const { gpu, mattes } = gpuRecorder()
    await paintPortrait(scene, gpu)
    expect(mattes.map(m => `${m.prefix}${m.clipId}`).sort()).toEqual(['C/E', 'E'])
  })
})

describe('EXP-1 — the frame ends once, at the top level', () => {
  it('keeps a parent matte alive through a nested transition', async () => {
    const child = childScene({ width: 400, height: 200 })
    child.shapes = [shape('from', 10, 0.1, '#ff0000'), shape('to', 20, 0.5, '#00ff00')]
    child.transitions = [{ id: 't1', kind: 'fade', t: 0.5, fromClipId: 'from', toClipId: 'to' }]
    const scene = portraitRoot(sizedCompound('C', 20, child))
    // B is A's matte; A draws AFTER the compound (higher z), so a nested
    // endFrame would already have freed B by the time A needs it.
    scene.shapes = [shape('B', 10, 0.1, '#0000ff'), matted('A', 40, 'B', 0.3)]
    const { gpu, events } = gpuRecorder()
    await paintPortrait(scene, gpu)

    expect(events.filter(e => e === 'endFrame')).toHaveLength(1)
    expect(events[events.length - 1]).toBe('endFrame')
    // …and the matted clip's own draw happened before it.
    expect(events.lastIndexOf('draw')).toBeLessThan(events.indexOf('endFrame'))
  })
})

describe('EXP-1 — equal-zIndex order is the preview’s', () => {
  it('paints a sequence before a shape at the same zIndex', async () => {
    const scene = flatScene()
    scene.freehand = []
    scene.shapes = [shape('s', 10, 0.1, '#ff0000')]
    scene.sequences = [
      { type: 'sequence', id: 'q', trackId: 'tq', name: 'q', sourceFrame: 0, opacity: 1, zIndex: 10, kind: 'frames', frameCount: 1, frameIndex: 0 } as never,
    ]
    const seq = new Map([['q', { source: { width: 64, height: 64, __tag: 'seqPic' } }]])
    const { ctx, calls } = recordingCtx(STAGE_W, STAGE_H)
    await renderFrame(ctx, scene, new Map(), new Map(), new Map(), STAGE_W, STAGE_H, 0, null, new Map(), seq as never)
    const seqAt = calls.findIndex(c => c.startsWith('drawImage(seqPic,'))
    const shapeAt = calls.findIndex(c => c.startsWith('rect('))
    expect(seqAt).toBeGreaterThan(-1)
    expect(shapeAt).toBeGreaterThan(-1)
    expect(seqAt).toBeLessThan(shapeAt)
  })

  it('paints a generator before an adjustment at the same zIndex', async () => {
    const scene = flatScene()
    scene.shapes = []
    scene.freehand = []
    scene.generators = [
      { type: 'generator', id: 'g', trackId: 'tg', name: 'g', sourceFrame: 0, opacity: 1, zIndex: 10, kind: 'counter', params: {}, seed: 1, localFrame: 0, durationFrames: 30, fps: 30 } as never,
    ]
    scene.adjustments = [
      { type: 'adjustment', id: 'a', trackId: 'ta', name: 'a', sourceFrame: 0, opacity: 1, zIndex: 10, effects: [{ id: 'g', kind: 'grain', params: {} }] as never },
    ]
    const { ctx, calls } = recordingCtx(STAGE_W, STAGE_H)
    const { gpu } = gpuRecorder(calls)
    await renderFrame(ctx, scene, new Map(), new Map(), new Map(), STAGE_W, STAGE_H, 0, gpu, new Map())
    const adjustAt = calls.indexOf('GPU:draw')
    const generatorAt = calls.findIndex(c => !c.startsWith('GPU:') && c !== 'save()' && c !== 'restore()')
    expect(adjustAt).toBeGreaterThan(-1)
    expect(generatorAt).toBeGreaterThan(-1)
    expect(generatorAt).toBeLessThan(adjustAt)
  })
})

describe('EXP-1 — a compound on the root stage paints exactly as before', () => {
  // Captured from the pre-EXP-1 worker (compound content size == root stage,
  // opacity 1). Canvas tags are normalised: they depend on allocation order.
  const PICTURE_FLAT = [
    'setTransform(1,0,0,1,0,0)', 'alpha=1', 'op=source-over', 'clearRect(0,0,1920,1080)',
    'save()', 'alpha=1', 'beginPath()', 'rect(192,540,216,216)', 'fill()', 'restore()',
    'save()', 'alpha=1', 'save()', 'transform(1,0,0,1,1056,540)', 'stroke(M 0 0 L 40 0 L 40 40 Z)', 'restore()', 'restore()',
    'save()', 'alpha=1', 'beginPath()', 'rect(768,540,216,216)', 'fill()', 'restore()',
    'save()', 'alpha=1', 'beginPath()', 'rect(1440,540,216,216)', 'fill()', 'restore()',
  ]
  const FRAME = ['save()', 'alpha=1', 'translate(1920,1080)', 'rotate(0)', 'drawImage(CANVAS,-960,-540,1920,1080)', 'restore()']

  for (const [label, outW, outH] of [['native output', 1920, 1080], ['half output', 960, 540]] as const) {
    it(`2D path, ${label}`, async () => {
      for (const s of allCanvasStubs) s.clearLog()
      const { ctx, calls } = recordingCtx(outW, outH)
      await renderFrame(ctx, onlyCompound(compound('c1', 10, 0.5, 1, flatScene())), new Map(), new Map(), new Map(), outW, outH, 0, null, new Map())
      expect(untag(calls)).toEqual(FRAME)
      expect(untag(logOf(onlyCompositeIn(calls)))).toEqual(PICTURE_FLAT)
    })

    it(`GPU path, ${label}: a child effect draws the same picture`, async () => {
      for (const s of allCanvasStubs) s.clearLog()
      const child = flatScene()
      child.shapes = [{ ...child.shapes[0], effects: [{ id: 'g', kind: 'grain', params: {} }] as never }, ...child.shapes.slice(1)]
      child.freehand = []
      const { gpu, draws } = gpuRecorder()
      const { ctx, calls } = recordingCtx(outW, outH)
      await renderFrame(ctx, onlyCompound(compound('c1', 10, 0.5, 1, child)), new Map(), new Map(), new Map(), outW, outH, 0, gpu, new Map())
      expect(untag(calls)).toEqual(FRAME)
      expect(untag(logOf(onlyCompositeIn(calls)))).toEqual([
        'setTransform(1,0,0,1,0,0)', 'alpha=1', 'op=source-over', 'clearRect(0,0,1920,1080)',
        'save()', 'alpha=1', 'beginPath()', 'rect(192,540,216,216)', 'fill()', 'restore()',
        'save()', 'alpha=1', 'beginPath()', 'rect(768,540,216,216)', 'fill()', 'restore()',
        'save()', 'alpha=1', 'drawImage(CANVAS,0,0,1920,1080)', 'restore()',
      ])
      expect(draws).toHaveLength(1)
      expect(draws[0].item.fullStage).toBe(true)
      expect(draws[0].item.opacity).toBe(1)
      expect((draws[0].item.effects as unknown[]).length).toBe(1)
      expect(draws[0].frame).toBe(0)
      // The child shares the root stage and output, so the renderer's own
      // defaults apply: no output override that would resize its canvas.
      expect(draws[0].view?.output).toBeUndefined()
    })
  }
})

// ---------------------------------------------------------------------------
// EXP-2 — a text or shape layer fades as ONE picture
//
// The preview rasterises a text/shape layer to a texture and draws it once with
// uOpacity. Export used to set globalAlpha and paint the parts straight onto the
// frame, so at opacity < 1 each part (outline, glyph, panel, stroke, fill)
// composited separately and showed through its neighbours.
// ---------------------------------------------------------------------------

function fadeScene(opacity: number): Scene {
  const scene = flatScene()
  scene.freehand = []
  scene.shapes = [{ ...shape('s', 10, 0.1, '#ff0000'), shapeStroke: '#00ff00', shapeStrokeWidth: 6, opacity }]
  scene.texts = [
    {
      id: 't', trackId: 'tt', name: 't', type: 'text', content: 'Hi', sourceFrame: 0, opacity, zIndex: 20,
      fontSize: 40, color: '#123456', textOutline: { color: '#000', width: 4 }, textShadow: { color: '#000', blur: 8, offsetX: 2, offsetY: 3 },
    } as never,
  ]
  return scene
}

async function paintFade(opacity: number, outW = STAGE_W, outH = STAGE_H): Promise<string[]> {
  const { ctx, calls } = recordingCtx(outW, outH)
  await renderFrame(ctx, fadeScene(opacity), new Map(), new Map(), new Map(), outW, outH, 0, null, new Map())
  return calls
}

describe('EXP-2 — opacity is applied once per layer, to the flattened picture', () => {
  it('draws a faded text layer and a faded shape as one picture each, at their opacity', async () => {
    const calls = await paintFade(0.5)

    // Nothing is painted straight onto the frame at 0.5...
    expect(calls.filter(c => c.startsWith('strokeText(') || c.startsWith('fillText(') || c.startsWith('rect(') || c === 'fill()' || c === 'stroke()')).toEqual([])
    // ...each layer is one drawImage of its own flattened buffer, at alpha 0.5.
    const draws = calls.flatMap((c, i) => (c.startsWith('drawImage(') ? [i] : []))
    expect(draws).toHaveLength(2)
    for (const at of draws) expect(calls.slice(at - 2, at + 1)).toEqual(['save()', 'alpha=0.5', calls[at]])

    // The buffers hold the parts at alpha 1, so they composite as one.
    const shapeBuffer = logOf(/^drawImage\((canvas\d+),/.exec(calls[draws[0]])![1])
    expect(shapeBuffer).toContain('rect(192,540,216,216)')
    expect(shapeBuffer.filter(c => c.startsWith('alpha='))).not.toContain('alpha=0.5')
    const textBuffer = logOf(/^drawImage\((canvas\d+),/.exec(calls[draws[1]])![1])
    expect(textBuffer.some(c => c.startsWith('strokeText('))).toBe(true)
    expect(textBuffer.some(c => c.startsWith('fillText('))).toBe(true)
    expect(textBuffer.filter(c => c.startsWith('alpha='))).not.toContain('alpha=0.5')
  })

  it('keeps today’s direct calls at opacity 1', async () => {
    // Captured from the pre-EXP-2 worker: no flatten, no drawImage.
    expect(await paintFade(1)).toEqual([
      'save()', 'alpha=1', 'beginPath()', 'rect(192,540,216,216)', 'fill()', 'stroke()', 'restore()',
      'save()', 'alpha=1', 'measureText("Hi")', 'save()', 'save()', 'strokeText(Hi,960,540)', 'fillText(Hi,960,540)', 'restore()', 'restore()', 'restore()',
    ])
  })

  it('flattens at output resolution, so a faded layer is as sharp as an opaque one', async () => {
    // Output is half the stage: the buffer is painted under the output scale and
    // composited 1:1, not painted at stage size and stretched.
    const calls = await paintFade(0.5, 960, 540)
    const tags = compositesIn(calls)
    expect(tags).toHaveLength(2)
    for (const tag of tags) {
      const buffer = allCanvasStubs.find(s => s.__tag === tag)!
      expect([buffer.width, buffer.height]).toEqual([960, 540])
      expect(logOf(tag)).toContain('setTransform(0.5,0,0,0.5,0,0)')
    }
  })

  it('fades a layer that is one fill directly, as before: nothing to flatten', async () => {
    const scene = fadeScene(0.5)
    scene.shapes = [{ ...scene.shapes[0], shapeStrokeWidth: 0 }]
    scene.texts = [{ ...scene.texts[0], textOutline: undefined, textShadow: undefined }]
    const { ctx, calls } = recordingCtx(STAGE_W, STAGE_H)
    await renderFrame(ctx, scene, new Map(), new Map(), new Map(), STAGE_W, STAGE_H, 0, null, new Map())
    expect(compositesIn(calls)).toEqual([])
    expect(calls.filter(c => c === 'alpha=0.5')).toHaveLength(2)
    expect(calls).toContain('fillText(Hi,960,540)')
    expect(calls).toContain('rect(192,540,216,216)')
  })

  it('leaves a blended layer to the blend path', async () => {
    const scene = fadeScene(0.5)
    scene.shapes = [{ ...scene.shapes[0], blend: 'multiply' }]
    scene.texts = []
    const { ctx, calls } = recordingCtx(STAGE_W, STAGE_H)
    await renderFrame(ctx, scene, new Map(), new Map(), new Map(), STAGE_W, STAGE_H, 0, null, new Map())
    // The blend path already flattens: one drawImage, composite op set once.
    expect(compositesIn(calls)).toHaveLength(1)
    expect(calls.filter(c => c === 'op=multiply')).toHaveLength(1)
  })
})
