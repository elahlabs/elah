/**
 * VideoLayer — GPU layer for ActiveVideoClip items.
 *
 * Architecture:
 *  - One VideoFrameProvider per unique src (shared across clips)
 *  - One VideoTexture per clip id
 *  - Synchronous draw(); async frame scheduling via provider.setPlayhead()
 *
 * VideoLayer talks ONLY to VideoFrameProvider, TexturePool/VideoTexture,
 * and ShaderProgram. No decoder, PlaybackEngine, TimelineEngine, or React.
 */

import type { ActiveVideoClip } from '../../../resolver/scene'
import { ShaderProgram } from '../ShaderProgram'
import { QUAD_FRAG_SRC } from '../shaders/quad.frag'
import { QUAD_VERT_SRC } from '../shaders/quad.vert'
import type { TexturePool } from '../TexturePool'
import { VideoTexture } from '../VideoTexture'
import {
  createVideoFrameProvider,
  type VideoFrameProvider,
  type VideoFrameProviderDeps,
} from '../../../media/video'
import { buildDrawTransformMatrix, resolveDrawRect, type CropRect, type DrawRect } from './drawRect'
import type { Layer, LayerContext } from './types'
import { needsChain } from '../compositing'
import * as videoUploadProbe from './videoUploadProbe'
import { displaySizeFor, normalizeRotation, type VideoRotation } from '../../../media/video/rotation'

// Placement math now lives in ./drawRect (shared with ImageLayer). Re-exported
// here for back-compat with existing importers (e.g. FrameProbeLayer, tests).
export {
  buildTransformMatrixFromRect,
  resolveTransformRect,
  resolveDrawRect,
  buildDrawTransformMatrix,
} from './drawRect'
export type { DrawRect } from './drawRect'
/** @deprecated use DrawRect from ./drawRect */
export type VideoDrawRect = DrawRect

/** Per-src provider entry with reference counting. */
interface ProviderEntry {
  provider: VideoFrameProvider
  refCount: number
  /** The source this provider was opened on. A clip re-pointed at another file needs a new one. */
  src: string
}

/**
 * Build the clip-space transform matrix for an ActiveVideoClip.
 *
 * Thin adapter over the shared `buildDrawTransformMatrix` — keeps the
 * `ActiveVideoClip`-typed signature FrameProbeLayer relies on.
 */
export function buildVideoTransformMatrix(
  item: ActiveVideoClip,
  stageWidth: number,
  stageHeight: number,
  contentWidth?: number,
  contentHeight?: number,
  crop?: CropRect,
): Float32Array {
  return buildDrawTransformMatrix(
    item.transform,
    stageWidth,
    stageHeight,
    contentWidth,
    contentHeight,
    crop,
  )
}

interface ContentSize {
  width: number
  height: number
  rotation: VideoRotation
}

export type VideoFrameProviderFactory = (src: string) => VideoFrameProvider

/**
 * Max timeline-frame distance between the holdover's capture point and the
 * incoming clip's first draw for the holdover to be shown. A direct video→video
 * cut is 1 frame apart (a few more under render jank). Anything larger means a
 * gap (e.g. an image between the clips) or a seek — showing the previous
 * video's frame there would ghost stale content into the new clip.
 */
const HOLDOVER_MAX_FRAME_GAP = 5

/**
 * How long a provider may sit at refCount 0 before VideoLayer disposes it.
 *
 * The cap below does nearly all of the memory work. Any scrub or playback that
 * keeps releasing clips holds the live provider count at `maxIdleProviders`
 * regardless of this number — measured across a 200-cut session, the count
 * never once reached the deadline as the binding constraint. The deadline only
 * decides anything in the single case the cap cannot reach: the user stops
 * touching the timeline with FEWER than `maxIdleProviders` clips idle, so
 * nothing new ever arrives to push them out.
 *
 * In that case 5s vs 30s is a rounding error on peak memory (the idle set is
 * already under the cap by definition) but it is the whole difference between a
 * warm and a cold re-scrub: pause, read the script, nudge the playhead back one
 * cut, and a 5s deadline has already thrown away the decoder you are about to
 * ask for. 20s covers a pause-and-come-back while still bounding how long an
 * abandoned tab holds decoders open.
 */
const DEFAULT_IDLE_DISPOSE_MS = 20_000

