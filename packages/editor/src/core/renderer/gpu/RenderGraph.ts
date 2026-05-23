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

import type { Scene } from '../../resolver/scene'
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
  zIndex: number
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

      for (const item of reg.activeItems.values()) {
        drawList.push({
          layer: reg.layer,
          item,
          zIndex: reg.getZIndex(item),
        })
      }
    }

    // Stable ascending sort: lower zIndex draws first (back), higher draws last (front).
    drawList.sort((a, b) => a.zIndex - b.zIndex)

    for (const entry of drawList) {
      entry.layer.draw(entry.item, ctx)
    }
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
      if (!active.has(getId(item))) {
        entering.push(item)
      }
    }

    for (const id of active.keys()) {
      if (!currentIds.has(id)) {
        leaving.push(id)
      }
    }

    return { entering, leaving }
  }
}
