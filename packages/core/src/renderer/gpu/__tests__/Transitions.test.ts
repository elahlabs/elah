/**
 * EDX-P9c: GPU transitions — the render graph composites a transitioning
 * pair through the chain, the registry drives kinds and document versions,
 * and the resolver keeps both clips live.
 */

import { describe, expect, it, vi } from 'vitest'
import { EffectChain } from '../EffectChain'
import { RenderGraph } from '../RenderGraph'
import { RecordingGl } from '../debug/RecordingGl'
import type { Layer, LayerContext } from '../layers/types'
import type { Scene } from '../../../resolver/scene'
import { TRANSITION_FRAG_SRC, TRANSITION_KIND_INDEX, transitionDirection } from '../transitions'
import { TRANSITION_KINDS, TRANSITION_REGISTRY, getTransitionDefinition } from '../../../transitions/registry'
import { TimelineEngine } from '../../../editor/TimelineEngine'
import { resolveTimeline } from '../../../resolver/resolveTimeline'
import { readProjectDocument } from '../../../editor/projectDocument'
import { projectNeedsGpu, WorkerEffectRenderer } from '../../../export/gpuExport'

type Item = { id: string; zIndex: number }

function recordingLayer(log: string[]): Layer<Item> {
  return {
    acquire: () => undefined,
    release: () => undefined,
    draw: (item) => log.push(item.id),
    dispose: () => undefined,
    notifyContextLost: () => undefined,
  } as Layer<Item>
}

function graphWith(items: Item[], transitions: Scene['transitions'], chain?: EffectChain) {
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
    ...(chain ? { effectChain: chain } : {}),
  }
  return { graph, ctx, log, scene: { transitions } as unknown as Scene }
}

const TR = [{ id: 'tr', kind: 'zoom' as const, t: 0.4, fromClipId: 'a', toClipId: 'b' }]

describe('RenderGraph transitions', () => {
  it('renders both clips into targets, then composites them where the incoming clip sits', () => {
    const chain = new EffectChain()
    const renderMatte = vi.spyOn(chain, 'renderMatte')
    const drawTransition = vi.spyOn(chain, 'drawTransition').mockReturnValue(true)
    const endFrame = vi.spyOn(chain, 'endFrame')
    const { graph, ctx, log, scene } = graphWith(
      [
        { id: 'a', zIndex: 0 },
        { id: 'b', zIndex: 1 },
        { id: 'title', zIndex: 2000 },
      ],
      TR,
      chain,
    )
    graph.execute(scene, ctx)
    // a and b drawn once each, into their targets; never again in the main pass.
    expect(log).toEqual(['a', 'b', 'title'])
    expect(renderMatte).toHaveBeenCalledTimes(2)
    expect(drawTransition).toHaveBeenCalledTimes(1)
    expect(drawTransition.mock.calls[0]![3]).toEqual({ kind: 'zoom', t: 0.4 })
    expect(endFrame).toHaveBeenCalledTimes(1)
  })

  it('falls back to drawing both clips when the shader cannot run', () => {
    const chain = new EffectChain()
    vi.spyOn(chain, 'drawTransition').mockReturnValue(false)
    const { graph, ctx, log, scene } = graphWith([{ id: 'a', zIndex: 0 }, { id: 'b', zIndex: 1 }], TR, chain)
    graph.execute(scene, ctx)
    // Once each into targets, then plainly: outgoing first.
    expect(log).toEqual(['a', 'b', 'a', 'b'])
  })

  it('without a chain, or with half the pair missing, clips draw normally', () => {
    const noChain = graphWith([{ id: 'a', zIndex: 0 }, { id: 'b', zIndex: 1 }], TR)
    noChain.graph.execute(noChain.scene, noChain.ctx)
    expect(noChain.log).toEqual(['a', 'b'])
    const chain = new EffectChain()
    const drawTransition = vi.spyOn(chain, 'drawTransition')
    const half = graphWith([{ id: 'b', zIndex: 1 }], TR, chain)
    half.graph.execute(half.scene, half.ctx)
    expect(half.log).toEqual(['b'])
    expect(drawTransition).not.toHaveBeenCalled()
  })
})