/**
 * Max providers retained simultaneously at refCount 0.
 *
 * The deadline alone cannot bound memory: a fast scrub across a multi-clip
 * timeline releases clips far quicker than the deadline, so every clip touched
 * inside one timeout window would be held at once. This cap is the burst valve,
 * and it is what actually keeps the live provider count flat over a session.
 *
 * 4 is sized against two independent ceilings:
 *  - Decoders. Chrome's practical concurrent hardware decoder count is single
 *    digits before `VideoDecoder.configure` starts failing. 4 idle plus the one
 *    or two actually being drawn stays inside that with room to spare.
 *  - Memory. Each idle provider pins its whole FrameCache, so this number is
 *    only as safe as that per-cache bound. Stated explicitly because it is a
 *    dependency on another file, not a local decision: 4 assumes a BYTE-bounded
 *    (resolution-aware) cache, and StreamingFrameProducer.ts now provides one —
 *    DEFAULT_MAX_CACHE_BYTES (256 MiB) caps each provider regardless of source
 *    resolution (≈32 frames at 1080p, ≈8 at 4K). If that byte bound is ever
 *    removed and the cache returns to a plain frame-count bound, this number
 *    has to come down with it.
 */
const DEFAULT_MAX_IDLE_PROVIDERS = 4

/**
 * Fraction of `idleDisposeMs` that must have elapsed before prewarm() bothers
 * pushing a provider's deadline back out.
 *
 * prewarm() runs once per RAF, so re-arming unconditionally costs a
 * clearTimeout + setTimeout + a full idle-set sweep ~60x/second per
 * idle-in-horizon clip, forever, to express "still not evicting this". Waiting
 * until the deadline is half consumed turns that into roughly two re-arms per
 * idle window. The cost is at most half a window of warmth lost in the worst
 * case — and only for a provider sitting in the prewarm horizon, i.e. one that
 * is about to be acquired and cancel its deadline outright anyway.
 */
const IDLE_REARM_AFTER_FRACTION = 0.5

/**
 * What a clip's media is doing. Mirrors `ClipLoadState` in the clip-load store
 * without importing it — this layer has no business knowing a store exists.
 */
export type VideoClipLoadState = 'loading' | 'error'

/** Tuning knobs for provider retention. Injectable so tests can drive them. */
export interface VideoLayerOptions {
  /** ms a refCount-0 provider stays warm before disposal. Default 20000. */
  idleDisposeMs?: number
  /** Max refCount-0 providers retained at once. Default 4. */
  maxIdleProviders?: number
  /**
   * Called when a clip starts loading, fails to open, or becomes drawable
   * (`null`). Fires at clip-boundary events only — never per frame — so a React
   * consumer can render a spinner without subscribing to the render loop.
   */
  onClipLoad?: (itemId: string, state: VideoClipLoadState | null) => void
}

/** A pending eviction deadline for one refCount-0 provider. */
interface IdleEviction {
  timer: ReturnType<typeof setTimeout>
  /**
   * Wall clock (ms) at which this deadline was armed. Read only by prewarm()'s
   * re-arm guard — without it a per-RAF prewarm cannot tell a deadline it armed
   * 16ms ago from one that is about to fire.
   */
  armedAt: number
}

export class VideoLayer implements Layer<ActiveVideoClip> {
  private readonly _pool: TexturePool
  private readonly _providerFactory: VideoFrameProviderFactory
  /** Decode deps forwarded to createVideoFrameProvider when no providerFactory override. */
  private readonly _deps: VideoFrameProviderDeps | undefined
  private readonly _idleDisposeMs: number
  private readonly _maxIdleProviders: number
  private readonly _onClipLoad: ((itemId: string, state: VideoClipLoadState | null) => void) | undefined
  /**
   * Clips whose provider's open promise already has a failure watcher attached.
   * acquire() runs every tick a clip is in the scene; without this the same
   * promise would collect a new `.then` sixty times a second.
   */
  private readonly _openWatchedItemIds = new Set<string>()

  private _program: ShaderProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _gl: WebGL2RenderingContext | null = null

