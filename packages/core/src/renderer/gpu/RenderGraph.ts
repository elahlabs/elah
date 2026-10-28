/**
 * RenderGraph — Scene diffing and layer dispatch.
 *
 * Holds a registry of Layer instances keyed by clip kind. On each execute():
 *   1. Diff each layer's active items against the current Scene slice.
 *   2. Call acquire() for entering items and release() for leaving items.
 *   3. Build a flat draw list sorted by zIndex ascending (stable sort).
 *   4. Issue draw() on each active item in order.
 *
 * RenderGraph is generic — new clip kinds register via registerLayer() without
 * modifying this file.
 */

import type { ActiveTransition, Scene } from '../../resolver/scene'
import type { Layer, LayerContext } from './layers/types'
import type { SceneDiff } from './types'

/** Internal bookkeeping for one registered layer. */
interface LayerRegistration<TItem> {
  layer: Layer<TItem>
  getItems: (scene: Scene) => TItem[]
  getId: (item: TItem) => string
  getZIndex: (item: TItem) => number
  /** Items currently acquired and eligible for draw(). */
  activeItems: Map<string, TItem>
}

/** A single entry in the sorted draw list built each execute() tick. */
interface RenderEntry<TItem> {
  layer: Layer<TItem>
  item: TItem
  id: string
  zIndex: number
}

/** Ids of drawn items that another drawn item uses as its track matte. */
function mattesInUse(drawList: ReadonlyArray<RenderEntry<unknown>>): ReadonlySet<string> {
  let wanted: Set<string> | null = null
  for (const entry of drawList) {
    const matte = (entry.item as { matte?: { sourceClipId?: string } }).matte
    if (matte?.sourceClipId) (wanted ??= new Set()).add(matte.sourceClipId)
  }
  if (!wanted) return EMPTY
  const present = new Set<string>()
  for (const entry of drawList) if (wanted.has(entry.id)) present.add(entry.id)
  return present
}

const EMPTY: ReadonlySet<string> = new Set()

/** Target key for one side of a transition; cannot collide with a clip id. */
function transitionKey(side: 'from' | 'to', transitionId: string): string {
  return `\u0000tr:${side}:${transitionId}`
}

export class RenderGraph {
  private readonly _registrations: LayerRegistration<unknown>[] = []

  /**
   * Register a layer that handles one kind of Scene item.
   *
   * @param layer     The Layer implementation.
   * @param getItems  Extracts the relevant array from a Scene (e.g. scene.videos).
   * @param getId     Returns the stable id for an item (used for diffing).
   * @param getZIndex Returns the compositing zIndex for an item.
   */
  registerLayer<TItem>(
    layer: Layer<TItem>,
    getItems: (scene: Scene) => TItem[],
    getId: (item: TItem) => string,
    getZIndex: (item: TItem) => number,
  ): void {
    this._registrations.push({
      layer: layer as Layer<unknown>,
      getItems: getItems as (scene: Scene) => unknown[],
      getId: getId as (item: unknown) => string,
      getZIndex: getZIndex as (item: unknown) => number,
      activeItems: new Map(),
    })
  }

