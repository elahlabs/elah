/**
 * WebGLContext — canvas management and WebGL2/WebGL1 context lifecycle.
 *
 * Responsibilities:
 *  - Create the <canvas> element and obtain a WebGL2 context (falling back to
 *    WebGL1 if WebGL2 is unavailable).
 *  - Handle webglcontextlost / webglcontextrestored browser events so the rest
 *    of the renderer can react without knowing about the DOM event system.
 *  - Manage viewport and backing-store dimensions (CSS size × DPR).
 *  - Set and maintain global GL state (blend mode, clear color) that applies
 *    across all draw calls.
 *
 * This is the ONLY file in the renderer that calls getContext('webgl2').
 * Everything else receives a WebGL2RenderingContext from here.
 *
 * Context loss notes:
 *  - When the GPU context is lost the browser fires webglcontextlost.
 *    We prevent its default (which would stop restoration) and set a flag.
 *  - On webglcontextrestored the context object becomes valid again; we
 *    fire onRestore so callers can re-create their GL objects.
 *  - All public methods that use gl guard against the lost state.
 */

export type ContextLostHandler = () => void
export type ContextRestoredHandler = (gl: WebGL2RenderingContext) => void

export interface WebGLContextOptions {
  /** Called when the GL context is lost. The caller should stop drawing. */
  onLost?: ContextLostHandler
  /**
   * Called when the GL context has been restored. The caller must
   * re-create all shaders, textures, and buffers.
   */
  onRestore?: ContextRestoredHandler
  /** Requested canvas alpha; default false (opaque, avoids compositor overhead). */
  alpha?: boolean
  /** Power preference hint passed to getContext; default 'default'. */
  powerPreference?: WebGLPowerPreference
  /**
   * Retain the WebGL drawing buffer across compositing operations.
   * Required for host code that calls `gl.readPixels()` outside the RAF tick
   * (dev tools, golden-pixel tests, frame recording). Default false.
   */
  preserveDrawingBuffer?: boolean
}

export class WebGLContext {
  readonly canvas: HTMLCanvasElement

  /** Current context; null while the context is lost. */
  private _gl: WebGL2RenderingContext | null = null

  /** Whether we successfully obtained a WebGL2 (vs WebGL1) context. */
  private _isWebGL2 = false

  private _lost = false

  private readonly _onLost: ContextLostHandler | undefined
  private readonly _onRestore: ContextRestoredHandler | undefined

  // Bound event handlers kept for removeEventListener.
  private readonly _handleLost: (e: Event) => void
  private readonly _handleRestored: (e: Event) => void

  constructor(options: WebGLContextOptions = {}) {
    this._onLost = options.onLost
    this._onRestore = options.onRestore

    this.canvas = document.createElement('canvas')
    this.canvas.style.display = 'block'
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'

    const ctxAttribs: WebGLContextAttributes = {
      alpha: options.alpha ?? false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      powerPreference: options.powerPreference ?? 'default',
    }

    // Prefer WebGL2; fall back to WebGL1 for broader device support.
    const gl2 = this.canvas.getContext('webgl2', ctxAttribs)
    if (gl2) {
      this._gl = gl2
      this._isWebGL2 = true
    } else {
      // WebGL1 is exposed as WebGLRenderingContext; we type it as WebGL2 via
      // a cast because our shader sources target #version 300 es which is
      // WebGL2-only. Callers relying on this path should check isWebGL2.
      const gl1 = this.canvas.getContext('webgl', ctxAttribs)
      if (gl1) {
        this._gl = gl1 as unknown as WebGL2RenderingContext
        this._isWebGL2 = false
      }
    }

    if (!this._gl) {
      throw new Error(
        'WebGLContext: WebGL is not supported or has been disabled in this browser.',
      )
    }

    this._handleLost = (e: Event) => {
      e.preventDefault()
      this._lost = true
      this._gl = null
      this._onLost?.()
    }

    this._handleRestored = () => {
      this._lost = false
      // Re-acquire the context object — it's the same canvas, same attribute bag.
      const restored = this.canvas.getContext('webgl2', ctxAttribs)
        ?? this.canvas.getContext('webgl', ctxAttribs) as unknown as WebGL2RenderingContext | null
      if (restored) {
        this._gl = restored as WebGL2RenderingContext
        this._initGLState()
        this._onRestore?.(this._gl)
      }
    }

    this.canvas.addEventListener('webglcontextlost', this._handleLost)
    this.canvas.addEventListener('webglcontextrestored', this._handleRestored)

    this._initGLState()
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** True while the context is lost. Callers must skip draw calls. */
  get isLost(): boolean {
    return this._lost
  }

  /** True if we obtained a WebGL2 context (false = WebGL1 fallback). */
  get isWebGL2(): boolean {
    return this._isWebGL2
  }

  /**
   * Returns the active GL context, or null if it is currently lost.
   * Callers must null-check before using.
   */
  get gl(): WebGL2RenderingContext | null {
    return this._gl
  }

  /**
   * Update the canvas backing-store size.
   * Call this from the renderer's resize() handler.
   *
   * @param cssWidth  CSS width of the host container, in CSS pixels.
   * @param cssHeight CSS height of the host container, in CSS pixels.
   * @param dpr       Device pixel ratio (window.devicePixelRatio). Defaults to 1.
   */
  resize(cssWidth: number, cssHeight: number, dpr = 1): void {
    const physicalW = Math.round(cssWidth * dpr)
    const physicalH = Math.round(cssHeight * dpr)

    if (this.canvas.width === physicalW && this.canvas.height === physicalH) return

    this.canvas.width = physicalW
    this.canvas.height = physicalH

    if (this._gl && !this._lost) {
      this._gl.viewport(0, 0, physicalW, physicalH)
    }
  }

  /**
   * Clear the canvas to the current clear color.
   * Does nothing if the context is lost.
   */
  clear(): void {
    if (!this._gl || this._lost) return
    this._gl.clear(this._gl.COLOR_BUFFER_BIT)
  }

  /**
   * Set the clear color. Values are [0..1] RGBA.
   * Defaults to opaque black; call before the first render if you need a
   * different background.
   */
  setClearColor(r: number, g: number, b: number, a: number): void {
    if (!this._gl || this._lost) return
    this._gl.clearColor(r, g, b, a)
  }

  /** Remove DOM event listeners and null out the context reference. */
  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this._handleLost)
    this.canvas.removeEventListener('webglcontextrestored', this._handleRestored)
    // Losing the context explicitly clears all GPU objects on some drivers.
    const ext = this._gl?.getExtension('WEBGL_lose_context')
    ext?.loseContext()
    this._gl = null
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _initGLState(): void {
    const gl = this._gl
    if (!gl) return

    // Premultiplied-alpha blending: standard for video/image compositing.
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    // Flip texture rows so VideoFrame pixel origin (top-left) matches WebGL
    // convention (bottom-left). Applied once; covers all texImage2D calls.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

    // Clear to opaque black.
    gl.clearColor(0, 0, 0, 1)

    // Synchronise viewport with current canvas dimensions.
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
  }
}
