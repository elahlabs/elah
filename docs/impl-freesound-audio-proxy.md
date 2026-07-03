# Fix: click-inserted audio is silent for 10–20s (Freesound cold fetch+decode)

Implementation spec — self-contained. Everything needed to complete the task is
in this document: root cause, exact file changes (full code), and a
verification checklist. All changes are in `apps/web` only; **no `@elah/*`
package rebuild is required**.

---

## 1. Symptom (as reported)

- Insert an audio chunk on the timeline **by clicking** → playback is broken:
  no sound at first; after interacting with the timeline 10–20s later the
  audio *sometimes* starts playing.
- Insert the same audio **by drag-and-drop** → works fine.
- User frames it as "the audio pipeline is not at the quality of the video
  pipeline."

## 2. Root cause (already diagnosed — do not re-investigate)

Both insertion paths run **identical code** — click activation
([packages/timeline/src/insertAsset.ts](../packages/timeline/src/insertAsset.ts) `insertMediaAsset`,
called from `packages/editor/src/editor/activation.ts` and
`apps/web/components/playground/production/MediaPanel.tsx:346`) and the drop
handler ([packages/timeline/src/useTimelineDrop.ts:149](../packages/timeline/src/useTimelineDrop.ts)).
The difference is **timing**, not code path:

1. The audio engine
   ([packages/core/src/media/audio/AudioPlaybackController.ts](../packages/core/src/media/audio/AudioPlaybackController.ts))
   must `fetch()` + `decodeAudioData()` the **entire file** before a clip can
   make any sound. Until the buffer resolves, the clip is silent; when it
   resolves the audio snaps in at the live playhead position.
2. Freesound preview MP3s are fetched directly from `cdn.freesound.org`,
   which sends **no `Cache-Control` header**, and the network route to that
   CDN is slow (a 300 KB preview took >15s in testing — matching the user's
   10–20s dead window).
3. The decode cache (`AudioPlaybackController._buffers`) is keyed by `src` and
   never evicted on success. So after the first (broken-feeling) click-insert
   finishes decoding, any later re-insert of the same sound — e.g. by drag —
   plays instantly. **That's why drag-drop appears to "work" and click
   appears broken**: the drag test always happens after the cache is warm.

Ruled out (verified, don't redo): CORS (`cdn.freesound.org` sends
`Access-Control-Allow-Origin: *`), stale package dist (dist is newer than the
last commit and contains the warm-up logic), and the insert helpers
themselves.

Also found: clicking a card in the **Freesound stock results**
(`FreesoundResults.tsx` `SoundCard`, `onClick={() => importFreesoundSound(sound)}`)
only registers the asset in the media library and never inserts it on the
timeline — inconsistent with the uploads grid in `MediaPanel.tsx`, where
clicking an asset inserts it at the playhead.

## 3. Fix strategy

Mirror what the repo already did for Pixabay images (see
`apps/web/app/api/pixabay/image/route.ts` and
`apps/web/lib/pixabay/proxyImage.ts` — read both before starting; the new
code deliberately follows their structure):

1. **New caching audio proxy** `/api/freesound/preview` — same-origin,
   long-lived immutable cache, in-flight dedupe, concurrency cap, SSRF
   allow-list.
2. **Route Freesound audio through the proxy** in `importFreesoundSound` (the
   asset `src` the timeline decodes) **and** in the panel's `<audio>` preview
   — one URL for both means previewing a sound warms the exact bytes the
   timeline will fetch+decode.
3. **Make clicking a Freesound card insert onto the timeline**, matching the
   uploads grid behavior.

The existing warm-up plumbing then does the rest: `Preview.tsx` already calls
`warmAudioSrc()` the moment an audio asset is registered in the media library
and `preloadProjectAudio()` on every engine change, so once the proxy makes
repeat loads cache-hits, the silent window collapses.

---

## 4. Changes

### 4.1 New file: `apps/web/app/api/freesound/preview/route.ts`

Create with exactly this content:

```ts
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
```

### 4.2 New file: `apps/web/lib/freesound/proxyPreview.ts`

Client helper mirroring `apps/web/lib/pixabay/proxyImage.ts`:

```ts
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
```

### 4.3 Edit: `apps/web/lib/freesound/importFreesoundAsset.ts`

Route the asset `src` through the proxy. In `importFreesoundSound`, change:

```ts
const src = sound.previews['preview-hq-mp3'] || sound.previews['preview-lq-mp3']
```

to:

```ts
// Proxied so the timeline's whole-file fetch+decode hits the browser cache
// (warmed by the card's <audio> preview) instead of a cold, slow CDN fetch —
// a cold fetch leaves a freshly inserted clip silent until it resolves.
const src = proxyFreesoundPreview(
  sound.previews['preview-hq-mp3'] || sound.previews['preview-lq-mp3'],
)
```

and add the import at the top:

```ts
import { proxyFreesoundPreview } from './proxyPreview'
```

