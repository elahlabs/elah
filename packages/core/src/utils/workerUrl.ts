/**
 * Cross-origin module workers (CONV-5).
 *
 * A browser refuses `new Worker(url)` when `url` is on another origin, which is
 * exactly the case when a page imports this package from a CDN (jsDelivr,
 * unpkg) instead of bundling it. The fix is a same-origin `blob:` module worker
 * whose only line is `import "<cdn worker url>";`: module workers may import
 * cross-origin scripts (CORS permitting), they just cannot BE one.
 *
 * This module never builds the same-origin worker. Each spawning site keeps
 * the literal `new Worker(new URL('./X.ts', import.meta.url), { type: 'module' })`
 * because Vite, webpack 5 and Turbopack only find and bundle a worker from that
 * exact call shape; moving it into a helper would silently drop the worker
 * chunk from every bundled host. The sites call `isCrossOriginModule` first and
 * only take the blob branch here when the module itself was loaded from
 * another origin.
 *
 * The check reads the SPAWNING module's own `import.meta.url`, not a
 * `new URL('./X.ts', import.meta.url)` built for the purpose: a second literal
 * of that shape outside `new Worker(...)` is treated by webpack and Turbopack as
 * an asset reference and would emit the raw `.ts` file. The worker sits next to
 * its spawning module, so both share an origin.
 *
 * Bundled hosts never reach the blob branch: webpack and Turbopack replace
 * `import.meta.url` with a `file://` URL (not http(s), so not cross-origin),
 * and a same-origin chunk URL is not cross-origin either.
 */

/** The page's origin, or undefined where there is no `location` (Node, a test). */
function currentOrigin(): string | undefined {
  try {
    const loc = (globalThis as { location?: { origin?: string } }).location
    return typeof loc?.origin === 'string' ? loc.origin : undefined
  } catch {
    return undefined
  }
}

/**
 * True when `moduleUrl` is an http(s) URL on another origin than the page, so a
 * worker file next to it cannot be started directly. False when there is no
 * `location` (Node, a test), for non-http(s) URLs (`file:` from a bundler,
 * `blob:`, `data:`) and for anything that does not parse.
 *
 * `pageOrigin` is a test seam; it defaults to `location.origin`.
 */
export function isCrossOriginModule(moduleUrl: string | URL, pageOrigin: string | undefined = currentOrigin()): boolean {
  if (!pageOrigin) return false
  let url: URL
  try {
    url = new URL(String(moduleUrl))
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return url.origin !== pageOrigin
}

/**
 * The URL of worker `name` sitting next to `moduleUrl`: `./<name>.js` (or
 * `.ts` when the module itself is a `.ts` source file).
 *
 * On jsDelivr (`cdn.jsdelivr.net/npm/...`) the result is the worker's `/+esm`
 * build: the raw file keeps bare imports (`mediabunny`) and a module worker has
 * no import map to resolve them, while `/+esm` rewrites them to CDN URLs. A
 * `/+esm` suffix on `moduleUrl` itself is ignored when resolving the sibling.
 */
export function siblingWorkerUrl(moduleUrl: string | URL, name: string): string {
  const base = new URL(String(moduleUrl))
  base.pathname = base.pathname.replace(/\/\+esm$/, '')
  const ext = base.pathname.endsWith('.ts') ? '.ts' : '.js'
  const url = new URL(`./${name}${ext}`, base)
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/')) {
    url.pathname = `${url.pathname}/+esm`
  }
  return url.href
}

/** A `blob:` URL for a one-line module that imports `url`. The caller revokes it. */
export function blobModuleUrl(url: string | URL): string {
  const source = `import ${JSON.stringify(String(url))};\n`
  return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
}

/**
 * Start a module worker for the cross-origin script `scriptUrl` through a
 * `blob:` wrapper (see the file comment). The blob URL is revoked once the
 * worker posts its first message or errors; by then the wrapper has been read.
 * Throws whatever `new Worker` throws (the blob URL is revoked first).
 */
export function startCrossOriginModuleWorker(scriptUrl: string | URL): Worker {
  const blobUrl = blobModuleUrl(scriptUrl)
  let worker: Worker
  try {
    worker = new Worker(blobUrl, { type: 'module' })
  } catch (err) {
    URL.revokeObjectURL(blobUrl)
    throw err
  }
  let revoked = false
  const revoke = () => {
    if (revoked) return
    revoked = true
    worker.removeEventListener('message', revoke)
    worker.removeEventListener('error', revoke)
    URL.revokeObjectURL(blobUrl)
  }
  worker.addEventListener('message', revoke)
  worker.addEventListener('error', revoke)
  return worker
}
