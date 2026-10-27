/**
 * SequenceLayer — GPU layer for `Scene.sequences` (PV-P8b).
 *
 * Structurally the animated sibling of ImageLayer: same quad pipeline,
 * placement math and effect-chain branch, but the texture is re-uploaded per
 * sequence frame instead of once. The per-frame async pattern (a provider
 * that never blocks `draw()`, `prewarm`-ing ahead of the playhead) copies
 * RotoMaskLayer's.
 *
 * Renderer invariants:
 *  - I1/I4: draw() is synchronous. A miss keeps drawing the last uploaded
 *    frame and fires prewarm out-of-band; nothing is drawn before the first
 *    frame arrives.
 *  - I5: only RenderGraph acquires/releases.
 *  - I9: notifyContextLost() drops every GL handle without GL calls.
 *
 * Imports ONLY from scene.ts, the sequence reader/provider, GL helpers and
 * browser APIs (fetch).
 */

import type { ActiveSequenceClip } from '../../../resolver/scene'
import { sequenceSourceKey } from '../../../resolver/sequence'
import { openAnimatedImage, openFrameSequence, type SequenceFrameReader } from '../../../media/sequence/SequenceReader'
import { SequenceFrameProvider } from '../../../media/sequence/SequenceFrameProvider'
import { ShaderProgram } from '../ShaderProgram'
import { QUAD_FRAG_SRC } from '../shaders/quad.frag'
import { QUAD_VERT_SRC } from '../shaders/quad.vert'
import { buildDrawTransformMatrix, resolveDrawRect } from './drawRect'
import type { Layer, LayerContext } from './types'
import { needsChain } from '../compositing'