  private readonly _providers = new Map<string, ProviderEntry>()
  private readonly _textures = new Map<string, VideoTexture>()
  private readonly _srcByItemId = new Map<string, string>()
  /**
   * Item IDs whose provider was created by prewarm() ahead of the clip becoming
   * active — the decoder is opening/decoding but the clip is NOT yet drawn.
   * These providers have refCount 0 (draw() has never acquired them).
   *
   * This is a TAG, not an ownership register: it means "created by prewarm and
   * not yet promoted by acquire()", and its only reader is the scrub-away sweep
   * at the bottom of prewarm(). It deliberately does NOT own the provider's
   * lifetime — every provider in here also carries an eviction deadline, because
   * the sweep only runs while prewarm() keeps being called and would otherwise
   * strand these providers the moment the render loop stops.
   *
   * An entry is removed the moment acquire() promotes it to a drawn clip.
   */
  private readonly _prewarmedItemIds = new Set<string>()
  /**
   * Pending eviction deadline per refCount-0 provider, keyed by clip id.
   *
   * Doubles as the LRU register for the idle-provider cap: Map iteration order
   * is insertion order, and every scheduling path deletes before it re-inserts,
   * so the head of this map is always the least-recently-released provider.
   * Every path that leaves a provider at refCount 0 arms an entry here —
   * release() and prewarm()'s create branch alike — and acquire() removes one
   * the instant a clip is drawn again, so nothing in this map ever has
   * refCount > 0 and its size tracks getIdleProviderCount(). That agreement is
   * an invariant to uphold, not something getIdleProviderCount() may assume:
   * see its comment.
   *
   * VideoLayer owns this timer rather than registering with the providers'
   * own idle timeouts (StreamingFrameProducer/VideoDecoderManager already run
   * one, firing into a callback nothing in production sets): `setIdleCallback`
   * is not part of the VideoFrameProvider interface, so reaching for it would
   * mean type-probing each concrete provider and silently leaking again for any
   * implementation that lacks it. Ownership also has to sit here regardless —
   * only VideoLayer can drop the Map entries that keep the provider reachable.
   */
  private readonly _idleEvictionTimers = new Map<string, IdleEviction>()
  /** DISPLAY-space size (post-rotation) plus the source rotation the texture needs. */
  private readonly _contentSizeByItemId = new Map<string, ContentSize>()
  /** Last sourceFrame logged per clip — prevents flooding at 60 fps on a frozen playhead. */
  private readonly _lastLoggedSourceFrameByItemId = new Map<string, number>()
  /**
   * Last clip texture that had real GPU content, kept alive after its clip
   * exits the scene. Used as a single-frame fallback when the incoming clip's
   * texture has not received its first decoded frame yet — prevents the 1-2
   * tick black flash at clip boundaries while async decode catches up.
   * Disposed as soon as the new clip uploads its first frame, or when the
   * incoming clip is NOT frame-adjacent to it (see HOLDOVER_MAX_FRAME_GAP).
   */
  private _holdoverTexture: VideoTexture | null = null
  /** Timeline frame at which the holdover's clip last drew. -Infinity = unknown/stale. */
  private _holdoverFrame = Number.NEGATIVE_INFINITY
  /**
   * Content dimensions of the frame held in _holdoverTexture. Without these, a
   * clip drawn from the holdover (its own contentSize entry is gone — release()
   * deleted it) would fall back to fill-the-stage and stretch the frame.
   */
  private _holdoverContentSize: ContentSize | null = null
  /** Timeline frame at which each active clip last drew — stamps the holdover on release. */
  private readonly _lastDrawFrameByItemId = new Map<string, number>()

  constructor(
    pool: TexturePool,
    providerFactoryOrDeps?: VideoFrameProviderFactory | VideoFrameProviderDeps,
    options?: VideoLayerOptions,
  ) {
    this._pool = pool
    this._idleDisposeMs = options?.idleDisposeMs ?? DEFAULT_IDLE_DISPOSE_MS
    this._maxIdleProviders = options?.maxIdleProviders ?? DEFAULT_MAX_IDLE_PROVIDERS
    this._onClipLoad = options?.onClipLoad
    if (typeof providerFactoryOrDeps === 'function') {
      this._providerFactory = providerFactoryOrDeps
      this._deps = undefined
    } else {
      this._deps = providerFactoryOrDeps
      this._providerFactory = (src: string) => createVideoFrameProvider(src, this._deps)
    }
  }

  acquire(item: ActiveVideoClip, ctx: LayerContext): void {
    const { gl } = ctx
    this._gl = gl
    this._ensurePipeline(gl)

    // A provider kept idle for this clip but opened on another source (the
    // clip was re-pointed, e.g. a reload reconnecting a local file) is stale:
    // drop it so the clip opens the file it now names instead of the dead one.
    const stale = this._providers.get(item.id)
    if (stale && stale.src !== item.src && stale.refCount <= 0) this._disposeProvider(item.id)

    this._textures.set(item.id, new VideoTexture(this._pool))
    this._srcByItemId.set(item.id, item.src)

    // Keyed by clip ID, not src: each clip owns an independent
    // StreamingFrameProducer so that copy-pasted clips (same src, different
    // startFrame) never share a playhead and cause backwards-seek stalls.
    let entry = this._providers.get(item.id)
    if (!entry) {
      const provider = this._deps
        ? createVideoFrameProvider(item.src, { ...this._deps, fps: ctx.fps })
        : this._providerFactory(item.src)
      entry = { provider, refCount: 0, src: item.src }
      this._providers.set(item.id, entry)
    }

    // Promote a prewarmed provider to a drawn clip: it's no longer prewarm's to
    // idle/dispose — the draw lifecycle (refCount + release) now owns it. Its
    // decoder is already warm from prewarm(), so the boundary paints instantly.
    this._prewarmedItemIds.delete(item.id)

    // Re-acquired before its eviction deadline (scrub back over a cut, or a
    // clip that briefly left the scene): cancel the pending disposal outright.
    // Without this the timer armed by the earlier release() would fire under a
    // clip that is being drawn right now and tear its decoder out mid-playback.
    this._cancelIdleEviction(item.id)

    entry.refCount++
    entry.provider.markActive()

    // Report before the first draw: a clip whose decoder is still opening has
    // nothing on screen, and that is exactly the wait the user is looking at.
    // draw() clears it the moment a frame uploads, so a warm provider is in
    // 'loading' for one tick.
    this._reportLoad(item.id, this._contentSizeByItemId.has(item.id) ? null : 'loading')
    this._watchOpenFailure(item.id, entry)
  }

