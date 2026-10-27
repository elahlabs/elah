import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { HARNESS_HTML, harnessJs } from './harness'
import { CliError } from './errors'

export interface ProgressPayload {
  frame: number
  totalFrames: number
}

export interface AudioMixMeta {
  sampleRate: number
  channels: number
  /** Frames per channel. */
  length: number
}

/**
 * Where an ffmpeg-encoded render sends its output. Present only when the page
 * runs with `encoder: 'ffmpeg'`; the /audio, /frame and /finish routes 404
 * without it.
 */
export interface EncodeSink {
  /** The audio mix: planar Float32 channels, concatenated. Arrives before any frame. */
  audio(meta: AudioMixMeta, planarPcm: Buffer): Promise<void>
  /** One PNG frame, in order. The page is answered only once this resolves. */
  frame(png: Buffer): Promise<void>
  /** Every frame is written: finish the encode and return the file's bytes. */
  finish(): Promise<Buffer>
}

export interface HarnessServerArgs {
  /** Per-run random secret protecting the callback and media routes. */
  token: string
  /** Route path (e.g. '/media/<token>/0') → absolute file path or http(s) URL to proxy. */
  media: Map<string, string>
  onProgress?: (p: ProgressPayload) => void
  onAudioIssue?: (message: string, src?: string) => void
  /** Set for ffmpeg-encoded renders; see EncodeSink. */
  encodeSink?: EncodeSink
  log?: (line: string) => void
}

export interface HarnessServer {
  origin: string
  /** Resolves with the exported MP4 bytes; rejects when the page reports an error. */
  result: Promise<Buffer>
  /** Reject the result from the outside (tab crash, browser disconnect). */
  fail(err: Error): void
  close(): Promise<void>
}

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.html': 'text/html',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

/**
 * Rewrites the bare specifiers that appear in @elah/core's dist when served to
 * the browser. `mediabunny` is the only one on the export graph today; immer
 * and zustand are mapped defensively in case future core changes pull them in.
 */
const VENDOR_PACKAGES = ['mediabunny', 'immer', 'zustand'] as const

interface VendorEntry {
  root: string
  /** Path of the package's browser entry, relative to root (posix). */
  entry: string
  /**
   * Package-relative paths the package.json `browser` field maps to `false`
   * (Node-only modules). Bundlers replace these with empty modules; serving
   * raw files over HTTP must do the same or the browser hits `node:` imports.
   */
  browserFalse: Set<string>
}

/**
 * Resolve a bare specifier to its entry file. Uses import.meta.resolve when
 * available (bundled Node runtime); falls back to createRequire under tooling
 * that doesn't expose it (vitest's SSR transform).
 */
export function resolveModuleFile(spec: string): string {
  const meta = import.meta as ImportMeta & { resolve?: (s: string) => string }
  if (typeof meta.resolve === 'function') return fileURLToPath(meta.resolve(spec))
  return createRequire(import.meta.url).resolve(spec)
}

/** Walk up from a resolved module file to the directory holding package.json. */
function packageRootFromEntry(entryFile: string): string {
  let dir = dirname(entryFile)
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir)
    if (parent === dir) throw new CliError(`Could not locate package root for ${entryFile}`)
    dir = parent
  }
  return dir
}

/**
 * Pick the browser-appropriate entry from a package's export map. Node's own
 * resolution (import.meta.resolve) applies the `node` condition, which is
 * wrong for code we serve to Chrome — so the '.' export is re-resolved here
 * preferring `browser` → `import` → `default`.
 */
