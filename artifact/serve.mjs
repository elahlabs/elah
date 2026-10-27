/**
 * Tiny static server for testing the artifact locally (Node built-ins only).
 *
 *   node artifact/serve.mjs [port]            default port 4400
 *
 *   http://localhost:4400/               dist/ with samples/promo/elah-input.json
 *   http://localhost:4400/<sample>/      dist/ with samples/<sample>/elah-input.json
 *
 * Any request path ending in `elah-input.json` is answered from the sample folder; everything else is
 * served from `artifact/dist/`, so the page behaves exactly as it will when published beside its input.
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ART = dirname(fileURLToPath(import.meta.url))
const DIST = join(ART, 'dist')
const SAMPLES = join(ART, 'samples')
const port = Number(process.argv[2] ?? 4400)
if (!(port >= 4400 && port <= 4499)) {
  console.error('Use a port in 4400-4499')
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean)
  let sample = 'promo'
  if (parts.length > 0 && existsSync(join(SAMPLES, parts[0])) && statSync(join(SAMPLES, parts[0])).isDirectory()) {
    sample = parts.shift()
  }
  const rel = parts.join('/') || 'index.html'
  // assets/<name>: the images a sample supplies (TICKET-PF-11), published beside the page on claude.ai.
  const sampleAssets = join(SAMPLES, sample, 'assets')
  const isAsset = rel.startsWith('assets/')
  const file =
    rel === 'elah-input.json'
      ? join(SAMPLES, sample, 'elah-input.json')
      : isAsset
        ? resolve(sampleAssets, normalize(rel.slice('assets/'.length)))
        : resolve(DIST, normalize(rel))
  const inside = rel === 'elah-input.json' || (isAsset ? file.startsWith(sampleAssets + sep) : file.startsWith(DIST + sep))
  if (!inside || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  res.end(readFileSync(file))
}).listen(port, () => console.log(`Elah artifact on http://localhost:${port}/  (samples: promo, title-card, project)`))