  /**
   * Diff the Scene against active items, drive acquire/release, then draw.
   * Called once per render tick by GpuRenderer.
   */
  execute(scene: Scene, ctx: LayerContext): void {
    const drawList: RenderEntry<unknown>[] = []

    for (const reg of this._registrations) {
      const currentItems = reg.getItems(scene)
      const diff = this._diff(currentItems, reg.activeItems, reg.getId)

      for (const id of diff.leaving) {
        reg.layer.release(id)
        reg.activeItems.delete(id)
      }

      for (const item of diff.entering) {
        reg.layer.acquire(item, ctx)
        reg.activeItems.set(reg.getId(item), item)
      }

      // Refresh persisting items so draw() sees the latest Scene data.
      for (const item of currentItems) {
        const id = reg.getId(item)
        if (reg.activeItems.has(id)) {
          reg.activeItems.set(id, item)
        }
      }

      // Iterate the Scene's own order (currentItems), not activeItems.values()
      // — the Map's insertion order is *acquire* order (when a clip first
      // entered the scene), so equal-zIndex ties would otherwise depend on
      // playback direction/scrub history instead of the Scene's deterministic
      // order, and could disagree with ExportWorker's tie-break.
      for (const item of currentItems) {
        drawList.push({
          layer: reg.layer,
          item,
          id: reg.getId(item),
          zIndex: reg.getZIndex(item),
        })
      }
    }

    // Stable ascending sort: lower zIndex draws first (back), higher draws last (front).
    drawList.sort((a, b) => a.zIndex - b.zIndex)

    // Track mattes (EDX-P7): any clip another clip uses as a matte this frame
    // is drawn into an offscreen target first and hidden from the picture —
    // Premiere's rule for a matte layer. Frames with no matte skip all of it.
    const matteSources = mattesInUse(drawList)
    const chain = ctx.effectChain
    // A nested graph namespaces every target it renders, so two copies of one
    // compound (which hold the same nested clip ids) never share a matte or a
    // transition target. At the top level the prefix is empty and every key and
    // every call is exactly what it was.
    const prefix = ctx.keyPrefix ?? ''
    if (matteSources.size > 0 && chain?.renderMatte) {
      for (const entry of drawList) {
        const id = entry.id
        if (!matteSources.has(id)) continue
        chain.renderMatte(ctx, prefix + id, () => entry.layer.draw(entry.item, ctx))
      }
    }

    // Transitions (EDX-P9c): each clip of a transitioning pair is drawn into
    // its own target — effects, mask, blend and all — and the pair is
    // composited by the transition shader where the incoming clip sits in the
    // stack. Needs the chain; without it the clips simply draw.
    const trFrom = new Map<string, ActiveTransition>()
    const trTo = new Map<string, ActiveTransition>()
    if (scene.transitions?.length && chain?.renderMatte && chain.drawTransition) {
      for (const tr of scene.transitions) {
        const fromEntry = drawList.find((e) => e.id === tr.fromClipId)
        const toEntry = drawList.find((e) => e.id === tr.toClipId)
        if (!fromEntry || !toEntry || fromEntry === toEntry) continue
        if (!chain.renderMatte(ctx, prefix + transitionKey('from', tr.id), () => fromEntry.layer.draw(fromEntry.item, ctx))) continue
        if (!chain.renderMatte(ctx, prefix + transitionKey('to', tr.id), () => toEntry.layer.draw(toEntry.item, ctx))) continue
        trFrom.set(fromEntry.id, tr)
        trTo.set(toEntry.id, tr)
      }
    }

    for (const entry of drawList) {
      if (matteSources.size > 0 && matteSources.has(entry.id)) continue
      if (trFrom.has(entry.id)) continue
      const tr = trTo.get(entry.id)
      if (tr) {
        const done = chain!.drawTransition!(ctx, prefix + transitionKey('from', tr.id), prefix + transitionKey('to', tr.id), {
          kind: tr.kind,
          t: tr.t,
          ...(tr.direction ? { direction: tr.direction } : {}),
        })
        if (done) continue
        // Shader unavailable: draw the pair plainly, outgoing first.
        const fromEntry = drawList.find((e) => e.id === tr.fromClipId)
        fromEntry?.layer.draw(fromEntry.item, ctx)
      }
      entry.layer.draw(entry.item, ctx)
    }

    // Only the top level ends the frame. A nested graph's targets belong to
    // the compound that owns them, and its CompoundLayer releases them by
    // prefix; ending the frame here would free the parent's mattes too.
    if (!prefix && (matteSources.size > 0 || trTo.size > 0)) chain?.endFrame?.(ctx.gl)
  }

  /**
   * Release all active items and clear state after a GL context loss.
   * The next execute() will re-acquire everything from scratch.
   */
  notifyContextLost(): void {
    for (const reg of this._registrations) {
      for (const id of reg.activeItems.keys()) {
        reg.layer.release(id)
      }
      reg.activeItems.clear()
    }
  }

  /** Dispose all registered layers and clear the registry. */
  dispose(): void {
    for (const reg of this._registrations) {
      for (const id of reg.activeItems.keys()) {
        reg.layer.release(id)
      }
      reg.activeItems.clear()
      reg.layer.dispose()
    }
    this._registrations.length = 0
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _diff<TItem>(
    current: TItem[],
    active: Map<string, TItem>,
    getId: (item: TItem) => string,
  ): SceneDiff<TItem> {
    const currentIds = new Set(current.map(getId))
    const entering: TItem[] = []
    const leaving: string[] = []

    for (const item of current) {
      const id = getId(item)
      const previous = active.get(id)
      if (previous === undefined) {
        entering.push(item)
      } else if (sourceOf(previous) !== sourceOf(item)) {
        // Same clip, different source file: a reload re-points a local clip from
        // the dead `blob:` URL of the previous page to the file it just reopened.
        // Layers load their source on acquire, so a persisting item would keep
        // drawing (or failing on) the old one forever. Release, then acquire.
        leaving.push(id)
        entering.push(item)
      }
    }

    for (const id of active.keys()) {
      if (!currentIds.has(id) && !leaving.includes(id)) {
        leaving.push(id)
      }
    }

    return { entering, leaving }
  }
}

/**
 * The media source an item draws from, when it has one. Only compared for
 * equality, so items without a `src` (shapes, text, compounds) never differ.
 */
function sourceOf(item: unknown): unknown {
  return typeof item === 'object' && item !== null ? (item as { src?: unknown }).src : undefined
}