function browserEntry(root: string): Omit<VendorEntry, 'root'> {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>
  const resolved = resolveExportValue((pkg.exports as Record<string, unknown> | undefined)?.['.'])
  const entry = resolved ?? (pkg.module as string) ?? (pkg.main as string)
  if (!entry) throw new CliError(`Package at ${root} has no resolvable browser entry`)

  const browserFalse = new Set<string>()
  if (typeof pkg.browser === 'object' && pkg.browser !== null) {
    for (const [key, value] of Object.entries(pkg.browser as Record<string, unknown>)) {
      if (value === false) browserFalse.add(key.replace(/^\.\//, ''))
    }
  }
  return { entry: entry.replace(/^\.\//, ''), browserFalse }
}

function resolveExportValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return undefined
  const map = value as Record<string, unknown>
  for (const condition of ['browser', 'import', 'default']) {
    const picked = resolveExportValue(map[condition])
    if (picked) return picked
  }
  return undefined
}

function resolveVendors(): Map<string, VendorEntry> {
  const vendors = new Map<string, VendorEntry>()
  for (const name of VENDOR_PACKAGES) {
    try {
      const entryFile = resolveModuleFile(name)
      const root = packageRootFromEntry(entryFile)
      vendors.set(name, { root, ...browserEntry(root) })
    } catch {
      // Leave unresolvable packages unmapped; the browser will surface a
      // clear import failure if core's graph ever actually needs them.
    }
  }
  return vendors
}

/** Replace bare vendor specifiers in served core modules with /vendor/ URLs. */
export function rewriteSpecifiers(source: string, vendors: Map<string, VendorEntry>): string {
  let out = source
  for (const [name, vendor] of vendors) {
    const url = `/vendor/${name}/${vendor.entry}`
    out = out
      .replace(new RegExp(`(from\\s*)(['"])${name}\\2`, 'g'), `$1$2${url}$2`)
      .replace(new RegExp(`(\\bimport\\s*\\(\\s*)(['"])${name}\\2`, 'g'), `$1$2${url}$2`)
      .replace(new RegExp(`(^|[;\\n])(import\\s*)(['"])${name}\\3`, 'g'), `$1$2$3${url}$3`)
  }
  return out
}

/**
 * Inline `process.env.NODE_ENV` as `"production"`, as a bundler's `define`
 * does. Served raw to the browser, a module that reads it (immer's ESM build,
 * which the converged core's export graph imports) throws "process is not
 * defined" before the export starts.
 */
export function defineNodeEnv(source: string): string {
  return source.replace(/\bprocess\.env\.NODE_ENV\b/g, '"production"')
}

/** Served modules (as opposed to media or other assets). */
function isScriptFile(file: string): boolean {
  const ext = extname(file).toLowerCase()
  return ext === '.js' || ext === '.mjs'
}

/**
 * Resolve a /core/* request against core's dist, tolerating the module-URL
 * quirks of tsc's bundler-resolution output: extensionless relative imports
 * and the literal `./ExportWorker.ts` worker URL that ships in dist.
 */
export function resolveDistFile(distRoot: string, urlPath: string): string | undefined {
  const requested = normalize(join(distRoot, urlPath))
  const rel = relative(distRoot, requested)
  if (rel.startsWith('..') || rel.split(sep).includes('..')) return undefined

  const candidates = [requested]
  if (!extname(requested)) {
    candidates.push(`${requested}.js`, join(requested, 'index.js'))
  } else if (requested.endsWith('.ts')) {
    candidates.push(requested.replace(/\.ts$/, '.js'))
  } else if (!requested.endsWith('.js')) {
    // A dotted module name compiled to `<name>.js` (`./shaders/quad.frag`).
    candidates.push(`${requested}.js`)
  }
  return candidates.find((c) => existsSync(c) && statSync(c).isFile())
}

/**
 * True when `resolveDistFile` answered `urlPath` with a directory's
 * `index.js`. The browser must then be redirected to that file's own URL:
 * a module's relative imports resolve against its response URL, so serving
 * `effects/index.js` at `/core/x/effects` would send `./blur` to `/core/x/blur`.
 */
export function isDirectoryIndex(distRoot: string, urlPath: string, file: string): boolean {
  return file === join(normalize(join(distRoot, urlPath)), 'index.js')
}

/** The URL of a directory request's `index.js`, keeping the query string. */
function indexUrl(path: string, search: string): string {
  return `${path.replace(/\/+$/, '')}/index.js${search}`
}

export async function startHarnessServer(args: HarnessServerArgs): Promise<HarnessServer> {
  const coreDist = dirname(resolveModuleFile('@elah/core'))
  const vendors = resolveVendors()
  const log = args.log ?? (() => {})

  let resolveResult: (b: Buffer) => void
  let rejectResult: (e: Error) => void
  const result = new Promise<Buffer>((res, rej) => {
    resolveResult = res
    rejectResult = rej
  })

  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      log(`harness server error on ${req.url}: ${(err as Error).message}`)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = decodeURIComponent(url.pathname)

    if (req.method === 'POST') {
      const body = await readBody(req)
      if (args.encodeSink && path.startsWith(`/cb/${args.token}/`)) {
        const handled = await handleEncodeRoute(args.encodeSink, path.slice(`/cb/${args.token}`.length), url, body)
        if (handled !== undefined) {
          res.writeHead(handled ? 204 : 500)
          res.end()
          return
        }
      }
      switch (path) {
        case `/cb/${args.token}/progress`:
          args.onProgress?.(JSON.parse(body.toString('utf8')) as ProgressPayload)
          break
        case `/cb/${args.token}/audio-issue`: {
          const { message, src } = JSON.parse(body.toString('utf8')) as { message: string; src?: string }
          args.onAudioIssue?.(message, src)
          break
        }
        case `/cb/${args.token}/result`:
          resolveResult(body)
          break
        case `/cb/${args.token}/error`: {
          const { message, stack } = JSON.parse(body.toString('utf8')) as { message: string; stack?: string }
          rejectResult(new CliError(`Export failed in the browser: ${message}${stack ? `\n${stack}` : ''}`))
          break
        }
        default:
          res.writeHead(404)
          res.end()
          return
      }
      res.writeHead(204)
      res.end()
      return
    }

    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(HARNESS_HTML)
      return
    }
    if (path === '/blank') {
      // An empty page on this origin, for the decode checks that run before
      // the harness loads (WebCodecs needs a secure context; 127.0.0.1 is one).
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><meta charset="utf-8"><title>elah</title>')
      return
    }
    if (path === '/harness.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end(harnessJs(args.token))
      return
    }

    if (path.startsWith('/core/')) {
      const sub = path.slice('/core/'.length)
      const file = resolveDistFile(coreDist, sub)
      if (!file) {
        log(`404 (core dist miss): ${path}`)
        res.writeHead(404)
        res.end()
        return
      }
      if (isDirectoryIndex(coreDist, sub, file)) {
        res.writeHead(302, { location: indexUrl(path, url.search) })
        res.end()
        return
      }
      const source = readFileSync(file, 'utf8')
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end(defineNodeEnv(rewriteSpecifiers(source, vendors)))
      return
    }

    if (path.startsWith('/vendor/')) {
      const [, , name, ...restParts] = path.split('/')
      const vendor = vendors.get(name)
      const rel = restParts.join('/')
      if (vendor?.browserFalse.has(rel)) {
        // Node-only module per the package's browser field — bundlers swap in
        // an empty module; do the same. Safe for namespace imports.
        res.writeHead(200, { 'content-type': 'text/javascript' })
        res.end('export {}\n')
        return
      }
      const file = vendor && resolveDistFile(vendor.root, rel)
      if (!file) {
        log(`404 (vendor miss): ${path}`)
        res.writeHead(404)
        res.end()
        return
      }
      if (isDirectoryIndex(vendor.root, rel, file)) {
        res.writeHead(302, { location: indexUrl(path, url.search) })
        res.end()
        return
      }
      if (isScriptFile(file)) {
        res.writeHead(200, { 'content-type': 'text/javascript' })
        res.end(defineNodeEnv(readFileSync(file, 'utf8')))
        return
      }
      serveLocalFile(req, res, file)
      return
    }

    if (args.media.has(path)) {
      const target = args.media.get(path)!
      if (/^https?:\/\//.test(target)) {
        await proxyRemote(req, res, target)
      } else {
        serveLocalFile(req, res, target)
      }
      return
    }

    log(`404 (unknown route): ${path}`)
    res.writeHead(404)
    res.end()
  }

  /**
   * The ffmpeg-encode routes. Returns undefined for any other route, true on
   * success, false when the sink failed — that failure also rejects `result`,
   * so the export reports ffmpeg's own error rather than the page's 500.
   */
  async function handleEncodeRoute(
    sink: EncodeSink,
    route: string,
    url: URL,
    body: Buffer
  ): Promise<boolean | undefined> {
    try {
      switch (route) {
        case '/audio':
          await sink.audio(parseAudioMeta(url.searchParams, body.length), body)
          return true
        case '/frame':
          await sink.frame(body)
          return true
        case '/finish':
          resolveResult(await sink.finish())
          return true
        default:
          return undefined
      }
    } catch (err) {
      rejectResult(err instanceof Error ? err : new CliError(String(err)))
      return false
    }
  }

  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new CliError('Harness server failed to bind a port')
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    result,
    fail: (err) => rejectResult(err),
    close: () =>
      new Promise<void>((res) => {
        server.closeAllConnections()
        server.close(() => res())
      }),
  }
}

