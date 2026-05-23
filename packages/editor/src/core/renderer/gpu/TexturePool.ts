/**
 * TexturePool — capped LRU allocator for WebGL2 textures.
 *
 * Textures are keyed by `{ width, height, internalFormat }` so layers can
 * reuse GPU memory across clips without per-frame alloc/free churn.
 *
 * Lifecycle:
 *  - `acquire()` hands out a texture (reused from the free list or freshly
 *    allocated up to `maxTextures`).
 *  - `release()` returns a texture to the pool; it becomes eligible for LRU
 *    eviction when the cap is reached.
 *  - `handleContextLost()` drops all bookkeeping without calling GL delete
 *    (the context is already gone).
 *  - `dispose()` deletes every texture still held in the free list.
 *
 * Callers holding acquired textures must `release()` them before `dispose()`.
 */

/** A pooled GL texture handle with its allocation dimensions. */
export interface PoolTexture {
  readonly glTexture: WebGLTexture
  readonly width: number
  readonly height: number
  readonly internalFormat: GLenum
}

export interface TexturePoolOptions {
  /** Hard cap on live GL textures (free + in-use). Default 16. */
  maxTextures?: number
}

const DEFAULT_MAX_TEXTURES = 16

export class TexturePool {
  private readonly _maxTextures: number

  /** Free textures grouped by dimension key. */
  private readonly _free = new Map<string, PoolTexture[]>()

  /** Flat LRU order across all buckets — head = oldest, tail = newest. */
  private readonly _lruFree: PoolTexture[] = []

  /** Total live GL textures (free + currently acquired). */
  private _allocated = 0

  constructor(options: TexturePoolOptions = {}) {
    this._maxTextures = options.maxTextures ?? DEFAULT_MAX_TEXTURES
  }

  /**
   * Obtain a texture sized for `width` × `height`.
   *
   * Returns `null` when the cap is reached and every texture is in use
   * (no free entries to evict). Callers should degrade gracefully.
   */
  acquire(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    internalFormat?: GLenum,
  ): PoolTexture | null {
    const fmt = internalFormat ?? gl.RGBA
    const key = this._bucketKey(width, height, fmt)

    const bucket = this._free.get(key)
    if (bucket && bucket.length > 0) {
      const entry = bucket.pop()!
      this._removeFromLru(entry)
      return entry
    }

    if (this._allocated < this._maxTextures) {
      return this._allocate(gl, width, height, fmt)
    }

    if (this._lruFree.length > 0) {
      this._evict(gl)
      return this._allocate(gl, width, height, fmt)
    }

    return null
  }

  /** Return a texture to the pool for reuse. */
  release(entry: PoolTexture): void {
    const key = this._bucketKey(entry.width, entry.height, entry.internalFormat)
    let bucket = this._free.get(key)
    if (!bucket) {
      bucket = []
      this._free.set(key, bucket)
    }
    bucket.push(entry)
    this._lruFree.push(entry)
  }

  /**
   * Drop all pool bookkeeping after a context loss.
   * Does not call `gl.deleteTexture` — the GL context is invalid.
   */
  handleContextLost(): void {
    this._free.clear()
    this._lruFree.length = 0
    this._allocated = 0
  }

  /** Delete all textures in the free list and reset the pool. */
  dispose(gl: WebGL2RenderingContext): void {
    for (const entry of this._lruFree) {
      gl.deleteTexture(entry.glTexture)
    }
    this._free.clear()
    this._lruFree.length = 0
    this._allocated = 0
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _bucketKey(width: number, height: number, internalFormat: GLenum): string {
    return `${width}:${height}:${internalFormat}`
  }

  private _removeFromLru(entry: PoolTexture): void {
    const idx = this._lruFree.indexOf(entry)
    if (idx !== -1) {
      this._lruFree.splice(idx, 1)
    }
  }

  private _allocate(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    internalFormat: GLenum,
  ): PoolTexture {
    const glTexture = gl.createTexture()
    if (!glTexture) {
      throw new Error('TexturePool: gl.createTexture() returned null')
    }

    gl.bindTexture(gl.TEXTURE_2D, glTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    // Pre-size the texture to avoid a resize stall on the first upload.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    )

    gl.bindTexture(gl.TEXTURE_2D, null)

    this._allocated++

    return { glTexture, width, height, internalFormat }
  }

  private _evict(gl: WebGL2RenderingContext): void {
    const oldest = this._lruFree.shift()
    if (!oldest) return

    const key = this._bucketKey(oldest.width, oldest.height, oldest.internalFormat)
    const bucket = this._free.get(key)
    if (bucket) {
      const idx = bucket.indexOf(oldest)
      if (idx !== -1) bucket.splice(idx, 1)
      if (bucket.length === 0) this._free.delete(key)
    }

    gl.deleteTexture(oldest.glTexture)
    this._allocated--
  }
}
