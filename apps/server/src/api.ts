import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, createWriteStream, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Busboy from 'busboy'
import { build, createRenderSession, validateSpec, CliError, Semaphore, type BuildSpec } from '@elah/cli'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(here, '..', 'assets')

const HOST = process.env.HOST ?? '127.0.0.1'
const PORT = Number(process.env.PORT ?? 8081)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 1)
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 500 * 1024 * 1024)

// Extension fallback for uploads whose filename has none — the harness
// server picks a content-type off the saved file's extension.
const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/aac': '.aac',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
}

interface ParsedRequest {
  spec: unknown
  /** Free-text creative brief. Unused today — reserved for a future
   * Claude-driven layer that turns this into (part of) the spec. */
  prompt?: string
  mediaRoot: string
  /** asset field name -> saved absolute file path, for "upload:<field>" assets. */
  uploads: Map<string, string>
  cleanup(): void
}

/**
 * multipart/form-data body: a "spec" text field (BuildSpec JSON — assets are
 * either CDN URLs or "upload:<field>" pointers), an optional "prompt" text
 * field, and one file part per upload reference.
 */
async function parseMultipart(req: IncomingMessage): Promise<ParsedRequest> {
  const mediaRoot = mkdtempSync(join(tmpdir(), 'elah-api-'))
  const cleanup = () => rmSync(mediaRoot, { recursive: true, force: true })

  try {
    return await new Promise<ParsedRequest>((resolve, reject) => {
      let spec: unknown
      let specErr: Error | undefined
      let prompt: string | undefined
      const uploads = new Map<string, string>()
      const pending: Promise<void>[] = []

      const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD_BYTES } })

      bb.on('field', (name, value) => {
        if (name === 'spec') {
          try {
            spec = JSON.parse(value)
          } catch (err) {
            specErr = new CliError(`'spec' field is not valid JSON: ${(err as Error).message}`)
          }
        } else if (name === 'prompt') {
          prompt = value
        }
      })

      bb.on('file', (fieldname, stream, info) => {
        // Some clients (curl -F "spec=@file.json") send even the JSON spec
        // as a file part rather than a text field — buffer it in memory.
        if (fieldname === 'spec') {
          const chunks: Buffer[] = []
          pending.push(
            new Promise<void>((res, rej) => {
              stream.on('data', (c: Buffer) => chunks.push(c))
              stream.on('end', () => {
                try {
                  spec = JSON.parse(Buffer.concat(chunks).toString('utf8'))
                } catch (err) {
                  specErr = new CliError(`'spec' field is not valid JSON: ${(err as Error).message}`)
                }
                res()
              })
              stream.on('error', rej)
            })
          )
          return
        }

        const ext = extname(info.filename ?? '') || EXT_BY_MIME[info.mimeType] || ''
        const dest = join(mediaRoot, `${fieldname}${ext}`)
        uploads.set(fieldname, dest)
        const write = createWriteStream(dest)
        pending.push(
          new Promise<void>((res, rej) => {
            stream.pipe(write)
            write.on('finish', res)
            write.on('error', rej)
            stream.on('error', rej)
          })
        )
      })

      bb.on('error', (err) => reject(err as Error))
      bb.on('close', () => {
        Promise.all(pending)
          .then(() => {
            if (specErr) reject(specErr)
            else if (spec === undefined) reject(new CliError("multipart request must include a 'spec' text field"))
            else resolve({ spec, prompt, mediaRoot, uploads, cleanup })
          })
          .catch(reject)
      })

      req.pipe(bb)
    })
  } catch (err) {
    cleanup()
    throw err
  }
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > maxBytes) {
        reject(new CliError(`request body exceeds ${maxBytes} bytes`))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** application/json body: assets are CDN URLs or paths under apps/server/assets. */
async function parseJson(req: IncomingMessage): Promise<ParsedRequest> {
  const body = await readBody(req, MAX_UPLOAD_BYTES)
  let spec: unknown
  try {
    spec = JSON.parse(body.toString('utf8'))
  } catch (err) {
    throw new CliError(`request body is not valid JSON: ${(err as Error).message}`)
  }
  return { spec, mediaRoot: assetsDir, uploads: new Map(), cleanup: () => {} }
}

/** Rewrite "upload:<field>" asset references to the saved file's absolute path. */
function resolveUploadedAssets(spec: BuildSpec, uploads: Map<string, string>): void {
  if (!spec.assets) return
  for (const [name, value] of Object.entries(spec.assets)) {
    if (!value.startsWith('upload:')) continue
    const field = value.slice('upload:'.length)
    const path = uploads.get(field)
    if (!path) {
      throw new CliError(
        `assets['${name}'] references upload:${field}, but no file was attached under that field name`
      )
    }
    spec.assets[name] = path
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) })
  res.end(json)
}

async function main(): Promise<void> {
  const session = createRenderSession()
  await session.warmup()
  const semaphore = new Semaphore(CONCURRENCY)

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/healthz') {
      if (req.method !== 'GET') return void writeJson(res, 405, { error: 'method not allowed' })
      writeJson(res, 200, { status: 'ok', browser: session.browserConnected() ? 'connected' : 'disconnected' })
      return
    }

    if (url.pathname !== '/api/render') return void writeJson(res, 404, { error: 'not found' })
    if (req.method !== 'POST') return void writeJson(res, 405, { error: 'method not allowed' })

    if (!semaphore.tryAcquire()) {
      res.setHeader('Retry-After', '5')
      writeJson(res, 503, { error: 'render capacity exhausted; retry later' })
      return
    }

    const jobId = randomUUID().slice(0, 8)
    const start = Date.now()
    let parsed: ParsedRequest | undefined
    try {
      const contentType = req.headers['content-type'] ?? ''
      parsed = contentType.includes('multipart/form-data') ? await parseMultipart(req) : await parseJson(req)

      const spec = validateSpec(parsed.spec)
      resolveUploadedAssets(spec, parsed.uploads)

      console.error(
        `[job ${jobId}] render start (${readdirSync(parsed.mediaRoot).length} local file(s))` +
          (parsed.prompt ? ` — prompt attached, not yet used: "${parsed.prompt}"` : '')
      )

      const { project } = await build({ spec, baseDir: parsed.mediaRoot })
      const bytes = await session.render(
        project,
        parsed.mediaRoot,
        {},
        { onWarning: (message) => console.error(`[job ${jobId}] warning: ${message}`) }
      )

      console.error(`[job ${jobId}] done in ${((Date.now() - start) / 1000).toFixed(1)}s (${bytes.length} bytes)`)
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': bytes.length })
      res.end(bytes)
    } catch (err) {
      if (err instanceof CliError) {
        writeJson(res, 422, { error: err.message })
      } else {
        console.error(`[job ${jobId}] failed:`, err)
        writeJson(res, 500, { error: 'internal render failure' })
      }
    } finally {
      parsed?.cleanup()
      semaphore.release()
    }
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      console.error(err)
      if (!res.headersSent) writeJson(res, 500, { error: 'internal server error' })
      else res.end()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, HOST, () => resolve())
  })

  console.log(`API listening on http://${HOST}:${PORT}`)
  console.log(`  GET  /healthz`)
  console.log(`  POST /api/render   application/json  OR  multipart/form-data`)

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) process.exit(130)
    shuttingDown = true
    console.error('shutting down...')
    server.close(() => {
      void session.close().then(() => process.exit(0))
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
