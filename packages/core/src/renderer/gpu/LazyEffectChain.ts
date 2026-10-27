/**
 * The effect chain as the layers see it, with the real `EffectChain` loaded on
 * first use (CONV-8).
 *
 * Until the `effects` feature has loaded this object behaves exactly like "no
 * chain" — `draw` returns false (the layer draws the clip plainly), and the
 * optional methods read as absent (a compound draws nothing, a matte source is
 * not rendered, a transition pair draws plainly). The first time anything asks
 * for the chain, the load starts; when it lands `onReady` fires once so the
 * renderer redraws its last scene, now with the chain.
 *
 * Once loaded it is a thin forwarder: every call reaches the same `EffectChain`
 * code export and the old eager mount ran, so the GL call stream is unchanged.
 *
 * Only a TYPE import of `EffectChain` lives here: the module itself comes
 * through `features.ts`, which is where the dynamic import is.
 */

import type { EffectChain } from './EffectChain'
import { getLoadedFeature, loadFeature } from './features'
import type { EffectChainLike, LayerContext } from './layers/types'
import type { ChainDrawRequest } from './EffectChain'

/** Minimum gap between load attempts after a failure, ms. */
const RETRY_MS = 5000

type Bound = Pick<EffectChainLike, 'renderMatte' | 'endFrame' | 'drawTransition' | 'renderTarget' | 'releaseTargets'>

export class LazyEffectChain implements EffectChainLike {
  private _chain: EffectChain | null = null
  private _bound: Bound | null = null
  private _requested = false
  private _disposed = false
  private _warned = false
  private _failedAt = 0

  constructor(private readonly _onReady: () => void) {}

  /** The real chain once loaded; otherwise starts the load and returns null. */
  private _ensure(): EffectChain | null {
    if (this._chain) return this._chain
    if (this._disposed) return null
    const mod = getLoadedFeature('effects')
    if (mod) {
      const chain = new mod.EffectChain()
      this._chain = chain
      this._bound = {
        renderMatte: chain.renderMatte.bind(chain),
        endFrame: chain.endFrame.bind(chain),
        drawTransition: chain.drawTransition.bind(chain),
        renderTarget: chain.renderTarget.bind(chain),
        releaseTargets: chain.releaseTargets.bind(chain),
      }
      return chain
    }
    // After a failed load, ask again only every RETRY_MS, so a dead chunk is
    // not re-requested on every frame.
    if (this._requested && this._failedAt > 0 && Date.now() - this._failedAt > RETRY_MS) {
      this._requested = false
      this._failedAt = 0
    }
    if (!this._requested) {
      this._requested = true
      loadFeature('effects').then(
        () => {
          if (!this._disposed) this._onReady()
        },
        (err: unknown) => {
          // Surfaced once; clips with effects keep drawing plainly. An export
          // never gets here: it awaits the feature and throws.
          this._failedAt = Date.now()
          if (!this._warned) {
            this._warned = true
            console.error('[GpuRenderer] the effects chunk failed to load; effects are skipped:', err)
          }
        },
      )
    }
    return null
  }

  draw(ctx: LayerContext, req: ChainDrawRequest): boolean {
    return this._ensure()?.draw(ctx, req) ?? false
  }

  get renderMatte(): EffectChainLike['renderMatte'] {
    return this._ensure() ? this._bound!.renderMatte : undefined
  }

  get endFrame(): EffectChainLike['endFrame'] {
    return this._chain ? this._bound!.endFrame : undefined
  }

  get drawTransition(): EffectChainLike['drawTransition'] {
    return this._ensure() ? this._bound!.drawTransition : undefined
  }

  get renderTarget(): EffectChainLike['renderTarget'] {
    return this._ensure() ? this._bound!.renderTarget : undefined
  }

  get releaseTargets(): EffectChainLike['releaseTargets'] {
    return this._ensure() ? this._bound!.releaseTargets : undefined
  }

  /** Render targets alive in the chain's pool; 0 before it loads. */
  get liveCount(): number {
    return this._chain?.pool.liveCount ?? 0
  }

  notifyContextLost(): void {
    this._chain?.notifyContextLost()
  }

  dispose(): void {
    this._disposed = true
    this._chain?.dispose()
    this._chain = null
    this._bound = null
  }
}
