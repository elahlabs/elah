/**
 * Matte pairing (PV-P8d), pure: find the library asset that is another
 * asset's black-and-white matte by filename convention (`<stem>_matte.<ext>`
 * / `<stem>_alpha.<ext>`), so inserting `clip.mp4` while `clip_matte.mp4` is
 * already in the library can place both and cut one with the other. No
 * engine, no store read — the caller supplies the candidate assets.
 */

import type { MediaAsset } from './types'

const MATTE_SUFFIX = /^(.*)_(alpha|matte)\.[^.]+$/i
const MATTE_SUFFIX_ONLY = /_matte\.[^.]+$/i

/** `stem` of `<stem>_alpha.<ext>` / `<stem>_matte.<ext>` (case-insensitive), else null. */
export function matteStem(name: string): string | null {
  const match = MATTE_SUFFIX.exec(name)
  return match ? match[1] : null
}

/** The name without its last extension. */
export function fileStem(name: string): string {
  const match = /^(.*)\.[^.]+$/.exec(name)
  return match ? match[1] : name
}

/**
 * The library asset that is `asset`'s matte: same `kind`, a different id,
 * `matteStem(other.name)` equal to `fileStem(asset.name)` ignoring case, and
 * `other.hasAlpha !== true`. A `_matte` name wins over `_alpha`; then the
 * most recent `addedAt`. Undefined when `asset` is itself a matte file or is
 * audio.
 */
export function findPairedMatte(
  asset: MediaAsset,
  assets: Iterable<MediaAsset>,
): MediaAsset | undefined {
  if (asset.kind === 'audio') return undefined
  if (matteStem(asset.name) !== null) return undefined

  const stem = fileStem(asset.name).toLowerCase()
  const candidates: MediaAsset[] = []

  for (const other of assets) {
    if (other.id === asset.id) continue
    if (other.kind !== asset.kind) continue
    if (other.hasAlpha === true) continue
    const otherStem = matteStem(other.name)
    if (otherStem === null) continue
    if (otherStem.toLowerCase() !== stem) continue
    candidates.push(other)
  }

  if (candidates.length === 0) return undefined

  candidates.sort((a, b) => {
    const aMatte = MATTE_SUFFIX_ONLY.test(a.name) ? 1 : 0
    const bMatte = MATTE_SUFFIX_ONLY.test(b.name) ? 1 : 0
    if (aMatte !== bMatte) return bMatte - aMatte
    return b.addedAt - a.addedAt
  })

  return candidates[0]
}
