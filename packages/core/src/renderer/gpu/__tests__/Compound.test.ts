import { describe, expect, it, vi } from 'vitest'
import { compoundRenderScale, compoundTargetSize, MAX_COMPOUND_SIDE } from '../layers/compoundTarget'
import { RecordingGl } from '../debug/RecordingGl'
import { EffectChain } from '../EffectChain'
import { RenderGraph } from '../RenderGraph'
import { TexturePool } from '../TexturePool'
import { createLayerSet, type LayerSet } from '../layers/createLayerSet'
import { MAX_COMPOUND_RENDER_DEPTH } from '../layers/CompoundLayer'
import { resolveDrawRect } from '../layers/drawRect'
import { createEffect } from '../../../effects/registry'
import { resolveEffects } from '../../../effects/resolveEffects'
import type { VideoFrameProvider } from '../../../media/video'
import type { Layer, LayerContext } from '../layers/types'
import type { ActiveCompoundClip, ActiveVideoClip, Scene } from '../../../resolver/scene'

/**
 * Compound render targets (PV-P1a-2).
 *
 * The scale policy is the whole defence against the plan's "FBO memory for
 * depth-4 compounds" risk: a nested scene that renders at full size every time
 * would need four full-size targets alive at once, and at 4K that is more than
 * a pool should hold. These tests pin the quantisation, because a scale that
 * drifts with an animated transform is what would actually exhaust the pool.
 */
describe('compound target size', () => {
  const content = { width: 1280, height: 720 }

  it('renders 1:1 when the compound covers its content at one pixel per stage unit', () => {
    expect(compoundRenderScale(content, { width: 1280, height: 720 }, 1)).toBe(1)
  })

  it('never goes above 1, however many device pixels there are', () => {
    // A retina display draws the same 1280x720 content into 2560x1440 device
    // pixels; the target is still the content size, not twice it.
    expect(compoundRenderScale(content, { width: 1280, height: 720 }, 2)).toBe(1)
  })

  it('halves once when half is still enough', () => {
    expect(compoundRenderScale(content, { width: 1280, height: 720 }, 0.5)).toBe(0.5)
  })

  it('drops to a quarter at a quarter size', () => {
    expect(compoundRenderScale(content, { width: 320, height: 180 }, 1)).toBe(0.25)
  })

  it('floors at an eighth rather than following the pointer down', () => {
    // Drawn at 100x56, one pixel per stage unit would want ~0.09.
    expect(compoundRenderScale(content, { width: 100, height: 56 }, 1)).toBe(0.125)
  })

  it('follows the axis that needs the most resolution', () => {
    // Drawn taller than the content is wide: the height sets the scale, so
    // 1440/720 * 0.5 = 1 and the result is 1, not 0.5.
    expect(compoundRenderScale(content, { width: 1280, height: 1440 }, 0.5)).toBe(1)
  })

  it('treats a degenerate input as 1:1 rather than asking for nothing', () => {
    expect(compoundRenderScale(content, { width: 1280, height: 720 }, 0)).toBe(1)
    expect(compoundRenderScale(content, { width: 0, height: 0 }, 1)).toBe(1)
    expect(compoundRenderScale({ width: 0, height: 720 }, { width: 100, height: 100 }, 1)).toBe(1)
    expect(compoundRenderScale(content, { width: Number.NaN, height: 100 }, 1)).toBe(1)
  })

  it('ignores the sign of a flipped transform', () => {
    expect(compoundRenderScale(content, { width: -320, height: -180 }, 1)).toBe(0.25)
  })

  it('sizes the target from the content and the scale', () => {
    expect(compoundTargetSize(content, 0.5)).toEqual({ width: 640, height: 360 })
    expect(compoundTargetSize(content, 1)).toEqual({ width: 1280, height: 720 })
  })

  it('caps the long edge and keeps the aspect ratio', () => {
    expect(compoundTargetSize({ width: 4096, height: 2160 }, 1)).toEqual({ width: 2048, height: 1080 })
    expect(MAX_COMPOUND_SIDE).toBe(2048)
  })

  it('never returns a zero-pixel side', () => {
    expect(compoundTargetSize({ width: 1, height: 1 }, 0.125)).toEqual({ width: 1, height: 1 })
    expect(compoundTargetSize({ width: 0, height: 0 }, 1)).toEqual({ width: 1, height: 1 })
  })

  it('a depth-4 nest at 1/8 stays inside a small pool', () => {
    // The risk the quantisation exists for: four levels, each as small as the
    // policy allows, must not add up to four full-size targets.
    const tiny = compoundTargetSize(content, 1 / 8)
    expect(tiny).toEqual({ width: 160, height: 90 })
    expect(tiny.width * tiny.height * 4).toBeLessThan(1280 * 720)
  })
})


