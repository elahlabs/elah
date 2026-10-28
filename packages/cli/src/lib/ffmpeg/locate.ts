import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CliError } from '../errors'

const execFileAsync = promisify(execFile)

/**
 * ffmpeg discovery, version floor, and encoder listing.
 *
 * ffmpeg is a system binary, like Chrome: never an npm dependency. A vendored
 * static build would add tens of MB, pull GPL-licensed code into the
 * dependency graph, and lose the hardware encoders only the platform's own
 * build has. Discovery mirrors browser.ts: --ffmpeg flag → ELAH_FFMPEG env →
 * `ffmpeg` on PATH.
 *
 * Ported from task-engine's media-export engine (itself from elahlabs/elah
 * PR #59's packages/export-server).
 */

/**
 * Lowest ffmpeg the encode path accepts. Encoding PNG frames needs nothing
 * newer than 4.4 (Ubuntu 22.04's build); an ffmpeg decode path would need
 * 5.1 for `-fps_mode passthrough`.
 */
export const MIN_FFMPEG_VERSION: readonly [number, number] = [4, 4]

export interface FfmpegBinary {
  /** Path or bare command name that was verified to run. */
  path: string
  /** First line of `ffmpeg -version`, kept verbatim for messages. */
  versionLine: string
  /** Parsed [major, minor]; null for git/nightly builds with no numeric version. */
  version: [number, number] | null
  /** Encoder names reported by `ffmpeg -encoders`. */
  encoders: ReadonlySet<string>
}

export interface LocateFfmpegOptions {
  /** Explicit executable path (--ffmpeg); wins over discovery. */
  ffmpegPath?: string
}

/**
 * Parses `ffmpeg -version` stdout into [major, minor]. Only the first line is
 * read, and a leading `n` is tolerated (BtbN static builds print
 * `version n6.1.1`). Git/nightly builds (`version N-118234-g0abcdef`) have no
 * numeric version and return null, so a custom build is not locked out.
 */
export function parseFfmpegVersion(stdout: string): [number, number] | null {
  const firstLine = stdout.split('\n')[0] ?? ''
  const match = /version\s+n?(\d+)\.(\d+)/.exec(firstLine)
  if (!match) return null
  return [Number(match[1]), Number(match[2])]
}

/**
 * Parses `ffmpeg -encoders` stdout into the set of encoder names. Lines look
 * like ` V....D libx264  libx264 H.264 ...`: each of the six flag columns has
 * its own alphabet, and matching it exactly matters — a loose `[VAS.]{6}`
 * rejects the `D`/`F`/`S` flags most real encoders (libx264 included) set.
 * The legend's ` V..... = Video` rows fit the flag columns too; the name
 * class excludes their `=`.
 */
export function parseEncoders(stdout: string): Set<string> {
  const encoders = new Set<string>()
  const lineRe = /^\s[VAS][F.][S.][X.][B.][D.]\s+([\w-]+)/gm
  let match: RegExpExecArray | null
  while ((match = lineRe.exec(stdout)) !== null) {
    encoders.add(match[1]!)
  }
  return encoders
}

function compareVersions(a: readonly [number, number], b: readonly [number, number]): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]
}

/**
 * Locate a usable ffmpeg and list its encoders. A found-but-too-old binary
 * fails immediately rather than falling through to the next candidate: that
 * is a fact about the user's install, not evidence the path is wrong.
 */
export async function locateFfmpeg(options: LocateFfmpegOptions = {}): Promise<FfmpegBinary> {
  const explicit = options.ffmpegPath ?? process.env.ELAH_FFMPEG
  const candidates = explicit ? [explicit] : ['ffmpeg']

  let lastError: Error | undefined
  for (const candidate of candidates) {
    let stdout: string
    try {
      ;({ stdout } = await execFileAsync(candidate, ['-version']))
    } catch (err) {
      lastError = err as Error
      continue
    }
    const versionLine = stdout.split('\n')[0]?.trim() ?? ''
    const version = parseFfmpegVersion(stdout)
    if (version !== null && compareVersions(version, MIN_FFMPEG_VERSION) < 0) {
      throw new CliError(
        `ffmpeg at '${candidate}' is version ${version[0]}.${version[1]}; the CLI needs ` +
          `${MIN_FFMPEG_VERSION[0]}.${MIN_FFMPEG_VERSION[1]} or newer. Found: ${versionLine}`
      )
    }
    const { stdout: encodersOut } = await execFileAsync(candidate, ['-hide_banner', '-encoders'])
    return { path: candidate, versionLine, version, encoders: parseEncoders(encodersOut) }
  }

  throw new CliError(
    'No ffmpeg found. Install ffmpeg 4.4+ (brew install ffmpeg / apt install ffmpeg / ' +
      'winget install ffmpeg), or pass --ffmpeg <path-to-ffmpeg> (or set ELAH_FFMPEG). ' +
      `Last error: ${lastError?.message}`
  )
}
