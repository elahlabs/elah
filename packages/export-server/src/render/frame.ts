/**
 * FrameCompositor — the compositor stage of the ffmpeg export pipeline.
 *
 * A line-by-line port of packages/core/src/export/ExportWorker.ts's
 * renderFrame/drawMedia/drawText/drawShape/drawFreehand and its transition
 * snapshot pass (:427-658, :300-301, :331-345, :350-357) from OffscreenCanvas
 * 2D to `@napi-rs/canvas`. Same draw order, same defaults, same z-sort — only
 * the canvas backend changed. This class reads ONLY the `Scene` (plus the
 * already-decoded frames/images handed to it by other modules in this
 * package), never `Project`/`Clip`, per the package's governing rule
 * (see types.ts).
 *
 * The browser version's `xlog`/`isDebugFrame` tracing is intentionally
 * dropped — it does not belong in this package.
 */

import {
  resolveDrawRect,
  computeTextLayout,
  type Scene,
  type Transform,
  type ActiveVideoClip,
  type ActiveImageClip,
  type ActiveTextClip,
  type ActiveShapeClip,
  type ActiveFreehandClip,
} from '@elah/core'
import { createCanvas, ImageData, Path2D } from '@napi-rs/canvas'
import type { Canvas, SKRSContext2D, Image } from '@napi-rs/canvas'

import type { DecodedFrame } from '../types'
import type { FontRegistry } from './fonts'

/**
 * The subset of a 2D context `computeTextLayout` needs — mirrors core's own
 * (unexported) `TextMeasurer` type exactly. `@napi-rs/canvas`'s `SKRSContext2D`
 * implements `font`/`measureText` but is not nominally assignable to
 * `Pick<CanvasRenderingContext2D, 'font' | 'measureText'>`, so callers cast
 * through this type at the one call site that needs it (see `drawText`).
 */
type TextMeasurer = Pick<CanvasRenderingContext2D, 'font' | 'measureText'>

/** Anything the `drawImage` port can place on stage: a loaded image or a scratch canvas. */
type DrawSource = Canvas | Image

export interface FrameSources {
  /** Decoded video frame per clip id; null when the decoder had nothing for this frame. */
  video: ReadonlyMap<string, DecodedFrame | null>
  /**
   * Loaded image per RAW Scene src (`ActiveImageClip.src`) — this class never
   * sees a resolved path/URL, so the map must be keyed by what it actually
   * looks clips up by. `exportProject` loads each image via the resolved
   * `plan.imageSources[].source` but keys this map by `.src`.
   */
  images: ReadonlyMap<string, Image>
}

export interface FrameCompositorInit {
  width: number
  height: number
  fonts: FontRegistry
}

/** One persistent scratch canvas a clip's decoded frame is copied into before `drawImage`. */
interface ScratchSurface {
  canvas: Canvas
  ctx: SKRSContext2D
}

/**
 * A frozen bitmap of an outgoing clip, held for the duration of a transition.
 * `owned` mirrors the browser version's `ImageBitmap.close()` bookkeeping:
 * `true` for a snapshot canvas this class allocated (a copied video frame,
 * released when the transition ends), `false` for a loaded `Image` that
 * `FrameSources.images` still owns and this class must not touch further than
 * holding a reference to it.
 */
interface SnapshotEntry {
  source: DrawSource
  owned: boolean
  /** True display dims for placement — never the (possibly downscaled) canvas dims. */
  displayWidth: number
  displayHeight: number
}

type AnyItem =
  | { kind: 'video'; item: ActiveVideoClip }
  | { kind: 'image'; item: ActiveImageClip }
  | { kind: 'text'; item: ActiveTextClip }
  | { kind: 'shape'; item: ActiveShapeClip }
  | { kind: 'freehand'; item: ActiveFreehandClip }

export class FrameCompositor {
  private readonly width: number
  private readonly height: number
  private readonly fonts: FontRegistry
  private readonly canvas: Canvas
  private readonly ctx: SKRSContext2D

  /** Per-clip-id scratch canvas a decoded video frame's raw bytes are copied into. */
  private readonly scratch = new Map<string, ScratchSurface>()
  /** Per-transition-id frozen snapshot of the outgoing clip. */
  private readonly snapshots = new Map<string, SnapshotEntry>()

  constructor(init: FrameCompositorInit) {
    this.width = init.width
    this.height = init.height
    this.fonts = init.fonts
    this.canvas = createCanvas(init.width, init.height)
    this.ctx = this.canvas.getContext('2d')
  }

  /**
   * Draws one Scene and returns the stage's RGBA pixels.
   * The returned array is a view into this class's own canvas buffer and is
   * reused across calls — hand it to the encoder immediately, never retain it.
   */
  render(scene: Scene, sources: FrameSources): Uint8ClampedArray {
    const { ctx, width, height } = this

    // Opaque black background (ExportWorker.ts:449-451) — every exported frame
    // is fully opaque, which is what makes the getImageData readback below
    // safe regardless of premultiplied-vs-straight alpha.
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)