describe('transition shader and registry', () => {
  it('has one shader branch per registered kind, and legacy kinds first', () => {
    expect(Object.keys(TRANSITION_KIND_INDEX).sort()).toEqual([...TRANSITION_KINDS].sort())
    expect(new Set(Object.values(TRANSITION_KIND_INDEX)).size).toBe(TRANSITION_KINDS.length)
    expect(TRANSITION_FRAG_SRC.startsWith('#version 300 es')).toBe(true)
    for (const u of ['uFrom', 'uTo', 'uT', 'uKind', 'uDir', 'uAspect']) expect(TRANSITION_FRAG_SRC).toMatch(new RegExp(`uniform \\w+ ${u};`))
    expect(TRANSITION_REGISTRY.filter((t) => t.legacy).map((t) => t.kind)).toEqual(['fade', 'slide', 'wipe'])
    expect(getTransitionDefinition('whip')?.directional).toBe(true)
  })

  it('maps directions in GL orientation (the old slide moved left for "left")', () => {
    expect(transitionDirection('left')).toEqual([-1, 0])
    expect(transitionDirection(undefined)).toEqual([1, 0])
    expect(transitionDirection('up')).toEqual([0, 1])
  })

  it('draws a transition with both targets bound and blending on', () => {
    const chain = new EffectChain()
    const gl = new RecordingGl()
    gl.viewport(0, 0, 320, 180)
    const ctx: LayerContext = { gl: gl as unknown as WebGL2RenderingContext, frame: 0, stage: { width: 640, height: 360 }, viewport: { width: 320, height: 180 }, fps: 30 }
    expect(chain.drawTransition(ctx, 'x', 'y', { kind: 'fade', t: 0.5 })).toBe(false)
    chain.renderMatte(ctx, 'x', () => undefined)
    chain.renderMatte(ctx, 'y', () => undefined)
    expect(chain.drawTransition(ctx, 'x', 'y', { kind: 'spin', t: 0.5 })).toBe(true)
  })
})

describe('transitions in the document and export', () => {
  function project(kind: 'fade' | 'whip') {
    const engine = new TimelineEngine({ fps: 30 })
    const v = engine.addTrack('video').id
    const a = engine.addClip({ trackId: v, type: 'image', name: 'a', src: 'a.png', startFrame: 0, durationFrames: 30 })
    const b = engine.addClip({ trackId: v, type: 'image', name: 'b', src: 'b.png', startFrame: 30, durationFrames: 30 })
    engine.addTransition({ fromClipId: a.id, toClipId: b.id, trackId: v, kind, durationFrames: 10 })
    return engine.getProject()
  }

  it('new kinds stamp version 3 and round-trip; legacy kinds stay version 1', () => {
    expect(project('fade').version).toBe(1)
    const whip = project('whip')
    expect(whip.version).toBe(3)
    expect(readProjectDocument(JSON.parse(JSON.stringify(whip))).transitions[0]!.kind).toBe('whip')
  })

  it('both clips are live in the scene with their resolved opacity', () => {
    const scene = resolveTimeline(30, project('fade'))
    expect(scene.transitions).toHaveLength(1)
    expect(scene.images.map((i) => i.opacity)).toEqual([1, 1])
  })

  it('only GPU-only kinds force the GPU in export', () => {
    expect(projectNeedsGpu(project('fade'))).toBe(false)
    expect(projectNeedsGpu(project('whip'))).toBe(true)
  })

  it('the export renderer composites two painted canvases', () => {
    const gl = new RecordingGl()
    const renderer = WorkerEffectRenderer.create({ width: 64, height: 36 }, { width: 640, height: 360 }, 30, () => ({
      canvas: { width: 64, height: 36 } as unknown as OffscreenCanvas,
      gl: gl as unknown as WebGL2RenderingContext,
    }))
    const src = { width: 64, height: 36 } as unknown as TexImageSource
    expect(renderer.drawTransition(src, src, { kind: 'glitchCut', t: 0.5 }, 3)).toBe(renderer.canvas)
  })
})
