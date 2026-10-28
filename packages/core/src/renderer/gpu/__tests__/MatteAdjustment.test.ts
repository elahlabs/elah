/**
 * EDX-P7b: adjustment clips and track mattes — resolver output, version
 * stamping, render-graph routing and the empty-matte rule.
 */

import { describe, expect, it, vi } from 'vitest'
import { TimelineEngine } from '../../../editor/TimelineEngine'
import { documentVersionFor } from '../../../editor/projectDocument'
import { createEffect } from '../../../effects/registry'
import { resolveTimeline } from '../../../resolver/resolveTimeline'
import { RecordingGl } from '../debug/RecordingGl'
import { EffectChain } from '../EffectChain'
import { RenderGraph } from '../RenderGraph'
import type { Layer, LayerContext } from '../layers/types'
import type { Scene } from '../../../resolver/scene'

function engineWithTracks() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 640, height: 360 } })
  const v = engine.addTrack('video').id
  const v2 = engine.addTrack('video').id
  return { engine, v, v2 }
}

describe('adjustment clips', () => {
  it('resolve into scene.adjustments only when they carry something to apply', () => {
    const { engine, v2 } = engineWithTracks()
    const adj = engine.addClip({ trackId: v2, type: 'adjustment', name: 'Grade', startFrame: 0, durationFrames: 30 })
    expect(resolveTimeline(5, engine.getProject()).adjustments).toBeUndefined()
    engine.updateClip(adj.id, v2, { effects: [createEffect('colorGrade', 'noir')] })
    const scene = resolveTimeline(5, engine.getProject())
    expect(scene.adjustments).toHaveLength(1)
    expect(scene.adjustments![0]).toMatchObject({ type: 'adjustment', id: adj.id })
    expect(scene.adjustments![0]!.effects![0]!.kind).toBe('colorGrade')
  })

  it('a scene without adjustment clips has no adjustments key (scene shape unchanged)', () => {
    const { engine, v } = engineWithTracks()
    engine.addClip({ trackId: v, type: 'image', name: 'i', src: 'i.png', startFrame: 0, durationFrames: 30 } as never)
    expect('adjustments' in resolveTimeline(0, engine.getProject())).toBe(false)
  })

  it('stamp the project version 2 in the same undo step', () => {
    const { engine, v2 } = engineWithTracks()
    expect(engine.getProject().version).toBe(1)
    engine.addClip({ trackId: v2, type: 'adjustment', name: 'A', startFrame: 0, durationFrames: 30 })
    expect(engine.getProject().version).toBe(2)
    expect(documentVersionFor(engine.getProject())).toBe(2)
    engine.undo()
    expect(engine.getProject().version).toBe(1)
    expect(documentVersionFor(engine.getProject())).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Render graph: matte sources are pre-rendered and hidden
// ---------------------------------------------------------------------------

interface Item {
  id: string
  zIndex: number
  matte?: { sourceClipId: string; kind: 'alpha' | 'luma'; invert: boolean }
}

function recordingLayer(log: string[]): Layer<Item> {
  return {
    acquire: () => {},
    release: () => {},
    draw: (item) => log.push(item.id),
    dispose: () => {},
  }
}

function graphWith(items: Item[], chain?: EffectChain) {
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
  return { graph, ctx, log, scene: {} as Scene }
}

describe('RenderGraph mattes', () => {
  it('draws a matte source into its own target first and hides it from the picture', () => {
    const chain = new EffectChain()
    const renderMatte = vi.spyOn(chain, 'renderMatte')
    const endFrame = vi.spyOn(chain, 'endFrame')
    const items: Item[] = [
      { id: 'bg', zIndex: 0 },
      { id: 'text-matte', zIndex: 1000 },
      { id: 'fill', zIndex: 2000, matte: { sourceClipId: 'text-matte', kind: 'alpha', invert: false } },
    ]
    const { graph, ctx, log, scene } = graphWith(items, chain)
    graph.execute(scene, ctx)
    expect(renderMatte).toHaveBeenCalledTimes(1)
    expect(renderMatte.mock.calls[0]![1]).toBe('text-matte')
    // Drawn once — inside renderMatte — and never in the main pass.
    expect(log).toEqual(['text-matte', 'bg', 'fill'])
    expect(endFrame).toHaveBeenCalledTimes(1)
  })

  it('a frame without mattes takes none of the matte path', () => {
    const chain = new EffectChain()
    const renderMatte = vi.spyOn(chain, 'renderMatte')
    const endFrame = vi.spyOn(chain, 'endFrame')
    const { graph, ctx, log, scene } = graphWith([{ id: 'a', zIndex: 0 }, { id: 'b', zIndex: 1 }], chain)
    graph.execute(scene, ctx)
    expect(log).toEqual(['a', 'b'])
    expect(renderMatte).not.toHaveBeenCalled()
    expect(endFrame).not.toHaveBeenCalled()
  })

  it('a matte whose source is not on screen hides nothing else', () => {
    const { graph, ctx, log, scene } = graphWith(
      [{ id: 'fill', zIndex: 0, matte: { sourceClipId: 'gone', kind: 'luma', invert: false } }],
      new EffectChain(),
    )
    graph.execute(scene, ctx)
    expect(log).toEqual(['fill'])
  })
})

describe('EffectChain empty-matte rule', () => {
  const base = {
    program: null as never,
    vao: {} as WebGLVertexArrayObject,
    unit: 0,
    contentWidth: 100,
    contentHeight: 100,
    rect: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    opacity: 1,
    effects: [],
  }
  const ctx = (gl: RecordingGl): LayerContext => ({
    gl: gl as unknown as WebGL2RenderingContext,
    frame: 0,
    stage: { width: 100, height: 100 },
    viewport: { width: 100, height: 100 },
    fps: 30,
  })

  it('hides the clip (reports drawn, draws nothing) when its alpha/luma matte is missing', () => {
    const gl = new RecordingGl()
    const draws = vi.spyOn(gl, 'drawArrays')
    const chain = new EffectChain()
    expect(chain.draw(ctx(gl), { ...base, matte: { sourceClipId: 'x', kind: 'alpha', invert: false } })).toBe(true)
    expect(draws).not.toHaveBeenCalled()
  })

  it('ignores a missing inverted matte (nothing to cut away)', () => {
    const gl = new RecordingGl()
    const chain = new EffectChain()
    expect(chain.draw(ctx(gl), { ...base, matte: { sourceClipId: 'x', kind: 'alpha', invert: true } })).toBe(false)
  })
})
