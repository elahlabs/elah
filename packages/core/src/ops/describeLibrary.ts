/**
 * `describeLibrary` (AGN-P2): the media library as the planner should see it.
 *
 * `describeProject` names a media clip's `content` by its bare asset id, so a
 * model looking at two clips cannot tell the interview from the B-roll, and
 * cannot choose a source for `insertSourceRange` at all. This lists what
 * footage EXISTS: id, kind, name, length, whether it carries sound, what the
 * AI analysis says it is, and whether a transcript is already cached (so a
 * caller can know without a network call).
 *
 * Pure and bounded: the longest sources come first, so the main footage is
 * never the one dropped, and the rest is counted in `assetsOmitted`.
 */

import type { MediaAsset, MediaKind } from '../assets/types'
import { isVectorAsset, vectorOriginLine } from '../assets/vector'

/** What the planner is told an asset is: `MediaKind`, except that an SVG image reads as `svg` (SVG-1a). */
export type DescribedKind = MediaKind | 'svg'

export interface DescribedAsset {
  id: string
  kind: DescribedKind
  name: string
  durationSec: number
  hasAudio?: boolean
  /** An SVG's origin, facts only ("Open-source icon · Material Symbols (Apache-2.0)", "Uploaded"). SVG assets only. */
  origin?: string
  /** The AI summary of the source, cut to a short budget. */
  about?: string
  tags?: string[]
  /** `'cached'` when a whole-source transcript with at least one word is stored on the asset. */
  transcript: 'none' | 'cached'
  /**
   * AGN-P11: what is visible in the picture at given source times, from frames
   * the user agreed to have described. Absent when nothing was observed.
   */
  seen?: Array<{ atSec: number; what: string; tags?: string[] }>
}

/** The fields `describeLibrary` reads; a full `MediaAsset` satisfies it. */
export type LibraryAssetLike = Pick<MediaAsset, 'id' | 'kind' | 'name' | 'durationSec'> &
  Partial<Pick<MediaAsset, 'hasAudio' | 'analysis' | 'transcript' | 'footage' | 'src' | 'vector'>>

export const MAX_DESCRIBED_ASSETS = 40
const MAX_NAME_CHARS = 60
const MAX_ABOUT_CHARS = 240
const MAX_TAGS = 8
/** AGN-P11: observations listed per asset, and the cut applied to each. */
export const MAX_SEEN_PER_ASSET = 12
const MAX_SEEN_CHARS = 160
const MAX_SEEN_TAGS = 4
/** AGN-P11: all `seen` text across the library, so 40 assets cannot each spend a full allowance. */
export const MAX_SEEN_TOTAL_CHARS = 6000

export function describeLibrary(
  assets: Iterable<LibraryAssetLike>,
  opts: { max?: number; maxNameChars?: number } = {},
): { assets: DescribedAsset[]; assetsOmitted?: number } {
  const max = Math.max(0, Math.floor(opts.max ?? MAX_DESCRIBED_ASSETS))
  const maxName = Math.max(1, Math.floor(opts.maxNameChars ?? MAX_NAME_CHARS))
  const len = (a: LibraryAssetLike) => (Number.isFinite(a.durationSec) ? a.durationSec : 0)
  // Array.prototype.sort is stable, so equal lengths keep library order.
  const all = [...assets].sort((a, b) => len(b) - len(a))
  let seenBudget = MAX_SEEN_TOTAL_CHARS
  const shown = all.slice(0, max).map((a): DescribedAsset => {
    const about = a.analysis?.summary?.trim()
    const tags = (a.analysis?.tags ?? []).slice(0, MAX_TAGS)
    const round = Math.round(len(a) * 100) / 100
    const seen: NonNullable<DescribedAsset['seen']> = []
    // A run the host application answered with nothing usable (state 'not-analysed') is never offered as an observation.
    if (a.footage?.state !== 'not-analysed') {
      for (const o of (a.footage?.observations ?? []).slice(0, MAX_SEEN_PER_ASSET)) {
        const what = o.summary.trim().slice(0, MAX_SEEN_CHARS)
        if (!what || !Number.isFinite(o.timestampSec)) continue
        const tags = o.tags.slice(0, MAX_SEEN_TAGS)
        const cost = what.length + tags.join('').length
        if (cost > seenBudget) break
        seenBudget -= cost
        seen.push({ atSec: Math.round(o.timestampSec * 10) / 10, what, ...(tags.length ? { tags } : {}) })
      }
    }
    const svg = isVectorAsset(a)
    return {
      id: a.id,
      kind: svg ? 'svg' : a.kind,
      name: a.name.slice(0, maxName),
      durationSec: round,
      ...(a.hasAudio !== undefined ? { hasAudio: a.hasAudio } : {}),
      ...(svg && a.vector ? { origin: vectorOriginLine(a.vector) } : {}),
      ...(about ? { about: about.slice(0, MAX_ABOUT_CHARS) } : {}),
      ...(about && tags.length ? { tags } : {}),
      transcript: (a.transcript?.words.length ?? 0) > 0 ? 'cached' : 'none',
      ...(seen.length ? { seen } : {}),
    }
  })
  return all.length > shown.length ? { assets: shown, assetsOmitted: all.length - shown.length } : { assets: shown }
}
