import { type NextRequest } from 'next/server'

/**
 * Image proxy for Pexels CDN assets — mirrors `/api/pixabay/image` (see that
 * route for the full rationale): caches responses so thumbnail-grid bursts
 * don't repeatedly hit Pexels' CDN, dedupes in-flight requests for the same
 * URL, caps concurrent origin fetches, and retries 429/5xx with backoff.
 *
 * SSRF guard: only Pexels' image CDN host may be proxied.
 */

const ALLOWED_HOSTS = new Set(['images.pexels.com'])

// Pexels asset URLs are content-addressed → safe to cache for a long time.
const CACHE_CONTROL = 'public, max-age=604800, s-maxage=604800, immutable'

const MAX_CONCURRENT_ORIGIN_FETCHES = 6

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
      await acquireSlot()
      let retryAfter: string | null = null
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'elah-editor/1.0 (+https://pexels.com)',
            Referer: 'https://www.pexels.com/',
          },
        })
        if (res.ok) {
          const body = await res.arrayBuffer()
          const contentType = res.headers.get('content-type') ?? 'image/jpeg'
          return { body, contentType }
        }
        lastStatus = res.status
        retryAfter = res.headers.get('retry-after')
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
        'Access-Control-Allow-Origin': '*',
        Vary: 'Origin',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'proxy fetch failed'
    return new Response(message, { status: 502 })
  }
}