/** Plain fetch, for frame sequences served without auth (dev harness, public URLs). Throws on a non-2xx. */
export const fetchSequenceFrame = async (url: string, signal?: AbortSignal): Promise<Blob> => {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Sequence frame ${url} → HTTP ${res.status}`)
  return res.blob()
}

export interface SequenceLayerOptions {
  /** Bytes of an animated file. Default: `sourceBlobCache.resolve`. */
  fileLoader?: (src: string) => Promise<Blob>
  /** One frame of a `frames` sequence. Default: plain fetch that throws on a non-2xx. */
  frameLoader?: (url: string, signal?: AbortSignal) => Promise<Blob>
  /** Replaces reader creation entirely (tests). */
  openReader?: (item: ActiveSequenceClip) => Promise<SequenceFrameReader>
  /** Frames fetched ahead of the playhead. Default 3. */
  lookahead?: number
  /** A frame arrived after the last draw — the host should redraw. */
  onFrameReady?: () => void
}

interface ItemResources {
  texture: WebGLTexture
  provider: SequenceFrameProvider
  sourceKey: string
  /** Frame index currently in the texture; -1 = nothing uploaded yet. */
  uploadedIndex: number
  width: number
  height: number
}

/** Sources warned about once (per source key), never re-logged for the same clip source. */
const warnedFallbacks = new Set<string>()

export class SequenceLayer implements Layer<ActiveSequenceClip> {
  private _program: ShaderProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _gl: WebGL2RenderingContext | null = null
  private readonly _resources = new Map<string, ItemResources>()
  private readonly _lookahead: number
  private readonly _onFrameReady: (() => void) | undefined
  private readonly _openReader: (item: ActiveSequenceClip) => Promise<SequenceFrameReader>

  constructor(options: SequenceLayerOptions = {}) {
    this._lookahead = Math.max(0, options.lookahead ?? 3)
    this._onFrameReady = options.onFrameReady
    this._openReader = options.openReader ?? this._defaultOpenReader(options)
  }

  private _defaultOpenReader(options: SequenceLayerOptions): (item: ActiveSequenceClip) => Promise<SequenceFrameReader> {
    const frameLoader = options.frameLoader ?? fetchSequenceFrame
    return async (item: ActiveSequenceClip): Promise<SequenceFrameReader> => {
      if (item.kind === 'animated-image') {
        const fileLoader = options.fileLoader ?? (await this._defaultFileLoader())
        const blob = await fileLoader(item.src!)
        const reader = await openAnimatedImage(blob, { src: item.src!, flipY: true })
        if (reader.fallback) this._warnFallback(item, reader.fallback)
        return reader
      }
      return openFrameSequence({
        template: item.frameUrlTemplate!,
        frameCount: item.frameCount,
        ...(item.startNumber ? { startNumber: item.startNumber } : {}),
        flipY: true,
        loader: frameLoader,
      })
    }
  }

  private async _defaultFileLoader(): Promise<(src: string) => Promise<Blob>> {
    const { sourceBlobCache } = await import('../../../media/video/demuxer/sourceBlobCache')
    return (src: string) => sourceBlobCache.resolve(src)
  }

  private _warnFallback(item: ActiveSequenceClip, fallback: string): void {
    const key = sequenceSourceKey(item)
    if (warnedFallbacks.has(key)) return
    warnedFallbacks.add(key)
    console.warn(`[SequenceLayer] ${item.src ?? key} shows its first frame: ${fallback}`)
  }

  acquire(item: ActiveSequenceClip, ctx: LayerContext): void {
    const { gl } = ctx
    this._gl = gl
    this._ensurePipeline(gl)

    const texture = gl.createTexture()
    if (!texture) throw new Error('SequenceLayer: gl.createTexture() returned null')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)

    const sourceKey = sequenceSourceKey(item)
    const provider = this._makeProvider(item)
    provider.prewarm(item.frameIndex, 1 + this._lookahead, item.frameCount, item.loop === true)

    this._resources.set(item.id, {
      texture,
      provider,
      sourceKey,
      uploadedIndex: -1,
      width: 0,
      height: 0,
    })
  }

  release(itemId: string): void {
    const res = this._resources.get(itemId)
    if (!res) return
    res.provider.dispose()
    if (this._gl) this._gl.deleteTexture(res.texture)
    this._resources.delete(itemId)
  }

  /** Fetch ahead for items already acquired. Never draws or uploads. */
  prewarm(items: ReadonlyArray<ActiveSequenceClip>, _ctx: LayerContext): void {
    for (const item of items) {
      const res = this._resources.get(item.id)
      if (res && res.sourceKey === sequenceSourceKey(item)) {
        res.provider.prewarm(item.frameIndex, 1 + this._lookahead, item.frameCount, item.loop === true)
      }
    }
  }

  draw(item: ActiveSequenceClip, ctx: LayerContext): void {
    this._gl = ctx.gl
    const res = this._resources.get(item.id)
    if (!res || !this._program || !this._vao) return
    const { gl } = ctx

    // A new source attached to the same clip id: start over.
    const sourceKey = sequenceSourceKey(item)
    if (res.sourceKey !== sourceKey) {
      res.provider.dispose()
      res.provider = this._makeProvider(item)
      res.sourceKey = sourceKey
      res.uploadedIndex = -1
    }

    if (res.uploadedIndex !== item.frameIndex) {
      const img = res.provider.getCurrent(item.frameIndex)
      if (img) {
        gl.bindTexture(gl.TEXTURE_2D, res.texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img.source)
        gl.bindTexture(gl.TEXTURE_2D, null)
        res.uploadedIndex = item.frameIndex
        res.width = img.width
        res.height = img.height
      }
    }
    res.provider.prewarm(item.frameIndex, 1 + this._lookahead, item.frameCount, item.loop === true)

    if (res.uploadedIndex < 0) return
    // A frame the provider knows is absent (a rejected load, e.g. a 404 on an
    // uncovered roto-mask frame) must draw nothing. Keeping the last upload here
    // would show the PREVIOUS frame, and as a track matte that is a stale cutout.
    // A frame that is merely still loading is not "known missing", so I4 (keep
    // the last upload) stands.
    if (res.uploadedIndex !== item.frameIndex && res.provider.isKnownMissing(item.frameIndex)) return

    const opacity = item.opacity ?? 1

    this._program.use(gl)
    gl.bindVertexArray(this._vao)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, res.texture)

    const cornerRadius = item.cornerRadius ?? 0
    const crop = item.crop

    // Effect stack: the chain draws the clip itself, or returns false and the
    // plain draw below runs. Clips without effects never get here.
    if (needsChain(item) && ctx.effectChain) {
      const rect = resolveDrawRect(item.transform, ctx.stage.width, ctx.stage.height, res.width, res.height, crop)
      const drawn = ctx.effectChain.draw(ctx, {
        program: this._program,
        vao: this._vao,
        unit: 0,
        contentWidth: res.width,
        contentHeight: res.height,
        ...(crop ? { crop } : {}),
        cornerRadius,
        rect,
        opacity,
        effects: item.effects ?? [],
        ...(item.mask ? { mask: item.mask } : {}),
        ...(item.blend ? { blend: item.blend } : {}),
        ...(item.matte ? { matte: item.matte } : {}),
      })
      if (drawn) {
        gl.bindTexture(gl.TEXTURE_2D, null)
        gl.bindVertexArray(null)
        return
      }
      this._program.use(gl)
      gl.bindVertexArray(this._vao)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, res.texture)
    }

    this._program.setUniform1i(gl, 'uTexture', 0)
    this._program.setUniform1f(gl, 'uOpacity', opacity)
    this._program.setUniform2f(gl, 'uRadius', cornerRadius, cornerRadius)
    this._program.setUniform4f(gl, 'uCrop', crop?.x ?? 0, crop?.y ?? 0, crop?.width ?? 0, crop?.height ?? 0)
    this._program.setUniformMatrix3fv(
      gl,
      'uTransform',
      false,
      buildDrawTransformMatrix(item.transform, ctx.stage.width, ctx.stage.height, res.width, res.height, crop),
    )

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    if (this._gl) {
      for (const res of this._resources.values()) {
        res.provider.dispose()
        this._gl.deleteTexture(res.texture)
      }
      if (this._vao) this._gl.deleteVertexArray(this._vao)
      if (this._program) this._program.dispose(this._gl)
    } else {
      for (const res of this._resources.values()) res.provider.dispose()
    }
    this._resources.clear()
    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Drop GL handles after a context loss (no GL calls). Providers go too; they reopen cheaply. */
  notifyContextLost(): void {
    for (const res of this._resources.values()) res.provider.dispose()
    this._resources.clear()
    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Exposed for testing. */
  getTextureCount(): number {
    return this._resources.size
  }

  // The fallback warning is issued from `_defaultOpenReader` itself (it has
  // the reader's `fallback` in hand right after opening); an injected
  // `openReader` (tests) supplies its own reader and is not expected to warn.
  private _makeProvider(item: ActiveSequenceClip): SequenceFrameProvider {
    return new SequenceFrameProvider({
      open: () => this._openReader(item),
      onFrameReady: () => this._onFrameReady?.(),
    })
  }

  private _ensurePipeline(gl: WebGL2RenderingContext): void {
    if (this._program && this._vao) return
    this._program = ShaderProgram.create(gl, QUAD_VERT_SRC, QUAD_FRAG_SRC)
    const vao = gl.createVertexArray()
    if (!vao) throw new Error('SequenceLayer: gl.createVertexArray() returned null')
    this._vao = vao
  }
}
