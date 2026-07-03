/**
 * DebugGpuRenderer — validation-only GPU renderer for debug quads.
 *
 * NOT a Renderer implementation. Accepts DebugRenderItem[] directly and
 * exercises WebGLContext + RenderGraph + TestLayer without touching Scene
 * resolution or any engine code.
 *
 * Lifecycle:
 *   1. mount(container)
 *   2. render(items) on every validation tick
 *   3. resize() when the container changes size
 *   4. dispose() on teardown
 */

import type { Scene } from '../../../resolver/scene'
import { TestLayer } from '../layers/TestLayer'
import { RenderGraph } from '../RenderGraph'
import type { Viewport } from '../types'
import { WebGLContext } from '../WebGLContext'
import type { DebugRenderItem } from './types'
import { DEBUG_STAGE } from './types'

export interface DebugGpuRendererOptions {
  /** Logical stage dimensions. Defaults to 1280×720. */
  stage?: { width: number; height: number }
  /** Clear colour as [r, g, b, a] in 0..1 range. Defaults to opaque black. */
  clearColor?: [number, number, number, number]
}

/** Minimal Scene stub passed to RenderGraph.execute(). */
function createStubScene(stage: { width: number; height: number }): Scene {
  return {
    frame: 0,
    fps: 30,
    stage,
    videos: [],
    audios: [],
    texts: [],
    images: [],
    shapes: [],
    freehand: [],
    transitions: [],
  }
}

export class DebugGpuRenderer {
  private readonly _options: DebugGpuRendererOptions
  private readonly _stage: { width: number; height: number }

  private _glCtx: WebGLContext | null = null
  private _renderGraph: RenderGraph | null = null
  private _testLayer: TestLayer | null = null

  private _items: DebugRenderItem[] = []
  private _mounted = false
  private _viewport: Viewport = { width: 0, height: 0 }

  constructor(options: DebugGpuRendererOptions = {}) {
    this._options = options
    this._stage = options.stage ?? { ...DEBUG_STAGE }
  }

  /** Attach the renderer canvas to a DOM container. May be called once. */
  mount(container: HTMLElement): void {
    if (this._mounted) {
      throw new Error('DebugGpuRenderer: mount() called more than once')
    }

    const clearColor = this._options.clearColor ?? [0, 0, 0, 1]

    this._glCtx = new WebGLContext({
      onLost: () => this._handleContextLost(),
      onRestore: () => this._handleContextRestored(),
    })

    this._glCtx.setClearColor(...clearColor)
    container.appendChild(this._glCtx.canvas)

    this._viewport = {
      width: this._glCtx.canvas.width,
      height: this._glCtx.canvas.height,
    }

    this._testLayer = new TestLayer()
    this._renderGraph = new RenderGraph()
    this._renderGraph.registerLayer(
      this._testLayer,
      () => this._items,
      (item) => item.id,
      (item) => item.zIndex,
    )

    this._mounted = true
  }

  /** Update canvas backing-store dimensions. */
  resize(cssWidth: number, cssHeight: number, dpr = 1): void {
    if (!this._glCtx || !this._mounted) return

    this._glCtx.resize(cssWidth, cssHeight, dpr)
    this._viewport = {
      width: this._glCtx.canvas.width,
      height: this._glCtx.canvas.height,
    }
  }

  /** Render the given debug items synchronously. */
  render(items: DebugRenderItem[]): void {
    if (!this._mounted || !this._glCtx || !this._renderGraph) return
    if (this._glCtx.isLost) return

    const gl = this._glCtx.gl
    if (!gl) return

    this._items = items

    this._glCtx.clear()

    const ctx = {
      gl,
      frame: 0,
      stage: this._stage,
      viewport: this._viewport,
      fps: 30,
    }

    this._renderGraph.execute(createStubScene(this._stage), ctx)
  }

  /** Tear down all resources. */
  dispose(): void {
    const gl = this._glCtx?.gl
    if (gl && this._testLayer) {
      this._testLayer.disposeGL(gl)
    } else {
      this._testLayer?.dispose()
    }

    this._renderGraph?.dispose()
    this._renderGraph = null
    this._testLayer = null

    this._glCtx?.dispose()
    this._glCtx?.canvas.remove()
    this._glCtx = null

    this._mounted = false
    this._items = []
    this._viewport = { width: 0, height: 0 }
  }

  /** Whether mount() has been called and dispose() has not. */
  get isMounted(): boolean {
    return this._mounted
  }

  /** The canvas element, or null if not mounted. */
  get canvas(): HTMLCanvasElement | null {
    return this._glCtx?.canvas ?? null
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _handleContextLost(): void {
    this._renderGraph?.notifyContextLost()
    this._testLayer?.notifyContextLost()
  }

  private _handleContextRestored(): void {
    const clearColor = this._options.clearColor ?? [0, 0, 0, 1]
    this._glCtx?.setClearColor(...clearColor)
    this._testLayer?.notifyContextLost()
  }
}
