import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scene } from '../../../resolver/scene'
import { RenderGraph } from '../RenderGraph'
import type { Layer, LayerContext } from '../layers/types'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface TestItem {
  id: string
  zIndex: number
  label: string
}

const STUB_SCENE: Scene = {
  frame: 0,
  fps: 30,
  stage: { width: 1280, height: 720 },
  videos: [],
  audios: [],
  texts: [],
  images: [],
  transitions: [],
}

const STUB_CTX = {
  gl: null as unknown as WebGL2RenderingContext,
  stage: { width: 1280, height: 720 },
  viewport: { width: 1280, height: 720 },
  fps: 30,
} satisfies LayerContext

function makeMockLayer(): Layer<TestItem> & {
  acquire: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
  draw: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
} {
  return {
    acquire: vi.fn(),
    release: vi.fn(),
    draw: vi.fn(),
    dispose: vi.fn(),
  }
}

function item(id: string, zIndex: number, label = id): TestItem {
  return { id, zIndex, label }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RenderGraph', () => {
  let graph: RenderGraph
  let items: TestItem[]
  let layer: ReturnType<typeof makeMockLayer>

  beforeEach(() => {
    graph = new RenderGraph()
    items = []
    layer = makeMockLayer()
    graph.registerLayer(
      layer,
      () => items,
      (i) => i.id,
      (i) => i.zIndex,
    )
  })

  it('draws items in ascending zIndex order', () => {
    items = [item('c', 3), item('a', 1), item('b', 2)]
    graph.execute(STUB_SCENE, STUB_CTX)

    const drawOrder = layer.draw.mock.calls.map(([drawn]) => (drawn as TestItem).id)
    expect(drawOrder).toEqual(['a', 'b', 'c'])
  })

  it('sorts items across multiple layers by global zIndex', () => {
    const layerB = makeMockLayer()
    let itemsB: TestItem[] = []

    graph.registerLayer(
      layerB,
      () => itemsB,
      (i) => i.id,
      (i) => i.zIndex,
    )

    items = [item('a1', 2)]
    itemsB = [item('b1', 1), item('b2', 3)]

    graph.execute(STUB_SCENE, STUB_CTX)

    const allDrawCalls = [
      ...layer.draw.mock.calls.map(([i]) => ({
        id: (i as TestItem).id,
        z: (i as TestItem).zIndex,
      })),
      ...layerB.draw.mock.calls.map(([i]) => ({
        id: (i as TestItem).id,
        z: (i as TestItem).zIndex,
      })),
    ].sort((a, b) => a.z - b.z)

    expect(allDrawCalls.map((c) => c.id)).toEqual(['b1', 'a1', 'b2'])
  })

  it('calls acquire() for entering items exactly once', () => {
    items = [item('a', 0), item('b', 1)]
    graph.execute(STUB_SCENE, STUB_CTX)

    expect(layer.acquire).toHaveBeenCalledTimes(2)
    expect(layer.acquire).toHaveBeenCalledWith(items[0], STUB_CTX)
    expect(layer.acquire).toHaveBeenCalledWith(items[1], STUB_CTX)

    // Second execute with same items — no re-acquire.
    graph.execute(STUB_SCENE, STUB_CTX)
    expect(layer.acquire).toHaveBeenCalledTimes(2)
  })

  it('calls release() for leaving items and skips draw()', () => {
    items = [item('a', 0), item('b', 1)]
    graph.execute(STUB_SCENE, STUB_CTX)

    items = [item('a', 0)]
    layer.draw.mockClear()
    graph.execute(STUB_SCENE, STUB_CTX)

    expect(layer.release).toHaveBeenCalledTimes(1)
    expect(layer.release).toHaveBeenCalledWith('b')

    const drawIds = layer.draw.mock.calls.map(([drawn]) => (drawn as TestItem).id)
    expect(drawIds).toEqual(['a'])
  })

  it('refreshes persisting items without re-acquiring', () => {
    items = [item('a', 0, 'original')]
    graph.execute(STUB_SCENE, STUB_CTX)

    items = [item('a', 0, 'updated')]
    graph.execute(STUB_SCENE, STUB_CTX)

    expect(layer.acquire).toHaveBeenCalledTimes(1)
    const calls = layer.draw.mock.calls
    const lastDrawn = calls[calls.length - 1]?.[0] as TestItem
    expect(lastDrawn.label).toBe('updated')
  })

  it('notifyContextLost() releases all active items', () => {
    items = [item('a', 0), item('b', 1)]
    graph.execute(STUB_SCENE, STUB_CTX)

    graph.notifyContextLost()

    expect(layer.release).toHaveBeenCalledTimes(2)
    expect(layer.release).toHaveBeenCalledWith('a')
    expect(layer.release).toHaveBeenCalledWith('b')

    layer.acquire.mockClear()
    layer.draw.mockClear()

    graph.execute(STUB_SCENE, STUB_CTX)
    expect(layer.acquire).toHaveBeenCalledTimes(2)
    expect(layer.draw).toHaveBeenCalledTimes(2)
  })

  it('dispose() releases active items and calls layer.dispose()', () => {
    items = [item('a', 0)]
    graph.execute(STUB_SCENE, STUB_CTX)

    graph.dispose()

    expect(layer.release).toHaveBeenCalledWith('a')
    expect(layer.dispose).toHaveBeenCalledTimes(1)

    layer.draw.mockClear()
    graph.execute(STUB_SCENE, STUB_CTX)
    expect(layer.draw).not.toHaveBeenCalled()
  })
})

describe('RenderGraph scene diffing', () => {
  it('detects simultaneous enter and leave in one tick', () => {
    const graph = new RenderGraph()
    let items: TestItem[] = []
    const layer = makeMockLayer()

    graph.registerLayer(
      layer,
      () => items,
      (i) => i.id,
      (i) => i.zIndex,
    )

    items = [item('a', 0), item('b', 1)]
    graph.execute(STUB_SCENE, STUB_CTX)

    items = [item('b', 1), item('c', 2)]
    layer.draw.mockClear()
    graph.execute(STUB_SCENE, STUB_CTX)

    expect(layer.release).toHaveBeenCalledWith('a')
    expect(layer.acquire).toHaveBeenCalledWith(expect.objectContaining({ id: 'c' }), STUB_CTX)

    const drawIds = layer.draw.mock.calls.map(([drawn]) => (drawn as TestItem).id)
    expect(drawIds).toEqual(['b', 'c'])
  })
})

describe('TestLayer transform matrix', () => {
  it('maps a full-stage quad to clip-space corners', async () => {
    const { buildTransformMatrix } = await import('../layers/TestLayer')

    const mat = buildTransformMatrix(
      { id: 'full', zIndex: 0, color: [1, 0, 0, 1], x: 0, y: 0, width: 1280, height: 720 },
      1280,
      720,
    )

    // Top-left (0,0) -> ndc (-1, -1) before shader Y flip
    expect(mat[6]).toBeCloseTo(-1, 5) // tx for pos.x=0
    expect(mat[7]).toBeCloseTo(-1, 5) // ty for pos.y=0

    // Bottom-right corner: pos=(1,1) -> ndc (1, 1)
    const ndcX = mat[0] * 1 + mat[3] * 1 + mat[6]
    const ndcY = mat[1] * 1 + mat[4] * 1 + mat[7]
    expect(ndcX).toBeCloseTo(1, 5)
    expect(ndcY).toBeCloseTo(1, 5)
  })
})
