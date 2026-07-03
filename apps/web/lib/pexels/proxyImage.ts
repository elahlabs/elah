/**
 * Rewrites a Pexels CDN image URL to go through our own `/api/pexels/image`
 * proxy, which caches the asset and shields Pexels' CDN from request bursts
 * (mirrors proxyPixabayImage — see that file for the full rationale).
 *
 * Non-Pexels URLs (e.g. blob:/data:/local object URLs) are returned unchanged
 * so this is safe to apply blanketly to any image src.
 */
export function proxyPexelsImage(src: string | null | undefined): string {
  if (!src) return ''
  if (!/^https?:\/\//i.test(src)) return src
  try {
    const host = new URL(src).hostname
    if (!/(^|\.)pexels\.com$/i.test(host)) return src
  } catch {
    return src
  }
  return `/api/pexels/image?url=${encodeURIComponent(src)}`
}