  /**
   * Surface a failed container open as an error state on the clip.
   *
   * The open promise is fire-and-forget on the render path and swallows its own
   * rejection into `openError`, so the only way to learn about the failure is to
   * wait on it and then read the flag. Attached once per clip.
   */
  private _watchOpenFailure(itemId: string, entry: ProviderEntry): void {
    if (this._onClipLoad === undefined) return
    if (this._openWatchedItemIds.has(itemId)) return
    // Read synchronously: StreamingFrameProducer nulls `openPromise` as soon as
    // the first discontinuity consumes it, so a later read finds nothing.
    const opening = entry.provider.openPromise
    if (!opening) return

    this._openWatchedItemIds.add(itemId)
    void opening.then(() => {
      // The clip may have been released and re-acquired against a different
      // provider in the meantime; only the current one gets to speak for it.
      if (this._providers.get(itemId) !== entry) return
      if (entry.provider.openError) this._reportLoad(itemId, 'error')
    })
  }

  private _reportLoad(itemId: string, state: VideoClipLoadState | null): void {
    this._onClipLoad?.(itemId, state)
  }

  release(itemId: string): void {
    const src = this._srcByItemId.get(itemId)
    if (!src) return

    // A clip that has left the scene has no loading state to report. Leaving
    // one behind would keep the preview's spinner up over a clip that is no
    // longer being drawn at all.
    this._reportLoad(itemId, null)

    const texture = this._textures.get(itemId)
    if (texture?.hasContent) {
      // Transfer to holdover so the next clip can borrow this frame for its
      // first tick while its own decode is in flight. Stamp it with the frame
      // this clip last drew at so draw() can reject it across gaps/seeks.
      this._holdoverTexture?.dispose()
      this._holdoverTexture = texture
      this._holdoverFrame =
        this._lastDrawFrameByItemId.get(itemId) ?? Number.NEGATIVE_INFINITY
      this._holdoverContentSize = this._contentSizeByItemId.get(itemId) ?? null
    } else {
      texture?.dispose()
    }
    this._textures.delete(itemId)
    this._srcByItemId.delete(itemId)
    this._contentSizeByItemId.delete(itemId)
    this._lastLoggedSourceFrameByItemId.delete(itemId)
    this._lastDrawFrameByItemId.delete(itemId)
    videoUploadProbe.forget(itemId)

    const entry = this._providers.get(itemId)
    if (!entry) return

    entry.refCount--
    if (entry.refCount <= 0) {
      entry.refCount = 0
      entry.provider.markIdle()
      // markIdle() alone only pauses decode — it never frees the decoder or the
      // cached frames, and the provider's own idle timer fires into a callback
      // production never registers. Arm our own so the provider is actually
      // disposed and unmapped if the clip does not come back.
      this._scheduleIdleEviction(itemId)
    }
  }

