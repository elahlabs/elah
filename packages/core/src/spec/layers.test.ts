import { describe, expect, it } from 'vitest'
import { packLayers, type LayerInput } from './layers'

describe('packLayers — order direction', () => {
  it('a HIGHER spec layer gets a HIGHER order — verified against the engine, not assumed', () => {
    // `resolver/resolveTimeline.ts`'s `trackZIndex` computes `order * 1000`
    // (elements tracks get a fixed offset added uniformly, so relative
    // ordering among them is decided by `order` alone), and a HIGHER zIndex
    // composites CLOSER TO THE VIEWER (`ctx.drawImage` calls run low to
    // high zIndex, later draws on top — the codebase carries a stale doc
    // comment claiming lower order is "closer to the viewer"; this test
    // pins the real, opposite behaviour so a future edit cannot silently
    // flip it back). So a higher order must mean more zIndex, and packLayers
    // must give a higher spec `layer` a higher `order` for "higher layer
    // draws in front" to hold once the engine composites it.
    const elements: LayerInput[] = [
      { id: 'back', layer: 0, startFrame: 0, durationFrames: 10 },
      { id: 'front', layer: 5, startFrame: 0, durationFrames: 10 },
    ]
    const { orderOf } = packLayers(elements)
    expect(orderOf.front!).toBeGreaterThan(orderOf.back!)
  })

  it('ascending layer values produce strictly ascending orders across the whole set', () => {
    const elements: LayerInput[] = [
      { id: 'a', layer: 2, startFrame: 0, durationFrames: 5 },
      { id: 'b', layer: -1, startFrame: 0, durationFrames: 5 },
      { id: 'c', layer: 0, startFrame: 0, durationFrames: 5 },
    ]
    const { orderOf } = packLayers(elements)
    expect(orderOf.b!).toBeLessThan(orderOf.c!)
    expect(orderOf.c!).toBeLessThan(orderOf.a!)
  })

  it('startOrder offsets every lane, for a caller that reserved lower orders (a background track)', () => {
    const elements: LayerInput[] = [{ id: 'a', layer: 0, startFrame: 0, durationFrames: 5 }]
    expect(packLayers(elements, 1).orderOf.a).toBe(1)
    expect(packLayers(elements, 0).orderOf.a).toBe(0)
  })
})

describe('packLayers — overlap packing', () => {
  it('two overlapping elements on the SAME layer land on two different tracks (orders)', () => {
    const elements: LayerInput[] = [
      { id: 'a', layer: 0, startFrame: 0, durationFrames: 20 },
      { id: 'b', layer: 0, startFrame: 10, durationFrames: 20 }, // overlaps a: [10,20) vs [0,20)
    ]
    const { lanes, orderOf } = packLayers(elements)
    expect(orderOf.a).not.toBe(orderOf.b)
    expect(lanes).toHaveLength(2)
  })

  it('two NON-overlapping elements on the same layer share one track', () => {
    const elements: LayerInput[] = [
      { id: 'a', layer: 0, startFrame: 0, durationFrames: 10 },
      { id: 'b', layer: 0, startFrame: 10, durationFrames: 10 }, // touching, not overlapping
    ]
    const { lanes, orderOf } = packLayers(elements)
    expect(orderOf.a).toBe(orderOf.b)
    expect(lanes).toHaveLength(1)
  })

  it('three mutually overlapping elements need three lanes', () => {
    const elements: LayerInput[] = [
      { id: 'a', layer: 0, startFrame: 0, durationFrames: 30 },
      { id: 'b', layer: 0, startFrame: 5, durationFrames: 30 },
      { id: 'c', layer: 0, startFrame: 10, durationFrames: 30 },
    ]
    const { lanes } = packLayers(elements)
    expect(lanes).toHaveLength(3)
  })

  it('a lane the packer reuses never holds two overlapping clips (the engine throws on that)', () => {
    const elements: LayerInput[] = [
      { id: 'a', layer: 3, startFrame: 0, durationFrames: 10 },
      { id: 'b', layer: 3, startFrame: 10, durationFrames: 10 }, // reuses a's lane
      { id: 'c', layer: 3, startFrame: 5, durationFrames: 10 }, // overlaps both -> new lane
    ]
    const { lanes } = packLayers(elements)
    for (const lane of lanes) {
      const members = lane.elementIds.map((id) => elements.find((e) => e.id === id)!)
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i]!
          const b = members[j]!
          const overlap = a.startFrame < b.startFrame + b.durationFrames && b.startFrame < a.startFrame + a.durationFrames
          expect(overlap).toBe(false)
        }
      }
    }
  })
})
