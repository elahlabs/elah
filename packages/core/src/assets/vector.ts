/**
 * SVG assets (SVG-1a). `MediaKind` has no vector member, so an SVG is an `image` asset; these helpers are the one
 * place that says whether an asset is one and what to say about where it came from.
 */

import type { MediaAsset, MediaAssetVector } from './types'

/** An SVG's text is kept on the asset up to this many characters; larger files are read back from `src`. */
export const VECTOR_INLINE_MAX_CHARS = 32_768

/** A name or source that is an SVG: `.svg` (optionally followed by a query or fragment) or a `data:image/svg…` URL. */
const SVG_LIKE = /\.svg(?:[?#].*)?$|^data:image\/svg/i

/** The target behind a same-origin gallery proxy URL (`/api/gallery/asset?url=<target>`), or `undefined`. */
function proxiedTarget(src: string): string | undefined {
  if (!src.includes('url=')) return undefined
  try {
    return new URL(src, 'http://local').searchParams.get('url') ?? undefined
  } catch {
    return undefined
  }
}

/**
 * True for an image asset that is an SVG: it carries a `vector` record, or its name or source says so. A proxied
 * source counts when the URL it wraps ends in `.svg`.
 */
export function isVectorAsset(a: Pick<MediaAsset, 'kind'> & Partial<Pick<MediaAsset, 'name' | 'src' | 'vector'>>): boolean {
  if (a.kind !== 'image') return false
  if (a.vector !== undefined) return true
  if (SVG_LIKE.test(a.name ?? '')) return true
  const src = a.src ?? ''
  if (SVG_LIKE.test(src)) return true
  const target = proxiedTarget(src)
  return target !== undefined && SVG_LIKE.test(target)
}

/** One line of facts about where a vector came from, for a card or a plan row. Never promotional. */
export function vectorOriginLine(vector: Pick<MediaAssetVector, 'origin' | 'source'>): string {
  const s = vector.source
  if (s) return `Open-source icon · ${s.setName ?? s.set} (${s.licence})`
  if (vector.origin === 'model') return 'Drawn by the assistant'
  if (vector.origin === 'iconify') return 'Open-source icon'
  return 'Uploaded'
}