  /**
   * Prewarm decode for video clips that are about to become active.
   *
   * `upcoming` is the list of ActiveVideoClips resolved a short horizon AHEAD of
   * the current playhead. For each, this ensures a provider exists and pushes its
   * playhead so the decoder opens, seeks to the nearest keyframe, and fills its
   * lookahead buffer — all BEFORE the clip enters the drawn scene. When the cut
   * arrives, acquire()+draw() find a warm decoder and paint the first frame
   * immediately instead of freezing on a cold open+seek.
   *
   * Does NOT draw, upload, or allocate GL state. Providers created here start at
   * refCount 0; if a clip later becomes active, acquire() promotes it. If the
   * horizon moves off a clip before it ever draws (e.g. the user scrubs away),
   * its still-refCount-0 provider is idled and dropped here. Providers created
   * here also carry the same idle deadline a released clip gets, so they are
   * reclaimed even if prewarm() is never called again.
   */
  prewarm(upcoming: ActiveVideoClip[], ctx: LayerContext): void {
    // Built up-front rather than as the loop walks: the cap sweep triggered from
    // inside the loop needs the WHOLE horizon to exempt, including the clips
    // this iteration has not reached yet.
    const horizonIds = new Set(upcoming.map((item) => item.id))

    for (const item of upcoming) {
      let entry = this._providers.get(item.id)
      // Same stale-source rule as acquire(): an idle provider on another file
      // would prewarm the wrong source.
      if (entry && entry.src !== item.src && entry.refCount <= 0) {
        this._disposeProvider(item.id)
        entry = undefined
      }
      if (!entry) {
        // Never seen this clip — create its provider cold and mark it prewarmed.
        const provider = this._deps
          ? createVideoFrameProvider(item.src, { ...this._deps, fps: ctx.fps })
          : this._providerFactory(item.src)
        entry = { provider, refCount: 0, src: item.src }
        this._providers.set(item.id, entry)
        this._prewarmedItemIds.add(item.id)
        provider.markActive()
        // Arm a deadline on this path too. Without it, the scrub-away sweep at
        // the bottom of this method is the provider's ONLY reclaim path — and
        // that sweep only runs while prewarm() keeps being called. Editor
        // paused, tab hidden, GpuRenderer.prewarm early-returning on !_mounted
        // or a lost context: the loop stops, the sweep never fires again, and
        // every provider prewarm ever created sits on a live decoder and a full
        // frame cache for the rest of the session. This is also what puts these
        // providers under `maxIdleProviders` at all — before, neither knob
        // applied to them.
        this._scheduleIdleEviction(item.id, horizonIds)
      } else if (entry.refCount > 0) {
        // Already an active, drawn clip — draw() is driving its playhead. Leave
        // it alone; pushing a future playhead here would seek it off the frame
        // being drawn this tick.
        continue
      } else {
        // A refCount-0 provider still inside the horizon: either released by a
        // clip the user scrubbed back over, or prewarmed on an earlier tick and
        // not yet drawn. Either way it is being actively re-warmed below, so its
        // producer must not be left reporting 'idle' — markIdle()/markActive()
        // only juggle a timer into an unset callback today, but that is a
        // property of the current provider, not a contract.
        entry.provider.markActive()
        // Push the deadline out so the timer armed at release (or at prewarm
        // creation) does not dispose the very provider we are re-warming.
        // Guarded: prewarm runs per RAF and re-arming is not free. Re-scheduling
        // re-inserts rather than grows the map, so it cannot push another idle
        // provider over the cap.
        if (this._shouldRearmIdleEviction(item.id)) {
          this._scheduleIdleEviction(item.id, horizonIds)
        }
      }

      // Push the future playhead so the decoder decodes ahead of the cut.
      entry.provider.setPlayhead(item.sourceFrame)
    }

    // Drop providers we prewarmed earlier that have fallen out of the horizon
    // without ever being drawn (scrub-away). Active clips (promoted via acquire)
    // are never in _prewarmedItemIds, so this can't touch a drawn clip.
    for (const id of [...this._prewarmedItemIds]) {
      if (horizonIds.has(id)) continue
      this._prewarmedItemIds.delete(id)
      this._disposeProvider(id)
    }
  }

