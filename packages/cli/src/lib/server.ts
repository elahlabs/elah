import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { HARNESS_HTML, HARNESS_JS } from './harness'
import { CliError } from './errors'

export interface ProgressPayload {
  frame: number
  totalFrames: number
}

export interface HarnessServerArgs {
  /** Route path (e.g. '/media/0') → absolute file path or http(s) URL to proxy. */
  media: Map<string, string>
  onProgress?: (p: ProgressPayload) => void
  onAudioIssue?: (message: string, src?: string) => void
  log?: (line: string) => void
}

export interface HarnessServer {
  origin: string
  /** Resolves with the exported MP4 bytes; rejects when the page reports an error. */
  result: Promise<Buffer>
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
      .replace(new RegExp(`(import\\s*\\(\\s*)(['"])${name}\\2`, 'g'), `$1$2${url}$2`)
      .replace(new RegExp(`(^|[;\\n])(import\\s*)(['"])${name}\\3`, 'g'), `$1$2$3${url}$3`)
  }
  return out
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
  }
  return candidates.find((c) => existsSync(c) && statSync(c).isFile())
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
      switch (path) {
        case '/progress':
          args.onProgress?.(JSON.parse(body.toString('utf8')) as ProgressPayload)
          break
        case '/audio-issue': {
          const { message, src } = JSON.parse(body.toString('utf8')) as { message: string; src?: string }
          args.onAudioIssue?.(message, src)
          break
        }
        case '/result':
          resolveResult(body)
          break
        case '/error': {
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
    if (path === '/harness.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end(HARNESS_JS)
      return
    }

    if (path.startsWith('/core/')) {
      const file = resolveDistFile(coreDist, path.slice('/core/'.length))
      if (!file) {
        log(`404 (core dist miss): ${path}`)
        res.writeHead(404)
        res.end()
        return
      }
      const source = readFileSync(file, 'utf8')
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end(rewriteSpecifiers(source, vendors))
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

  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new CliError('Harness server failed to bind a port')
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    result,
    close: () =>
      new Promise<void>((res) => {
        server.closeAllConnections()
        server.close(() => res())
      }),
  }
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
