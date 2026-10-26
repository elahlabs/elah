import { usageError } from '../lib/errors'
import { parsePositiveInt } from '../lib/flags'
import { createRenderSession } from '../lib/render-session'
import { resolveOutputFormat } from '../lib/format'
import { ENCODER_CHOICES, type EncoderChoice } from '../lib/ffmpeg/select'
import { curlExample, powershellExample, startServe } from '../lib/serve'

export interface ServeArgs {
  port?: string
  host?: string
  concurrency?: string
  mediaRoot?: string
  container?: string
  codec?: string
  height?: string
  videoBitrate?: string
  audioBitrate?: string
  encoder?: string
  ffmpeg?: string
  browser?: string
  timeoutSec?: string
  verbose: boolean
}

export async function runServe(args: ServeArgs): Promise<void> {
  const format = resolveOutputFormat({ container: args.container, videoCodec: args.codec })
  if (args.encoder !== undefined && !(ENCODER_CHOICES as readonly string[]).includes(args.encoder)) {
    throw usageError(`--encoder must be one of: ${ENCODER_CHOICES.join(', ')}`)
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

  const session = createRenderSession({ browserPath: args.browser, ffmpegPath: args.ffmpeg })
  await session.warmup()

  const handle = await startServe({
    host,
    port,
    concurrency,
    mediaRoot,
    session,
    render: {
      container: format.container,
      videoCodec: format.videoCodec,
      outputHeight: height,
      videoBitrate,
      audioBitrate,
      encoder: args.encoder as EncoderChoice | undefined,
      timeoutMs,
    },
    log: stderr,
    verbose: args.verbose,
  })

  stderr(`elah serve listening on http://${host}:${handle.port} (concurrency ${concurrency}, media root ${mediaRoot})`)
  if (host !== '127.0.0.1') {
    stderr('warning: no authentication — expose only on a trusted network')
  }
  stderr('')
  const renderOrigin = `http://${host}:${handle.port}`
  stderr('render your first video:')
  if (process.platform === 'win32') {
    stderr(`  ${powershellExample(renderOrigin)}`)
    stderr(`  (or, with curl.exe: ${curlExample(renderOrigin)})`)
  } else {
    stderr(`  ${curlExample(renderOrigin)}`)
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
