/**
 * FramebufferPool — reusable RGBA8 render targets for the effect chain.
 *
 * A chain needs two targets at once (ping-pong) and gives them back straight
 * after its clip is drawn, so the pool rarely holds more than a handful. Sizes
 * are exact rather than bucketed: a clip's chain size is stable from frame to
 * frame, so exact reuse hits every frame after the first and no pass has to
 * work in a sub-rect of a larger texture.
 *
 * Bounds: at most `maxLive` targets exist at once (acquire returns null past
 * that and the caller draws without effects), and at most `maxFree` idle ones
 * are kept, oldest evicted first.
 */

export interface RenderTarget {
  fbo: WebGLFramebuffer
  texture: WebGLTexture
  width: number
  height: number
}

export interface FramebufferPoolOptions {
  /** Hard cap on targets alive at once (in use + free). Default 8. */
  maxLive?: number
  /** Idle targets kept for reuse. Default 6. */
  maxFree?: number
}

export class FramebufferPool {
  private readonly _maxLive: number
  private readonly _maxFree: number
  /** Idle targets, oldest first. */
  private readonly _free: RenderTarget[] = []
  private readonly _inUse = new Set<RenderTarget>()

  constructor(options: FramebufferPoolOptions = {}) {
    this._maxLive = Math.max(2, options.maxLive ?? 8)
    this._maxFree = Math.max(0, options.maxFree ?? 6)
  }

  /** A target of exactly `width × height`, or null (cap reached / incomplete FBO). */
  acquire(gl: WebGL2RenderingContext, width: number, height: number): RenderTarget | null {
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))

    const index = this._free.findIndex((t) => t.width === w && t.height === h)
    if (index >= 0) {
      const [target] = this._free.splice(index, 1)
      this._inUse.add(target!)
      return target!
    }

    // Make room: drop idle targets of other sizes before refusing.
    while (this.liveCount >= this._maxLive && this._free.length > 0) {
      this._destroy(gl, this._free.shift()!)
    }
    if (this.liveCount >= this._maxLive) return null

    const target = this._create(gl, w, h)
    if (target) this._inUse.add(target)
    return target
  }

  /** Give a target back. Unknown targets are ignored. */
  release(gl: WebGL2RenderingContext, target: RenderTarget): void {
    if (!this._inUse.delete(target)) return
    this._free.push(target)
    while (this._free.length > this._maxFree) {
      this._destroy(gl, this._free.shift()!)
    }
  }

  /** Delete every target. */
  dispose(gl: WebGL2RenderingContext): void {
    for (const t of this._free) this._destroy(gl, t)
    for (const t of this._inUse) this._destroy(gl, t)
    this._free.length = 0
    this._inUse.clear()
  }

  /** Forget every handle without GL calls (the context is gone). */
  notifyContextLost(): void {
    this._free.length = 0
    this._inUse.clear()
  }

  get liveCount(): number {
    return this._free.length + this._inUse.size
  }

  get freeCount(): number {
    return this._free.length
  }

  // ---------------------------------------------------------------------------

  private _create(gl: WebGL2RenderingContext, width: number, height: number): RenderTarget | null {
    const texture = gl.createTexture()
    const fbo = gl.createFramebuffer()
    if (!texture || !fbo) {
      if (texture) gl.deleteTexture(texture)
      if (fbo) gl.deleteFramebuffer(fbo)
      return null
    }
    // Leave the caller's texture binding as found: a layer may fall back to
    // its plain draw with its source still bound on the active unit.
    const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, previousTexture ?? null)

    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous ?? null)

    if (!complete) {
      gl.deleteFramebuffer(fbo)
      gl.deleteTexture(texture)
      return null
    }
    return { fbo, texture, width, height }
  }

  private _destroy(gl: WebGL2RenderingContext, target: RenderTarget): void {
    gl.deleteFramebuffer(target.fbo)
    gl.deleteTexture(target.texture)
  }
}
