// minimal shell worker. its real job is to exist with a fetch handler so
// chromium treats the site as installable; offline navigation fallback is the
// only behaviour we actually want. it must never touch app data, RSC payloads
// or hashed build output — this is a WebCodecs video editor and a stale
// worker serving deleted chunks is far worse than no worker at all.
const CACHE = 'elah-shell-v1'
const PRECACHE = ['/offline', '/elah-mark.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // hard bail-outs: anything not a same-origin GET page navigation is handed
  // straight back to the browser (no respondWith at all).
  if (request.method !== 'GET') return
  if (url.origin !== self.location.origin) return
  if (request.mode !== 'navigate') return
  // app router flight requests are navigations in disguise; caching or
  // rewriting them produces version-skew crashes on deploy.
  if (url.searchParams.has('_rsc') || request.headers.get('RSC')) return
  // never shadow the posthog reverse proxy or our own api routes.
  if (url.pathname.startsWith('/ingest') || url.pathname.startsWith('/api')) return

  // network-first, offline-page fallback. html is never written to the cache,
  // so a deploy can't leave a document pointing at deleted _next chunks.
  event.respondWith(fetch(request).catch(() => caches.match('/offline')))
})