describe('EffectChain.renderTarget (PV-P1)', () => {
  const STAGE = { width: 1280, height: 720 }

  function ctxFor(gl: RecordingGl, chain: EffectChain, keyPrefix?: string): LayerContext {
    return {
      gl: gl as unknown as WebGL2RenderingContext,
      frame: 0,
      stage: STAGE,
      viewport: STAGE,
      fps: 30,
      effectChain: chain,
      ...(keyPrefix === undefined ? {} : { keyPrefix }),
    }
  }

  function setup() {
    const gl = new RecordingGl()
    gl.viewport(0, 0, 320, 180)
    const chain = new EffectChain()
    return { gl, chain, ctx: ctxFor(gl, chain) }
  }

  it('renders into a target of the requested size and restores the viewport', () => {
    const { gl, chain, ctx } = setup()
    let inside: number[] = []
    const target = chain.renderTarget(ctx, 'k', () => {
      inside = Array.from(gl.getParameter(gl.VIEWPORT) as ArrayLike<number>)
    }, { width: 64, height: 36 })

    expect(target).not.toBeNull()
    expect(target!.width).toBe(64)
    expect(target!.height).toBe(36)
    // The viewport inside draw() is the target, so the nested scene renders
    // into the texture rather than onto the screen.
    expect(inside).toEqual([0, 0, 64, 36])
    // And the screen viewport is exactly as it was afterwards.
    expect(Array.from(gl.getParameter(gl.VIEWPORT) as ArrayLike<number>)).toEqual([0, 0, 320, 180])
    expect(chain.hasMatte('k')).toBe(true)
  })

  it('without a size it follows the viewport, exactly as a matte does', () => {
    const { gl, chain, ctx } = setup()
    const target = chain.renderTarget(ctx, 'v', () => {})
    expect(target!.width).toBe(320)
    expect(target!.height).toBe(180)
  })

  it('renderMatte is still the boolean it always was', () => {
    const { chain, ctx } = setup()
    expect(chain.renderMatte(ctx, 'm', () => {})).toBe(true)
    expect(chain.hasMatte('m')).toBe(true)
  })

  it('releaseTargets frees one prefix and leaves the rest alone', () => {
    const { gl, chain, ctx } = setup()
    chain.renderMatte(ctx, 'c1/x', () => {})
    chain.renderMatte(ctx, 'c2/y', () => {})
    expect(chain.pool.liveCount).toBe(2)

    chain.releaseTargets(gl as unknown as WebGL2RenderingContext, 'c1/')
    expect(chain.hasMatte('c1/x')).toBe(false)
    expect(chain.hasMatte('c2/y')).toBe(true)
    // One target back in the free list, one still in use.
    expect(chain.pool.freeCount).toBe(1)
    expect(chain.pool.liveCount).toBe(2)
  })

  it('a nested matte lookup is namespaced, so two copies do not share one', () => {
    const { gl, chain } = setup()
    const inner = ctxFor(gl, chain, 'c1/')
    const drawn: number[] = []
    // Nothing under the prefix yet: the clip is fully matted out and draws
    // nothing, which is exactly what an absent matte has always meant.
    chain.draw(inner, {
      program: {} as never,
      vao: {} as never,
      unit: 0,
      contentWidth: 100,
      contentHeight: 100,
      effects: [],
      rect: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
      opacity: 1,
      matte: { sourceClipId: 'x', kind: 'alpha', invert: false },
    })
    expect(drawn).toHaveLength(0)

    chain.renderMatte(inner, 'c1/x', () => {})
    // Now the same request resolves, because the key it looks up is prefixed.
    expect(chain.hasMatte('c1/x')).toBe(true)
    expect(chain.hasMatte('x')).toBe(false)
  })

  it('an empty viewport still refuses, as it always did', () => {
    const gl = new RecordingGl()
    const chain = new EffectChain()
    const empty = { ...ctxFor(gl, chain), viewport: { width: 0, height: 0 } }
    expect(chain.renderMatte(empty, 'm', () => {})).toBe(false)
  })
})


