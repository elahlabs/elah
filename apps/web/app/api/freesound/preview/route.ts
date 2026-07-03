import { type NextRequest } from 'next/server'

/**
 * Audio proxy for Freesound preview MP3s.
 *
 * Why this exists: the editor's audio pipeline must fetch + decode the WHOLE
 * preview file into an AudioBuffer before a clip can make any sound
 * (AudioPlaybackController). `cdn.freesound.org` responds without
 * `Cache-Control`, and the browser fetches it cold every time — on a slow
 * route to the CDN that's a 10-20s silent window right after a sound is
 * inserted on the timeline, which reads as "audio playback is broken".
 *
 * Routing previews through this proxy fixes it two ways:
 *  1. Long-lived caching — `Cache-Control: public, max-age=…, immutable`
 *     lets the browser serve repeat loads from cache. Preview URLs embed the
 *     sound id and quality tier and never change content, so immutable is safe.
 *  2. One URL for preview and timeline — the panel's <audio> preview and the
 *     Web Audio `fetch()` hit the same proxied URL, so listening to a sound
 *     before adding it warms the exact bytes the timeline will decode.
 *
 * In-flight requests for the same URL are deduped and total concurrency
 * toward Freesound is capped, mirroring the Pixabay image proxy.
 *
 * SSRF guard: only Freesound preview hosts may be proxied. Any other host is
 * rejected with 400 so this route can never be used as an open proxy.
 */

// Freesound serves previews from these hosts. Keep the list tight — this is
// the SSRF boundary.
const ALLOWED_HOSTS = new Set(['cdn.freesound.org', 'freesound.org'])

// Preview URLs embed the sound id + quality tier and their content never
// changes → safe to cache for a long time. 7 days on the browser, and let a
// shared cache hold it as well.
const CACHE_CONTROL = 'public, max-age=604800, s-maxage=604800, immutable'

// Cap simultaneous origin fetches so a result-grid warm-up burst queues
// instead of saturating the (already slow) CDN route.
const MAX_CONCURRENT_ORIGIN_FETCHES = 4

let _activeFetches = 0
const _waiters: Array<() => void> = []
// Dedupe concurrent requests for the same URL into a single origin fetch —
// the <audio> preview and the Web Audio decode often race for the same file.
const _inFlight = new Map<string, Promise<{ body: ArrayBuffer; contentType: string }>>()

async function acquireSlot(): Promise<void> {
  if (_activeFetches < MAX_CONCURRENT_ORIGIN_FETCHES) {
    _activeFetches++
    return
  }
  await new Promise<void>((resolve) => _waiters.push(resolve))
  _activeFetches++
}

function releaseSlot(): void {
  _activeFetches--
  const next = _waiters.shift()
  if (next) next()
}

function isAllowed(url: URL): boolean {
  return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname)
}

async function fetchOrigin(url: string): Promise<{ body: ArrayBuffer; contentType: string }> {
  const existing = _inFlight.get(url)
  if (existing) return existing

  const promise = (async () => {
    await acquireSlot()
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`origin responded ${res.status}`)
      const body = await res.arrayBuffer()
      const contentType = res.headers.get('content-type') ?? 'audio/mpeg'
      return { body, contentType }
    } finally {
      releaseSlot()
    }
  })()

  _inFlight.set(url, promise)
  try {
    return await promise
  } finally {
    _inFlight.delete(url)
  }
}

export async function GET(req: NextRequest) {
  const target = new URL(req.url).searchParams.get('url')
  if (!target) {
    return new Response('missing url', { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return new Response('invalid url', { status: 400 })
  }

  if (!isAllowed(parsed)) {
    return new Response('host not allowed', { status: 400 })
  }

  try {
    const { body, contentType } = await fetchOrigin(parsed.toString())
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': CACHE_CONTROL,
        // Served full-body (Range ignored) so the <audio> preview's load and
        // the later Web Audio fetch() share one browser cache entry.
        'Accept-Ranges': 'none',
        'Access-Control-Allow-Origin': '*',
        Vary: 'Origin',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'proxy fetch failed'
    // 502: upstream (Freesound) problem, not a client error.
    return new Response(message, { status: 502 })
  }
}
