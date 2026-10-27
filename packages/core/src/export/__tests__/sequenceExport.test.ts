/**
 * PV-P8c — sequence clips paint through the worker's real `renderFrame`.
 *
 * `ExportWorker.ts` cannot be driven end to end outside a real worker (no
 * `ImageDecoder`/mediabunny/OffscreenCanvas in Node), and the ticket itself
 * says "no test runs the worker" for the same reason PV-P6b-4 relied on typecheck
 * plus a browser row. This file is narrower than that: it drives the module's
 * exported `renderFrame` directly — the same technique
 * `compoundExport.test.ts` (PV-P1b-1) uses to pin the flat paint order — with a
 * `sequenceImages` map standing in for `sequenceFrames.ts`'s store, so the
 * drawEntry/drawWithEffects/paintToScratch wiring this ticket adds is exercised
 * for real rather than only typechecked.
 *
 * What this does NOT cover: `sequenceFrames.ts`'s own decode/cache/retry logic
 * (covered by `sequenceFrames.test.ts`), and the GPU effect-chain draw path for
 * a sequence clip (no WebGL2 in Node — `sequenceFrames.test.ts`/browser row).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type { Scene, ActiveSequenceClip, ActiveCompoundClip } from '../../resolver/scene'

vi.mock('mediabunny', () => ({}))

class Path2DStub {
  constructor(readonly d: string) {}
}
;(globalThis as { Path2D?: unknown }).Path2D = Path2DStub

/**
 * A minimal `OffscreenCanvas` double so `paintCompoundPicture`'s per-depth
 * scratch buffer can be allocated in Node, WITH a real recording context —
 * unlike the root context, a compound clip's own `drawMedia(ctx, picture, …)`
 * call happens whether or not its CHILD scene found anything to draw, so the
 * nested-key test below has to look inside the picture buffer's own log, not
 * the root's.
 */
const allCanvasStubs: OffscreenCanvasStub[] = []

class OffscreenCanvasStub {
  readonly log: string[] = []
  private ctx: unknown = null
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    allCanvasStubs.push(this)
  }
  clearLog(): void {
    this.log.length = 0
  }
  getContext(kind: string): unknown {
    if (kind !== '2d') return null
    if (!this.ctx) {
      const log = this.log
      this.ctx = new Proxy(
        {},
        {
          get(_t, prop) {
            if (typeof prop !== 'string') return undefined
            if (prop === 'canvas') return { width: 0, height: 0 }
            return (...args: unknown[]) => {
              log.push(`${prop}(${args.map((a) => (a && typeof a === 'object' ? 'obj' : String(a))).join(',')})`)
              return undefined
            }
          },
          set() {
            return true
          },
        },
      )
    }
    return this.ctx
  }
}
;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = OffscreenCanvasStub

type WorkerModule = typeof import('../ExportWorker')
let renderFrame: WorkerModule['renderFrame']

beforeAll(async () => {
  const mod = await import('../ExportWorker')
  renderFrame = mod.renderFrame
})

afterAll(() => {
  vi.unstubAllGlobals()
})

/** A recording 2D context; logs every call, args stringified crudely. */
function recordingCtx(): { ctx: OffscreenCanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = []
  const target = {} as Record<string, unknown>
  const ctx = new Proxy(target, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop === 'canvas') return { width: 1920, height: 1080 }
      return (...args: unknown[]) => {
        calls.push(`${prop}(${args.map((a) => (a && typeof a === 'object' ? 'obj' : String(a))).join(',')})`)
        return undefined
      }
    },
    set(_t, prop) {
      void prop
      return true
    },
  })
  return { ctx: ctx as unknown as OffscreenCanvasRenderingContext2D, calls }
}

function seqClip(overrides: Partial<ActiveSequenceClip> = {}): ActiveSequenceClip {
  return {
    id: 'seq1',
    trackId: 'tr-seq1',
    name: 'seq1',
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
    type: 'sequence',
    kind: 'animated-image',
    src: 'blob:x',
    frameCount: 4,
    frameIndex: 0,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0, y: 0 } },
    ...overrides,
  }
}

function emptyScene(overrides: Partial<Scene> = {}): Scene {
  return {
    frame: 0,
    fps: 30,
    stage: { width: 1920, height: 1080 },
    videos: [],
    audios: [],
    texts: [],
    images: [],
    shapes: [],
    freehand: [],
    transitions: [],
    ...overrides,
  }
}

function fakeSequenceImage(): { source: unknown; width: number; height: number; close: () => void } {
  return { source: {}, width: 64, height: 64, close: () => {} }
}

describe('PV-P8c — sequence clips in the export worker paint path', () => {
  it('draws through drawMedia when the image is present, keyed by bare clip id at the root', async () => {
    const scene = emptyScene({ sequences: [seqClip({ id: 'seq1', frameIndex: 2 })] })
    const { ctx, calls } = recordingCtx()
    const sequenceImages = new Map([['seq1', fakeSequenceImage()]]) as never

    await renderFrame(ctx, scene, new Map(), new Map(), new Map(), 1920, 1080, 0, null, new Map(), sequenceImages)

    expect(calls.some((c) => c.startsWith('drawImage('))).toBe(true)
  })

  it('draws nothing, without throwing, when no image is held for the clip yet', async () => {
    const scene = emptyScene({ sequences: [seqClip({ id: 'seq1' })] })
    const { ctx, calls } = recordingCtx()

    await expect(
      renderFrame(ctx, scene, new Map(), new Map(), new Map(), 1920, 1080, 0, null, new Map(), new Map()),
    ).resolves.toBeUndefined()
    expect(calls.some((c) => c.startsWith('drawImage('))).toBe(false)
  })

  it('a sequence nested in a compound is looked up by its occurrence key, not its bare id', async () => {
    const childScene = emptyScene({ sequences: [seqClip({ id: 'child-seq', frameIndex: 0 })] })
    const compound: ActiveCompoundClip = {
      type: 'compound',
      id: 'comp1',
      trackId: 'tr-comp1',
      name: 'comp1',
      sourceFrame: 0,
      opacity: 1,
      zIndex: 0,
      scene: childScene,
      contentSize: { width: 1920, height: 1080 },
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0, y: 0 } },
    }
    const scene = emptyScene({ compounds: [compound] })

    // The child scene paints into depth 1's scratch `picture` buffer
    // (`paintCompoundPicture`), which is reused (not reallocated) frame to
    // frame — clear its log rather than counting allocations, the same
    // reason `compoundExport.test.ts` does.
    const pictureAt = () => allCanvasStubs[allCanvasStubs.length - 1]
    const childDrew = () => pictureAt().log.some((c) => c.startsWith('drawImage('))

    // Wrong key (bare id): the nested clip must NOT be found this way.
    {
      const { ctx } = recordingCtx()
      const wrongKey = new Map([['child-seq', fakeSequenceImage()]]) as never
      await renderFrame(ctx, scene, new Map(), new Map(), new Map(), 1920, 1080, 0, null, new Map(), wrongKey)
      expect(childDrew()).toBe(false)
      pictureAt().clearLog()
    }

    // Right key (occurrence path, JSON of ['comp1', 'child-seq']).
    {
      const { ctx } = recordingCtx()
      const rightKey = new Map([[JSON.stringify(['comp1', 'child-seq']), fakeSequenceImage()]]) as never
      await renderFrame(ctx, scene, new Map(), new Map(), new Map(), 1920, 1080, 0, null, new Map(), rightKey)
      expect(childDrew()).toBe(true)
    }
  })
})
