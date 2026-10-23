/**
 * GpuRenderer — WebGL2 implementation of the Renderer interface.
 *
 * Flow:
 *   Scene → RenderGraph → VideoLayer → VideoFrameProvider → VideoTexture
 *        → TexturePool → WebGL draw → canvas output
 *
 * Invariants:
 *   - render() is synchronous — never awaits async work.
 *   - render() is idempotent on equal Scene references.
 *   - Imports only from scene.ts, renderer/types, and browser APIs.
 */

import type { ActiveGeneratorClip, ActiveRotoMask, ActiveSequenceClip, ActiveVideoClip, Scene } from '../../resolver/scene'
import type { Renderer } from '../types'
import {
  GpuRendererDebugPanel,
  type DebugPanelSnapshot,
} from './debug/GpuRendererDebugPanel'
import { GpuDebugCounters } from './debug/GpuDebugCounters'
import { VideoLayer } from './layers/VideoLayer'
import { FrameProbeLayer } from './layers/FrameProbeLayer'
import { TextLayer } from './layers/TextLayer'
import { ImageLayer } from './layers/ImageLayer'
import { ShapeLayer } from './layers/ShapeLayer'
import { FreehandLayer } from './layers/FreehandLayer'
import { AdjustmentLayer } from './layers/AdjustmentLayer'
import { LazyEffectChain } from './LazyEffectChain'
import type { LazyLayer } from './layers/LazyLayer'
import type { Layer, LayerContext } from './layers/types'
import type { RenderGraph } from './RenderGraph'
import { createLayerSet, type LayerSet } from './layers/createLayerSet'
import { TexturePool } from './TexturePool'
import type { RendererOptions, Viewport } from './types'
import { computeContainViewport } from './viewport'
import { WebGLContext } from './WebGLContext'

export class GpuRenderer implements Renderer {
  private readonly _options: RendererOptions

  private _glCtx: WebGLContext | null = null
  private _renderGraph: RenderGraph | null = null
  private _layerSet: LayerSet | null = null
  private _texturePool: TexturePool | null = null
  private _videoLayer: VideoLayer | null = null
  private _textLayer: TextLayer | null = null
  private _imageLayer: ImageLayer | null = null
  private _shapeLayer: ShapeLayer | null = null
  private _freehandLayer: FreehandLayer | null = null
  private _rotoMaskLayer: LazyLayer<ActiveRotoMask, 'rotoMasks'> | null = null
  private _sequenceLayer: LazyLayer<ActiveSequenceClip, 'sequences'> | null = null
  private _adjustmentLayer: AdjustmentLayer | null = null
  private _generatorLayer: LazyLayer<ActiveGeneratorClip, 'generators'> | null = null
  private _effectChain: LazyEffectChain | null = null
  private _debugPanel: GpuRendererDebugPanel | null = null

  private _container: HTMLElement | null = null
  private _mounted = false
  private _debugEnabled = false
  private _lastScene: Scene | null = null
  private _viewport: Viewport = { width: 0, height: 0 }

  private _lastRenderTime = 0
  private _fps = 0
  private _lastRenderDurationMs = 0
  private _noOpTicks = 0

  constructor(options: RendererOptions = {}) {
    this._options = options
  }

  mount(container: HTMLElement): void {
    if (this._mounted) {
      throw new Error('GpuRenderer: mount() called more than once')
    }

    const clearColor = this._options.clearColor ?? [0, 0, 0, 1]

    this._glCtx = new WebGLContext({
      onLost: () => this._handleContextLost(),
      onRestore: () => this._handleContextRestored(),
      onUnrecoverable: () => this._options.onContextUnrecoverable?.(),
      preserveDrawingBuffer: this._options.preserveDrawingBuffer,
    })

    this._glCtx.setClearColor(...clearColor)

    container.appendChild(this._glCtx.canvas)
    this._container = container

    this._viewport = {
      width: this._glCtx.canvas.width,
      height: this._glCtx.canvas.height,
    }

    this._texturePool = new TexturePool({
      maxTextures: this._options.maxTextures,
    })

    // If a providerFactory override is set, use it directly (tests / headless).
    // Otherwise build deps from demuxerFactory/decoderFactory/maxOutstandingDecodes
    // so that VideoLayer creates DecoderBackedVideoFrameProvider for real decode.
    const videoLayerArg = this._options.providerFactory
      ?? (this._options.demuxerFactory
        ? {
            demuxerFactory: this._options.demuxerFactory,
            decoderFactory: this._options.decoderFactory,
            maxOutstanding: this._options.maxOutstandingDecodes,
            maxFrameLongEdge: this._options.maxVideoLongEdge,
          }
        : undefined)

    // One chain shared by every graph, nested compound graphs included (PV-P1):
    // it is the single owner of the framebuffer pool, which is what lets a
    // compound namespace its targets by key prefix rather than by pool.
    // It loads the real EffectChain on first use (CONV-8) and asks for a redraw when it has.
    this._effectChain = new LazyEffectChain(() => this._redrawLast())

    // Every layer, on one graph (PV-P1). The construction lives in
    // createLayerSet so a compound can build an independent second set for its
    // nested scene; this call is the top level of that recursion (depth 0,
    // empty key prefix), and is otherwise what mount always did.
    const set = createLayerSet({
      texturePool: this._texturePool,
      ...(videoLayerArg ? { videoProvider: videoLayerArg } : {}),
      ...(this._options.probeLayer ? { probeLayer: true } : {}),
      ...(this._options.onClipLoad ? { onClipLoad: this._options.onClipLoad } : {}),
      ...(this._options.rotoMaskLoader ? { rotoMaskLoader: this._options.rotoMaskLoader } : {}),
      ...(this._options.onRotoMaskFrame ? { onRotoMaskFrame: this._options.onRotoMaskFrame } : {}),
      ...(this._options.sequenceFrameLoader ? { sequenceFrameLoader: this._options.sequenceFrameLoader } : {}),
      ...(this._options.onSequenceFrame ? { onSequenceFrame: this._options.onSequenceFrame } : {}),
      onFeatureReady: () => this._redrawLast(),
    })
    this._layerSet = set
    this._renderGraph = set.graph
    this._videoLayer = set.videoLayer
    this._imageLayer = set.imageLayer
    this._textLayer = set.textLayer
    this._shapeLayer = set.shapeLayer
    this._freehandLayer = set.freehandLayer
    this._generatorLayer = set.generatorLayer
    this._adjustmentLayer = set.adjustmentLayer
    this._rotoMaskLayer = set.rotoMaskLayer
    this._sequenceLayer = set.sequenceLayer

    this._mounted = true

    if (this._debugEnabled) {
      this._attachDebugPanel()
    }
  }