  draw(item: ActiveVideoClip, ctx: LayerContext): void {
    this._gl = ctx.gl

    const texture = this._textures.get(item.id)
    const entry = this._providers.get(item.id)
    if (!texture || !entry) return

    this._lastDrawFrameByItemId.set(item.id, ctx.frame)
    videoUploadProbe.noteDrawn(item.id, ctx.frame)

    const { provider } = entry

    // Push the playhead before reading the cache so the producer can fill
    // the lookahead window for this tick and upcoming ticks.
    provider.setPlayhead(item.sourceFrame)
    const frame = provider.getCurrent(item.sourceFrame)

    if (frame !== null) {
      // Single-owner rule: the FrameCache owns this frame and closes it on
      // eviction. We only BORROW it here — VideoTexture.upload() never closes it,
      // so there is no clone and no double-owner. (The cache holds an ImageBitmap
      // copy on the real decode path; a VideoFrame on the synthetic dev path.)
      const uploaded = texture.upload(ctx.gl, frame)
      if (uploaded) {
        videoUploadProbe.noteUploaded(item.id, ctx.frame)
        // The cached bitmap may be a downscaled copy; the clip's content size is
        // the SOURCE size when the provider knows it.
        const src = provider.sourceSize
        const rawWidth = src?.width ?? ('displayWidth' in frame ? frame.displayWidth : frame.width)
        const rawHeight = src?.height ?? ('displayHeight' in frame ? frame.displayHeight : frame.height)
        // The frame is the coded (unrotated) picture. Fit/crop/transform all
        // work in what the viewer sees, so the content size is the rotated one.
        const rotation = normalizeRotation(provider.rotation)
        const { width, height } = displaySizeFor(rawWidth, rawHeight, rotation)
        // A content size appearing for the first time IS the first drawable
        // frame for this clip — the moment the wait the user is watching ends.
        if (!this._contentSizeByItemId.has(item.id)) this._reportLoad(item.id, null)
        this._contentSizeByItemId.set(item.id, { width, height, rotation })
        // First real frame for this clip — holdover is no longer needed.
        this._holdoverTexture?.dispose()
        this._holdoverTexture = null
        this._holdoverContentSize = null
      }
    }
    // On cache miss: setPlayhead() already triggered decode for this frame.
    // The provider keeps the last uploaded texture content — no flicker.

    if (!this._program || !this._vao) return

    let contentSize = this._contentSizeByItemId.get(item.id)
    const opacity = item.opacity ?? 1

    this._program.use(ctx.gl)
    ctx.gl.bindVertexArray(this._vao)

    // Prefer the clip's own texture; fall back to the holdover for the first
    // tick(s) while async decode delivers the initial frame — avoids the black
    // flash at clip boundaries. The holdover is only valid across a direct cut:
    // if this clip is not frame-adjacent to where the holdover was captured
    // (image/gap between clips, or a seek), drop it instead of ghosting the
    // previous video's frame into this clip.
    let unit = texture.bind(ctx.gl, 0)
    if (unit < 0 && this._holdoverTexture !== null) {
      if (Math.abs(ctx.frame - this._holdoverFrame) <= HOLDOVER_MAX_FRAME_GAP) {
        unit = this._holdoverTexture.bind(ctx.gl, 0)
        // The borrowed frame must be fitted by ITS dimensions, not the (absent)
        // dimensions of the incoming clip — otherwise it stretches to the stage.
        contentSize ??= this._holdoverContentSize ?? undefined
      } else {
        this._holdoverTexture.dispose()
        this._holdoverTexture = null
        this._holdoverContentSize = null
      }
    }
    if (unit < 0) return

    // Effect stack: the chain draws the clip itself, or returns false and the
    // plain draw below runs. Clips without effects never get here.
    if (needsChain(item) && ctx.effectChain) {
      const rect = resolveDrawRect(
        item.transform,
        ctx.stage.width,
        ctx.stage.height,
        contentSize?.width,
        contentSize?.height,
        item.crop,
      )
      const drawn = ctx.effectChain.draw(ctx, {
        program: this._program,
        vao: this._vao,
        unit,
        contentWidth: contentSize?.width ?? rect.width,
        contentHeight: contentSize?.height ?? rect.height,
        ...(item.crop ? { crop: item.crop } : {}),
        rotation: contentSize?.rotation ?? 0,
        cornerRadius: item.cornerRadius ?? 0,
        rect,
        opacity,
        effects: item.effects ?? [],
        ...(item.mask ? { mask: item.mask } : {}),
        ...(item.blend ? { blend: item.blend } : {}),
        ...(item.matte ? { matte: item.matte } : {}),
      })
      if (drawn) {
        ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, null)
        ctx.gl.bindVertexArray(null)
        return
      }
      this._program.use(ctx.gl)
      ctx.gl.bindVertexArray(this._vao)
    }

    this._program.setUniform1i(ctx.gl, 'uTexture', unit)
    this._program.setUniform1f(ctx.gl, 'uOpacity', opacity)
    // Always set uRadius (0 when unset) — the uniform persists in the GL
    // program between draws, so a clip that has no cornerRadius must still
    // clear whatever the previously-drawn clip left behind.
    const cornerRadius = item.cornerRadius ?? 0
    this._program.setUniform2f(ctx.gl, 'uRadius', cornerRadius, cornerRadius)
    // Always set uCrop (zeros when unset) — same reasoning as uRadius above:
    // the uniform persists between draws within this program.
    const crop = item.crop
    this._program.setUniform4f(ctx.gl, 'uCrop', crop?.x ?? 0, crop?.y ?? 0, crop?.width ?? 0, crop?.height ?? 0)
    // Always set (0 when upright) — persists in the program between draws.
    this._program.setUniform1i(ctx.gl, 'uRotation', contentSize?.rotation ?? 0)
    this._program.setUniformMatrix3fv(
      ctx.gl,
      'uTransform',
      false,
      buildVideoTransformMatrix(
        item,
        ctx.stage.width,
        ctx.stage.height,
        contentSize?.width,
        contentSize?.height,
        crop,
      ),
    )

