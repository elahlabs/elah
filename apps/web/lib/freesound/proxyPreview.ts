/**
 * Rewrites a Freesound preview URL to go through our own
 * `/api/freesound/preview` proxy, which caches the file and serves it
 * same-origin so the <audio> preview and the timeline's Web Audio decode
 * share one browser cache entry (see the route for the full rationale).
 *
 * Non-Freesound URLs (e.g. blob:/data:/local object URLs) are returned
 * unchanged so this is safe to apply blanketly to any audio src.
 */
export function proxyFreesoundPreview(src: string | null | undefined): string {
  if (!src) return ''
  // Only proxy http(s) Freesound assets; leave blob:/data:/relative URLs alone.
  if (!/^https?:\/\//i.test(src)) return src
  try {
    const host = new URL(src).hostname
    if (!/(^|\.)freesound\.org$/i.test(host)) return src
  } catch {
    return src
  }
  return `/api/freesound/preview?url=${encodeURIComponent(src)}`
}