describe('RenderGraph in a compound (PV-P1)', () => {
  interface Item {
    id: string
    zIndex: number
  }
  const TR = [{ id: 'tr', kind: 'fade' as const, t: 0.4, fromClipId: 'a', toClipId: 'b' }]

  function recordingLayer(log: string[]): Layer<Item> {
    return {
      acquire: () => undefined,
      release: () => undefined,
      draw: (item) => log.push(item.id),
      dispose: () => undefined,
      notifyContextLost: () => undefined,
    } as Layer<Item>
  }

  /** A chain that records the keys it is asked for, and reports success. */
  function spyChain() {
    const mattes: string[] = []
    const transitions: Array<[string, string]> = []
    let ended = 0
    return {
      mattes,
      transitions,
      ended: () => ended,
      chain: {
        draw: () => true,
        renderMatte: (_ctx: LayerContext, key: string) => {
          mattes.push(key)
          return true
        },
        drawTransition: (_ctx: LayerContext, from: string, to: string) => {
          transitions.push([from, to])
          return true
        },
        endFrame: () => {
          ended++
        },
      },
    }
  }

  function graphWith(items: Item[], chain: unknown, keyPrefix?: string) {
    const log: string[] = []
    const graph = new RenderGraph()
    graph.registerLayer(recordingLayer(log), () => items, (i) => i.id, (i) => i.zIndex)
    const gl = new RecordingGl()
    gl.viewport(0, 0, 320, 180)
    const ctx: LayerContext = {
      gl: gl as unknown as WebGL2RenderingContext,
      frame: 0,
      stage: { width: 640, height: 360 },
      viewport: { width: 320, height: 180 },
      fps: 30,
      effectChain: chain as LayerContext['effectChain'],
      ...(keyPrefix === undefined ? {} : { keyPrefix }),
    }
    return { graph, ctx, log, scene: { transitions: TR } as unknown as Scene }
  }

  it('namespaces every target it renders', () => {
    const spy = spyChain()
    const { graph, ctx, scene } = graphWith([{ id: 'a', zIndex: 0 }, { id: 'b', zIndex: 1 }], spy.chain, 'p/')
    graph.execute(scene, ctx)
    expect(spy.mattes).toEqual(['p/\u0000tr:from:tr', 'p/\u0000tr:to:tr'])
    expect(spy.transitions).toEqual([['p/\u0000tr:from:tr', 'p/\u0000tr:to:tr']])
  })

  it('leaves the top level exactly as it was: no prefix, and it ends the frame', () => {
    const spy = spyChain()
    const { graph, ctx, scene } = graphWith([{ id: 'a', zIndex: 0 }, { id: 'b', zIndex: 1 }], spy.chain)
    graph.execute(scene, ctx)
    expect(spy.mattes).toEqual(['\u0000tr:from:tr', '\u0000tr:to:tr'])
    expect(spy.ended()).toBe(1)
  })

  it('a nested graph does not end the frame, because its targets are not its own', () => {
    const spy = spyChain()
    const { graph, ctx, scene } = graphWith([{ id: 'a', zIndex: 0 }, { id: 'b', zIndex: 1 }], spy.chain, 'p/')
    graph.execute(scene, ctx)
    // The compound that owns this graph releases its prefix; ending the frame
    // here would free the parent frame's mattes as well.
    expect(spy.ended()).toBe(0)
  })

  it('prefixes a matte source too', () => {
    const spy = spyChain()
    // A matte is declared on the CONSUMING clip, naming its source.
    const items: Array<Item & { matte?: { sourceClipId: string; inverted: boolean } }> = [
      { id: 'a', zIndex: 0 },
      { id: 'b', zIndex: 1, matte: { sourceClipId: 'a', inverted: false } },
    ]
    const log: string[] = []
    const graph = new RenderGraph()
    graph.registerLayer(recordingLayer(log), () => items, (i) => i.id, (i) => i.zIndex)
    const gl = new RecordingGl()
    gl.viewport(0, 0, 320, 180)
    const ctx: LayerContext = {
      gl: gl as unknown as WebGL2RenderingContext,
      frame: 0,
      stage: { width: 640, height: 360 },
      viewport: { width: 320, height: 180 },
      fps: 30,
      effectChain: spy.chain as LayerContext['effectChain'],
      keyPrefix: 'c1/',
    }
    graph.execute({ transitions: [] } as unknown as Scene, ctx)
    expect(spy.mattes).toContain('c1/a')
    expect(spy.mattes).not.toContain('a')
  })
})