Note: `findExisting(src)` dedupe now runs against the proxied src — that is
correct and mirrors `importPixabayPhoto`.

### 4.4 Edit: `apps/web/components/playground/production/FreesoundResults.tsx`

Three changes:

**(a) Preview `<audio>` uses the proxied URL** — in `SoundCard`'s
`togglePreview`, change:

```ts
const src = sound.previews['preview-hq-mp3'] || sound.previews['preview-lq-mp3']
```

to:

```ts
// Same proxied URL the timeline will decode — previewing warms its cache.
const src = proxyFreesoundPreview(
  sound.previews['preview-hq-mp3'] || sound.previews['preview-lq-mp3'],
)
```

Add the import:

```ts
import { proxyFreesoundPreview } from '@/lib/freesound/proxyPreview'
```

**(b) Click inserts onto the timeline.** Today the card's `onClick` only
registers the asset in the library. Thread an `onActivate` callback through:

- Add to `SoundCard`'s props: `onActivate: (asset: MediaAsset) => void`
  (import `type MediaAsset` from `@elah/editor`).
- Change the card's `onClick={() => importFreesoundSound(sound)}` to
  `onClick={() => onActivate(importFreesoundSound(sound))}`.
- `SoundCard` is wrapped in `memo` — keep the callback identity stable in the
  parent (see (c)).

**(c) `FreesoundResults` accepts and forwards the callback.** Change the
signature to:

```ts
export function FreesoundResults({
  query,
  onActivate,
}: {
  query: string
  onActivate: (asset: MediaAsset) => void
}) {
```

and pass it down: `<SoundCard key={s.id} sound={s} onActivate={onActivate} />`.

**(d) Dedupe the preview element across the src change.** `SoundCard` caches
its `HTMLAudioElement` in a ref keyed by nothing — since the src is computed
inside `togglePreview` on first use, no further change is needed there.

### 4.5 Edit: `apps/web/components/playground/production/MediaPanel.tsx`

Wire the existing insert handler into the Freesound results. Change:

```tsx
<FreesoundResults query={search} />
```

to:

```tsx
<FreesoundResults query={search} onActivate={(asset) => void onActivateAsset(asset)} />
```

`onActivateAsset` (already defined at line ~344) calls
`insertMediaAsset(engine, asset.id)` and shows the "Added …" notice, so
click-insert from stock results now behaves exactly like the uploads grid.
If the linter complains about the inline arrow, wrap it in `useCallback`
with `[onActivateAsset]`.

---

## 5. What NOT to change

- **No `@elah/core` / `@elah/timeline` / `@elah/editor` changes.** The
  controller's snap-in-when-decoded behavior is correct; the fix is making
  the decode warm/fast, which is app-side. (Also: apps consume the built
  `dist` of those packages — changing their `src` would require a rebuild.)
- Do not proxy Pixabay **video** files (existing comment in
  `importPixabayAsset.ts` explains why); this task only adds an **audio**
  proxy for small (~300 KB) Freesound previews.
- Do not add retry/backoff ladders to the new route — Freesound's failure
  mode is slowness, not 429 bursts like Pixabay.

## 6. Verification checklist

1. `cd apps/web && npx tsc --noEmit` (or the repo's lint/typecheck script)
   passes.
2. Run the web app (`npm run dev` from `apps/web` or the root dev script).
   Open the production playground editor.
3. Proxy works: open
   `http://localhost:3000/api/freesound/preview?url=https%3A%2F%2Fcdn.freesound.org%2Fpreviews%2F612%2F612095_5674468-hq.mp3`
   directly — expect an MP3 response with `Cache-Control: … immutable`.
   A non-Freesound `url` (e.g. `https://example.com/a.mp3`) must return 400.
4. In the Audio panel (Freesound source): hover a sound card, click its play
   button — preview streams via `/api/freesound/preview` (check the Network
   tab).
5. **Click** a sound card: a clip appears on the audio track at the playhead
   and the "Added …" notice shows. Press play — audio should start with at
   most a brief delay on the very first cold load, and instantly if the sound
   was previewed first or inserted before (browser cache / decode cache).
6. Drag-and-drop a card onto the timeline still works and plays.
7. Regression: uploads-grid click insert, Pixabay photos/videos, and the
   Agentic AI compose flow still work.

## 7. Known residual limitation (document, don't fix here)

The *very first* touch of a sound that was never previewed still pays one
real network fetch of the whole MP3 before it can be heard — that latency is
physics, not a bug. The proxy + shared cache make every subsequent load
instant, and previewing (the normal flow before adding music) pre-warms it.
If further parity with the video pipeline is wanted later, the candidates are
in `AudioPlaybackController`: look-ahead scheduling of upcoming clips
(Web Audio `node.start(when)`), and re-scheduling active nodes on project
edits (move/trim during playback keeps a stale offset until the next
transport event).
