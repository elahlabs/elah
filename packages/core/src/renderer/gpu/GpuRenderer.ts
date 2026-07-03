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

import type { ActiveVideoClip, Scene } from '../../resolver/scene'
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
import type { Layer, LayerContext } from './layers/types'
import { RenderGraph } from './RenderGraph'
import { TexturePool } from './TexturePool'
import type { RendererOptions, Viewport } from './types'
import { computeContainViewport } from './viewport'
import { WebGLContext } from './WebGLContext'

export class GpuRenderer implements Renderer {
  private readonly _options: RendererOptions

  private _glCtx: WebGLContext | null = null
  private _renderGraph: RenderGraph | null = null
  private _texturePool: TexturePool | null = null
  private _videoLayer: VideoLayer | null = null
  private _textLayer: TextLayer | null = null
  private _imageLayer: ImageLayer | null = null
  private _shapeLayer: ShapeLayer | null = null
  private _freehandLayer: FreehandLayer | null = null
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
          }
        : undefined)

    // Bisection mode: FrameProbeLayer paints synthetic colour + frame text,
    // bypassing all decode/cache so the clock→render→draw path can be tested
    // in isolation. _videoLayer stays null so the debug panel reports no decode
    // metrics (it has none in this mode).
    let videoLayer: Layer<ActiveVideoClip>
    if (this._options.probeLayer) {
      videoLayer = new FrameProbeLayer()
    } else {
      this._videoLayer = new VideoLayer(this._texturePool, videoLayerArg)
      videoLayer = this._videoLayer
    }

    this._renderGraph = new RenderGraph()
    this._renderGraph.registerLayer(
      videoLayer,
      (scene) => scene.videos,
      (item) => item.id,
      (item) => item.zIndex,
    )

    // Image clips share the video quad pipeline (minus the decoder) and
    // composite by global zIndex like everything else.
    this._imageLayer = new ImageLayer()
    this._renderGraph.registerLayer(
      this._imageLayer,
      (scene) => scene.images,
      (item) => item.id,
      (item) => item.zIndex,
    )

    // Text overlays composite above/below video purely by zIndex — RenderGraph
    // sorts the global draw list across all registered layers.
    this._textLayer = new TextLayer()
    this._renderGraph.registerLayer(
      this._textLayer,
      (scene) => scene.texts,
      (item) => item.id,
      (item) => item.zIndex,
    )

    this._shapeLayer = new ShapeLayer()
    this._renderGraph.registerLayer(
      this._shapeLayer,
      (scene) => scene.shapes,
      (item) => item.id,
      (item) => item.zIndex,
    )

    this._freehandLayer = new FreehandLayer()
    this._renderGraph.registerLayer(
      this._freehandLayer,
      (scene) => scene.freehand,
      (item) => item.id,
      (item) => item.zIndex,
    )

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

    const renderStart = now

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
    this._videoLayer = null
    this._textLayer = null
    this._imageLayer = null

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
    this._lastScene = null
    this._texturePool?.handleContextLost()
    this._videoLayer?.notifyContextLost()
    this._textLayer?.notifyContextLost()
    this._imageLayer?.notifyContextLost()
    this._shapeLayer?.notifyContextLost()
    this._freehandLayer?.notifyContextLost()
    this._renderGraph?.notifyContextLost()
  }

  private _handleContextRestored(): void {
    // WebGLContext re-initialises GL state on restore.
    // Reset lastScene so the next render() re-acquires all active clips.
    this._lastScene = null

    const clearColor = this._options.clearColor ?? [0, 0, 0, 1]
    this._glCtx?.setClearColor(...clearColor)
  }
}
