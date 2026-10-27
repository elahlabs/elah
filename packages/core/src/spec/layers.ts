/**
 * layers.ts — elements to tracks (AV-1).
 *
 * A `VideoSpec` element names a `layer`, a plain number: whatever else is on
 * that layer must never visually conflict with it in TIME, because the
 * engine's `update` visitor THROWS when a clip would overlap another on the
 * same track, and a throw inside `layProject`'s batch rolls back the whole
 * generated video. So this module groups elements by `layer` and then
 * interval-packs each group into as many lanes as it takes so no two clips on
 * one lane overlap — the same problem `ops/apply.ts`'s `laneFor` solves for a
 * single new clip against a live engine, done here up front for a whole batch
 * with no engine at all.
 *
 * `Track.order` direction (verified in `layers.test.ts` against
 * `resolver/resolveTimeline.ts`'s `trackZIndex`, `order * 1000`): a HIGHER
 * `order` composites CLOSER to the viewer. So a higher `layer` must map to a
 * higher `order` — ascending layer, ascending order — which is exactly what
 * processing layers from lowest to highest while a single counter climbs
 * gives for free.
 *
 * Pure: no ids, no `Track` objects, no engine. `compile.ts` turns the
 * `order` this returns into real tracks.
 */

export interface LayerInput {
  id: string
  /** Compositing layer; a higher number draws in front. */
  layer: number
  startFrame: number
  durationFrames: number
}

/** One synthesized lane: an `order` and the element ids placed on it, in start order. */
export interface LayerLane {
  order: number
  elementIds: string[]
}

export interface LayerPackResult {
  /** One entry per lane created, ascending `order` (back -> front). */
  lanes: LayerLane[]
  /** elementId -> the `order` of the lane its clip lands on. */
  orderOf: Record<string, number>
}

function overlaps(a: LayerInput, bEnd: number): boolean {
  return a.startFrame < bEnd
}

/**
 * Interval-pack `elements` (all understood to share ONE `layer`) into the
 * fewest lanes such that no two placed on the same lane overlap. Greedy:
 * elements are taken in start-frame order; each is placed on the first lane
 * whose last-placed element already ends at or before this one starts, or a
 * new lane is opened when none does. Ties within a layer (which lane an
 * overlapping element of that SAME layer lands on relative to another) are
 * arbitrary — the spec has no vocabulary for stacking order within one
 * layer — but deterministic, since the input order (sorted by start, then by
 * the order given) always produces the same lanes.
 */
function packOneLayer(elements: ReadonlyArray<LayerInput>): string[][] {
  const sorted = [...elements].sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id))
  const lanes: { end: number; ids: string[] }[] = []
  for (const el of sorted) {
    const end = el.startFrame + el.durationFrames
    const lane = lanes.find((l) => !overlaps(el, l.end))
    if (lane) {
      lane.ids.push(el.id)
      lane.end = end
    } else {
      lanes.push({ end, ids: [el.id] })
    }
  }
  return lanes.map((l) => l.ids)
}

/**
 * Group `elements` by `layer` and interval-pack each group, returning lanes
 * in ascending `order` starting at `startOrder` (default 0) — so a caller
 * that has already reserved lower orders (a background track) can offset the
 * whole result by passing `startOrder: 1`.
 */
export function packLayers(elements: ReadonlyArray<LayerInput>, startOrder = 0): LayerPackResult {
  const byLayer = new Map<number, LayerInput[]>()
  for (const el of elements) {
    const list = byLayer.get(el.layer)
    if (list) list.push(el)
    else byLayer.set(el.layer, [el])
  }
  const layerValues = [...byLayer.keys()].sort((a, b) => a - b)

  const lanes: LayerLane[] = []
  const orderOf: Record<string, number> = {}
  let order = startOrder
  for (const layer of layerValues) {
    const laneGroups = packOneLayer(byLayer.get(layer)!)
    for (const elementIds of laneGroups) {
      lanes.push({ order, elementIds })
      for (const id of elementIds) orderOf[id] = order
      order += 1
    }
  }
  return { lanes, orderOf }
}