  resize(cssWidth: number, cssHeight: number, dpr = 1): void {
    if (!this._glCtx || !this._mounted) return

    this._glCtx.resize(cssWidth, cssHeight, dpr)
    this._viewport = {
      width: this._glCtx.canvas.width,
      height: this._glCtx.canvas.height,
    }
  }

  render(scene: Scene): void {
    if (!this._mounted || !this._glCtx || !this._renderGraph) return
    if (this._glCtx.isLost) return
    if (scene === this._lastScene) {
      this._lastRenderDurationMs = 0
      this._noOpTicks++
      return
    }

    const gl = this._glCtx.gl
    if (!gl) return

    const now = performance.now()
    if (this._lastRenderTime > 0) {
      const dt = now - this._lastRenderTime
      if (dt > 0) {
        this._fps = 1000 / dt
      }
    }
    this._lastRenderTime = now

    this._drawScene(scene, gl, now)
  }

  /**
   * An optional feature finished loading (CONV-8): draw the last scene again,
   * now with it. The host is not involved, so a paused frame fills in on its
   * own. Coalesced to one redraw per task, and a no-op once unmounted or lost.
   */
  private _redrawQueued = false
  private _redrawLast(): void {
    if (this._redrawQueued) return
    this._redrawQueued = true
    queueMicrotask(() => {
      this._redrawQueued = false
      const scene = this._lastScene
      if (!scene || !this._mounted || !this._glCtx || this._glCtx.isLost) return
      const gl = this._glCtx.gl
      if (!gl) return
      this._drawScene(scene, gl, performance.now())
    })
  }

  private _drawScene(scene: Scene, gl: WebGL2RenderingContext, renderStart: number): void {
    if (!this._glCtx || !this._renderGraph) return

    // Clear the WHOLE framebuffer first (gl.clear ignores the viewport), so the
    // letterbox/pillarbox margins are painted with the clear colour.
    this._glCtx.clear()

    // Fit the project-aspect stage into the canvas and restrict drawing to that
    // inner rect. The unit quad maps clip-space [-1,1] → this viewport, so the
    // video fills the project aspect and the cleared margins become the bars.
    const canvas = this._glCtx.canvas
    const fit = computeContainViewport(
      canvas.width,
      canvas.height,
      scene.stage.width,
      scene.stage.height,
    )
    gl.viewport(fit.x, fit.y, fit.width, fit.height)

    const ctx = this._buildLayerContext(scene, gl)
    this._renderGraph.execute(scene, ctx)

    this._lastRenderDurationMs = performance.now() - renderStart
    this._lastScene = scene
  }

  /**
   * Prewarm decode for a future scene without drawing it.
   *
   * Called by the render loop with a Scene resolved a short horizon ahead of the
   * current playhead. Forwards the upcoming video clips to VideoLayer so their
   * decoders open + seek + fill lookahead before the clip becomes visible —
   * eliminating the cold-start freeze when cutting from an image (or any
   * non-video clip) into a video. No-op in probe mode (FrameProbeLayer has no
   * decode pipeline) and before mount.
   */
  prewarm(scene: Scene): void {
    if (!this._mounted || !this._glCtx || !this._videoLayer) return
    if (this._glCtx.isLost) return
    const gl = this._glCtx.gl
    if (!gl) return
    const ctx = this._buildLayerContext(scene, gl)
    this._videoLayer.prewarm(scene.videos, ctx)
    if (scene.rotoMasks) this._rotoMaskLayer?.prewarm(scene.rotoMasks, ctx)
    if (scene.sequences) this._sequenceLayer?.prewarm(scene.sequences, ctx)
  }