    // Capture a snapshot of each transition's outgoing clip on its first
    // frame. The frame/image is already decoded/loaded in `sources` — no
    // extra seek or decode needed (ExportWorker.ts:329-345).
    this.captureSnapshots(scene, sources)

    const items: AnyItem[] = [
      ...scene.videos.map(item => ({ kind: 'video' as const, item })),
      ...scene.images.map(item => ({ kind: 'image' as const, item })),
      ...scene.texts.map(item => ({ kind: 'text' as const, item })),
      ...scene.shapes.map(item => ({ kind: 'shape' as const, item })),
      ...scene.freehand.map(item => ({ kind: 'freehand' as const, item })),
    ].sort((a, b) => a.item.zIndex - b.item.zIndex)

    for (const entry of items) {
      ctx.save()
      ctx.globalAlpha = entry.item.opacity ?? 1

      if (entry.kind === 'video') {
        const frame = sources.video.get(entry.item.id) ?? null
        if (frame) {
          const surface = this.surfaceFor(entry.item.id, frame.width, frame.height)
          surface.ctx.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0)
          // Use the frame's TRUE display size for placement, not the (possibly
          // decode-capped) scratch canvas size — see CRITICAL geometry note below.
          this.drawMedia(surface.canvas, frame.displayWidth, frame.displayHeight, entry.item.transform)
        }
      } else if (entry.kind === 'image') {
        const image = sources.images.get(entry.item.src)
        if (image) this.drawMedia(image, image.width, image.height, entry.item.transform)
      } else if (entry.kind === 'text') {
        this.drawText(entry.item)
      } else if (entry.kind === 'shape') {
        this.drawShape(entry.item)
      } else {
        this.drawFreehand(entry.item)
      }

