import { usageError } from '../lib/errors'
import { parsePositiveInt } from '../lib/flags'
import { CODECS, createRenderSession } from '../lib/render-session'
import { startServe } from '../lib/serve'

export interface ServeArgs {
  port?: string
  host?: string
  concurrency?: string
  mediaRoot?: string
  codec?: string
  height?: string
  videoBitrate?: string
  audioBitrate?: string
  browser?: string
  timeoutSec?: string
  verbose: boolean
}

export async function runServe(args: ServeArgs): Promise<void> {
  if (args.codec !== undefined && !(CODECS as readonly string[]).includes(args.codec)) {
    throw usageError(`--codec must be one of: ${CODECS.join(', ')}`)
  }
  const port = args.port !== undefined ? parsePositiveInt(args.port, '--port') : 8080
  const concurrency = args.concurrency !== undefined ? parsePositiveInt(args.concurrency, '--concurrency') : 1
  const height = args.height !== undefined ? parsePositiveInt(args.height, '--height') : undefined
  const videoBitrate =
    args.videoBitrate !== undefined ? parsePositiveInt(args.videoBitrate, '--video-bitrate') : undefined
  const audioBitrate =
    args.audioBitrate !== undefined ? parsePositiveInt(args.audioBitrate, '--audio-bitrate') : undefined
  const timeoutMs =
    (args.timeoutSec !== undefined ? parsePositiveInt(args.timeoutSec, '--timeout') : 600) * 1000
  const host = args.host ?? '127.0.0.1'
  const mediaRoot = args.mediaRoot ?? process.cwd()

  const stderr = (line: string) => process.stderr.write(`${line}\n`)

  const session = createRenderSession({ browserPath: args.browser })
  await session.warmup()

  const handle = await startServe({
    host,
    port,
    concurrency,
    mediaRoot,
    session,
    render: {
      videoCodec: args.codec as (typeof CODECS)[number] | undefined,
      outputHeight: height,
      videoBitrate,
      audioBitrate,
      timeoutMs,
    },
    log: stderr,
    verbose: args.verbose,
  })

  stderr(`elah serve listening on http://${host}:${handle.port} (concurrency ${concurrency}, media root ${mediaRoot})`)
  if (host !== '127.0.0.1') {
    stderr('warning: no authentication — expose only on a trusted network')
  }

  await new Promise<void>((resolve) => {
    let shuttingDown = false
    const shutdown = () => {
      if (shuttingDown) {
        process.exit(130)
      }
      shuttingDown = true
      stderr('shutting down...')
      void handle
        .close()
        .then(() => session.close())
        .then(() => resolve())
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}
