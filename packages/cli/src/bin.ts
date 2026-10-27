import { parseArgs } from 'node:util'
import { CliError, usageError } from './lib/errors'

// Inlined from package.json by the esbuild define at build time.
declare const __ELAH_CLI_VERSION__: string | undefined
const VERSION = typeof __ELAH_CLI_VERSION__ === 'string' ? __ELAH_CLI_VERSION__ : '0.0.0-dev'

const USAGE = `elah — headless CLI for the Elah video engine

Usage:
  elah split  --project <in.json> --clip <clipId> --at <frame|timecode> [--out <out.json>]
  elah trim   --project <in.json> --clip <clipId> [--start <frame|timecode>]
              [--duration <frames|timecode>] [--out <out.json>]
  elah export --project <in.json> --out <file.mp4|file.webm> [--container mp4|webm]
              [--codec avc|hevc|av1|vp9|vp8] [--height <N>] [--video-bitrate <bps>] [--audio-bitrate <bps>]
              [--encoder auto|ffmpeg|chrome] [--ffmpeg <path>] [--browser <path>] [--headed] [--timeout <s>]
  elah build  --spec <spec.json> [--out <project.json>] [--export <file.mp4|file.webm>] [export options]
  elah serve  [--port <n>] [--host <addr>] [--concurrency <n>] [--media-root <dir>]
              [--container mp4|webm] [--codec avc|hevc|av1|vp9|vp8] [--height <N>] [--video-bitrate <bps>]
              [--audio-bitrate <bps>] [--encoder auto|ffmpeg|chrome] [--ffmpeg <path>] [--browser <path>]
              [--timeout <s>] [--verbose]

split/trim write the resulting project JSON to stdout unless --out is given.
The container follows --container, else the output file's extension (.webm), else MP4.
MP4 takes avc (default), hevc or av1 with AAC audio; WebM takes vp9 (default), vp8 or av1 with Opus.
Export draws every frame in Chrome. --encoder auto (default) encodes with ffmpeg 4.4+ when found
(--ffmpeg, ELAH_FFMPEG, then PATH) and falls back to Chrome's encoder with a warning.
build consumes a seconds-based spec (assets map + clips) — see packages/cli/README.md
for the schema; it probes media durations and constructs the project via the engine.
Timecodes: SS:FF, MM:SS:FF or HH:MM:SS:FF at the project fps.
Exit codes: 0 success · 1 validation/runtime failure · 2 usage error.
`

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE)
    return
  }
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${VERSION}\n`)
    return
  }

  switch (command) {
    case 'split': {
      const { values } = parse(rest, {
        project: { type: 'string' },
        clip: { type: 'string' },
        at: { type: 'string' },
        out: { type: 'string' },
      })
      const { runSplit } = await import('./commands/split')
      runSplit({
        project: required(values.project, '--project'),
        clip: required(values.clip, '--clip'),
        at: required(values.at, '--at'),
        out: values.out,
      })
      return
    }
    case 'trim': {
      const { values } = parse(rest, {
        project: { type: 'string' },
        clip: { type: 'string' },
        start: { type: 'string' },
        duration: { type: 'string' },
        out: { type: 'string' },
      })
      const { runTrim } = await import('./commands/trim')
      runTrim({
        project: required(values.project, '--project'),
        clip: required(values.clip, '--clip'),
        start: values.start,
        duration: values.duration,
        out: values.out,
      })
      return
    }
    case 'export': {
      const { values } = parse(rest, {
        project: { type: 'string' },
        out: { type: 'string' },
        container: { type: 'string' },
        codec: { type: 'string' },
        height: { type: 'string' },
        'video-bitrate': { type: 'string' },
        'audio-bitrate': { type: 'string' },
        encoder: { type: 'string' },
        ffmpeg: { type: 'string' },
        browser: { type: 'string' },
        headed: { type: 'boolean' },
        timeout: { type: 'string' },
        verbose: { type: 'boolean' },
      })
      // Lazy import keeps split/trim (and --help) free of the export/browser code path.
      const { runExport } = await import('./commands/export')
      await runExport({
        project: required(values.project, '--project'),
        out: required(values.out, '--out'),
        container: values.container,
        codec: values.codec,
        height: values.height,
        videoBitrate: values['video-bitrate'],
        audioBitrate: values['audio-bitrate'],
        encoder: values.encoder,
        ffmpeg: values.ffmpeg,
        browser: values.browser,
        headed: values.headed ?? false,
        timeoutSec: values.timeout,
        verbose: values.verbose ?? false,
      })
      return
    }
    case 'build': {
      const { values } = parse(rest, {
        spec: { type: 'string' },
        out: { type: 'string' },
        export: { type: 'string' },
        container: { type: 'string' },
        codec: { type: 'string' },
        height: { type: 'string' },
        'video-bitrate': { type: 'string' },
        'audio-bitrate': { type: 'string' },
        encoder: { type: 'string' },
        ffmpeg: { type: 'string' },
        browser: { type: 'string' },
        headed: { type: 'boolean' },
        timeout: { type: 'string' },
        verbose: { type: 'boolean' },
      })
      const { runBuild } = await import('./commands/build')
      await runBuild({
        spec: required(values.spec, '--spec'),
        out: values.out,
        export: values.export,
        container: values.container,
        codec: values.codec,
        height: values.height,
        videoBitrate: values['video-bitrate'],
        audioBitrate: values['audio-bitrate'],
        encoder: values.encoder,
        ffmpeg: values.ffmpeg,
        browser: values.browser,
        headed: values.headed ?? false,
        timeoutSec: values.timeout,
        verbose: values.verbose ?? false,
      })
      return
    }
    case 'serve': {
      const { values } = parse(rest, {
        port: { type: 'string' },
        host: { type: 'string' },
        concurrency: { type: 'string' },
        'media-root': { type: 'string' },
        container: { type: 'string' },
        codec: { type: 'string' },
        height: { type: 'string' },
        'video-bitrate': { type: 'string' },
        'audio-bitrate': { type: 'string' },
        encoder: { type: 'string' },
        ffmpeg: { type: 'string' },
        browser: { type: 'string' },
        timeout: { type: 'string' },
        verbose: { type: 'boolean' },
      })
      const { runServe } = await import('./commands/serve')
      await runServe({
        port: values.port,
        host: values.host,
        concurrency: values.concurrency,
        mediaRoot: values['media-root'],
        container: values.container,
        codec: values.codec,
        height: values.height,
        videoBitrate: values['video-bitrate'],
        audioBitrate: values['audio-bitrate'],
        encoder: values.encoder,
        ffmpeg: values.ffmpeg,
        browser: values.browser,
        timeoutSec: values.timeout,
        verbose: values.verbose ?? false,
      })
      return
    }
    default:
      throw usageError(`Unknown command '${command}'.\n\n${USAGE}`)
  }
}

function parse<T extends Record<string, { type: 'string' | 'boolean' }>>(
  args: string[],
  options: T
) {
  try {
    return parseArgs({ args, options, allowPositionals: false })
  } catch (err) {
    throw usageError(`${(err as Error).message}\n\n${USAGE}`)
  }
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined) throw usageError(`Missing required option ${flag}\n\n${USAGE}`)
  return value
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof CliError) {
    process.stderr.write(`error: ${err.message}\n`)
    process.exit(err.exitCode)
  }
  process.stderr.write(`unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  process.exit(1)
})
