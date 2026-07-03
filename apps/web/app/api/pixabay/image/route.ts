import { type NextRequest } from 'next/server'

/**
 * Image proxy for Pixabay CDN assets.
 *
 * Why this exists: the agentic AI flow fires many Pixabay searches in quick
 * succession, and each result set renders a grid of thumbnails that the browser
 * loads directly from `pixabay.com/get/...`. Under that burst Pixabay's CDN
 * returns HTTP 429 (Too Many Requests) and the images silently fail to render.
 *
 * Routing image loads through this proxy fixes it two ways:
 *  1. Long-lived caching — we set `Cache-Control: public, max-age=…, immutable`,
 *     so the browser (and any CDN in front of this app) serves repeat loads of
 *     the same asset from cache and never re-hits Pixabay. Pixabay asset URLs
 *     are content-addressed (they embed a hash), so treating them as immutable
 *     is safe.
 *  2. Origin protection — in-flight requests for the same URL are deduped and
 *     total concurrency toward Pixabay is capped, so a burst of identical or
 *     simultaneous loads collapses into far fewer origin fetches.
 *
 * SSRF guard: only hostnames on the Pixabay allow-list may be proxied. Any
 * other host is rejected with 400 so this route can never be used as an open
 * proxy.
 */

// Pixabay serves media from these hosts. Keep the list tight — this is the
// SSRF boundary.
const ALLOWED_HOSTS = new Set([
  'pixabay.com',
  'cdn.pixabay.com',
  'i.vimeocdn.com', // Pixabay video thumbnails are occasionally served here.
])

// Pixabay asset URLs are content-addressed (embed a hash) → safe to cache for a
// long time. 7 days on the browser, and let a shared cache hold it as well.
const CACHE_CONTROL = 'public, max-age=604800, s-maxage=604800, immutable'

// Cap simultaneous origin fetches so a thumbnail-grid burst can't itself 429
// Pixabay. Excess requests wait for a slot. Kept small on purpose.
const MAX_CONCURRENT_ORIGIN_FETCHES = 6

// Pixabay's CDN rate-limits bursts with HTTP 429. Concurrency capping reduces
// but doesn't eliminate this — a 429 still leaks through under load and, without
// a retry, the image fails hard. Retry a few times with capped exponential
// backoff (honoring Retry-After when present) so transient throttling recovers
// instead of surfacing as a broken image.
const MAX_ORIGIN_RETRIES = 3
const BASE_BACKOFF_MS = 400
const MAX_BACKOFF_MS = 3000

function backoffDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN
  if (Number.isFinite(retryAfterSec) && retryAfterSec >= 0) {
    return Math.min(retryAfterSec * 1000, MAX_BACKOFF_MS)
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let _activeFetches = 0
const _waiters: Array<() => void> = []
// Dedupe concurrent requests for the same URL into a single origin fetch.
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
    let lastStatus = 0
    for (let attempt = 0; attempt <= MAX_ORIGIN_RETRIES; attempt++) {
      // Re-acquire a slot per attempt and release it before sleeping, so a
      // request backing off from a 429 never occupies a concurrency slot while
      // it waits (which would starve requests that could actually succeed).
      await acquireSlot()
      let retryAfter: string | null = null
      try {
        const res = await fetch(url, {
          // A UA + referer keeps Pixabay from treating the proxied request as a
          // bare hotlink; harmless if ignored.
          headers: {
            'User-Agent': 'elah-editor/1.0 (+https://pixabay.com)',
            Referer: 'https://pixabay.com/',
          },
        })
        if (res.ok) {
          const body = await res.arrayBuffer()
          const contentType = res.headers.get('content-type') ?? 'image/jpeg'
          return { body, contentType }
        }
        lastStatus = res.status
        retryAfter = res.headers.get('retry-after')
        // Only retry throttling (429) and transient upstream errors (5xx);
        // a 4xx like 404 won't fix itself, so fail fast.
        if (res.status !== 429 && res.status < 500) {
          throw new Error(`origin responded ${res.status}`)
        }
      } finally {
        releaseSlot()
      }
      if (attempt < MAX_ORIGIN_RETRIES) {
        await sleep(backoffDelayMs(attempt, retryAfter))
      }
    }
    throw new Error(`origin responded ${lastStatus} after ${MAX_ORIGIN_RETRIES + 1} attempts`)
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
        // The timeline renderer loads these images with `crossOrigin="anonymous"`
        // so it can read pixels into a WebGL texture (see imageCache's
        // defaultImageLoader). A crossOrigin <img> is held to the CORS protocol
        // even same-origin, so the response must carry ACAO or the load errors.
        // `Vary: Origin` keeps the browser's CORS and non-CORS (plain grid <img>)
        // cache entries separate — without it the immutable non-CORS response
        // gets reused for the crossOrigin request and fails the CORS check.
        'Access-Control-Allow-Origin': '*',
        Vary: 'Origin',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'proxy fetch failed'
    // 502: upstream (Pixabay) problem, not a client error.
    return new Response(message, { status: 502 })
  }
}
