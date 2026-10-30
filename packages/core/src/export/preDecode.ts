/**
 * Main-thread rasterisation of SVG image clips for export (PV-P6b-4).
 *
 * Workers in Chromium cannot decode SVG (measured, see the withdrawn
 * PLAN-WEB-GRAPHICS), so `ExportWorker.ts`'s per-src `createImageBitmap(blob)`
 * fails for one. This module runs on the main thread, before the worker
 * spawns: it decodes each SVG image src through the same `<img>` path the
 * preview uses (so the rasterised bitmap is exactly the size the preview
 * places it at), draws it into a canvas of that size, and hands the resulting
 * `ImageBitmap`s to the worker via `ExportOptions.preDecoded`.
 *
 * `data:` image sources (raster ones too) take the same route. A sandboxed
 * host can forbid the worker's `fetch` of a `data:` URL under `connect-src`
 * (a claude.ai artifact allows only `'self'`, `blob:` and Google Fonts) while
 * still letting an `<img>` load it under `img-src`, so decoding them here keeps
 * export working wherever the preview does. Other raster sources are untouched
 * — they still fetch and decode inside the worker.
 *
 * Pure with respect to the DOM only through its injected `deps`; the
 * production defaults use `document.createElement('canvas')` and the
 * preview's `loadCachedImage`, so this file must never be imported by
 * `ExportWorker.ts` (the worker stays DOM-free).
 */
import { MAX_COMPOUND_DEPTH, type Project } from '../types'
import { loadCachedImage } from '../renderer/gpu/layers/imageCache'

/** A URL's file extension identifies it as a known raster format. */
const RASTER_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico'])

/**
 * `true`: `src` names an SVG by its URL alone. `false`: `src` names a known
 * raster format by its URL alone. `null`: the URL does not say either way
 * (every `blob:` URL, and any URL with no recognised extension) — the caller
 * falls back to a content-type probe.
 */
export function svgByUrl(src: string): boolean | null {
  const dataMatch = /^data:([^,;]+)/i.exec(src)
  if (dataMatch) {
    return /^image\/svg\+xml$/i.test(dataMatch[1]!)
  }
  const path = src.split(/[?#]/)[0]!
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
  if (ext === 'svg') return true
  if (RASTER_EXTENSIONS.has(ext)) return false
  return null
}

/**
 * Every image clip `src` in `project`, through compounds (depth ≤
 * {@link MAX_COMPOUND_DEPTH}, mirroring `compoundFrames.ts`'s `collectClips`),
 * unique, in first-seen order.
 */
export function collectImageSrcs(project: Project): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  walk(project, 0)
  return out

  function walk(p: Project, depth: number): void {
    for (const clips of Object.values(p.clips)) {
      for (const clip of clips) {
        if (clip.type === 'image' && typeof clip.src === 'string') {
          if (!seen.has(clip.src)) {
            seen.add(clip.src)
            out.push(clip.src)
          }
        } else if (clip.type === 'compound' && clip.compound) {
          if (depth >= MAX_COMPOUND_DEPTH) continue
          walk(clip.compound.project, depth + 1)
        }
      }
    }
  }
}

export interface PreDecodeDeps {
  /** Default: `loadCachedImage` (the preview's `<img>` decode). */
  loadImage?: (src: string) => Promise<{ source: CanvasImageSource; width: number; height: number }>
  /** Default: draw into a width×height `<canvas>`, then `createImageBitmap(canvas)`. */
  rasterize?: (source: CanvasImageSource, width: number, height: number) => Promise<ImageBitmap>
  /** Default: blob:/data: → fetch(src) and read blob.type; http(s) → HEAD and read content-type; any error → null. */
  contentType?: (src: string) => Promise<string | null>
}

/** Natural size used when an SVG source reports no intrinsic size. */
export const SVG_FALLBACK_SIZE = 1024

const defaultLoadImage: Required<PreDecodeDeps>['loadImage'] = async (src) => {
  const { source, width, height } = await loadCachedImage(src)
  // `loadCachedImage`'s default loader always resolves an <img>, which is a
  // valid CanvasImageSource; the wider TexImageSource return type is what
  // needs the cast, not the runtime value.
  return { source: source as CanvasImageSource, width, height }
}

const defaultRasterize: Required<PreDecodeDeps>['rasterize'] = async (source, width, height) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('preDecodeSvgImages: 2D canvas context unavailable')
  ctx.drawImage(source, 0, 0, width, height)
  return createImageBitmap(canvas)
}

const defaultContentType: Required<PreDecodeDeps>['contentType'] = async (src) => {
  try {
    if (src.startsWith('blob:') || src.startsWith('data:')) {
      const blob = await fetch(src).then((res) => res.blob())
      return blob.type || null
    }
    const res = await fetch(src, { method: 'HEAD' })
    return res.headers.get('content-type')
  } catch {
    return null
  }
}

/**
 * `existing` plus a bitmap for every SVG or `data:` image src in `project` not
 * already in it.
 *
 * Sources are processed one at a time, in order (never `Promise.all`), so a
 * slow or failing decode has a clear place in the trace and in a rejection.
 * `svgByUrl` decides from the URL alone when it can; only a URL it cannot
 * read (e.g. every `blob:` URL) falls back to `contentType`, and a
 * `contentType` failure — a rejection or an unreadable header — is treated as
 * "not SVG", never as a reason to fail the export. A `loadImage` rejection is
 * NOT swallowed: it propagates, exactly as a broken raster image fails export
 * today.
 */
export async function preDecodeSvgImages(
  project: Project,
  existing?: Record<string, ImageBitmap>,
  deps?: PreDecodeDeps,
): Promise<Record<string, ImageBitmap>> {
  const loadImage = deps?.loadImage ?? defaultLoadImage
  const rasterize = deps?.rasterize ?? defaultRasterize
  const contentType = deps?.contentType ?? defaultContentType

  const out: Record<string, ImageBitmap> = { ...existing }
  for (const src of collectImageSrcs(project)) {
    if (src in out) continue

    let isSvg = svgByUrl(src)
    if (isSvg === null) {
      try {
        const type = await contentType(src)
        isSvg = type?.startsWith('image/svg+xml') ?? false
      } catch {
        isSvg = false
      }
    }
    // A data: raster is decoded here too, at its natural size, so the worker never fetches it.
    if (!isSvg && !src.startsWith('data:')) continue

    const { source, width, height } = await loadImage(src)
    let w = width
    let h = height
    if (!w || !h) {
      w = SVG_FALLBACK_SIZE
      h = SVG_FALLBACK_SIZE
      console.warn('[export] image has no intrinsic size; rasterised at 1024×1024:', src.slice(0, 64))
    }
    out[src] = await rasterize(source, w, h)
  }
  return out
}