  /**
   * Returns the canvas element used for rendering, or null if not mounted.
   * Intended for dev tools and Playwright tests (window.__GPU__.readCanvas).
   */
  getCanvas(): HTMLCanvasElement | null {
    return this._glCtx?.canvas ?? null
  }

  /** Enable or disable the development-only DOM debug overlay. */
  setDebug(enabled: boolean): void {
    this._debugEnabled = enabled

    if (enabled) {
      this._attachDebugPanel()
    } else if (this._debugPanel) {
      this._debugPanel.dispose()
      this._debugPanel = null
    }
  }

  dispose(): void {
    this._debugPanel?.dispose()
    this._debugPanel = null

    // Order matters: graph.dispose() releases acquired textures back into the
    // pool; only then can pool.dispose(gl) GL-delete every handle. Disposing
    // the pool first would leak the textures still held by VideoLayer.
    this._renderGraph?.dispose()
    this._renderGraph = null
    this._layerSet = null
    this._videoLayer = null
    this._textLayer = null
    this._imageLayer = null
    this._rotoMaskLayer = null
    this._sequenceLayer = null
    this._adjustmentLayer = null
    this._generatorLayer = null
    this._effectChain?.dispose()
    this._effectChain = null

    const gl = this._glCtx?.gl ?? null
    if (gl && this._texturePool) {
      this._texturePool.dispose(gl)
    }
    this._texturePool = null

    this._glCtx?.dispose()
    this._glCtx?.canvas.remove()
    this._glCtx = null

    this._container = null
    this._mounted = false
    this._lastScene = null
    this._viewport = { width: 0, height: 0 }
    this._lastRenderTime = 0
    this._fps = 0
    this._lastRenderDurationMs = 0
    this._noOpTicks = 0
  }

  /** True while the WebGL context is lost. Hosts should pause resolve/prewarm work. */
  get isContextLost(): boolean {
    return this._glCtx?.isLost ?? false
  }

  /** Exposed for tests: underlying video layer instance. */
  get videoLayer(): VideoLayer | null {
    return this._videoLayer
  }

  /** Exposed for tests: last computed FPS from render() cadence. */
  get fps(): number {
    return this._fps
  }

  /** Exposed for tests: duration of the last render() call in ms. */
  get lastRenderDurationMs(): number {
    return this._lastRenderDurationMs
  }

  /**
   * Render targets alive in the effect chain's pool (in use + idle).
   *
   * A compound holds one target while it is being placed, and the chain
   * borrows two per effect pass, so this is the number the plan's "FBO memory
   * for depth-4 compounds" row is measured with. Exposed for tests and
   * /dev/compound.
   */
  get framebufferLiveCount(): number {
    return this._effectChain?.liveCount ?? 0
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _buildLayerContext(
    scene: Scene,
    gl: WebGL2RenderingContext,
  ): LayerContext {
    return {
      gl,
      frame: scene.frame,
      stage: scene.stage,
      viewport: this._viewport,
      fps: scene.fps,
      ...(this._effectChain ? { effectChain: this._effectChain } : {}),
    }
  }

  private _attachDebugPanel(): void {
    if (!this._debugEnabled || this._debugPanel || !this._container) return

    this._debugPanel = new GpuRendererDebugPanel(this._container, () =>
      this._buildDebugSnapshot(),
    )
  }

  private _buildDebugSnapshot(): DebugPanelSnapshot {
    const counters = GpuDebugCounters.snapshot()
    const scene = this._lastScene

    return {
      fps: this._fps,
      currentFrame: scene?.frame ?? 0,
      activeClipCount: scene?.videos.length ?? 0,
      textureCount: this._videoLayer?.getTextureCount() ?? 0,
      cacheHitRatio: counters.cacheHitRatio,
      renderDurationMs: this._lastRenderDurationMs,
      decoderStates: this._videoLayer?.getDecoderStates() ?? {},
      droppedFrames: counters.droppedFrames,
      outstandingDecodes: counters.outstandingDecodes,
      activeProviders: this._videoLayer?.getProviderCount() ?? 0,
      noOpTicks: this._noOpTicks,
    }
  }

  private _handleContextLost(): void {
    this._options.onContextLost?.()
    this._lastScene = null
    this._texturePool?.handleContextLost()
    this._effectChain?.notifyContextLost()
    // Through the set, so a compound's nested sets hear about it too. No GL
    // calls happen here: every handle is already invalid.
    this._layerSet?.notifyContextLost()
  }

  private _handleContextRestored(): void {
    // WebGLContext re-initialises GL state on restore.
    // Reset lastScene so the next render() re-acquires all active clips.
    this._lastScene = null

    const clearColor = this._options.clearColor ?? [0, 0, 0, 1]
    this._glCtx?.setClearColor(...clearColor)
    this._options.onContextRestored?.()
  }
}
