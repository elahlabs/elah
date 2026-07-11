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

/**
 * Text-only spec (no media assets) so the copy-paste example renders on a
 * machine with nothing but the server running. fps/stage fall back to spec
 * defaults (30, 1920x1080).
 */
export const HELLO_SPEC =
  '{"clips":[{"track":"text","text":"Hello from elah","start":0,"duration":3,"fontSize":96}]}'

export function curlExample(origin: string): string {
  return `curl -X POST ${origin}/render -H 'content-type: application/json' -d '${HELLO_SPEC}' -o hello.mp4`
}

/**
 * PowerShell aliases `curl` to Invoke-WebRequest, which doesn't accept -H/-d
 * the curl way. Point Windows users at curl.exe (or Invoke-RestMethod).
 */
export function powershellExample(origin: string): string {
  return `Invoke-RestMethod -Uri "${origin}/render" -Method Post -ContentType "application/json" -Body '${HELLO_SPEC}' -OutFile hello.mp4`
}

/** GET / — a human clicked the listen address; orient them instead of a JSON 404. */
function welcomePage(origin: string, browserConnected: boolean): string {
  const escapedCurl = curlExample(origin).replace(/</g, '&lt;')
  const escapedPowershell = powershellExample(origin).replace(/</g, '&lt;')
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>elah serve</title>
<style>
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
         max-width: 720px; margin: 3rem auto; padding: 0 1rem; line-height: 1.6;
         background: #0d1117; color: #e6edf3; }
  h1 { font-size: 1.3rem; } h1 span { color: #7ee787; }
  code, pre { background: #161b22; border: 1px solid #30363d; border-radius: 6px; }
  code { padding: 0.1em 0.4em; }
  pre { padding: 0.8em 1em; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  table { border-collapse: collapse; } td { padding: 0.15em 1em 0.15em 0; vertical-align: top; }
  a { color: #58a6ff; }
  .muted { color: #8b949e; }
</style>
<h1>elah serve <span>&#9679; ${browserConnected ? 'browser connected' : 'browser disconnected'}</span></h1>
<p>Headless render server for the <a href="https://www.elah.dev">elah</a> video engine.
POST a build spec, get an MP4 back.</p>
<table>
  <tr><td><code>GET /healthz</code></td><td class="muted">status + browser state</td></tr>
  <tr><td><code>POST /render</code></td><td class="muted">build spec JSON in, <code>video/mp4</code> out</td></tr>
</table>
<p>Render your first video (no media files needed):</p>
<pre>${escapedCurl}</pre>
<p class="muted">On Windows PowerShell, <code>curl</code> is aliased to Invoke-WebRequest and won't accept <code>-H</code>/<code>-d</code> the curl way &mdash; use this instead:</p>
<pre>${escapedPowershell}</pre>
<p class="muted">Spec schema: assets map + clips array &mdash; see the
<a href="https://github.com/elahlabs/elah/tree/main/packages/cli#readme">@elah/cli README</a>.</p>
`
}

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

  if (url.pathname === '/') {
    if (req.method !== 'GET') {
      writeJson(res, 405, { error: 'method not allowed' })
      return
    }
    const origin = `http://${req.headers.host ?? 'localhost'}`
    const html = welcomePage(origin, deps.browserConnected())
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) })
    res.end(html)
    return
  }

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