/** Validate the /audio query against the body it describes (4 bytes per sample). */
export function parseAudioMeta(params: URLSearchParams, bodyBytes: number): AudioMixMeta {
  const read = (name: string): number => {
    const value = Number(params.get(name))
    if (!Number.isInteger(value) || value <= 0) {
      throw new CliError(`Audio mix from the browser has an invalid ${name}: ${params.get(name)}`)
    }
    return value
  }
  const meta = { sampleRate: read('sampleRate'), channels: read('channels'), length: read('length') }
  if (bodyBytes !== meta.channels * meta.length * 4) {
    throw new CliError(
      `Audio mix from the browser is ${bodyBytes} bytes; expected ${meta.channels * meta.length * 4} ` +
        `(${meta.channels} channels x ${meta.length} Float32 samples)`
    )
  }
  return meta
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => res(Buffer.concat(chunks)))
    req.on('error', rej)
  })
}

/** Stream a local file with Range support (mediabunny probes via range reads). */
function serveLocalFile(req: IncomingMessage, res: ServerResponse, absPath: string): void {
  const size = statSync(absPath).size
  const type = MIME[extname(absPath).toLowerCase()] ?? 'application/octet-stream'
  const range = req.headers.range

  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null
  if (match && (match[1] !== '' || match[2] !== '')) {
    const start = match[1] === '' ? Math.max(0, size - Number(match[2])) : Number(match[1])
    const end = match[1] !== '' && match[2] !== '' ? Math.min(Number(match[2]), size - 1) : size - 1
    if (start > end || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` })
      res.end()
      return
    }
    res.writeHead(206, {
      'content-type': type,
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-length': end - start + 1,
      'accept-ranges': 'bytes',
    })
    createReadStream(absPath, { start, end }).pipe(res)
    return
  }

  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' })
  createReadStream(absPath).pipe(res)
}

/** Proxy a remote media URL through the local origin (avoids CORS in the page). */
async function proxyRemote(req: IncomingMessage, res: ServerResponse, target: string): Promise<void> {
  const headers: Record<string, string> = {}
  if (req.headers.range) headers.range = req.headers.range
  const upstream = await fetch(target, { headers })

  const passthrough: Record<string, string> = {}
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h)
    if (v) passthrough[h] = v
  }
  res.writeHead(upstream.status, passthrough)
  if (upstream.body) {
    Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(res)
  } else {
    res.end()
  }
}
