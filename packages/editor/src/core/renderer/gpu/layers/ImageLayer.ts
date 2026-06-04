/**
 * ImageLayer — GPU layer for ActiveImageClip items.
 *
 * Structurally this is the static sibling of VideoLayer: same quad pipeline and
 * placement math (`buildDrawTransformMatrix`, including the no-transform contain
 * fit), but with a one-shot image load instead of a per-frame decoder.
 *
 * Its texture+upload idiom mirrors TextLayer rather than VideoLayer/VideoTexture:
 * a per-item `gl.createTexture` uploaded once, toggling UNPACK_PREMULTIPLY_ALPHA
 * around the upload so images with alpha (e.g. PNG) composite correctly against
 * the premultiplied blend func set in WebGLContext. Orientation is handled the
 * same way as TextLayer's 2D canvas — a top-left-origin source against the global
 * UNPACK_FLIP_Y_WEBGL + the shader's Y flip — so no per-image flip is needed.
 *
 * The load is async; draw() simply skips until the image is ready and uploads on
 * the first tick after it resolves. The Preview RAF re-renders every frame, so a
 * late-loading image appears within one frame with no extra invalidation.
 *
 * Imports ONLY from scene.ts, core/types (via drawRect), and browser APIs.
 */

import type { ActiveImageClip } from '../../../resolver/scene'
import { ShaderProgram } from '../ShaderProgram'
import { QUAD_FRAG_SRC } from '../shaders/quad.frag'
import { QUAD_VERT_SRC } from '../shaders/quad.vert'
import { buildDrawTransformMatrix } from './drawRect'
import type { Layer, LayerContext } from './types'

/** A decoded image ready for upload, plus its intrinsic size for the contain fit. */
export interface LoadedImage {
  source: TexImageSource
  width: number
  height: number
}

/** Loads an image src into an uploadable source. Injectable so tests skip the DOM. */
export type ImageLoader = (src: string) => Promise<LoadedImage>

/** Default loader: an <img> element, mirroring probeImage/makeImageThumbnail. */
const defaultImageLoader: ImageLoader = (src) =>
  new Promise<LoadedImage>((resolve, reject) => {
    const img = document.createElement('img')
    img.onload = () => {
      img.onload = null
      img.onerror = null
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      img.onload = null
      img.onerror = null
      reject(new Error(`ImageLayer: failed to load image "${src}"`))
    }
    img.src = src
  })

/** Per-clip resources: GL texture + the loaded image (null until it resolves). */
interface ItemResources {
  texture: WebGLTexture
  image: LoadedImage | null
  /** True once the loaded image has been uploaded into the texture. */
  uploaded: boolean
}

export class ImageLayer implements Layer<ActiveImageClip> {
  private _program: ShaderProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _gl: WebGL2RenderingContext | null = null
  private readonly _resources = new Map<string, ItemResources>()
  private readonly _loadImage: ImageLoader

  constructor(loadImage?: ImageLoader) {
    this._loadImage = loadImage ?? defaultImageLoader
  }

  acquire(item: ActiveImageClip, ctx: LayerContext): void {
    const { gl } = ctx
    this._gl = gl
    this._ensurePipeline(gl)

    const texture = gl.createTexture()
    if (!texture) {
      throw new Error('ImageLayer: gl.createTexture() returned null')
    }

    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)

    const res: ItemResources = { texture, image: null, uploaded: false }
    this._resources.set(item.id, res)

    // Kick the load off out-of-band. draw() picks the result up on a later tick.
    // Guard against the clip being released (or re-acquired) before it resolves.
    void this._loadImage(item.src)
      .then((image) => {
        if (this._resources.get(item.id) === res) {
          res.image = image
        }
      })
      .catch((err) => {
        console.warn(`[ImageLayer] ${(err as Error).message}`)
      })
  }

  release(itemId: string): void {
    const res = this._resources.get(itemId)
    if (!res) return
    if (this._gl) {
      this._gl.deleteTexture(res.texture)
    }
    this._resources.delete(itemId)
  }

  draw(item: ActiveImageClip, ctx: LayerContext): void {
    this._gl = ctx.gl
    const res = this._resources.get(item.id)
    if (!res || !this._program || !this._vao) return

    const { gl } = ctx

    if (res.image && !res.uploaded) {
      gl.bindTexture(gl.TEXTURE_2D, res.texture)
      // Premultiply on upload so semi-transparent image pixels (PNG) blend
      // correctly against the premultiplied blend func; restore the default so
      // the opaque video upload path is unaffected regardless of draw order.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, res.image.source)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.bindTexture(gl.TEXTURE_2D, null)
      res.uploaded = true
    }

    // Nothing to draw until the image has loaded + uploaded.
    if (!res.uploaded || !res.image) return

    const opacity = item.opacity ?? 1

    this._program.use(gl)
    gl.bindVertexArray(this._vao)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, res.texture)

    this._program.setUniform1i(gl, 'uTexture', 0)
    this._program.setUniform1f(gl, 'uOpacity', opacity)
    this._program.setUniformMatrix3fv(
      gl,
      'uTransform',
      false,
      buildDrawTransformMatrix(
        item.transform,
        ctx.stage.width,
        ctx.stage.height,
        res.image.width,
        res.image.height,
      ),
    )

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    if (this._gl) {
      for (const res of this._resources.values()) {
        this._gl.deleteTexture(res.texture)
      }
      if (this._vao) this._gl.deleteVertexArray(this._vao)
      if (this._program) this._program.dispose(this._gl)
    }
    this._resources.clear()
    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Drop GL object references after a context loss (no GL calls — context is gone). */
  notifyContextLost(): void {
    this._resources.clear()
    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Exposed for testing: number of per-clip texture handles. */
  getTextureCount(): number {
    return this._resources.size
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _ensurePipeline(gl: WebGL2RenderingContext): void {
    if (this._program && this._vao) return

    this._program = ShaderProgram.create(gl, QUAD_VERT_SRC, QUAD_FRAG_SRC)

    const vao = gl.createVertexArray()
    if (!vao) {
      throw new Error('ImageLayer: gl.createVertexArray() returned null')
    }
    this._vao = vao
  }
}
