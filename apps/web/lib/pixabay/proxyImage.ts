/**
 * Rewrites a Pixabay CDN image URL to go through our own `/api/pixabay/image`
 * proxy, which caches the asset and shields Pixabay's CDN from the request
 * bursts the agentic flow generates (see the route for the full rationale).
 *
 * Non-Pixabay URLs (e.g. blob:/data:/local object URLs) are returned unchanged
 * so this is safe to apply blanketly to any image src.
 */
export function proxyPixabayImage(src: string | null | undefined): string {
  if (!src) return ''
  // Only proxy http(s) Pixabay assets; leave blob:/data:/relative URLs alone.
  if (!/^https?:\/\//i.test(src)) return src
  try {
    const host = new URL(src).hostname
    if (!/(^|\.)pixabay\.com$/i.test(host) && host !== 'i.vimeocdn.com') return src
  } catch {
    return src
  }
  return `/api/pixabay/image?url=${encodeURIComponent(src)}`
}
