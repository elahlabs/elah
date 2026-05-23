/**
 * VideoTexture — per-clip handle that uploads decoded frames to a pooled GL texture.
 *
 * Owns one `PoolTexture` entry from a shared `TexturePool`. The upload path is
 * the single abstraction over `gl.texImage2D` for video pixels:
 *
 *   upload(gl, frame) → texImage2D → frame.close()
 *
 * **Frame ownership:** the caller transfers the `VideoFrame` to this class.
 * `upload()` closes it immediately after the GL upload, regardless of success.
 * Do not close the frame before or after calling `upload()`.
 *
 * On context loss, call `handleContextLost()` (does not touch the pool — the
 * pool's own handler already cleared all handles). The next `upload()` will
 * re-acquire a fresh texture from the pool.
 */

import type { PoolTexture, TexturePool } from './TexturePool'

export class VideoTexture {
  private readonly _pool: TexturePool

  private _entry: PoolTexture | null = null
  private _hasContent = false

  constructor(pool: TexturePool) {
    this._pool = pool
  }

  /** Whether a frame has been successfully uploaded at least once. */
  get hasContent(): boolean {
    return this._hasContent
  }

  /**
   * Upload pixel data from a decoded `VideoFrame` into the pooled texture.
   *
   * Re-acquires from the pool when dimensions change or no texture is held.
   * Returns `false` if the pool is exhausted; the frame is still closed.
   */
  upload(gl: WebGL2RenderingContext, frame: VideoFrame): boolean {
    const width = frame.displayWidth
    const height = frame.displayHeight

    try {
      if (
        !this._entry
        || this._entry.width !== width
        || this._entry.height !== height
      ) {
        if (this._entry) {
          this._pool.release(this._entry)
          this._entry = null
        }

        const acquired = this._pool.acquire(gl, width, height, gl.RGBA)
        if (!acquired) {
          return false
        }
        this._entry = acquired
      }

      gl.bindTexture(gl.TEXTURE_2D, this._entry.glTexture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        frame as TexImageSource,
      )
      gl.bindTexture(gl.TEXTURE_2D, null)

      this._hasContent = true
      return true
    } finally {
      frame.close()
    }
  }

  /**
   * Bind the texture to `unit` for drawing.
   * Returns the unit index, or `-1` if nothing has been uploaded yet.
   */
  bind(gl: WebGL2RenderingContext, unit: number): number {
    if (!this._entry || !this._hasContent) {
      return -1
    }

    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, this._entry.glTexture)
    return unit
  }

  /**
   * Drop the held texture reference after context loss.
   * Does not return the entry to the pool (handles are already invalid).
   */
  handleContextLost(): void {
    this._entry = null
    this._hasContent = false
  }

  /** Return the pooled texture and reset state. */
  release(): void {
    if (this._entry) {
      this._pool.release(this._entry)
      this._entry = null
    }
    this._hasContent = false
  }

  /** Alias for `release()`. */
  dispose(): void {
    this.release()
  }
}
