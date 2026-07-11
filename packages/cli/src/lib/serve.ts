import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { Project } from '@elah/core'
import { CliError } from './errors'
import { buildProject } from './build-project'
import type { RenderJobOptions, RenderSession } from './render-session'

export class Semaphore {
  private activeCount = 0

  constructor(readonly max: number) {}

  get active(): number {
    return this.activeCount
  }

  tryAcquire(): boolean {
    if (this.activeCount >= this.max) return false
    this.activeCount += 1
    return true
  }

  release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1)
  }
}

export interface ServeHandlerDeps {
  buildSpec(spec: unknown): Promise<Project>
  renderProject(project: Project, jobId: string): Promise<Buffer>
  browserConnected(): boolean
  semaphore: Semaphore
  maxBodyBytes: number
  log(line: string): void
}

const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024

export function createServeHandler(
  deps: ServeHandlerDeps
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void handle(req, res, deps).catch((err: unknown) => {
      deps.log(`serve handler error: ${(err as Error).stack ?? (err as Error).message}`)
      if (!res.headersSent) writeJson(res, 500, { error: 'internal server error' })
      else res.end()
    })
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, deps: ServeHandlerDeps): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (url.pathname === '/healthz') {
    if (req.method !== 'GET') {
      writeJson(res, 405, { error: 'method not allowed' })
      return
    }
    writeJson(res, 200, { status: 'ok', browser: deps.browserConnected() ? 'connected' : 'disconnected' })
    return
  }

  if (url.pathname === '/render') {
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'method not allowed' })
      return
    }
    await handleRender(req, res, deps)
    return
  }

  writeJson(res, 404, { error: 'not found' })
}

async function handleRender(req: IncomingMessage, res: ServerResponse, deps: ServeHandlerDeps): Promise<void> {
  if (!deps.semaphore.tryAcquire()) {
    res.setHeader('Retry-After', '5')
    writeJson(res, 503, { error: 'render capacity exhausted; retry later' })
    return
  }

  const jobId = randomUUID().slice(0, 8)
  const start = Date.now()
  try {
    let body: Buffer
    try {
      body = await readBody(req, deps.maxBodyBytes)
    } catch (err) {
      if ((err as Error).message === 'body too large') {
        writeJson(res, 413, { error: `request body exceeds ${deps.maxBodyBytes} bytes` })
        return
      }
      throw err
    }

    let spec: unknown
    try {
      spec = JSON.parse(body.toString('utf8'))
    } catch (err) {
      writeJson(res, 400, { error: `request body is not valid JSON: ${(err as Error).message}` })
      return
    }

    deps.log(`[job ${jobId}] render start`)

    let project: Project
    try {
      project = await deps.buildSpec(spec)
    } catch (err) {
      if (err instanceof CliError) {
        writeJson(res, 422, { error: err.message })
      } else {
        deps.log(`[job ${jobId}] failed (build): ${(err as Error).stack ?? (err as Error).message}`)
        writeJson(res, 500, { error: 'internal build failure' })
      }
      return
    }

    let bytes: Buffer
    try {
      bytes = await deps.renderProject(project, jobId)
    } catch (err) {
      const message = err instanceof CliError ? err.message : 'internal render failure'
      deps.log(`[job ${jobId}] failed (render): ${(err as Error).stack ?? (err as Error).message}`)
      writeJson(res, 500, { error: message })
      return
    }

    deps.log(`[job ${jobId}] done in ${((Date.now() - start) / 1000).toFixed(1)}s (${bytes.length} bytes)`)
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': bytes.length })
    res.end(bytes)
  } finally {
    deps.semaphore.release()
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) })
  res.end(json)
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = []
    let total = 0
    let tooLarge = false
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > maxBytes) {
        // Keep draining the request stream (so 'end' still fires and the
        // socket isn't torn down mid-response) but stop buffering it.
        tooLarge = true
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (tooLarge) rej(new Error('body too large'))
      else res(Buffer.concat(chunks))
    })
    req.on('error', rej)
  })
}

export interface ServeOptions {
  host: string
  /** 0 = ephemeral port (tests). */
  port: number
  concurrency: number
  /** Absolute dir that relative spec asset paths resolve against. */
  mediaRoot: string
  /** Server-level codec/height/bitrate/timeout applied to every render. */
  render: RenderJobOptions
  session: RenderSession
  maxBodyBytes?: number
  log?: (line: string) => void
  verbose?: boolean
}

export interface ServeHandle {
  port: number
  close(): Promise<void>
}

export async function startServe(options: ServeOptions): Promise<ServeHandle> {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`))
  const semaphore = new Semaphore(options.concurrency)
  const lastDecile = new Map<string, number>()

  const deps: ServeHandlerDeps = {
    buildSpec: (spec) => buildProject({ spec, baseDir: options.mediaRoot }).then((r) => r.project),
    renderProject: (project, jobId) =>
      options.session.render(project, options.mediaRoot, options.render, {
        onWarning: (message) => log(`[job ${jobId}] warning: ${message}`),
        ...(options.verbose
          ? {
              onLog: (line: string) => log(`[job ${jobId}] ${line}`),
              onProgress: ({ frame, totalFrames }: { frame: number; totalFrames: number }) => {
                const decile = Math.floor((10 * (frame + 1)) / totalFrames)
                if (lastDecile.get(jobId) === decile) return
                lastDecile.set(jobId, decile)
                log(`[job ${jobId}] progress ${Math.min(frame + 1, totalFrames)}/${totalFrames}`)
              },
            }
          : {}),
      }),
    browserConnected: () => options.session.browserConnected(),
    semaphore,
    maxBodyBytes: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    log,
  }

  const server = createServer(createServeHandler(deps))

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new CliError('Serve HTTP server failed to bind a port')
  }

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeIdleConnections()
        server.close(() => resolve())
      }),
  }
}