      ctx.restore()
    }

    // Transition snapshot pass — mirrors TransitionOverlay's CSS logic in the
    // 2D canvas API (ExportWorker.ts:531-554). The resolver already set the
    // incoming clip's opacity to 1 and the outgoing clip's to 0 in the items
    // loop above, so only the snapshot needs painting here.
    for (const tr of scene.transitions) {
      const snap = this.snapshots.get(tr.id)
      if (!snap) continue
      ctx.save()

      if (tr.kind === 'slide') {
        const sign = tr.direction === 'left' ? -1 : 1
        ctx.translate(sign * tr.t * width, 0)
        this.drawMedia(snap.source, snap.displayWidth, snap.displayHeight, undefined)
      } else if (tr.kind === 'wipe') {
        // Reveal the incoming clip from the right by shrinking the snapshot's visible area.
        ctx.beginPath()
        ctx.rect(0, 0, width * (1 - tr.t), height)
        ctx.clip()
        this.drawMedia(snap.source, snap.displayWidth, snap.displayHeight, undefined)
      } else {
        // fade (default)
        ctx.globalAlpha = 1 - tr.t
        this.drawMedia(snap.source, snap.displayWidth, snap.displayHeight, undefined)
      }

      ctx.restore()
    }

    this.releaseStaleSnapshots(scene)

    return ctx.getImageData(0, 0, width, height).data
  }

  /** Releases scratch surfaces and snapshots. */
  dispose(): void {
    // @napi-rs/canvas canvases have no explicit close/dispose — their native
    // buffers are reclaimed by GC once dereferenced, unlike the browser's
    // ImageBitmap. Dropping the maps' references is the whole of "release".
    this.scratch.clear()
    this.snapshots.clear()
  }

  // ---------------------------------------------------------------------
  // Transition snapshots (ExportWorker.ts:296-301, 331-345, 350-357)
  // ---------------------------------------------------------------------

  private captureSnapshots(scene: Scene, sources: FrameSources): void {
    for (const tr of scene.transitions) {
      if (this.snapshots.has(tr.id)) continue

      const fromVideo = scene.videos.find(v => v.id === tr.fromClipId)
      const fromImage = scene.images.find(i => i.id === tr.fromClipId)

      if (fromVideo) {
        const frame = sources.video.get(fromVideo.id) ?? null
        if (!frame) continue
        // `frame.data` is a view invalidated by the next decoder step —
        // copy it into a fresh canvas before the current frame's decode
        // advances (types.ts DecodedFrame doc comment).
        const copy = new Uint8ClampedArray(frame.data)
        const snapshotCanvas = createCanvas(frame.width, frame.height)
        snapshotCanvas.getContext('2d').putImageData(new ImageData(copy, frame.width, frame.height), 0, 0)
        this.snapshots.set(tr.id, {
          source: snapshotCanvas,
          owned: true,
          displayWidth: frame.displayWidth,
          displayHeight: frame.displayHeight,
        })
      } else if (fromImage) {
        const image = sources.images.get(fromImage.src)
        if (!image) continue
        this.snapshots.set(tr.id, {
          source: image,
          owned: false,
          displayWidth: image.width,
          displayHeight: image.height,
        })
      }
    }
  }

  /** Release snapshots whose transition window has closed. */
  private releaseStaleSnapshots(scene: Scene): void {
    const activeIds = new Set(scene.transitions.map(tr => tr.id))
    for (const id of this.snapshots.keys()) {
      if (!activeIds.has(id)) this.snapshots.delete(id)
    }
  }

  // ---------------------------------------------------------------------
  // Placement helpers — mirror the GPU renderer's drawRect/textLayout logic
  // (ExportWorker.ts:565-658)
  // ---------------------------------------------------------------------

  private drawMedia(source: DrawSource, displayWidth: number, displayHeight: number, transform: Transform | undefined): void {
    // CRITICAL: `render()` is called with the OUTPUT dimensions, and those are
    // what get passed as stageW/stageH here — never `scene.stage.*` — exactly
    // as ExportWorker.ts:347/485/500 does. Do not "fix" this to use the stage
    // size; parity with the browser exporter depends on it.
    const rect = resolveDrawRect(transform, this.width, this.height, displayWidth, displayHeight)
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2

    this.ctx.translate(cx, cy)
    this.ctx.rotate(rect.rotation)
    this.ctx.drawImage(source, -rect.width / 2, -rect.height / 2, rect.width, rect.height)
  }

  private drawText(clip: ActiveTextClip): void {
    const ctx = this.ctx
    // Substitute the font family first so the layout measures with the font
    // that will actually paint (fonts.ts).
    const item = { ...clip, fontFamily: this.fonts.substitute(clip.fontFamily) }
    // computeTextLayout wants Pick<CanvasRenderingContext2D, 'font' | 'measureText'>;
    // SKRSContext2D is structurally close but not nominally assignable, so we
    // cast once here rather than widen the shared core signature.
    const layout = computeTextLayout(ctx as unknown as TextMeasurer, item, { width: this.width, height: this.height })
    ctx.fillStyle = layout.style.color
    ctx.textAlign = layout.style.textAlign
    ctx.textBaseline = 'middle'

    const rotation = clip.transform?.rotation ?? 0
    if (rotation !== 0) {
      const cx = layout.center.x * this.width
      const cy = layout.center.y * this.height
      ctx.translate(cx, cy)
      ctx.rotate(rotation)
      ctx.translate(-cx, -cy)
    }

    for (let i = 0; i < layout.lines.length; i++) {
      ctx.fillText(layout.lines[i], layout.anchorX, layout.firstLineY + i * layout.lineAdvance)
    }
  }

  /** Mirrors ShapeLayer.paintShape — same centered rect/circle/triangle geometry. */
  private drawShape(item: ActiveShapeClip): void {
    const ctx = this.ctx
    const cx = (item.transform?.x ?? 0.5) * this.width
    const cy = (item.transform?.y ?? 0.5) * this.height
    const shortSide = Math.min(this.width, this.height)
    const half = (item.transform?.scale ?? 0.5) * shortSide * 0.5

    ctx.fillStyle = item.shapeFill
    ctx.strokeStyle = item.shapeStroke
    ctx.lineWidth = item.shapeStrokeWidth

    if (item.shapeKind === 'rect') {
      ctx.beginPath()
      ctx.rect(cx - half, cy - half, half * 2, half * 2)
      ctx.fill()
      if (item.shapeStrokeWidth > 0) ctx.stroke()
    } else if (item.shapeKind === 'circle') {
      ctx.beginPath()
      ctx.arc(cx, cy, half, 0, Math.PI * 2)
      ctx.fill()
      if (item.shapeStrokeWidth > 0) ctx.stroke()
    } else if (item.shapeKind === 'triangle') {
      ctx.beginPath()
      ctx.moveTo(cx, cy - half)
      ctx.lineTo(cx + half, cy + half)
      ctx.lineTo(cx - half, cy + half)
      ctx.closePath()
      ctx.fill()
      if (item.shapeStrokeWidth > 0) ctx.stroke()
    }
  }

  /** Mirrors FreehandLayer.paintFreehand — same Path2D stroke, invalid pathData is a no-op. */
  private drawFreehand(item: ActiveFreehandClip): void {
    if (!item.pathData) return

    const ctx = this.ctx
    ctx.strokeStyle = item.strokeColor
    ctx.lineWidth = item.strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    try {
      const path = new Path2D(item.pathData)
      ctx.stroke(path)
    } catch {
      // Invalid pathData — render nothing.
    }
  }

  /** Returns (creating or resizing as needed) the scratch canvas a clip's decoded frame is copied into. */
  private surfaceFor(clipId: string, width: number, height: number): ScratchSurface {
    const existing = this.scratch.get(clipId)
    if (existing && existing.canvas.width === width && existing.canvas.height === height) {
      return existing
    }
    const canvas = createCanvas(width, height)
    const surface: ScratchSurface = { canvas, ctx: canvas.getContext('2d') }
    this.scratch.set(clipId, surface)
    return surface
  }
}