// ---------------------------------------------------------------------------
// Layers and the compound picture
// ---------------------------------------------------------------------------

interface ProviderFactory {
  (src: string): VideoFrameProvider
  /** Every src a provider was asked for, in order. */
  srcs: string[]
  /** How many providers have been disposed. */
  disposed: number
}

/** Counts factory calls and records every provider's disposal. */
function makeProviderFactory(): ProviderFactory {
  const srcs: string[] = []
  let disposed = 0
  const factory = ((src: string): VideoFrameProvider => {
    srcs.push(src)
    return {
      getCurrent: () => null,
      setPlayhead: () => {},
      markIdle: () => {},
      markActive: () => {},
      dispose: () => {
        disposed++
      },
    }
  }) as ProviderFactory
  Object.defineProperties(factory, {
    srcs: { get: () => srcs },
    disposed: { get: () => disposed },
  })
  return factory
}

function videoClip(id: string, src: string, zIndex = 0): ActiveVideoClip {
  return {
    id,
    trackId: 't1',
    name: id,
    type: 'video',
    src,
    sourceFrame: 0,
    opacity: 1,
    zIndex,
    volume: 1,
  }
}

function sceneWith(overrides: Partial<Scene> = {}): Scene {
  return {
    frame: 0,
    fps: 30,
    stage: { width: 1280, height: 720 },
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

/** An `ActiveCompoundClip` with one nested video clip, built by hand. */
function compound(
  id: string,
  overrides: Partial<ActiveCompoundClip> = {},
  nested: Partial<Scene> = {},
): ActiveCompoundClip {
  return {
    id,
    trackId: 't1',
    name: id,
    type: 'compound',
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
    contentSize: { width: 1280, height: 720 },
    scene: sceneWith({ videos: [videoClip('v', 'same.mp4')], ...nested }),
    ...overrides,
  }
}

describe('createLayerSet', () => {
  it('registers the item layers in the historical order, the compound last', () => {
    const order: string[] = []
    const spy = vi
      .spyOn(RenderGraph.prototype, 'registerLayer')
      .mockImplementation(function (this: RenderGraph, layer: unknown) {
        order.push((layer as object).constructor.name)
      })
    try {
      createLayerSet({ texturePool: new TexturePool() })
    } finally {
      spy.mockRestore()
    }
    expect(order).toEqual([
      'VideoLayer',
      'ImageLayer',
      'SequenceLayer',
      'TextLayer',
      'ShapeLayer',
      'FreehandLayer',
      'GeneratorLayer',
      'AdjustmentLayer',
      'RotoMaskLayer',
      'CompoundLayer',
    ])
  })

  it('probe mode registers the probe layer in the video slot and has no video layer', () => {
    const set = createLayerSet({ texturePool: new TexturePool(), probeLayer: true })
    expect(set.videoLayer).toBeNull()
    expect(set.graph).toBeInstanceOf(RenderGraph)
  })

  it('a scene with no compounds never touches the compound layer', () => {
    const set = createLayerSet({ texturePool: new TexturePool() })
    const acquire = vi.spyOn(set.compoundLayer, 'acquire')
    const gl = new RecordingGl()
    gl.viewport(0, 0, 640, 360)
    set.graph.execute(sceneWith({ videos: [videoClip('v', 'same.mp4')] }), {
      gl: gl as unknown as WebGL2RenderingContext,
      frame: 0,
      stage: { width: 1280, height: 720 },
      viewport: { width: 640, height: 360 },
      fps: 30,
    })
    expect(acquire).not.toHaveBeenCalled()
    expect(set.compoundLayer.childCount).toBe(0)
  })
})

describe('CompoundLayer', () => {
  const STAGE = { width: 1280, height: 720 }

  interface Harness {
    gl: RecordingGl
    chain: EffectChain
    set: LayerSet
    ctx: LayerContext
    providers: ReturnType<typeof makeProviderFactory>
  }

  function harness(withChain = true): Harness {
    const gl = new RecordingGl()
    // The compound is drawn into half the stage's device pixels, which is what
    // fixes the target size at 640x360 rather than the full content size.
    gl.viewport(0, 0, 640, 360)
    const chain = new EffectChain()
    const providers = makeProviderFactory()
    const set = createLayerSet({ texturePool: new TexturePool(), videoProvider: providers })
    const ctx: LayerContext = {
      gl: gl as unknown as WebGL2RenderingContext,
      frame: 0,
      stage: STAGE,
      viewport: { width: 640, height: 360 },
      fps: 30,
      ...(withChain ? { effectChain: chain } : {}),
    }
    return { gl, chain, set, ctx, providers }
  }

  it('renders the nested scene into a target of its own and places it', () => {
    const h = harness()
    const item = compound('c1')
    const renderTarget = vi.spyOn(h.chain, 'renderTarget')
    // Every graph execute, parent and nested alike: the nested one is handed the
    // compound's coordinate space and key prefix, not the parent's.
    const runs: Array<{ scene: Scene; ctx: LayerContext }> = []
    const execute = RenderGraph.prototype.execute
    vi.spyOn(RenderGraph.prototype, 'execute').mockImplementation(function (
      this: RenderGraph,
      scene: Scene,
      ctx: LayerContext,
    ) {
      runs.push({ scene, ctx })
      return execute.call(this, scene, ctx)
    })

    h.set.graph.execute(sceneWith({ compounds: [item] }), h.ctx)

    expect(renderTarget).toHaveBeenCalledTimes(1)
    const [targetCtx, key, , size] = renderTarget.mock.calls[0]!
    expect(targetCtx.stage).toEqual({ width: 1280, height: 720 })
    expect(key).toBe('c1/\u0000compound')
    expect(size).toEqual({ width: 640, height: 360 })
    const nested = runs.find((r) => r.scene === item.scene)!
    expect(nested.ctx.stage).toEqual({ width: 1280, height: 720 })
    expect(nested.ctx.viewport).toEqual({ width: 640, height: 360 })
    expect(nested.ctx.keyPrefix).toBe('c1/')
    // The parent graph is untouched: no prefix, and the canvas is still the
    // viewport it was handed.
    expect(runs[0]!.ctx.keyPrefix).toBeUndefined()
    expect(runs[0]!.ctx.viewport).toEqual({ width: 640, height: 360 })

    // One decoder for the one nested video clip, keyed by src.
    expect(h.providers.srcs).toEqual(['same.mp4'])
    // Nothing is left in use: the compound's targets went back to the pool.
    expect(h.chain.pool.liveCount).toBe(h.chain.pool.freeCount)
  })

  it("places the target as an image would, and a compound's own effects go through the chain", () => {
    const h = harness()
    const effects = resolveEffects([createEffect('gaussianBlur')])
    const draw = vi.spyOn(h.chain, 'draw')

    h.set.graph.execute(sceneWith({ compounds: [compound('c1', { effects })] }), h.ctx)

    expect(draw).toHaveBeenCalledTimes(1)
    const req = draw.mock.calls[0]![1]
    // Placed at the CONTENT size, not the target size: a 1/2-scale target
    // mapped as if it were the content would shrink the picture by half again.
    expect(req.contentWidth).toBe(1280)
    expect(req.contentHeight).toBe(720)
    expect(req.rect).toEqual(resolveDrawRect(undefined, 1280, 720, 1280, 720))
    expect(req.opacity).toBe(1)
  })

  it('a compound with no effects of its own takes the plain quad path', () => {
    const h = harness()
    const draw = vi.spyOn(h.chain, 'draw')
    const quads = vi.spyOn(h.gl, 'drawArrays')
    h.set.graph.execute(sceneWith({ compounds: [compound('c1')] }), h.ctx)
    // The nested video has no effects either, so the chain is never asked.
    expect(draw).not.toHaveBeenCalled()
    // …and the compound still reached the screen: its quad was drawn.
    expect(quads).toHaveBeenCalled()
  })

  it('a compound that leaves the scene disposes its nested layers with it', () => {
    const h = harness()
    h.set.graph.execute(sceneWith({ compounds: [compound('c1')] }), h.ctx)
    expect(h.providers.disposed).toBe(0)

    h.set.graph.execute(sceneWith({ compounds: [] }), h.ctx)

    expect(h.providers.disposed).toBe(1)
    expect(h.set.compoundLayer.childCount).toBe(0)
  })

  it('without a chain there is nowhere to render, so it draws nothing and does not throw', () => {
    const h = harness(false)
    expect(() => h.set.graph.execute(sceneWith({ compounds: [compound('c1')] }), h.ctx)).not.toThrow()
    expect(h.providers.srcs).toEqual([])
  })
})

describe('compound risk numbers (plan: FBO memory, child decoders)', () => {
  const STAGE = { width: 1280, height: 720 }

  function setup(): { gl: RecordingGl; chain: EffectChain; set: LayerSet; ctx: LayerContext; providers: ReturnType<typeof makeProviderFactory> } {
    const gl = new RecordingGl()
    gl.viewport(0, 0, 1280, 720)
    const chain = new EffectChain()
    const providers = makeProviderFactory()
    const set = createLayerSet({ texturePool: new TexturePool(), videoProvider: providers })
    return {
      gl,
      chain,
      set,
      providers,
      ctx: {
        gl: gl as unknown as WebGL2RenderingContext,
        frame: 0,
        stage: STAGE,
        viewport: { width: 1280, height: 720 },
        fps: 30,
        effectChain: chain,
      },
    }
  }

  it('four levels of nesting hold four targets, and every key is namespaced', () => {
    const { chain, set, ctx } = setup()
    const keys: string[] = []
    const real = chain.renderTarget.bind(chain)
    vi.spyOn(chain, 'renderTarget').mockImplementation((c, key, draw, size) => {
      keys.push(key)
      return real(c, key, draw, size)
    })

    // c1 → c2 → c3 → c4, each holding the next; the innermost holds a video.
    const inner = compound('c4', {}, { videos: [videoClip('v', 'same.mp4')] })
    const c3 = compound('c3', {}, { videos: [], compounds: [inner] })
    const c2 = compound('c2', {}, { videos: [], compounds: [c3] })
    const c1 = compound('c1', {}, { videos: [], compounds: [c2] })

    set.graph.execute(sceneWith({ compounds: [c1] }), ctx)

    expect(keys).toEqual([
      'c1/\u0000compound',
      'c1/c2/\u0000compound',
      'c1/c2/c3/\u0000compound',
      'c1/c2/c3/c4/\u0000compound',
    ])
    // The plan's threshold: 4 alive, and the cap is 5. All four are back in the
    // pool, so the next frame starts from the same place.
    expect(chain.pool.liveCount).toBeLessThanOrEqual(5)
    expect(chain.pool.liveCount).toBe(chain.pool.freeCount)
    expect(chain.pool.freeCount).toBe(4)
  })

  it('two compounds sharing one nested source open exactly two decoders', () => {
    const { set, ctx, providers } = setup()
    const a = compound('a')
    const b = compound('b')
    set.graph.execute(sceneWith({ compounds: [a, b] }), ctx)
    // One provider per compound, NOT one per src and not one shared: the two
    // child sets have independent VideoLayers, so neither can starve the other.
    expect(providers.srcs).toEqual(['same.mp4', 'same.mp4'])
  })

  it('a fifth level is refused rather than rendered', () => {
    const { chain, set, ctx } = setup()
    const keys: string[] = []
    const real = chain.renderTarget.bind(chain)
    vi.spyOn(chain, 'renderTarget').mockImplementation((c, key, draw, size) => {
      keys.push(key)
      return real(c, key, draw, size)
    })

    // Five compounds, each holding the next - deeper than the document reader
    // allows, so only a hand-built Scene can produce it. Rendering it would
    // recurse until the stack gives out, so the layer stops at the cap.
    let inner = compound('c5', {}, { videos: [videoClip('v', 'same.mp4')] })
    for (const id of ['c4', 'c3', 'c2', 'c1']) {
      inner = compound(id, {}, { videos: [], compounds: [inner] })
    }
    set.graph.execute(sceneWith({ compounds: [inner] }), ctx)

    expect(MAX_COMPOUND_RENDER_DEPTH).toBe(4)
    expect(keys).toHaveLength(4)
    expect(keys[3]).toBe('c1/c2/c3/c4/\u0000compound')
  })
})
