/**
 * GpuRenderer — WebGL2 implementation of the Renderer interface.
 *
 * Phase 3 scope: render orchestration shell with a placeholder video layer
 * that draws colored quads via scissor+ clear. No decoders, textures, or
 * VideoFrame logic yet.
 *
 * Flow:
 *   Scene → RenderGraph → sorted layers → draw calls → canvas output
 *
 * Invariants:
 *   - render() is synchronous — never awaits async work.
 *   - render() is idempotent on equal Scene references.
 *   - Imports only from scene.ts, renderer/types, and browser APIs.
 */

import type { ActiveVideoClip, Scene } from '../../resolver/scene'
import type { Renderer } from '../types'
import type { Layer, LayerContext } from './layers/types'
import { RenderGraph } from './RenderGraph'
import type { RendererOptions, Viewport } from './types'
import { WebGLContext } from './WebGLContext'

/** Fixed palette for placeholder clip colours (RGB, 0..1). */
const PLACEHOLDER_PALETTE: ReadonlyArray<[number, number, number]> = [
  [0.85, 0.20, 0.20],
  [0.20, 0.70, 0.30],
  [0.20, 0.40, 0.90],
  [0.90, 0.70, 0.10],
  [0.70, 0.20, 0.85],
  [0.10, 0.75, 0.75],
]

/**
 * Phase 3 stand-in for VideoLayer.
 *
 * Draws solid-colour scissor rects to exercise acquire → sort → draw → release
 * without needing shaders, textures, or decoders. Replaced by VideoLayer in
 * a later phase.
 */
class PlaceholderVideoLayer implements Layer<ActiveVideoClip> {
  private readonly _colors = new Map<string, [number, number, number]>()
  private _colorIndex = 0

  acquire(item: ActiveVideoClip, _ctx: LayerContext): void {
    const color = PLACEHOLDER_PALETTE[this._colorIndex % PLACEHOLDER_PALETTE.length]!
    this._colorIndex++
    this._colors.set(item.id, color)
  }

  release(itemId: string): void {
    this._colors.delete(itemId)
  }

  draw(item: ActiveVideoClip, ctx: LayerContext): void {
    const color = this._colors.get(item.id)
    if (!color) return

    const { gl } = ctx
    const { width, height } = ctx.viewport

    const [r, g, b] = color
    const opacity = item.opacity

    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(0, 0, width, height)
    gl.clearColor(r * opacity, g * opacity, b * opacity, opacity)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.SCISSOR_TEST)

    // Restore default clear colour for subsequent clears.
    gl.clearColor(0, 0, 0, 1)
  }

  dispose(): void {
    this._colors.clear()
    this._colorIndex = 0
  }
}

export class GpuRenderer implements Renderer {
  private readonly _options: RendererOptions

  private _glCtx: WebGLContext | null = null
  private _renderGraph: RenderGraph | null = null
  private _placeholderVideoLayer: PlaceholderVideoLayer | null = null

  private _mounted = false
  private _lastScene: Scene | null = null
  private _viewport: Viewport = { width: 0, height: 0 }

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
    })

    this._glCtx.setClearColor(...clearColor)

    container.appendChild(this._glCtx.canvas)

    this._viewport = {
      width: this._glCtx.canvas.width,
      height: this._glCtx.canvas.height,
    }

    this._renderGraph = new RenderGraph()
    this._placeholderVideoLayer = new PlaceholderVideoLayer()

    this._renderGraph.registerLayer(
      this._placeholderVideoLayer,
      (scene) => scene.videos,
      (item) => item.id,
      (item) => item.zIndex,
    )

    this._mounted = true
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
    if (scene === this._lastScene) return

    const gl = this._glCtx.gl
    if (!gl) return

    this._glCtx.clear()

    const ctx = this._buildLayerContext(scene, gl)
    this._renderGraph.execute(scene, ctx)

    this._lastScene = scene
  }

  dispose(): void {
    this._renderGraph?.dispose()
    this._renderGraph = null
    this._placeholderVideoLayer = null

    this._glCtx?.dispose()
    this._glCtx?.canvas.remove()
    this._glCtx = null

    this._mounted = false
    this._lastScene = null
    this._viewport = { width: 0, height: 0 }
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
      stage: scene.stage,
      viewport: this._viewport,
      fps: scene.fps,
    }
  }

  private _handleContextLost(): void {
    this._lastScene = null
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