    ctx.gl.drawArrays(ctx.gl.TRIANGLE_STRIP, 0, 4)

    ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, null)
    ctx.gl.bindVertexArray(null)
  }

  dispose(): void {
    for (const itemId of this._srcByItemId.keys()) videoUploadProbe.forget(itemId)
    for (const texture of this._textures.values()) {
      texture.dispose()
    }
    this._textures.clear()
    this._srcByItemId.clear()
    this._contentSizeByItemId.clear()
    this._lastDrawFrameByItemId.clear()
    this._holdoverTexture?.dispose()
    this._holdoverTexture = null
    this._holdoverFrame = Number.NEGATIVE_INFINITY
    this._holdoverContentSize = null

    // Cancel first: the timers hold a reference to `this` and would otherwise
    // wake up after teardown to evict from maps that are already empty.
    for (const pending of this._idleEvictionTimers.values()) {
      clearTimeout(pending.timer)
    }
    this._idleEvictionTimers.clear()

    for (const [itemId, entry] of this._providers) {
      entry.provider.dispose()
      this._reportLoad(itemId, null)
    }
    this._providers.clear()
    this._prewarmedItemIds.clear()
    this._openWatchedItemIds.clear()

    if (this._gl) {
      if (this._vao) this._gl.deleteVertexArray(this._vao)
      if (this._program) this._program.dispose(this._gl)
    }

    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Drop GL object references after a context loss. */
  notifyContextLost(): void {
    for (const texture of this._textures.values()) {
      texture.handleContextLost()
    }
    // Holdover GL handle is also invalid after context loss.
    this._holdoverTexture?.handleContextLost()
    this._holdoverTexture = null
    this._holdoverContentSize = null
    this._program = null
    this._vao = null
    this._gl = null
  }

  /** Delete GL objects while the context is still valid. */
  disposeGL(gl: WebGL2RenderingContext): void {
    for (const texture of this._textures.values()) {
      texture.dispose()
    }
    if (this._vao) gl.deleteVertexArray(this._vao)
    if (this._program) this._program.dispose(gl)
    this.dispose()
  }

  /** Exposed for testing: provider instance for a clip item ID. */
  getProviderForItemId(itemId: string): VideoFrameProvider | undefined {
    return this._providers.get(itemId)?.provider
  }

  /** Exposed for testing: first provider whose src matches (for single-clip test scenarios). */
  getProviderForSrc(src: string): VideoFrameProvider | undefined {
    for (const [itemId, itemSrc] of this._srcByItemId) {
      if (itemSrc === src) return this._providers.get(itemId)?.provider
    }
    return undefined
  }

  /** Exposed for testing: ref count for a clip item ID. */
  getProviderRefCount(itemId: string): number {
    return this._providers.get(itemId)?.refCount ?? 0
  }

  /**
   * Providers held at refCount 0 — warm, undrawn, awaiting eviction.
   *
   * Counted off `_providers` rather than read from `_idleEvictionTimers.size`.
   * The two agree, but only because every refCount-0 path arms a deadline — and
   * a refCount-0 provider that reaches this state WITHOUT one is precisely the
   * leak this counter exists to surface. Reading the timer map would report 0
   * for it and hide the bug (which is exactly how prewarm-created providers
   * escaped both retention knobs unnoticed). Correct by construction, not by
   * coincidence.
   */
  getIdleProviderCount(): number {
    let count = 0
    for (const entry of this._providers.values()) {
      if (entry.refCount === 0) count++
    }
    return count
  }

  /** Exposed for testing: number of per-clip texture handles. */
  getTextureCount(): number {
    return this._textures.size
  }

  /** Number of unique src providers currently alive (including idle). */
  getProviderCount(): number {
    return this._providers.size
  }

  /**
   * Snapshot of `src → decoderState` for all live providers.
   * Used by the debug panel. Returns `{}` when no providers are alive.
   */
  getDecoderStates(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [src, entry] of this._providers) {
      const provider = entry.provider as VideoFrameProvider & { decoderState?: string }
      if (typeof provider.decoderState === 'string') {
        out[src] = provider.decoderState
      }
    }
    return out
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _ensurePipeline(gl: WebGL2RenderingContext): void {
    if (this._program && this._vao) return

    this._program = ShaderProgram.create(gl, QUAD_VERT_SRC, QUAD_FRAG_SRC)

    const vao = gl.createVertexArray()
    if (!vao) {
      throw new Error('VideoLayer: gl.createVertexArray() returned null')
    }
    this._vao = vao
  }

  /**
   * Arm (or re-arm) the eviction deadline for a refCount-0 provider.
   *
   * Deletes before inserting so the id moves to the tail of the LRU order —
   * a re-armed provider must count as the most recently released, otherwise the
   * cap sweep below would evict the clip the user is actively scrubbing over.
   *
   * `protectedIds`, when given, is the prewarm horizon of the pass that armed
   * this deadline; see _enforceIdleProviderCap.
   */
  private _scheduleIdleEviction(itemId: string, protectedIds?: ReadonlySet<string>): void {
    this._cancelIdleEviction(itemId)
    this._idleEvictionTimers.set(itemId, {
      timer: setTimeout(() => {
        this._idleEvictionTimers.delete(itemId)
        this._disposeProvider(itemId)
      }, this._idleDisposeMs),
      armedAt: Date.now(),
    })
    this._enforceIdleProviderCap(protectedIds)
  }

  private _cancelIdleEviction(itemId: string): void {
    const pending = this._idleEvictionTimers.get(itemId)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this._idleEvictionTimers.delete(itemId)
  }

  /**
   * Whether prewarm() should push a provider's deadline further out.
   *
   * prewarm() runs once per RAF, so an unguarded re-arm costs a clearTimeout, a
   * setTimeout and a full cap sweep ~60x/second per idle-in-horizon clip — pure
   * churn to keep re-stating a decision nothing has changed. Wait until the
   * deadline is meaningfully consumed instead.
   *
   * Returns true when there is no deadline at all: that keeps this the single
   * place a refCount-0 provider can end up un-armed, so a future path that
   * forgets to schedule one self-heals on the next prewarm pass rather than
   * leaking silently.
   */
  private _shouldRearmIdleEviction(itemId: string): boolean {
    const pending = this._idleEvictionTimers.get(itemId)
    if (pending === undefined) return true
    return Date.now() - pending.armedAt >= this._idleDisposeMs * IDLE_REARM_AFTER_FRACTION
  }

  /**
   * Dispose the least-recently-released providers until the idle set fits the
   * cap. Needed because a burst of clip changes — a fast scrub across a
   * multi-clip timeline — strands far more providers inside one timeout window
   * than the decoded-frame budget can hold, and each one keeps a live decoder
   * until its own deadline arrives.
   *
   * `protectedIds` is the prewarm horizon of the pass that triggered the sweep,
   * and its members are exempt. Those providers sit at refCount 0 only because
   * their clips have not been drawn YET — they are decoding ahead of a cut that
   * is seconds away, not scrub history nobody will look at. Evicting them is
   * both wrong and unstable: prewarm() recreates whatever it still needs on the
   * very next RAF, so a horizon wider than the cap degenerates into a 60Hz
   * open-and-dispose storm across every clip in it. The exemption gives up
   * nothing the cap was ever protecting either — a horizon of N simultaneous
   * clips becomes N providers at refCount > 0 a moment later, and the cap has
   * never bounded drawn clips.
   *
   * Iterating a snapshot of the keys (rather than repeatedly re-reading the
   * head) is what lets a protected id be skipped without spinning forever on it.
   */
  private _enforceIdleProviderCap(protectedIds?: ReadonlySet<string>): void {
    if (this._idleEvictionTimers.size <= this._maxIdleProviders) return
    for (const itemId of [...this._idleEvictionTimers.keys()]) {
      if (this._idleEvictionTimers.size <= this._maxIdleProviders) return
      if (protectedIds?.has(itemId) === true) continue
      this._disposeProvider(itemId)
    }
  }

  /**
   * Free a provider and drop every reference that kept it reachable.
   *
   * Refuses to touch a drawn clip: the timer that scheduled this eviction may
   * have been armed before a re-acquire, and disposing a refCount > 0 provider
   * would kill the decoder feeding the current frame. acquire() cancels the
   * timer for exactly this reason — the guard is the backstop for any future
   * path that forgets to.
   */
  private _disposeProvider(itemId: string): void {
    this._cancelIdleEviction(itemId)
    const entry = this._providers.get(itemId)
    if (!entry || entry.refCount > 0) return

    entry.provider.dispose()
    this._providers.delete(itemId)
    this._srcByItemId.delete(itemId)
    this._prewarmedItemIds.delete(itemId)
    this._openWatchedItemIds.delete(itemId)
    // Defensive: release() normally clears this first, but a provider disposed
    // straight out of prewarm never went through release at all.
    this._reportLoad(itemId, null)
  }
}
