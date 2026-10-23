/**
 * A layer whose implementation loads on first use (CONV-8).
 *
 * RenderGraph registers one of these where the generator, sequence and roto
 * mask layers used to be constructed eagerly. While the feature module is
 * still loading it holds the items RenderGraph acquired and draws nothing; when
 * the module lands it builds the real layer, replays those acquires (so the
 * real layer sees exactly the acquire/release stream it would have), and fires
 * `onReady` so the renderer redraws.
 *
 * A scene without items for this layer never touches it: RenderGraph calls
 * nothing on a layer with no items except `release` of ids it never had and
 * `dispose`, both of which are cheap here.
 */

import type { FeatureId, FeatureModules } from '../features'
import { loadFeature } from '../features'
import type { Layer, LayerContext } from './types'

export class LazyLayer<TItem extends { id: string }, K extends FeatureId = FeatureId> implements Layer<TItem> {
  private _real: (Layer<TItem> & LayerExtras) | null = null
  private readonly _pending = new Map<string, TItem>()
  private _ctx: LayerContext | null = null
  private _started = false
  private _disposed = false
  private _failedAt = 0
  private _warned = false

  constructor(
    private readonly _feature: K,
    private readonly _build: (mod: FeatureModules[K]) => Layer<TItem> & LayerExtras,
    private readonly _onReady: () => void,
  ) {}

  /** The real layer once loaded. For the renderer's tests and `prewarm` forwarding. */
  get real(): (Layer<TItem> & LayerExtras) | null {
    return this._real
  }

  private _start(): void {
    if (this._disposed) return
    if (this._started && this._failedAt > 0 && Date.now() - this._failedAt > 5000) {
      this._started = false
      this._failedAt = 0
    }
    if (this._started) return
    this._started = true
    loadFeature(this._feature).then(
      (mod) => {
        if (this._disposed || this._real) return
        const real = this._build(mod)
        this._real = real
        const ctx = this._ctx
        if (ctx) for (const item of this._pending.values()) real.acquire(item, ctx)
        this._pending.clear()
        this._onReady()
      },
      (err: unknown) => {
        this._failedAt = Date.now()
        if (!this._warned) {
          this._warned = true
          console.error(`[GpuRenderer] the ${this._feature} chunk failed to load; those clips are not drawn:`, err)
        }
      },
    )
  }

  acquire(item: TItem, ctx: LayerContext): void {
    if (this._real) {
      this._real.acquire(item, ctx)
      return
    }
    this._ctx = ctx
    this._pending.set(item.id, item)
    this._start()
  }

  release(itemId: string): void {
    if (this._real) this._real.release(itemId)
    else this._pending.delete(itemId)
  }

  draw(item: TItem, ctx: LayerContext): void {
    if (this._real) {
      this._real.draw(item, ctx)
      return
    }
    // RenderGraph can draw an item it acquired before the load; keep asking.
    this._ctx = ctx
    this._start()
  }

  prewarm(items: ReadonlyArray<TItem>, ctx: LayerContext): void {
    if (this._real) {
      this._real.prewarm?.(items, ctx)
      return
    }
    if (items.length > 0) this._start()
  }

  notifyContextLost(): void {
    this._pending.clear()
    this._real?.notifyContextLost?.()
  }

  dispose(): void {
    this._disposed = true
    this._pending.clear()
    this._real?.dispose()
    this._real = null
  }
}

/** What the real layers carry beyond `Layer`. */
export interface LayerExtras {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prewarm?(items: ReadonlyArray<any>, ctx: LayerContext): void
  notifyContextLost?(): void
}
